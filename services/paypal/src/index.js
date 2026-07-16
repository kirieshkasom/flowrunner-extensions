const logger = {
  info: (...args) => console.log('[PayPal] info:', ...args),
  debug: (...args) => console.log('[PayPal] debug:', ...args),
  error: (...args) => console.log('[PayPal] error:', ...args),
  warn: (...args) => console.log('[PayPal] warn:', ...args),
}

const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com'
const LIVE_BASE_URL = 'https://api-m.paypal.com'

const TOKEN_LIFETIME_SECONDS = 32400 // PayPal access tokens live ~9 hours
const TOKEN_REFRESH_MARGIN_MS = 60000 // refresh ~60s before expiry

/**
 * @integrationName PayPal
 * @integrationIcon /icon.svg
 */
class PayPal {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.baseUrl = config.environment === 'Live' ? LIVE_BASE_URL : SANDBOX_BASE_URL
    // Monotonic counter for idempotency keys (repo rules forbid Math.random).
    this.requestCounter = 0
  }

  // ==================================================================================
  // Internal helpers
  // ==================================================================================

  async #getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.accessToken
    }

    logger.debug('requesting a new access token (client_credentials)')

    const basicAuth = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    let response

    try {
      response = await Flowrunner.Request.post(`${ this.baseUrl }/v1/oauth2/token`)
        .set({
          'Authorization': `Basic ${ basicAuth }`,
          'Content-Type': 'application/x-www-form-urlencoded',
        })
        .send('grant_type=client_credentials')
    } catch (error) {
      const message = error.body?.error_description || error.body?.error || error.message

      throw new Error(`Failed to obtain a PayPal access token: ${ message }. Check the Client ID, Client Secret, and Environment.`)
    }

    if (!response.access_token) {
      throw new Error('PayPal token endpoint did not return an access token')
    }

    this.accessToken = response.access_token
    this.accessTokenExpiresAt = Date.now() + (response.expires_in || TOKEN_LIFETIME_SECONDS) * 1000

    return this.accessToken
  }

  async #apiRequest({ url, method = 'get', body, query, headers, logTag }) {
    const accessToken = await this.#getAccessToken()

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](`${ this.baseUrl }${ url }`)
        .set({
          'Authorization': `Bearer ${ accessToken }`,
          'Content-Type': 'application/json',
          ...(headers || {}),
        })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const errorBody = error.body || {}
      const details = (errorBody.details || [])
        .map(item => item.description || item.issue)
        .filter(Boolean)
        .join('; ')

      const debugId = errorBody.debug_id ? ` (debug_id: ${ errorBody.debug_id })` : ''
      const message = [errorBody.message || errorBody.error_description || error.message, details].filter(Boolean).join(' - ')

      logger.error(`${ logTag } - failed: ${ message }${ debugId }`)

      throw new Error(`PayPal API error: ${ message }${ debugId }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Builds the PayPal-Request-Id idempotency header. Uses a caller-supplied key when present,
  // otherwise generates a timestamp + counter value (no Math.random per repo rules).
  #idempotencyHeaders(idempotencyKey) {
    const key = idempotencyKey && String(idempotencyKey).trim()
      ? String(idempotencyKey).trim()
      : `fr-${ Date.now() }-${ ++this.requestCounter }`

    return { 'PayPal-Request-Id': key }
  }

  #money(currencyCode, value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return { currency_code: currencyCode || 'USD', value: String(value) }
  }

  // ==================================================================================
  // Orders (Checkout v2)
  // ==================================================================================

  /**
   * @operationName Create Order
   * @description Creates a PayPal order (Checkout v2). Provide either a simple amount, currency, and
   * description to build a single purchase unit, or pass a raw purchaseUnits array (1-10 units) for full
   * control over items, shipping, and payees. The order intent controls whether funds are captured
   * immediately (Capture) or reserved for later capture (Authorize). Returns the order id, status, and
   * approval links.
   * @category Orders
   * @route POST /orders
   * @paramDef {"type":"String","label":"Intent","name":"intent","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Capture","Authorize"]}},"defaultValue":"Capture","description":"Whether to capture funds immediately or authorize (reserve) them for later capture."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","description":"Order total for the simple single-unit form (for example, 99.99). Ignored when Purchase Units is provided."}
   * @paramDef {"type":"String","label":"Currency Code","name":"currencyCode","defaultValue":"USD","description":"Three-letter ISO-4217 currency code for the simple form (for example, USD, EUR)."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description shown on the purchase unit in the simple form."}
   * @paramDef {"type":"Array<Object>","label":"Purchase Units","name":"purchaseUnits","description":"Raw purchase_units array (1-10 items) passed through verbatim; overrides the simple Amount/Currency/Description form."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional PayPal-Request-Id for safe retries. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"id":"5O190127TN364715T","status":"CREATED","links":[{"href":"https://www.paypal.com/checkoutnow?token=5O190127TN364715T","rel":"approve","method":"GET"}]}
   */
  async createOrder(intent, amount, currencyCode, description, purchaseUnits, idempotencyKey) {
    const units = Array.isArray(purchaseUnits) && purchaseUnits.length > 0
      ? purchaseUnits
      : [{
        amount: this.#money(currencyCode, amount),
        ...(description ? { description } : {}),
      }]

    const body = {
      intent: this.#resolveChoice(intent, { Capture: 'CAPTURE', Authorize: 'AUTHORIZE' }) || 'CAPTURE',
      purchase_units: units,
    }

    return this.#apiRequest({
      url: '/v2/checkout/orders',
      method: 'post',
      body,
      headers: this.#idempotencyHeaders(idempotencyKey),
      logTag: 'createOrder',
    })
  }

  /**
   * @operationName Get Order
   * @description Retrieves the full details of a PayPal order by its id, including status, purchase units,
   * payer information, and payment source.
   * @category Orders
   * @route GET /orders/{orderId}
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"The PayPal-generated order id (for example, 5O190127TN364715T)."}
   * @returns {Object}
   * @sampleResult {"id":"5O190127TN364715T","status":"APPROVED","intent":"CAPTURE","purchase_units":[{"amount":{"currency_code":"USD","value":"99.99"}}]}
   */
  async getOrder(orderId) {
    return this.#apiRequest({
      url: `/v2/checkout/orders/${ encodeURIComponent(orderId) }`,
      logTag: 'getOrder',
    })
  }

  /**
   * @operationName Capture Order
   * @description Captures payment for a previously approved order (intent Capture). The buyer must have
   * approved the order first. Returns the captured payment details, including the capture id used for
   * later refunds.
   * @category Orders
   * @route POST /orders/{orderId}/capture
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"The approved order id to capture."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional PayPal-Request-Id for safe retries. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"id":"5O190127TN364715T","status":"COMPLETED","purchase_units":[{"payments":{"captures":[{"id":"3C679366HH908993F","status":"COMPLETED"}]}}]}
   */
  async captureOrder(orderId, idempotencyKey) {
    return this.#apiRequest({
      url: `/v2/checkout/orders/${ encodeURIComponent(orderId) }/capture`,
      method: 'post',
      body: {},
      headers: this.#idempotencyHeaders(idempotencyKey),
      logTag: 'captureOrder',
    })
  }

  /**
   * @operationName Authorize Order
   * @description Authorizes (reserves) payment for a previously approved order with intent Authorize.
   * Returns the authorization details, including the authorization id used to capture or void the payment
   * later.
   * @category Orders
   * @route POST /orders/{orderId}/authorize
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"The approved order id to authorize."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional PayPal-Request-Id for safe retries. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"id":"5O190127TN364715T","status":"COMPLETED","purchase_units":[{"payments":{"authorizations":[{"id":"0VF52814937998046","status":"CREATED"}]}}]}
   */
  async authorizeOrder(orderId, idempotencyKey) {
    return this.#apiRequest({
      url: `/v2/checkout/orders/${ encodeURIComponent(orderId) }/authorize`,
      method: 'post',
      body: {},
      headers: this.#idempotencyHeaders(idempotencyKey),
      logTag: 'authorizeOrder',
    })
  }

  // ==================================================================================
  // Payments (v2)
  // ==================================================================================

  /**
   * @operationName Get Captured Payment
   * @description Retrieves the details of a captured payment by its capture id, including amount, status,
   * and whether it is the final capture.
   * @category Payments
   * @route GET /payments/captures/{captureId}
   * @paramDef {"type":"String","label":"Capture ID","name":"captureId","required":true,"description":"The id of the captured payment (for example, 3C679366HH908993F)."}
   * @returns {Object}
   * @sampleResult {"id":"3C679366HH908993F","status":"COMPLETED","amount":{"currency_code":"USD","value":"99.99"},"final_capture":true}
   */
  async getCapturedPayment(captureId) {
    return this.#apiRequest({
      url: `/v2/payments/captures/${ encodeURIComponent(captureId) }`,
      logTag: 'getCapturedPayment',
    })
  }

  /**
   * @operationName Refund Captured Payment
   * @description Refunds a captured payment. Leave the amount empty for a full refund, or provide an amount
   * and currency for a partial refund. Optionally add a note visible to the payer and an external invoice
   * id. Returns the refund id and status.
   * @category Payments
   * @route POST /payments/captures/{captureId}/refund
   * @paramDef {"type":"String","label":"Capture ID","name":"captureId","required":true,"description":"The id of the captured payment to refund."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","description":"Refund amount (for example, 25.00). Leave empty to refund the full captured amount."}
   * @paramDef {"type":"String","label":"Currency Code","name":"currencyCode","defaultValue":"USD","description":"Three-letter ISO-4217 currency code for a partial refund; must match the capture currency."}
   * @paramDef {"type":"String","label":"Note To Payer","name":"noteToPayer","description":"Optional reason for the refund shown to the payer (max 255 characters)."}
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","description":"Optional external invoice reference for the refund (max 127 characters)."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional PayPal-Request-Id for safe retries. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"id":"1JU08902781691411","status":"COMPLETED","amount":{"currency_code":"USD","value":"25.00"}}
   */
  async refundCapturedPayment(captureId, amount, currencyCode, noteToPayer, invoiceId, idempotencyKey) {
    const body = {}
    const money = this.#money(currencyCode, amount)

    if (money) {
      body.amount = money
    }

    if (noteToPayer) {
      body.note_to_payer = noteToPayer
    }

    if (invoiceId) {
      body.invoice_id = invoiceId
    }

    return this.#apiRequest({
      url: `/v2/payments/captures/${ encodeURIComponent(captureId) }/refund`,
      method: 'post',
      body,
      headers: this.#idempotencyHeaders(idempotencyKey),
      logTag: 'refundCapturedPayment',
    })
  }

  /**
   * @operationName Get Authorized Payment
   * @description Retrieves the details of an authorized (reserved) payment by its authorization id,
   * including amount, status, and expiration time.
   * @category Payments
   * @route GET /payments/authorizations/{authorizationId}
   * @paramDef {"type":"String","label":"Authorization ID","name":"authorizationId","required":true,"description":"The id of the authorized payment (for example, 0VF52814937998046)."}
   * @returns {Object}
   * @sampleResult {"id":"0VF52814937998046","status":"CREATED","amount":{"currency_code":"USD","value":"99.99"},"expiration_time":"2026-08-11T00:00:00Z"}
   */
  async getAuthorizedPayment(authorizationId) {
    return this.#apiRequest({
      url: `/v2/payments/authorizations/${ encodeURIComponent(authorizationId) }`,
      logTag: 'getAuthorizedPayment',
    })
  }

  /**
   * @operationName Capture Authorized Payment
   * @description Captures funds from a previously authorized payment. Leave the amount empty to capture the
   * full authorized amount. Set Final Capture to true when no further captures against this authorization
   * are expected. Returns the resulting capture id and status.
   * @category Payments
   * @route POST /payments/authorizations/{authorizationId}/capture
   * @paramDef {"type":"String","label":"Authorization ID","name":"authorizationId","required":true,"description":"The id of the authorized payment to capture."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","description":"Amount to capture (for example, 50.00). Leave empty to capture the full authorized amount."}
   * @paramDef {"type":"String","label":"Currency Code","name":"currencyCode","defaultValue":"USD","description":"Three-letter ISO-4217 currency code for a partial capture."}
   * @paramDef {"type":"Boolean","label":"Final Capture","name":"finalCapture","uiComponent":{"type":"CHECKBOX"},"description":"Set to true if this is the final capture for the authorization."}
   * @paramDef {"type":"String","label":"Note To Payer","name":"noteToPayer","description":"Optional note about this capture shown to the payer."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional PayPal-Request-Id for safe retries. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"id":"2GG279541U471931P","status":"COMPLETED","amount":{"currency_code":"USD","value":"50.00"},"final_capture":true}
   */
  async captureAuthorizedPayment(authorizationId, amount, currencyCode, finalCapture, noteToPayer, idempotencyKey) {
    const body = {}
    const money = this.#money(currencyCode, amount)

    if (money) {
      body.amount = money
    }

    if (finalCapture !== undefined && finalCapture !== null) {
      body.final_capture = Boolean(finalCapture)
    }

    if (noteToPayer) {
      body.note_to_payer = noteToPayer
    }

    return this.#apiRequest({
      url: `/v2/payments/authorizations/${ encodeURIComponent(authorizationId) }/capture`,
      method: 'post',
      body,
      headers: this.#idempotencyHeaders(idempotencyKey),
      logTag: 'captureAuthorizedPayment',
    })
  }

  /**
   * @operationName Void Authorized Payment
   * @description Voids (cancels) a previously authorized payment so the reserved funds are released. Once
   * voided, the authorization can no longer be captured.
   * @category Payments
   * @route POST /payments/authorizations/{authorizationId}/void
   * @paramDef {"type":"String","label":"Authorization ID","name":"authorizationId","required":true,"description":"The id of the authorized payment to void."}
   * @returns {Object}
   * @sampleResult {"id":"0VF52814937998046","status":"VOIDED"}
   */
  async voidAuthorizedPayment(authorizationId) {
    return this.#apiRequest({
      url: `/v2/payments/authorizations/${ encodeURIComponent(authorizationId) }/void`,
      method: 'post',
      body: {},
      logTag: 'voidAuthorizedPayment',
    })
  }

  // ==================================================================================
  // Invoicing (v2)
  // ==================================================================================

  /**
   * @operationName Create Draft Invoice
   * @description Creates a draft invoice. Provide the full PayPal invoice object via the Invoice parameter,
   * containing detail (currency_code, invoice_number, note), invoicer (business info), primary_recipients
   * (each with billing_info), and items (each with name, quantity, and unit_amount). The invoice is saved
   * as a draft; use Send Invoice to deliver it. Returns the created invoice id and status.
   * @category Invoicing
   * @route POST /invoicing/invoices
   * @paramDef {"type":"Object","label":"Invoice","name":"invoice","required":true,"description":"The full PayPal invoice object: {detail:{currency_code,invoice_number,note}, invoicer:{name,email_address}, primary_recipients:[{billing_info:{name,email_address}}], items:[{name,quantity,unit_amount:{currency_code,value}}]}."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional PayPal-Request-Id for safe retries. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"id":"INV2-Z56S-5LLA-Q52L-CPZ5","status":"DRAFT","detail":{"currency_code":"USD"},"amount":{"currency_code":"USD","value":"74.21"}}
   */
  async createDraftInvoice(invoice, idempotencyKey) {
    return this.#apiRequest({
      url: '/v2/invoicing/invoices',
      method: 'post',
      body: invoice || {},
      headers: this.#idempotencyHeaders(idempotencyKey),
      logTag: 'createDraftInvoice',
    })
  }

  /**
   * @operationName Send Invoice
   * @description Sends or schedules an invoice to the recipient by email. Optionally override the email
   * subject and note, and control whether copies go to the recipient and the invoicer. Moves the invoice
   * from DRAFT to SENT (or SCHEDULED).
   * @category Invoicing
   * @route POST /invoicing/invoices/{invoiceId}/send
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The id of the draft invoice to send."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Optional subject line for the invoice notification email."}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"Optional note included in the invoice notification email."}
   * @paramDef {"type":"Boolean","label":"Send To Recipient","name":"sendToRecipient","defaultValue":true,"uiComponent":{"type":"CHECKBOX"},"description":"Whether to email a copy of the invoice to the recipient. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Send To Invoicer","name":"sendToInvoicer","uiComponent":{"type":"CHECKBOX"},"description":"Whether to email a copy of the invoice to the merchant (invoicer)."}
   * @returns {Object}
   * @sampleResult {"href":"https://www.paypal.com/invoice/p/#INV2-Z56S-5LLA-Q52L-CPZ5","rel":"self","method":"GET"}
   */
  async sendInvoice(invoiceId, subject, note, sendToRecipient, sendToInvoicer) {
    const body = {}

    if (subject) {
      body.subject = subject
    }

    if (note) {
      body.note = note
    }

    if (sendToRecipient !== undefined && sendToRecipient !== null) {
      body.send_to_recipient = Boolean(sendToRecipient)
    }

    if (sendToInvoicer !== undefined && sendToInvoicer !== null) {
      body.send_to_invoicer = Boolean(sendToInvoicer)
    }

    return this.#apiRequest({
      url: `/v2/invoicing/invoices/${ encodeURIComponent(invoiceId) }/send`,
      method: 'post',
      body,
      logTag: 'sendInvoice',
    })
  }

  /**
   * @operationName Get Invoice
   * @description Retrieves the full details of an invoice by its id, including status, recipients, line
   * items, amounts, and payment history.
   * @category Invoicing
   * @route GET /invoicing/invoices/{invoiceId}
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The id of the invoice to retrieve (for example, INV2-Z56S-5LLA-Q52L-CPZ5)."}
   * @returns {Object}
   * @sampleResult {"id":"INV2-Z56S-5LLA-Q52L-CPZ5","status":"SENT","amount":{"currency_code":"USD","value":"74.21"},"due_amount":{"currency_code":"USD","value":"74.21"}}
   */
  async getInvoice(invoiceId) {
    return this.#apiRequest({
      url: `/v2/invoicing/invoices/${ encodeURIComponent(invoiceId) }`,
      logTag: 'getInvoice',
    })
  }

  /**
   * @operationName List Invoices
   * @description Lists invoices for the merchant account with pagination. Use Page and Page Size to page
   * through results, and enable Total Required to include total item and page counts in the response.
   * @category Invoicing
   * @route GET /invoicing/invoices
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number to retrieve (starts at 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Number of invoices per page (max 100, default 20)."}
   * @paramDef {"type":"Boolean","label":"Total Required","name":"totalRequired","uiComponent":{"type":"CHECKBOX"},"description":"Include total_items and total_pages in the response."}
   * @returns {Object}
   * @sampleResult {"total_items":2,"total_pages":1,"items":[{"id":"INV2-Z56S-5LLA-Q52L-CPZ5","status":"DRAFT","amount":{"currency_code":"USD","value":"74.21"}}]}
   */
  async listInvoices(page, pageSize, totalRequired) {
    const query = {
      page: page || 1,
      page_size: pageSize || 20,
    }

    if (totalRequired !== undefined && totalRequired !== null) {
      query.total_required = Boolean(totalRequired)
    }

    return this.#apiRequest({
      url: '/v2/invoicing/invoices',
      query,
      logTag: 'listInvoices',
    })
  }

  /**
   * @operationName Cancel Invoice
   * @description Cancels a sent invoice and optionally notifies the recipient. Override the notification
   * subject and note as needed. The invoice moves to CANCELLED status.
   * @category Invoicing
   * @route POST /invoicing/invoices/{invoiceId}/cancel
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The id of the sent invoice to cancel."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Optional subject line for the cancellation email."}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"Optional note included in the cancellation email."}
   * @paramDef {"type":"Boolean","label":"Send To Recipient","name":"sendToRecipient","defaultValue":true,"uiComponent":{"type":"CHECKBOX"},"description":"Whether to email the cancellation to the recipient. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Send To Invoicer","name":"sendToInvoicer","uiComponent":{"type":"CHECKBOX"},"description":"Whether to email the cancellation to the merchant (invoicer)."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async cancelInvoice(invoiceId, subject, note, sendToRecipient, sendToInvoicer) {
    const body = {}

    if (subject) {
      body.subject = subject
    }

    if (note) {
      body.note = note
    }

    if (sendToRecipient !== undefined && sendToRecipient !== null) {
      body.send_to_recipient = Boolean(sendToRecipient)
    }

    if (sendToInvoicer !== undefined && sendToInvoicer !== null) {
      body.send_to_invoicer = Boolean(sendToInvoicer)
    }

    await this.#apiRequest({
      url: `/v2/invoicing/invoices/${ encodeURIComponent(invoiceId) }/cancel`,
      method: 'post',
      body,
      logTag: 'cancelInvoice',
    })

    return { success: true }
  }

  /**
   * @operationName Generate Invoice Number
   * @description Generates the next available invoice number for the merchant account. Use the returned
   * number as detail.invoice_number when creating a new invoice.
   * @category Invoicing
   * @route POST /invoicing/generate-next-invoice-number
   * @returns {Object}
   * @sampleResult {"invoice_number":"0001"}
   */
  async generateInvoiceNumber() {
    return this.#apiRequest({
      url: '/v2/invoicing/generate-next-invoice-number',
      method: 'post',
      body: {},
      logTag: 'generateInvoiceNumber',
    })
  }

  /**
   * @operationName Delete Invoice
   * @description Permanently deletes a draft or cancelled invoice. Sent invoices in other states cannot be
   * deleted.
   * @category Invoicing
   * @route DELETE /invoicing/invoices/{invoiceId}
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The id of the draft or cancelled invoice to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteInvoice(invoiceId) {
    await this.#apiRequest({
      url: `/v2/invoicing/invoices/${ encodeURIComponent(invoiceId) }`,
      method: 'delete',
      logTag: 'deleteInvoice',
    })

    return { success: true }
  }

  /**
   * @operationName Record Payment
   * @description Records an external (offline) payment against an invoice, such as cash, check, or bank
   * transfer. Provide the payment method, date, and amount. Returns the recorded payment id.
   * @category Invoicing
   * @route POST /invoicing/invoices/{invoiceId}/payments
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The id of the invoice to record a payment against."}
   * @paramDef {"type":"String","label":"Method","name":"method","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Bank Transfer","Cash","Check","Credit Card","Debit Card","PayPal","Wire Transfer","Other"]}},"description":"How the payment was received."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","required":true,"description":"The payment amount received (for example, 74.21)."}
   * @paramDef {"type":"String","label":"Currency Code","name":"currencyCode","defaultValue":"USD","description":"Three-letter ISO-4217 currency code; must match the invoice currency."}
   * @paramDef {"type":"String","label":"Payment Date","name":"paymentDate","uiComponent":{"type":"DATE_PICKER"},"description":"The date the payment was received (YYYY-MM-DD). Defaults to today when omitted."}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"Optional note about the payment."}
   * @returns {Object}
   * @sampleResult {"payment_id":"PAY-1B56960729604235TKQQIYVY"}
   */
  async recordPayment(invoiceId, method, amount, currencyCode, paymentDate, note) {
    const body = {
      method: this.#resolveChoice(method, {
        'Bank Transfer': 'BANK_TRANSFER',
        'Cash': 'CASH',
        'Check': 'CHECK',
        'Credit Card': 'CREDIT_CARD',
        'Debit Card': 'DEBIT_CARD',
        'PayPal': 'PAYPAL',
        'Wire Transfer': 'WIRE_TRANSFER',
        'Other': 'OTHER',
      }),
      payment_date: paymentDate || new Date().toISOString().slice(0, 10),
      amount: this.#money(currencyCode, amount),
    }

    if (note) {
      body.note = note
    }

    return this.#apiRequest({
      url: `/v2/invoicing/invoices/${ encodeURIComponent(invoiceId) }/payments`,
      method: 'post',
      body,
      logTag: 'recordPayment',
    })
  }

  // ==================================================================================
  // Subscriptions (Billing v1)
  // ==================================================================================

  /**
   * @operationName Create Subscription
   * @description Creates a subscription for a billing plan. Provide the plan id and subscriber details
   * (name and email). Optionally set the quantity and start time. Returns the subscription id, status, and
   * the approval link the subscriber uses to confirm.
   * @category Subscriptions
   * @route POST /billing/subscriptions
   * @paramDef {"type":"String","label":"Plan ID","name":"planId","required":true,"description":"The id of the billing plan to subscribe to (for example, P-5ML4271244454362WXNWU5NQ)."}
   * @paramDef {"type":"String","label":"Subscriber Email","name":"subscriberEmail","description":"The subscriber's email address."}
   * @paramDef {"type":"String","label":"Subscriber Given Name","name":"subscriberGivenName","description":"The subscriber's first (given) name."}
   * @paramDef {"type":"String","label":"Subscriber Surname","name":"subscriberSurname","description":"The subscriber's last name (surname)."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The quantity of the product in the subscription."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the subscription should start (RFC 3339, for example, 2026-08-01T00:00:00Z). Defaults to immediately."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional PayPal-Request-Id for safe retries. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"id":"I-BW452GLLEP1G","status":"APPROVAL_PENDING","plan_id":"P-5ML4271244454362WXNWU5NQ","links":[{"href":"https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-2M539689T3856352J","rel":"approve","method":"GET"}]}
   */
  async createSubscription(planId, subscriberEmail, subscriberGivenName, subscriberSurname, quantity, startTime, idempotencyKey) {
    const body = { plan_id: planId }
    const subscriber = {}

    if (subscriberEmail) {
      subscriber.email_address = subscriberEmail
    }

    if (subscriberGivenName || subscriberSurname) {
      subscriber.name = {}

      if (subscriberGivenName) {
        subscriber.name.given_name = subscriberGivenName
      }

      if (subscriberSurname) {
        subscriber.name.surname = subscriberSurname
      }
    }

    if (Object.keys(subscriber).length > 0) {
      body.subscriber = subscriber
    }

    if (quantity !== undefined && quantity !== null && quantity !== '') {
      body.quantity = String(quantity)
    }

    if (startTime) {
      body.start_time = startTime
    }

    return this.#apiRequest({
      url: '/v1/billing/subscriptions',
      method: 'post',
      body,
      headers: this.#idempotencyHeaders(idempotencyKey),
      logTag: 'createSubscription',
    })
  }

  /**
   * @operationName Get Subscription
   * @description Retrieves the details of a subscription by its id, including status, plan id, subscriber,
   * and billing information.
   * @category Subscriptions
   * @route GET /billing/subscriptions/{subscriptionId}
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The id of the subscription (for example, I-BW452GLLEP1G)."}
   * @returns {Object}
   * @sampleResult {"id":"I-BW452GLLEP1G","status":"ACTIVE","plan_id":"P-5ML4271244454362WXNWU5NQ","quantity":"20"}
   */
  async getSubscription(subscriptionId) {
    return this.#apiRequest({
      url: `/v1/billing/subscriptions/${ encodeURIComponent(subscriptionId) }`,
      logTag: 'getSubscription',
    })
  }

  /**
   * @operationName Activate Subscription
   * @description Activates a suspended subscription so billing resumes. Optionally provide a reason.
   * @category Subscriptions
   * @route POST /billing/subscriptions/{subscriptionId}/activate
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The id of the subscription to activate."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","description":"Optional reason for activating the subscription."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async activateSubscription(subscriptionId, reason) {
    await this.#apiRequest({
      url: `/v1/billing/subscriptions/${ encodeURIComponent(subscriptionId) }/activate`,
      method: 'post',
      body: reason ? { reason } : {},
      logTag: 'activateSubscription',
    })

    return { success: true }
  }

  /**
   * @operationName Suspend Subscription
   * @description Suspends an active subscription, pausing billing until it is reactivated. Provide a reason
   * for the suspension.
   * @category Subscriptions
   * @route POST /billing/subscriptions/{subscriptionId}/suspend
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The id of the subscription to suspend."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":true,"description":"The reason for suspending the subscription (for example, Item out of stock)."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async suspendSubscription(subscriptionId, reason) {
    await this.#apiRequest({
      url: `/v1/billing/subscriptions/${ encodeURIComponent(subscriptionId) }/suspend`,
      method: 'post',
      body: { reason: reason || 'Suspended via FlowRunner' },
      logTag: 'suspendSubscription',
    })

    return { success: true }
  }

  /**
   * @operationName Cancel Subscription
   * @description Cancels an active or suspended subscription. This action is permanent and stops all future
   * billing. Provide a reason for the cancellation.
   * @category Subscriptions
   * @route POST /billing/subscriptions/{subscriptionId}/cancel
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The id of the subscription to cancel."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":true,"description":"The reason for cancelling the subscription (for example, Not satisfied with the service)."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async cancelSubscription(subscriptionId, reason) {
    await this.#apiRequest({
      url: `/v1/billing/subscriptions/${ encodeURIComponent(subscriptionId) }/cancel`,
      method: 'post',
      body: { reason: reason || 'Cancelled via FlowRunner' },
      logTag: 'cancelSubscription',
    })

    return { success: true }
  }

  /**
   * @operationName List Plans
   * @description Lists billing plans for the merchant account with pagination. Optionally filter by a
   * product id. Enable Total Required to include total item and page counts.
   * @category Subscriptions
   * @route GET /billing/plans
   * @paramDef {"type":"String","label":"Product ID","name":"productId","description":"Optional product id to filter plans by."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number to retrieve (starts at 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Number of plans per page (max 20, default 20)."}
   * @paramDef {"type":"Boolean","label":"Total Required","name":"totalRequired","uiComponent":{"type":"CHECKBOX"},"description":"Include total_items and total_pages in the response."}
   * @returns {Object}
   * @sampleResult {"plans":[{"id":"P-5ML4271244454362WXNWU5NQ","name":"Video Streaming Service Plan","status":"ACTIVE"}]}
   */
  async listPlans(productId, page, pageSize, totalRequired) {
    const query = {
      page: page || 1,
      page_size: pageSize || 20,
    }

    if (productId) {
      query.product_id = productId
    }

    if (totalRequired !== undefined && totalRequired !== null) {
      query.total_required = Boolean(totalRequired)
    }

    return this.#apiRequest({
      url: '/v1/billing/plans',
      query,
      logTag: 'listPlans',
    })
  }

  /**
   * @operationName Get Plan
   * @description Retrieves the details of a billing plan by its id, including status, billing cycles, and
   * pricing.
   * @category Subscriptions
   * @route GET /billing/plans/{planId}
   * @paramDef {"type":"String","label":"Plan ID","name":"planId","required":true,"description":"The id of the billing plan (for example, P-5ML4271244454362WXNWU5NQ)."}
   * @returns {Object}
   * @sampleResult {"id":"P-5ML4271244454362WXNWU5NQ","name":"Video Streaming Service Plan","status":"ACTIVE","billing_cycles":[{"tenure_type":"REGULAR","sequence":1}]}
   */
  async getPlan(planId) {
    return this.#apiRequest({
      url: `/v1/billing/plans/${ encodeURIComponent(planId) }`,
      logTag: 'getPlan',
    })
  }

  // ==================================================================================
  // Payouts (v1)
  // ==================================================================================

  /**
   * @operationName Create Batch Payout
   * @description Creates a batch payout that sends money to one or more recipients. Provide a unique sender
   * batch id, an optional email subject, and an array of payout items, each with a receiver, amount,
   * currency, recipient type, and optional note. Returns the payout batch id and initial status.
   * @category Payouts
   * @route POST /payments/payouts
   * @paramDef {"type":"String","label":"Sender Batch ID","name":"senderBatchId","required":true,"description":"A unique id you assign to this payout batch to prevent duplicate payouts."}
   * @paramDef {"type":"String","label":"Email Subject","name":"emailSubject","description":"Optional subject line for the email recipients receive with the payout."}
   * @paramDef {"type":"String","label":"Recipient Type","name":"recipientType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Email","PayPal ID","Phone"]}},"defaultValue":"Email","description":"How the receiver values identify recipients across all items."}
   * @paramDef {"type":"Array<Object>","label":"Items","name":"items","required":true,"description":"Payout items: [{receiver, amount, currency, note}]. Receiver is the recipient's email, PayPal ID, or phone based on Recipient Type; amount is a string; currency is an ISO-4217 code; note is optional."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional PayPal-Request-Id for safe retries. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"batch_header":{"payout_batch_id":"FYXMPQTX4JC9N","batch_status":"PENDING","sender_batch_header":{"sender_batch_id":"Payouts_2026_100007"}}}
   */
  async createBatchPayout(senderBatchId, emailSubject, recipientType, items, idempotencyKey) {
    const resolvedType = this.#resolveChoice(recipientType, {
      'Email': 'EMAIL',
      'PayPal ID': 'PAYPAL_ID',
      'Phone': 'PHONE',
    }) || 'EMAIL'

    const senderBatchHeader = { sender_batch_id: senderBatchId }

    if (emailSubject) {
      senderBatchHeader.email_subject = emailSubject
    }

    const payoutItems = (Array.isArray(items) ? items : []).map(item => {
      const entry = {
        recipient_type: resolvedType,
        amount: this.#money(item.currency, item.amount),
        receiver: item.receiver,
      }

      if (item.note) {
        entry.note = item.note
      }

      return entry
    })

    return this.#apiRequest({
      url: '/v1/payments/payouts',
      method: 'post',
      body: { sender_batch_header: senderBatchHeader, items: payoutItems },
      headers: this.#idempotencyHeaders(idempotencyKey),
      logTag: 'createBatchPayout',
    })
  }

  /**
   * @operationName Get Payout Batch
   * @description Retrieves the status and details of a batch payout by its payout batch id, including the
   * status of each individual payout item.
   * @category Payouts
   * @route GET /payments/payouts/{payoutBatchId}
   * @paramDef {"type":"String","label":"Payout Batch ID","name":"payoutBatchId","required":true,"description":"The id of the payout batch (for example, FYXMPQTX4JC9N)."}
   * @returns {Object}
   * @sampleResult {"batch_header":{"payout_batch_id":"FYXMPQTX4JC9N","batch_status":"SUCCESS"},"items":[{"payout_item_id":"8AELMXH8UB2P8","transaction_status":"SUCCESS"}]}
   */
  async getPayoutBatch(payoutBatchId) {
    return this.#apiRequest({
      url: `/v1/payments/payouts/${ encodeURIComponent(payoutBatchId) }`,
      logTag: 'getPayoutBatch',
    })
  }
}

Flowrunner.ServerCode.addService(PayPal, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'PayPal Developer Dashboard -> Apps & Credentials -> your app -> Client ID.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'PayPal Developer Dashboard -> Apps & Credentials -> your app -> Secret.',
  },
  {
    name: 'environment',
    displayName: 'Environment',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['Sandbox', 'Live'],
    defaultValue: 'Sandbox',
    required: true,
    shared: false,
    hint: 'Use Sandbox for testing and Live for real transactions.',
  },
])
