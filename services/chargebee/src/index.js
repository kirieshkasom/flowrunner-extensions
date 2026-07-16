const logger = {
  info: (...args) => console.log('[Chargebee] info:', ...args),
  debug: (...args) => console.log('[Chargebee] debug:', ...args),
  error: (...args) => console.log('[Chargebee] error:', ...args),
  warn: (...args) => console.log('[Chargebee] warn:', ...args),
}

const DEFAULT_LIMIT = 20

/**
 * Recursively flattens a nested object/array into Chargebee's
 * application/x-www-form-urlencoded key convention:
 *   { customer: { first_name: 'A' } }          -> customer[first_name]=A
 *   { subscription_items: [{ item_price_id: 'x', quantity: 2 }] }
 *     -> subscription_items[item_price_id][0]=x&subscription_items[quantity][0]=2
 * Arrays of objects are transposed so each object key becomes key[field][index].
 * Undefined, null and empty-string values are skipped.
 */
function flatten(obj, prefix, out) {
  for (const key in obj) {
    const value = obj[key]

    if (value === undefined || value === null || value === '') {
      continue
    }

    const path = prefix ? `${ prefix }[${ key }]` : key

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          // Array of objects -> key[field][index]=value (Chargebee transposed form)
          for (const field in item) {
            const fieldValue = item[field]

            if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
              continue
            }

            out[`${ path }[${ field }][${ index }]`] = String(fieldValue)
          }
        } else if (item !== undefined && item !== null && item !== '') {
          out[`${ path }[${ index }]`] = String(item)
        }
      })
    } else if (typeof value === 'object') {
      flatten(value, path, out)
    } else {
      out[path] = String(value)
    }
  }

  return out
}

/**
 * @integrationName Chargebee
 * @integrationIcon /icon.png
 */
class ChargebeeService {
  constructor(config) {
    this.site = config.site
    this.apiKey = config.apiKey
  }

  #baseUrl() {
    return `https://${ this.site }.chargebee.com/api/v2`
  }

  #authHeader() {
    // HTTP Basic auth: API key as username, empty password.
    const token = Buffer.from(`${ this.apiKey }:`).toString('base64')

    return `Basic ${ token }`
  }

  #encodeForm(obj) {
    const flat = flatten(obj || {}, '', {})

    return Object.keys(flat)
      .map(key => `${ encodeURIComponent(key) }=${ encodeURIComponent(flat[key]) }`)
      .join('&')
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.#baseUrl() }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': this.#authHeader() })

      if (query) {
        request.query(flatten(query, '', {}))
      }

      if (body !== undefined) {
        request.set({ 'Content-Type': 'application/x-www-form-urlencoded' })

        return await request.send(this.#encodeForm(body))
      }

      return await request
    } catch (error) {
      const responseBody = error.body || {}
      const parts = [
        responseBody.message || error.message,
        responseBody.api_error_code && `api_error_code: ${ responseBody.api_error_code }`,
        responseBody.error_code && `error_code: ${ responseBody.error_code }`,
      ].filter(Boolean)
      const message = parts.join(' | ')

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Chargebee API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /* ============================ Customers ============================ */

  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a new customer record in Chargebee. Provide contact details and, optionally, a billing address object. Customers group subscriptions, invoices and payment sources under a single billing profile. Returns the created customer resource.
   * @route POST /customers
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Customer's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Customer's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Customer's email address. Used for invoice and dunning notifications."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Company name associated with the customer."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Customer's phone number."}
   * @paramDef {"type":"Object","label":"Billing Address","name":"billingAddress","required":false,"description":"Billing address object. Supported fields include first_name, last_name, line1, line2, city, state, state_code, zip, country (2-letter ISO code)."}
   * @returns {Object}
   * @sampleResult {"customer":{"id":"cust_16BdDZUL6bafW1","first_name":"John","last_name":"Doe","email":"john@example.com","auto_collection":"on","net_term_days":0,"created_at":1517507212,"object":"customer"}}
   */
  async createCustomer(firstName, lastName, email, company, phone, billingAddress) {
    return await this.#apiRequest({
      logTag: '[createCustomer]',
      path: '/customers',
      method: 'post',
      body: {
        first_name: firstName,
        last_name: lastName,
        email,
        company,
        phone,
        billing_address: billingAddress,
      },
    })
  }

  /**
   * @operationName List Customers
   * @category Customers
   * @description Lists customers on the Chargebee site with optional filtering by email and pagination. Use the returned next_offset value as the Offset parameter to fetch the next page. Returns a list wrapper containing customer resources.
   * @route GET /customers
   * @paramDef {"type":"String","label":"Email Is","name":"email","description":"Filter to customers whose email exactly matches this value."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-100, default 20)."}
   * @paramDef {"type":"String","label":"Offset","name":"offset","description":"Pagination token from a previous response's next_offset. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"list":[{"customer":{"id":"cust_16BdDZUL6bafW1","first_name":"John","email":"john@example.com","object":"customer"}}],"next_offset":"[\"1517507212000\",\"12345\"]"}
   */
  async listCustomers(email, limit, offset) {
    return await this.#apiRequest({
      logTag: '[listCustomers]',
      path: '/customers',
      method: 'get',
      query: {
        'email[is]': email,
        limit: limit || DEFAULT_LIMIT,
        offset,
      },
    })
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves a single customer by its Chargebee customer ID, including contact details, billing address and account preferences. Returns the customer resource.
   * @route GET /customers/{customerId}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Chargebee customer ID. Search by email to select one."}
   * @returns {Object}
   * @sampleResult {"customer":{"id":"cust_16BdDZUL6bafW1","first_name":"John","last_name":"Doe","email":"john@example.com","auto_collection":"on","created_at":1517507212,"object":"customer"}}
   */
  async getCustomer(customerId) {
    return await this.#apiRequest({
      logTag: '[getCustomer]',
      path: `/customers/${ encodeURIComponent(customerId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Customer
   * @category Customers
   * @description Updates an existing customer's contact details. Only supplied fields are changed; empty fields are ignored. To update the billing address, use Get Customer to inspect the current values first. Returns the updated customer resource.
   * @route POST /customers/{customerId}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Chargebee customer ID to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Updated first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Updated last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Updated email address."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Updated company name."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number."}
   * @returns {Object}
   * @sampleResult {"customer":{"id":"cust_16BdDZUL6bafW1","first_name":"Jane","email":"jane@example.com","object":"customer"}}
   */
  async updateCustomer(customerId, firstName, lastName, email, company, phone) {
    return await this.#apiRequest({
      logTag: '[updateCustomer]',
      path: `/customers/${ encodeURIComponent(customerId) }`,
      method: 'post',
      body: {
        first_name: firstName,
        last_name: lastName,
        email,
        company,
        phone,
      },
    })
  }

  /**
   * @operationName Delete Customer
   * @category Customers
   * @description Permanently deletes a customer from Chargebee. The customer must have no active subscriptions or unpaid invoices. This action cannot be undone. Returns the deleted customer resource.
   * @route POST /customers/{customerId}/delete
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Chargebee customer ID to delete."}
   * @returns {Object}
   * @sampleResult {"customer":{"id":"cust_16BdDZUL6bafW1","deleted":true,"object":"customer"}}
   */
  async deleteCustomer(customerId) {
    return await this.#apiRequest({
      logTag: '[deleteCustomer]',
      path: `/customers/${ encodeURIComponent(customerId) }/delete`,
      method: 'post',
      body: {},
    })
  }

  /* ============================ Subscriptions ============================ */

  /**
   * @operationName Create Subscription
   * @category Subscriptions
   * @description Creates a new item-based subscription for an existing customer. Provide one or more subscription items, each referencing an item price ID (from List Item Prices) and an optional quantity. Returns the subscription along with the customer and, if generated, the first invoice.
   * @route POST /customers/{customerId}/subscription_for_items
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer the subscription belongs to."}
   * @paramDef {"type":"Array<Object>","label":"Subscription Items","name":"subscriptionItems","required":true,"description":"Array of items, each an object with item_price_id (required, from List Item Prices) and optional quantity (number). Example: [{\"item_price_id\":\"basic-USD-monthly\",\"quantity\":1}]."}
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"sub_9dW8mN8UL6c7C","customer_id":"cust_16BdDZUL6bafW1","status":"active","currency_code":"USD","subscription_items":[{"item_price_id":"basic-USD-monthly","item_type":"plan","quantity":1}],"object":"subscription"},"customer":{"id":"cust_16BdDZUL6bafW1","object":"customer"}}
   */
  async createSubscription(customerId, subscriptionItems) {
    return await this.#apiRequest({
      logTag: '[createSubscription]',
      path: `/customers/${ encodeURIComponent(customerId) }/subscription_for_items`,
      method: 'post',
      body: {
        subscription_items: subscriptionItems,
      },
    })
  }

  /**
   * @operationName Get Subscription
   * @category Subscriptions
   * @description Retrieves a single subscription by its ID, including its status, billing period, items and associated customer. Returns the subscription resource.
   * @route GET /subscriptions/{subscriptionId}
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The Chargebee subscription ID."}
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"sub_9dW8mN8UL6c7C","customer_id":"cust_16BdDZUL6bafW1","status":"active","currency_code":"USD","object":"subscription"},"customer":{"id":"cust_16BdDZUL6bafW1","object":"customer"}}
   */
  async getSubscription(subscriptionId) {
    return await this.#apiRequest({
      logTag: '[getSubscription]',
      path: `/subscriptions/${ encodeURIComponent(subscriptionId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Subscriptions
   * @category Subscriptions
   * @description Lists subscriptions on the site with optional filtering by customer ID and status, plus pagination. Use the returned next_offset value as the Offset parameter to fetch the next page. Returns a list wrapper of subscription resources.
   * @route GET /subscriptions
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","dictionary":"getCustomersDictionary","description":"Filter to subscriptions belonging to this customer."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Future","In Trial","Active","Non Renewing","Paused","Cancelled"]}},"description":"Filter to subscriptions in this status."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-100, default 20)."}
   * @paramDef {"type":"String","label":"Offset","name":"offset","description":"Pagination token from a previous response's next_offset."}
   * @returns {Object}
   * @sampleResult {"list":[{"subscription":{"id":"sub_9dW8mN8UL6c7C","status":"active","object":"subscription"},"customer":{"id":"cust_16BdDZUL6bafW1","object":"customer"}}],"next_offset":"[\"1517507212000\",\"77\"]"}
   */
  async listSubscriptions(customerId, status, limit, offset) {
    const statusValue = this.#resolveChoice(status, {
      'Future': 'future',
      'In Trial': 'in_trial',
      'Active': 'active',
      'Non Renewing': 'non_renewing',
      'Paused': 'paused',
      'Cancelled': 'cancelled',
    })

    return await this.#apiRequest({
      logTag: '[listSubscriptions]',
      path: '/subscriptions',
      method: 'get',
      query: {
        'customer_id[is]': customerId,
        'status[is]': statusValue,
        limit: limit || DEFAULT_LIMIT,
        offset,
      },
    })
  }

  /**
   * @operationName Update Subscription
   * @category Subscriptions
   * @description Updates an item-based subscription, replacing its items with the supplied set. Provide the full desired list of subscription items; each needs an item_price_id and optional quantity. Returns the updated subscription.
   * @route POST /subscriptions/{subscriptionId}/update_for_items
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The subscription to update."}
   * @paramDef {"type":"Array<Object>","label":"Subscription Items","name":"subscriptionItems","required":true,"description":"Full replacement list of items, each an object with item_price_id (required) and optional quantity (number)."}
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"sub_9dW8mN8UL6c7C","status":"active","subscription_items":[{"item_price_id":"pro-USD-monthly","quantity":2,"item_type":"plan"}],"object":"subscription"}}
   */
  async updateSubscription(subscriptionId, subscriptionItems) {
    return await this.#apiRequest({
      logTag: '[updateSubscription]',
      path: `/subscriptions/${ encodeURIComponent(subscriptionId) }/update_for_items`,
      method: 'post',
      body: {
        subscription_items: subscriptionItems,
      },
    })
  }

  /**
   * @operationName Cancel Subscription
   * @category Subscriptions
   * @description Cancels an item-based subscription. By default the cancellation takes effect immediately; set End Of Term to true to schedule cancellation at the end of the current billing term instead. Returns the updated subscription.
   * @route POST /subscriptions/{subscriptionId}/cancel_for_items
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The subscription to cancel."}
   * @paramDef {"type":"Boolean","label":"End Of Term","name":"endOfTerm","uiComponent":{"type":"CHECKBOX"},"description":"When true, cancellation is scheduled for the end of the current term. When false (default), it takes effect immediately."}
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"sub_9dW8mN8UL6c7C","status":"cancelled","cancelled_at":1517507300,"object":"subscription"}}
   */
  async cancelSubscription(subscriptionId, endOfTerm) {
    return await this.#apiRequest({
      logTag: '[cancelSubscription]',
      path: `/subscriptions/${ encodeURIComponent(subscriptionId) }/cancel_for_items`,
      method: 'post',
      body: {
        end_of_term: endOfTerm === true ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Pause Subscription
   * @category Subscriptions
   * @description Pauses an active subscription. By default the pause takes effect immediately; set Pause Option to End Of Term to pause at the end of the current term. A paused subscription generates no charges until resumed. Returns the updated subscription.
   * @route POST /subscriptions/{subscriptionId}/pause
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The subscription to pause."}
   * @paramDef {"type":"String","label":"Pause Option","name":"pauseOption","uiComponent":{"type":"DROPDOWN","options":{"values":["Immediately","End Of Term"]}},"description":"When to apply the pause. Defaults to Immediately."}
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"sub_9dW8mN8UL6c7C","status":"paused","object":"subscription"}}
   */
  async pauseSubscription(subscriptionId, pauseOption) {
    const pauseValue = this.#resolveChoice(pauseOption, {
      'Immediately': 'immediately',
      'End Of Term': 'end_of_term',
    })

    return await this.#apiRequest({
      logTag: '[pauseSubscription]',
      path: `/subscriptions/${ encodeURIComponent(subscriptionId) }/pause`,
      method: 'post',
      body: {
        pause_option: pauseValue,
      },
    })
  }

  /**
   * @operationName Resume Subscription
   * @category Subscriptions
   * @description Resumes a paused subscription. By default resumption is immediate; set Resume Option to Specific Date to resume on a scheduled date. Returns the updated subscription.
   * @route POST /subscriptions/{subscriptionId}/resume
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The paused subscription to resume."}
   * @paramDef {"type":"String","label":"Resume Option","name":"resumeOption","uiComponent":{"type":"DROPDOWN","options":{"values":["Immediately","Specific Date"]}},"description":"When to resume the subscription. Defaults to Immediately."}
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"sub_9dW8mN8UL6c7C","status":"active","object":"subscription"}}
   */
  async resumeSubscription(subscriptionId, resumeOption) {
    const resumeValue = this.#resolveChoice(resumeOption, {
      'Immediately': 'immediately',
      'Specific Date': 'specific_date',
    })

    return await this.#apiRequest({
      logTag: '[resumeSubscription]',
      path: `/subscriptions/${ encodeURIComponent(subscriptionId) }/resume`,
      method: 'post',
      body: {
        resume_option: resumeValue,
      },
    })
  }

  /**
   * @operationName Reactivate Subscription
   * @category Subscriptions
   * @description Reactivates a cancelled subscription, moving it back to active (or in-trial) status and resuming billing. Returns the reactivated subscription.
   * @route POST /subscriptions/{subscriptionId}/reactivate
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The cancelled subscription to reactivate."}
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"sub_9dW8mN8UL6c7C","status":"active","object":"subscription"}}
   */
  async reactivateSubscription(subscriptionId) {
    return await this.#apiRequest({
      logTag: '[reactivateSubscription]',
      path: `/subscriptions/${ encodeURIComponent(subscriptionId) }/reactivate`,
      method: 'post',
      body: {},
    })
  }

  /* ============================ Invoices ============================ */

  /**
   * @operationName List Invoices
   * @category Invoices
   * @description Lists invoices on the site with optional filtering by customer ID and status, plus pagination. Use the returned next_offset value as the Offset parameter to fetch the next page. Returns a list wrapper of invoice resources.
   * @route GET /invoices
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","dictionary":"getCustomersDictionary","description":"Filter to invoices for this customer."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Paid","Posted","Payment Due","Not Paid","Voided","Pending"]}},"description":"Filter to invoices in this status."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-100, default 20)."}
   * @paramDef {"type":"String","label":"Offset","name":"offset","description":"Pagination token from a previous response's next_offset."}
   * @returns {Object}
   * @sampleResult {"list":[{"invoice":{"id":"1","customer_id":"cust_16BdDZUL6bafW1","status":"paid","total":1000,"currency_code":"USD","object":"invoice"}}],"next_offset":"[\"1517507212000\",\"1\"]"}
   */
  async listInvoices(customerId, status, limit, offset) {
    const statusValue = this.#resolveChoice(status, {
      'Paid': 'paid',
      'Posted': 'posted',
      'Payment Due': 'payment_due',
      'Not Paid': 'not_paid',
      'Voided': 'voided',
      'Pending': 'pending',
    })

    return await this.#apiRequest({
      logTag: '[listInvoices]',
      path: '/invoices',
      method: 'get',
      query: {
        'customer_id[is]': customerId,
        'status[is]': statusValue,
        limit: limit || DEFAULT_LIMIT,
        offset,
      },
    })
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves a single invoice by its ID, including line items, amounts, taxes and payment status. Returns the invoice resource.
   * @route GET /invoices/{invoiceId}
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The Chargebee invoice ID."}
   * @returns {Object}
   * @sampleResult {"invoice":{"id":"1","customer_id":"cust_16BdDZUL6bafW1","status":"paid","total":1000,"amount_paid":1000,"currency_code":"USD","object":"invoice"}}
   */
  async getInvoice(invoiceId) {
    return await this.#apiRequest({
      logTag: '[getInvoice]',
      path: `/invoices/${ encodeURIComponent(invoiceId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Invoice For Customer
   * @category Invoices
   * @description Creates an ad-hoc invoice for a customer using one or more item prices and/or one-off charges. Each item price entry needs an item_price_id and optional quantity; each charge needs an amount (in the smallest currency unit, e.g. cents) and a description. Returns the created invoice.
   * @route POST /customers/{customerId}/create_invoice_for_items
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to invoice."}
   * @paramDef {"type":"Array<Object>","label":"Item Prices","name":"itemPrices","required":false,"description":"Array of item price entries, each an object with item_price_id (required) and optional quantity (number)."}
   * @paramDef {"type":"Array<Object>","label":"Charges","name":"charges","required":false,"description":"Array of one-off charge objects, each with amount (integer, smallest currency unit) and description."}
   * @returns {Object}
   * @sampleResult {"invoice":{"id":"5","customer_id":"cust_16BdDZUL6bafW1","status":"payment_due","total":1500,"currency_code":"USD","object":"invoice"}}
   */
  async createInvoiceForCustomer(customerId, itemPrices, charges) {
    return await this.#apiRequest({
      logTag: '[createInvoiceForCustomer]',
      path: `/customers/${ encodeURIComponent(customerId) }/create_invoice_for_items`,
      method: 'post',
      body: {
        item_prices: itemPrices,
        charges,
      },
    })
  }

  /**
   * @operationName Void Invoice
   * @category Invoices
   * @description Voids an invoice, marking it as cancelled and reversing any credits it applied. Optionally provide a comment explaining the reason. Returns the voided invoice.
   * @route POST /invoices/{invoiceId}/void
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The invoice to void."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","description":"Optional note recorded with the void action."}
   * @returns {Object}
   * @sampleResult {"invoice":{"id":"5","status":"voided","object":"invoice"}}
   */
  async voidInvoice(invoiceId, comment) {
    return await this.#apiRequest({
      logTag: '[voidInvoice]',
      path: `/invoices/${ encodeURIComponent(invoiceId) }/void`,
      method: 'post',
      body: {
        comment,
      },
    })
  }

  /**
   * @operationName Collect Payment
   * @category Invoices
   * @description Attempts to collect payment for an outstanding invoice using the customer's payment source. Optionally specify a payment source ID to charge a particular card. Returns the invoice with an updated payment status.
   * @route POST /invoices/{invoiceId}/collect_payment
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The invoice to collect payment for."}
   * @paramDef {"type":"String","label":"Payment Source ID","name":"paymentSourceId","description":"Optional payment source (card) ID to charge. Defaults to the customer's primary payment source."}
   * @returns {Object}
   * @sampleResult {"invoice":{"id":"5","status":"paid","amount_paid":1500,"object":"invoice"},"transaction":{"id":"txn_1","amount":1500,"status":"success","object":"transaction"}}
   */
  async collectPayment(invoiceId, paymentSourceId) {
    return await this.#apiRequest({
      logTag: '[collectPayment]',
      path: `/invoices/${ encodeURIComponent(invoiceId) }/collect_payment`,
      method: 'post',
      body: {
        payment_source_id: paymentSourceId,
      },
    })
  }

  /**
   * @operationName Get Invoice PDF
   * @category Invoices
   * @description Generates a downloadable PDF for an invoice and returns a temporary, time-limited download URL. Returns a download object containing the download_url.
   * @route POST /invoices/{invoiceId}/pdf
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The invoice to render as a PDF."}
   * @returns {Object}
   * @sampleResult {"download":{"download_url":"https://example.chargebee.com/download/invoice_pdf/abc123","valid_till":1517510812,"object":"download"}}
   */
  async getInvoicePdf(invoiceId) {
    return await this.#apiRequest({
      logTag: '[getInvoicePdf]',
      path: `/invoices/${ encodeURIComponent(invoiceId) }/pdf`,
      method: 'post',
      body: {},
    })
  }

  /* ============================ Items & Item Prices ============================ */

  /**
   * @operationName List Items
   * @category Product Catalog
   * @description Lists product catalog items (plans, addons and charges) on the site with optional type filtering and pagination. Use the returned next_offset value as the Offset parameter to fetch the next page. Returns a list wrapper of item resources.
   * @route GET /items
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Plan","Addon","Charge"]}},"description":"Filter to items of this type."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-100, default 20)."}
   * @paramDef {"type":"String","label":"Offset","name":"offset","description":"Pagination token from a previous response's next_offset."}
   * @returns {Object}
   * @sampleResult {"list":[{"item":{"id":"basic","name":"Basic","type":"plan","status":"active","object":"item"}}],"next_offset":"[\"basic\"]"}
   */
  async listItems(type, limit, offset) {
    const typeValue = this.#resolveChoice(type, {
      'Plan': 'plan',
      'Addon': 'addon',
      'Charge': 'charge',
    })

    return await this.#apiRequest({
      logTag: '[listItems]',
      path: '/items',
      method: 'get',
      query: {
        'type[is]': typeValue,
        limit: limit || DEFAULT_LIMIT,
        offset,
      },
    })
  }

  /**
   * @operationName Get Item
   * @category Product Catalog
   * @description Retrieves a single product catalog item by its ID, including its type, status and pricing model. Returns the item resource.
   * @route GET /items/{itemId}
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"description":"The Chargebee item ID."}
   * @returns {Object}
   * @sampleResult {"item":{"id":"basic","name":"Basic","type":"plan","status":"active","item_family_id":"fam-1","object":"item"}}
   */
  async getItem(itemId) {
    return await this.#apiRequest({
      logTag: '[getItem]',
      path: `/items/${ encodeURIComponent(itemId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Item Prices
   * @category Product Catalog
   * @description Lists item prices (the concrete priced variants of items, e.g. per currency and billing period) with optional item and currency filtering plus pagination. The item_price_id values returned here are used when creating or updating subscriptions. Returns a list wrapper of item price resources.
   * @route GET /item_prices
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","description":"Filter to item prices belonging to this item."}
   * @paramDef {"type":"String","label":"Currency Code","name":"currencyCode","description":"Filter to item prices in this ISO currency code (e.g. USD)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-100, default 20)."}
   * @paramDef {"type":"String","label":"Offset","name":"offset","description":"Pagination token from a previous response's next_offset."}
   * @returns {Object}
   * @sampleResult {"list":[{"item_price":{"id":"basic-USD-monthly","item_id":"basic","name":"Basic USD Monthly","price":1000,"currency_code":"USD","period_unit":"month","object":"item_price"}}],"next_offset":"[\"basic-USD-monthly\"]"}
   */
  async listItemPrices(itemId, currencyCode, limit, offset) {
    return await this.#apiRequest({
      logTag: '[listItemPrices]',
      path: '/item_prices',
      method: 'get',
      query: {
        'item_id[is]': itemId,
        'currency_code[is]': currencyCode,
        limit: limit || DEFAULT_LIMIT,
        offset,
      },
    })
  }

  /**
   * @operationName Get Item Price
   * @category Product Catalog
   * @description Retrieves a single item price by its ID, including its amount, currency, billing period and pricing model. Returns the item price resource.
   * @route GET /item_prices/{itemPriceId}
   * @paramDef {"type":"String","label":"Item Price ID","name":"itemPriceId","required":true,"dictionary":"getItemPricesDictionary","description":"The Chargebee item price ID."}
   * @returns {Object}
   * @sampleResult {"item_price":{"id":"basic-USD-monthly","item_id":"basic","price":1000,"currency_code":"USD","period":1,"period_unit":"month","object":"item_price"}}
   */
  async getItemPrice(itemPriceId) {
    return await this.#apiRequest({
      logTag: '[getItemPrice]',
      path: `/item_prices/${ encodeURIComponent(itemPriceId) }`,
      method: 'get',
    })
  }

  /* ============================ Payment Sources ============================ */

  /**
   * @operationName List Payment Sources
   * @category Payment Sources
   * @description Lists a customer's payment sources (saved cards, bank accounts and other payment methods) with pagination. Use the returned next_offset value as the Offset parameter to fetch the next page. Returns a list wrapper of payment source resources.
   * @route GET /payment_sources
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer whose payment sources to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-100, default 20)."}
   * @paramDef {"type":"String","label":"Offset","name":"offset","description":"Pagination token from a previous response's next_offset."}
   * @returns {Object}
   * @sampleResult {"list":[{"payment_source":{"id":"pm_16BdDZUL6bafW2","customer_id":"cust_16BdDZUL6bafW1","type":"card","status":"valid","card":{"last4":"4242","brand":"visa"},"object":"payment_source"}}],"next_offset":null}
   */
  async listPaymentSources(customerId, limit, offset) {
    return await this.#apiRequest({
      logTag: '[listPaymentSources]',
      path: '/payment_sources',
      method: 'get',
      query: {
        'customer_id[is]': customerId,
        limit: limit || DEFAULT_LIMIT,
        offset,
      },
    })
  }

  /**
   * @operationName Get Payment Source
   * @category Payment Sources
   * @description Retrieves a single payment source by its ID, including its type, status and (for cards) masked details. Returns the payment source resource.
   * @route GET /payment_sources/{paymentSourceId}
   * @paramDef {"type":"String","label":"Payment Source ID","name":"paymentSourceId","required":true,"description":"The Chargebee payment source ID."}
   * @returns {Object}
   * @sampleResult {"payment_source":{"id":"pm_16BdDZUL6bafW2","customer_id":"cust_16BdDZUL6bafW1","type":"card","status":"valid","card":{"last4":"4242","brand":"visa","expiry_month":12,"expiry_year":2030},"object":"payment_source"}}
   */
  async getPaymentSource(paymentSourceId) {
    return await this.#apiRequest({
      logTag: '[getPaymentSource]',
      path: `/payment_sources/${ encodeURIComponent(paymentSourceId) }`,
      method: 'get',
    })
  }

  /* ============================ Credit Notes ============================ */

  /**
   * @operationName List Credit Notes
   * @category Credit Notes
   * @description Lists credit notes on the site with optional filtering by customer ID and pagination. Use the returned next_offset value as the Offset parameter to fetch the next page. Returns a list wrapper of credit note resources.
   * @route GET /credit_notes
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","dictionary":"getCustomersDictionary","description":"Filter to credit notes for this customer."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-100, default 20)."}
   * @paramDef {"type":"String","label":"Offset","name":"offset","description":"Pagination token from a previous response's next_offset."}
   * @returns {Object}
   * @sampleResult {"list":[{"credit_note":{"id":"cn_1","customer_id":"cust_16BdDZUL6bafW1","reference_invoice_id":"5","status":"refunded","total":500,"currency_code":"USD","object":"credit_note"}}],"next_offset":null}
   */
  async listCreditNotes(customerId, limit, offset) {
    return await this.#apiRequest({
      logTag: '[listCreditNotes]',
      path: '/credit_notes',
      method: 'get',
      query: {
        'customer_id[is]': customerId,
        limit: limit || DEFAULT_LIMIT,
        offset,
      },
    })
  }

  /**
   * @operationName Get Credit Note
   * @category Credit Notes
   * @description Retrieves a single credit note by its ID, including its line items, amounts and reference invoice. Returns the credit note resource.
   * @route GET /credit_notes/{creditNoteId}
   * @paramDef {"type":"String","label":"Credit Note ID","name":"creditNoteId","required":true,"description":"The Chargebee credit note ID."}
   * @returns {Object}
   * @sampleResult {"credit_note":{"id":"cn_1","customer_id":"cust_16BdDZUL6bafW1","reference_invoice_id":"5","status":"refunded","total":500,"currency_code":"USD","object":"credit_note"}}
   */
  async getCreditNote(creditNoteId) {
    return await this.#apiRequest({
      logTag: '[getCreditNote]',
      path: `/credit_notes/${ encodeURIComponent(creditNoteId) }`,
      method: 'get',
    })
  }

  /* ============================ Hosted Pages ============================ */

  /**
   * @operationName Create Checkout
   * @category Hosted Pages
   * @description Creates a Chargebee-hosted checkout page for a new item-based subscription and returns a hosted page object containing a URL the customer can visit to enter payment details and complete the purchase. Provide the subscription items and, optionally, an existing customer ID to prefill the checkout. Returns the hosted_page resource.
   * @route POST /hosted_pages/checkout_new_for_items
   * @paramDef {"type":"Array<Object>","label":"Subscription Items","name":"subscriptionItems","required":true,"description":"Array of items, each an object with item_price_id (required) and optional quantity (number)."}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":false,"dictionary":"getCustomersDictionary","description":"Optional existing customer to associate with the checkout, prefilling their details."}
   * @returns {Object}
   * @sampleResult {"hosted_page":{"id":"hp_16BdDZUL6bafW3","type":"checkout_new","url":"https://example.chargebee.com/pages/v3/hp_16BdDZUL6bafW3/","state":"created","object":"hosted_page"}}
   */
  async createCheckout(subscriptionItems, customerId) {
    return await this.#apiRequest({
      logTag: '[createCheckout]',
      path: '/hosted_pages/checkout_new_for_items',
      method: 'post',
      body: {
        subscription_items: subscriptionItems,
        customer: customerId ? { id: customerId } : undefined,
      },
    })
  }

  /* ============================ Dictionaries ============================ */

  /**
   * @typedef {Object} getCustomersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Email fragment to search customers by (prefix match on email)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset token from a previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customers Dictionary
   * @description Provides a searchable list of customers (by email) for selecting a customer ID in dependent parameters. The option value is the Chargebee customer ID.
   * @route POST /get-customers-dictionary
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Search text (email) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Doe (john@example.com)","value":"cust_16BdDZUL6bafW1","note":"Acme Inc"}],"cursor":"[\"1517507212000\",\"12345\"]"}
   */
  async getCustomersDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getCustomersDictionary]',
      path: '/customers',
      method: 'get',
      query: {
        'email[starts_with]': search,
        limit: 20,
        offset: cursor,
      },
    })

    const list = response.list || []

    return {
      items: list.map(entry => {
        const customer = entry.customer || {}
        const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ')
        const label = name && customer.email
          ? `${ name } (${ customer.email })`
          : name || customer.email || customer.id

        return {
          label,
          value: customer.id,
          note: customer.company || customer.email || undefined,
        }
      }),
      cursor: response.next_offset || undefined,
    }
  }

  /**
   * @typedef {Object} getItemPricesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter item prices by name (prefix match)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset token from a previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Item Prices Dictionary
   * @description Provides a searchable list of active item prices for selecting an item price ID when creating or updating subscriptions. The option value is the Chargebee item price ID.
   * @route POST /get-item-prices-dictionary
   * @paramDef {"type":"getItemPricesDictionary__payload","label":"Payload","name":"payload","description":"Search text (item price name) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Basic USD Monthly","value":"basic-USD-monthly","note":"USD - month"}],"cursor":"[\"basic-USD-monthly\"]"}
   */
  async getItemPricesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getItemPricesDictionary]',
      path: '/item_prices',
      method: 'get',
      query: {
        'name[starts_with]': search,
        'status[is]': 'active',
        limit: 20,
        offset: cursor,
      },
    })

    const list = response.list || []

    return {
      items: list.map(entry => {
        const itemPrice = entry.item_price || {}
        const noteParts = [itemPrice.currency_code, itemPrice.period_unit].filter(Boolean)

        return {
          label: itemPrice.name || itemPrice.id,
          value: itemPrice.id,
          note: noteParts.join(' - ') || undefined,
        }
      }),
      cursor: response.next_offset || undefined,
    }
  }
}

Flowrunner.ServerCode.addService(ChargebeeService, [
  {
    name: 'site',
    displayName: 'Site',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Chargebee site name — the subdomain in {site}.chargebee.com (e.g. "acme" for acme.chargebee.com).',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Chargebee API key. Find it in Chargebee → Settings → Configure Chargebee → API Keys.',
  },
])
