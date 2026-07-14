const logger = {
  info: (...args) => console.log('[Mindee] info:', ...args),
  debug: (...args) => console.log('[Mindee] debug:', ...args),
  error: (...args) => console.log('[Mindee] error:', ...args),
  warn: (...args) => console.log('[Mindee] warn:', ...args),
}

const API_BASE_URL = 'https://api.mindee.net/v1'

// Mindee's own (off-the-shelf) product account.
const MINDEE_ACCOUNT = 'mindee'

/**
 * @integrationName Mindee
 * @integrationIcon /icon.png
 */
class MindeeService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Normalize a downloaded file body to a Buffer. Flowrunner.Request auto-parses
  // the response by Content-Type, so a JSON/text source can arrive as a parsed
  // object/string rather than bytes despite .setEncoding(null); re-serialize those.
  #toBuffer(body) {
    if (Buffer.isBuffer(body)) {
      return body
    }

    if (typeof body === 'string') {
      return Buffer.from(body)
    }

    return Buffer.from(JSON.stringify(body))
  }

  // Derive a filename (with extension) from a URL so Mindee can detect the mime type.
  #fileNameFromUrl(fileUrl) {
    try {
      const raw = decodeURIComponent(String(fileUrl).split('?')[0].split('/').pop() || '')

      return raw && raw.includes('.') ? raw : `document_${ Date.now() }.pdf`
    } catch (error) {
      return `document_${ Date.now() }.pdf`
    }
  }

  // Core predictor. Downloads the file at fileUrl and POSTs it to Mindee as a
  // multipart 'document' field. `productPath` is the portion after /v1/products/,
  // e.g. `mindee/invoices/v4`. Returns the full parsed Mindee response.
  async #predict({ productPath, fileUrl, extraFields, logTag }) {
    if (!fileUrl) {
      throw new Error('Mindee API error: a document URL is required.')
    }

    const url = `${ API_BASE_URL }/products/${ productPath }/predict`

    try {
      logger.debug(`${ logTag } - [POST::${ url }] downloading ${ fileUrl }`)

      const fileBytes = this.#toBuffer(await Flowrunner.Request.get(fileUrl).setEncoding(null))
      const filename = this.#fileNameFromUrl(fileUrl)

      // Do NOT set Content-Type manually — FormData supplies the multipart boundary.
      const formData = new Flowrunner.Request.FormData()

      formData.append('document', fileBytes, { filename })

      for (const [key, value] of Object.entries(extraFields || {})) {
        if (value !== undefined && value !== null && value !== '') {
          formData.append(key, String(value))
        }
      }

      return await Flowrunner.Request.post(url)
        .set({ Authorization: `Token ${ this.apiKey }` })
        .form(formData)
    } catch (error) {
      const apiError = error.body?.api_request?.error
      const message = apiError?.message ||
        (apiError && typeof apiError === 'object' ? JSON.stringify(apiError) : undefined) ||
        error.body?.message ||
        error.message

      logger.error(`${ logTag } - failed (${ error.status || error.statusCode || '?' }): ${ message }`)

      throw new Error(`Mindee API error: ${ message }`)
    }
  }

  // Pull document.inference.prediction out of a Mindee response.
  #prediction(response) {
    return response?.document?.inference?.prediction || {}
  }

  // Mindee fields are usually { value, confidence } wrappers. Return the value.
  #val(field) {
    if (field === undefined || field === null) {
      return undefined
    }

    return typeof field === 'object' && Object.prototype.hasOwnProperty.call(field, 'value')
      ? field.value
      : field
  }

  /**
   * @operationName Parse Invoice
   * @category Financial
   * @description Extracts structured data from an invoice (PDF or image) using Mindee's off-the-shelf Invoices model. Returns a flattened `fields` object with supplier and customer names, totals (amount, net, tax), invoice date and due date, invoice number, currency, and line items, alongside the complete raw Mindee response. Provide any publicly reachable document URL or a FlowRunner file URL.
   * @route POST /parse-invoice
   * @appearanceColor #6A5CFF #8B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"URL of the invoice file (PDF, JPG, PNG, WEBP, TIFF, HEIC). Can be a public URL or a FlowRunner file URL. The file is downloaded and uploaded to Mindee."}
   *
   * @returns {Object}
   * @sampleResult {"fields":{"supplierName":"ACME Corp","customerName":"Widgets Inc","totalAmount":110,"totalNet":100,"totalTax":10,"currency":"USD","date":"2024-01-15","dueDate":"2024-02-15","invoiceNumber":"INV-001","lineItems":[{"description":"Widget A","quantity":2,"unitPrice":50,"totalAmount":100}]},"raw":{"api_request":{"status":"success","status_code":201},"document":{"id":"abc-123","inference":{"prediction":{}}}}}
   */
  async parseInvoice(documentUrl) {
    const response = await this.#predict({
      logTag: '[parseInvoice]',
      productPath: `${ MINDEE_ACCOUNT }/invoices/v4`,
      fileUrl: documentUrl,
    })

    const p = this.#prediction(response)

    return {
      fields: {
        supplierName: this.#val(p.supplier_name),
        supplierAddress: this.#val(p.supplier_address),
        customerName: this.#val(p.customer_name),
        customerAddress: this.#val(p.customer_address),
        totalAmount: this.#val(p.total_amount),
        totalNet: this.#val(p.total_net),
        totalTax: this.#val(p.total_tax),
        currency: this.#val(p.locale?.currency) || this.#val(p.locale),
        date: this.#val(p.date),
        dueDate: this.#val(p.due_date),
        invoiceNumber: this.#val(p.invoice_number),
        lineItems: (p.line_items || []).map(item => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          totalAmount: item.total_amount,
          taxRate: item.tax_rate,
        })),
      },
      raw: response,
    }
  }

  /**
   * @operationName Parse Receipt
   * @category Financial
   * @description Extracts structured data from an expense receipt (PDF or image) using Mindee's off-the-shelf Expense Receipts model. Returns a flattened `fields` object with merchant name, total amount, receipt date and time, expense category, and taxes, plus the complete raw response. Provide any publicly reachable document URL or a FlowRunner file URL.
   * @route POST /parse-receipt
   * @appearanceColor #6A5CFF #8B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"URL of the receipt file (PDF, JPG, PNG, WEBP, TIFF, HEIC). Can be a public URL or a FlowRunner file URL. The file is downloaded and uploaded to Mindee."}
   *
   * @returns {Object}
   * @sampleResult {"fields":{"merchantName":"Coffee Shop","total":12.5,"totalNet":11.36,"totalTax":1.14,"currency":"USD","date":"2024-01-15","time":"09:30","category":"food","taxes":[{"rate":10,"amount":1.14}]},"raw":{"api_request":{"status":"success","status_code":201},"document":{"id":"abc-123","inference":{"prediction":{}}}}}
   */
  async parseReceipt(documentUrl) {
    const response = await this.#predict({
      logTag: '[parseReceipt]',
      productPath: `${ MINDEE_ACCOUNT }/expense_receipts/v5`,
      fileUrl: documentUrl,
    })

    const p = this.#prediction(response)

    return {
      fields: {
        merchantName: this.#val(p.supplier_name),
        total: this.#val(p.total_amount),
        totalNet: this.#val(p.total_net),
        totalTax: this.#val(p.total_tax),
        currency: this.#val(p.locale?.currency) || this.#val(p.locale),
        date: this.#val(p.date),
        time: this.#val(p.time),
        category: this.#val(p.category),
        subCategory: this.#val(p.subcategory),
        taxes: (p.taxes || []).map(tax => ({ rate: tax.rate, amount: tax.value || tax.amount })),
      },
      raw: response,
    }
  }

  /**
   * @operationName Parse Financial Document
   * @category Financial
   * @description Extracts structured data from either an invoice or a receipt using Mindee's Financial Document model, which auto-detects the document type. Returns a flattened `fields` object with supplier and customer, totals, date, invoice number, and line items, plus the complete raw response. Use this when a document may be either an invoice or a receipt. Provide any publicly reachable document URL or a FlowRunner file URL.
   * @route POST /parse-financial-document
   * @appearanceColor #6A5CFF #8B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"URL of the invoice or receipt file (PDF, JPG, PNG, WEBP, TIFF, HEIC). Can be a public URL or a FlowRunner file URL. The file is downloaded and uploaded to Mindee."}
   *
   * @returns {Object}
   * @sampleResult {"fields":{"documentType":"INVOICE","supplierName":"ACME Corp","customerName":"Widgets Inc","totalAmount":110,"totalNet":100,"totalTax":10,"currency":"USD","date":"2024-01-15","invoiceNumber":"INV-001","lineItems":[{"description":"Widget A","quantity":2,"totalAmount":100}]},"raw":{"api_request":{"status":"success","status_code":201},"document":{"id":"abc-123","inference":{"prediction":{}}}}}
   */
  async parseFinancialDocument(documentUrl) {
    const response = await this.#predict({
      logTag: '[parseFinancialDocument]',
      productPath: `${ MINDEE_ACCOUNT }/financial_document/v1`,
      fileUrl: documentUrl,
    })

    const p = this.#prediction(response)

    return {
      fields: {
        documentType: this.#val(p.document_type),
        supplierName: this.#val(p.supplier_name),
        supplierAddress: this.#val(p.supplier_address),
        customerName: this.#val(p.customer_name),
        customerAddress: this.#val(p.customer_address),
        totalAmount: this.#val(p.total_amount),
        totalNet: this.#val(p.total_net),
        totalTax: this.#val(p.total_tax),
        currency: this.#val(p.locale?.currency) || this.#val(p.locale),
        date: this.#val(p.date),
        dueDate: this.#val(p.due_date),
        invoiceNumber: this.#val(p.invoice_number),
        lineItems: (p.line_items || []).map(item => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          totalAmount: item.total_amount,
        })),
      },
      raw: response,
    }
  }

  /**
   * @operationName Parse ID Document
   * @category Identity
   * @description Extracts identity fields from a national ID card using Mindee's International ID model. Returns a flattened `fields` object with document type and number, surname, given names, nationality, sex, birth date and place, issue and expiry dates, and issuing country, plus the complete raw response. Provide any publicly reachable document URL or a FlowRunner file URL.
   * @route POST /parse-id-document
   * @appearanceColor #6A5CFF #8B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"URL of the ID document image (JPG, PNG, WEBP, TIFF, HEIC) or PDF. Can be a public URL or a FlowRunner file URL. The file is downloaded and uploaded to Mindee."}
   *
   * @returns {Object}
   * @sampleResult {"fields":{"documentType":"IDENTIFICATION_CARD","documentNumber":"X1234567","surnames":["DOE"],"givenNames":["JOHN"],"nationality":"USA","sex":"M","birthDate":"1990-01-01","birthPlace":"NEW YORK","issueDate":"2020-01-01","expiryDate":"2030-01-01","countryOfIssue":"USA"},"raw":{"api_request":{"status":"success","status_code":201},"document":{"id":"abc-123","inference":{"prediction":{}}}}}
   */
  async parseIdDocument(documentUrl) {
    const response = await this.#predict({
      logTag: '[parseIdDocument]',
      productPath: `${ MINDEE_ACCOUNT }/international_id/v2`,
      fileUrl: documentUrl,
    })

    const p = this.#prediction(response)

    return {
      fields: {
        documentType: this.#val(p.document_type),
        documentNumber: this.#val(p.document_number),
        surnames: (p.surnames || []).map(item => this.#val(item)),
        givenNames: (p.given_names || []).map(item => this.#val(item)),
        nationality: this.#val(p.nationality),
        sex: this.#val(p.sex),
        birthDate: this.#val(p.birth_date),
        birthPlace: this.#val(p.birth_place),
        issueDate: this.#val(p.issue_date),
        expiryDate: this.#val(p.expiry_date),
        countryOfIssue: this.#val(p.country_of_issue),
        address: this.#val(p.address),
        mrz1: this.#val(p.mrz_line1),
        mrz2: this.#val(p.mrz_line2),
      },
      raw: response,
    }
  }

  /**
   * @operationName Parse Passport
   * @category Identity
   * @description Extracts identity fields from a passport using Mindee's off-the-shelf Passport model. Returns a flattened `fields` object with document number, surname, given names, country, nationality, sex, birth date and place, issue and expiry dates, and the MRZ lines, plus the complete raw response. Provide any publicly reachable document URL or a FlowRunner file URL.
   * @route POST /parse-passport
   * @appearanceColor #6A5CFF #8B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"URL of the passport image (JPG, PNG, WEBP, TIFF, HEIC) or PDF. Can be a public URL or a FlowRunner file URL. The file is downloaded and uploaded to Mindee."}
   *
   * @returns {Object}
   * @sampleResult {"fields":{"documentNumber":"X1234567","surname":"DOE","givenNames":["JOHN"],"country":"USA","nationality":"USA","sex":"M","birthDate":"1990-01-01","birthPlace":"NEW YORK","issueDate":"2020-01-01","expiryDate":"2030-01-01","mrz1":"P<USADOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<","mrz2":"X1234567<8USA9001019M3001017<<<<<<<<<<<<<<06"},"raw":{"api_request":{"status":"success","status_code":201},"document":{"id":"abc-123","inference":{"prediction":{}}}}}
   */
  async parsePassport(documentUrl) {
    const response = await this.#predict({
      logTag: '[parsePassport]',
      productPath: `${ MINDEE_ACCOUNT }/passport/v1`,
      fileUrl: documentUrl,
    })

    const p = this.#prediction(response)

    return {
      fields: {
        documentNumber: this.#val(p.id_number),
        surname: this.#val(p.surname),
        givenNames: (p.given_names || []).map(item => this.#val(item)),
        country: this.#val(p.country),
        nationality: this.#val(p.nationality),
        sex: this.#val(p.gender),
        birthDate: this.#val(p.birth_date),
        birthPlace: this.#val(p.birth_place),
        issueDate: this.#val(p.issuance_date),
        expiryDate: this.#val(p.expiry_date),
        mrz1: this.#val(p.mrz1),
        mrz2: this.#val(p.mrz2),
      },
      raw: response,
    }
  }

  /**
   * @operationName Parse Resume
   * @category HR
   * @description Extracts structured data from a resume/CV using Mindee's off-the-shelf Resume model. Returns a flattened `fields` object with the candidate's full name, profession, emails and phone numbers, address, skills, languages, education, and work experience, plus the complete raw response. Provide any publicly reachable document URL or a FlowRunner file URL.
   * @route POST /parse-resume
   * @appearanceColor #6A5CFF #8B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"URL of the resume file (PDF, JPG, PNG, WEBP, TIFF, HEIC). Can be a public URL or a FlowRunner file URL. The file is downloaded and uploaded to Mindee."}
   *
   * @returns {Object}
   * @sampleResult {"fields":{"fullName":"John Doe","givenNames":["John"],"surnames":["Doe"],"profession":"Software Engineer","emails":["john@example.com"],"phoneNumbers":["+1 555 000 1111"],"address":"123 Main St","skills":["JavaScript","Python"],"languages":[{"language":"English","level":"Native"}],"workExperience":[{"employer":"ACME","role":"Engineer","startDate":"2020-01","endDate":"2023-01"}]},"raw":{"api_request":{"status":"success","status_code":201},"document":{"id":"abc-123","inference":{"prediction":{}}}}}
   */
  async parseResume(documentUrl) {
    const response = await this.#predict({
      logTag: '[parseResume]',
      productPath: `${ MINDEE_ACCOUNT }/resume/v1`,
      fileUrl: documentUrl,
    })

    const p = this.#prediction(response)

    return {
      fields: {
        fullName: this.#val(p.given_names) && this.#val(p.surnames)
          ? [...(p.given_names || []).map(item => this.#val(item)), ...(p.surnames || []).map(item => this.#val(item))].join(' ')
          : undefined,
        givenNames: (p.given_names || []).map(item => this.#val(item)),
        surnames: (p.surnames || []).map(item => this.#val(item)),
        profession: this.#val(p.profession),
        emails: (p.email_addresses || p.emails || []).map(item => this.#val(item)),
        phoneNumbers: (p.phone_numbers || []).map(item => this.#val(item)),
        address: this.#val(p.address),
        skills: (p.hard_skills || []).map(item => this.#val(item?.name) || this.#val(item)),
        softSkills: (p.soft_skills || []).map(item => this.#val(item)),
        languages: (p.languages || []).map(item => ({ language: item.language, level: item.level })),
        education: (p.education || []).map(item => ({
          degree: item.degree,
          school: item.school,
          domain: item.domain,
          startDate: item.start_year || item.start_month,
          endDate: item.end_year || item.end_month,
        })),
        workExperience: (p.professional_experiences || []).map(item => ({
          employer: item.employer,
          role: item.role,
          department: item.department,
          startDate: item.start_month || item.start_year,
          endDate: item.end_month || item.end_year,
          description: item.description,
        })),
      },
      raw: response,
    }
  }

  /**
   * @operationName Parse US Driver License
   * @category Identity
   * @description Extracts fields from a United States driver license using Mindee's off-the-shelf US Driver License model. Returns a flattened `fields` object with the license state and number, first and last name, address, date of birth, issue and expiry dates, sex, and eye color, plus the complete raw response. Provide any publicly reachable document URL or a FlowRunner file URL.
   * @route POST /parse-us-driver-license
   * @appearanceColor #6A5CFF #8B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"URL of the US driver license image (JPG, PNG, WEBP, TIFF, HEIC) or PDF. Can be a public URL or a FlowRunner file URL. The file is downloaded and uploaded to Mindee."}
   *
   * @returns {Object}
   * @sampleResult {"fields":{"state":"CA","licenseNumber":"D1234567","firstName":"JOHN","lastName":"DOE","address":"123 MAIN ST, LOS ANGELES, CA","dateOfBirth":"1990-01-01","issuedDate":"2020-01-01","expiryDate":"2030-01-01","sex":"M","eyeColor":"BRO","height":"5-10"},"raw":{"api_request":{"status":"success","status_code":201},"document":{"id":"abc-123","inference":{"prediction":{}}}}}
   */
  async parseUsDriverLicense(documentUrl) {
    const response = await this.#predict({
      logTag: '[parseUsDriverLicense]',
      productPath: `${ MINDEE_ACCOUNT }/us_driver_license/v1`,
      fileUrl: documentUrl,
    })

    const p = this.#prediction(response)

    return {
      fields: {
        state: this.#val(p.state),
        licenseNumber: this.#val(p.driver_license_id) || this.#val(p.dl_id) || this.#val(p.id),
        firstName: this.#val(p.first_name),
        lastName: this.#val(p.last_name),
        address: this.#val(p.address),
        dateOfBirth: this.#val(p.date_of_birth),
        issuedDate: this.#val(p.issued_date),
        expiryDate: this.#val(p.expiry_date),
        sex: this.#val(p.sex),
        eyeColor: this.#val(p.eye_color),
        height: this.#val(p.height),
      },
      raw: response,
    }
  }

  /**
   * @operationName Parse Custom Document
   * @category Custom Models
   * @description Runs a document through a custom or generated Mindee model that you built in the Mindee platform. Provide your account name, the API endpoint (model) name, and the model version, and the file is uploaded for prediction. Returns the raw Mindee response with the full `document.inference.prediction` so you can read any field your custom model defines. Use this to unlock any custom-trained or generated model.
   * @route POST /parse-custom-document
   * @appearanceColor #6A5CFF #8B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Account Name","name":"accountName","required":true,"description":"Your Mindee account (organization) name that owns the custom endpoint."}
   * @paramDef {"type":"String","label":"Endpoint Name","name":"endpointName","required":true,"description":"The API endpoint (model) name of your custom/generated model, as shown in the Mindee platform."}
   * @paramDef {"type":"String","label":"Version","name":"version","required":true,"description":"The model version to call, e.g. 1 or 1.2. The 'v' prefix is added automatically."}
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"URL of the file to parse (PDF or image). Can be a public URL or a FlowRunner file URL. The file is downloaded and uploaded to Mindee."}
   *
   * @returns {Object}
   * @sampleResult {"api_request":{"status":"success","status_code":201},"document":{"id":"abc-123","name":"custom.pdf","inference":{"prediction":{"my_field":{"value":"example","confidence":0.98}}}}}
   */
  async parseCustomDocument(accountName, endpointName, version, documentUrl) {
    return await this.#predict({
      logTag: '[parseCustomDocument]',
      productPath: `${ accountName }/${ endpointName }/${ this.#normalizeVersion(version) }`,
      fileUrl: documentUrl,
    })
  }

  /**
   * @operationName Parse Document (Generic)
   * @category Custom Models
   * @description Escape hatch for any Mindee product. Provide the full product path (the segment after `/v1/products/`, e.g. `mindee/invoices/v4` or `mindee/us_mail/v3`) and a document URL, and the file is uploaded for prediction. Returns the raw Mindee response including `document.inference.prediction`. Use this to call newer or less common off-the-shelf products not exposed as dedicated actions.
   * @route POST /parse-document-generic
   * @appearanceColor #6A5CFF #8B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Product Path","name":"productPath","required":true,"description":"Path after /v1/products/, including the version, e.g. mindee/invoices/v4 or mindee/passport/v1."}
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"URL of the file to parse (PDF or image). Can be a public URL or a FlowRunner file URL. The file is downloaded and uploaded to Mindee."}
   *
   * @returns {Object}
   * @sampleResult {"api_request":{"status":"success","status_code":201},"document":{"id":"abc-123","name":"doc.pdf","inference":{"prediction":{}}}}
   */
  async parseDocumentGeneric(productPath, documentUrl) {
    return await this.#predict({
      logTag: '[parseDocumentGeneric]',
      productPath: String(productPath || '').replace(/^\/+|\/+$/g, ''),
      fileUrl: documentUrl,
    })
  }

  // Accepts "1", "v1", "1.2", "v1.2" → "v1" / "v1.2".
  #normalizeVersion(version) {
    const raw = String(version || '').trim().replace(/^v/i, '')

    return `v${ raw || '1' }`
  }
}

Flowrunner.ServerCode.addService(MindeeService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Mindee API key, sent as the "Authorization: Token <key>" header. Create one in the Mindee platform under API Keys.',
  },
])
