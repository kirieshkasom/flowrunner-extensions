const logger = {
  info: (...args) => console.log('[Wufoo] info:', ...args),
  debug: (...args) => console.log('[Wufoo] debug:', ...args),
  error: (...args) => console.log('[Wufoo] error:', ...args),
  warn: (...args) => console.log('[Wufoo] warn:', ...args),
}

// Wufoo authenticates with the API key as the HTTP Basic username and any
// password. 'footastic' is the conventional placeholder password.
const AUTH_PASSWORD = 'footastic'

const MAX_PAGE_SIZE = 100

// Allowed operators for entry filtering (Wufoo uses underscore-joined tokens).
const FILTER_OPERATORS = {
  'Contains': 'Contains',
  'Does not contain': 'Does_not_contain',
  'Begins with': 'Begins_with',
  'Ends with': 'Ends_with',
  'Is equal to': 'Is_equal_to',
  'Is not equal to': 'Is_not_equal_to',
  'Is less than': 'Is_less_than',
  'Is greater than': 'Is_greater_than',
  'Is on': 'Is_on',
  'Is before': 'Is_before',
  'Is after': 'Is_after',
  'Is not null': 'Is_not_NULL',
}

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Wufoo
 * @integrationIcon /icon.png
 */
class WufooService {
  constructor(config) {
    this.subdomain = config.subdomain
    this.apiKey = config.apiKey
  }

  #baseUrl() {
    return `https://${ this.subdomain }.wufoo.com/api/v3`
  }

  #authHeader() {
    const token = Buffer.from(`${ this.apiKey }:${ AUTH_PASSWORD }`).toString('base64')

    return `Basic ${ token }`
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', form, query, logTag }) {
    const url = `${ this.#baseUrl() }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': this.#authHeader() })
        .query(cleanedQuery || {})

      let response

      if (form !== undefined) {
        // Wufoo writes (Create Entry / Add Webhook) expect URL-encoded form data.
        request.set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        response = await request.send(this.#encodeForm(form))
      } else {
        response = await request
      }

      // Wufoo signals write failures in the body with Success:0 and ErrorText.
      if (response && response.Success !== undefined && Number(response.Success) === 0) {
        const detail = response.ErrorText || 'Request rejected'
        const fieldErrors = Array.isArray(response.FieldErrors) && response.FieldErrors.length
          ? ` (${ response.FieldErrors.map(fe => `${ fe.ID }: ${ fe.ErrorText }`).join('; ') })`
          : ''

        throw new Error(`Wufoo API error: ${ detail }${ fieldErrors }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('Wufoo API error:')) {
        throw error
      }

      const status = error.status || error.statusCode
      const body = error.body
      const message = body?.ErrorText || body?.Text || body?.message || error.message
      const statusPart = status ? ` (HTTP ${ status })` : ''

      logger.error(`${ logTag } - request failed${ statusPart }: ${ message }`)

      throw new Error(`Wufoo API error${ statusPart }: ${ message }`)
    }
  }

  #encodeForm(form) {
    return Object.entries(clean(form))
      .map(([key, value]) => `${ encodeURIComponent(key) }=${ encodeURIComponent(value) }`)
      .join('&')
  }

  /**
   * @operationName List Forms
   * @category Forms
   * @description Lists all forms in the Wufoo account, each with its Name, Hash (the form identifier used by every other Wufoo operation), public status, and links to its fields and entries. Use a form's Hash as the "Form Identifier" argument elsewhere. Supports paging and an optional count of entries submitted today.
   * @route GET /forms
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Forms per page (max 1000, default 1000)."}
   * @paramDef {"type":"Boolean","label":"Include Today Count","name":"includeTodayCount","uiComponent":{"type":"CHECKBOX"},"description":"When true, includes each form's entry count for today."}
   *
   * @returns {Object}
   * @sampleResult {"Forms":[{"Name":"Contact Form","Description":"","Hash":"s1afea8b1vk0jf7","IsPublic":"1","DateCreated":"2010-07-07 14:51:14","LinkFields":"https://sub.wufoo.com/api/v3/forms/s1afea8b1vk0jf7/fields.json","LinkEntries":"https://sub.wufoo.com/api/v3/forms/s1afea8b1vk0jf7/entries.json"}]}
   */
  async listForms(page, limit, includeTodayCount) {
    return await this.#apiRequest({
      logTag: '[listForms]',
      path: '/forms.json',
      method: 'get',
      query: {
        page,
        limit,
        includeTodayCount: includeTodayCount ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Get Form
   * @category Forms
   * @description Retrieves a single form by its identifier (the form Hash from List Forms, or the form URL slug). Returns the form's metadata including Name, description, public status, redirect settings, and links to its fields and entries.
   * @route GET /form
   *
   * @paramDef {"type":"String","label":"Form Identifier","name":"formIdentifier","required":true,"dictionary":"getFormsDictionary","description":"The form Hash (from List Forms) or the form URL slug. Pick a form or type an identifier."}
   *
   * @returns {Object}
   * @sampleResult {"Forms":[{"Name":"Contact Form","Description":"","Hash":"s1afea8b1vk0jf7","IsPublic":"1","Language":"english","StartDate":"","EndDate":"","EntryLimit":"0","DateCreated":"2010-07-07 14:51:14","LinkFields":"https://sub.wufoo.com/api/v3/forms/s1afea8b1vk0jf7/fields.json","LinkEntries":"https://sub.wufoo.com/api/v3/forms/s1afea8b1vk0jf7/entries.json"}]}
   */
  async getForm(formIdentifier) {
    return await this.#apiRequest({
      logTag: '[getForm]',
      path: `/forms/${ encodeURIComponent(formIdentifier) }.json`,
      method: 'get',
    })
  }

  /**
   * @operationName List Form Fields
   * @category Forms
   * @description Lists all fields on a form, including each field's ID (e.g. "Field1", "Field105"), Title, Type, whether it is required, sub-fields (for address/name/checkbox fields), and choices (for select/radio fields). Wufoo entries are keyed by these Field IDs, so run this first to map human-readable labels to the Field{n} keys needed to build filters, submit entries, or interpret entry data.
   * @route GET /fields
   *
   * @paramDef {"type":"String","label":"Form Identifier","name":"formIdentifier","required":true,"dictionary":"getFormsDictionary","description":"The form Hash (from List Forms) or URL slug."}
   * @paramDef {"type":"Boolean","label":"Include System Fields","name":"includeSystem","uiComponent":{"type":"CHECKBOX"},"description":"When true, includes system/metadata fields (EntryId, DateCreated, IP, etc.)."}
   *
   * @returns {Object}
   * @sampleResult {"Fields":[{"Title":"Name","Instructions":"","IsRequired":"1","ID":"Field1","Type":"shortname","SubFields":[{"ID":"Field1","Label":"First"},{"ID":"Field2","Label":"Last"}]},{"Title":"Email","IsRequired":"0","ID":"Field105","Type":"email"}]}
   */
  async listFormFields(formIdentifier, includeSystem) {
    return await this.#apiRequest({
      logTag: '[listFormFields]',
      path: `/forms/${ encodeURIComponent(formIdentifier) }/fields.json`,
      method: 'get',
      query: {
        system: includeSystem ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName List Entries
   * @category Entries
   * @description Lists submissions (entries) for a form. Each entry is keyed by Field IDs (e.g. "Field1", "Field105") plus EntryId and DateCreated — run List Form Fields to map those IDs to labels. Supports paging (pageStart / pageSize, max 100 per page), sorting by a Field ID, and an optional single-condition filter (Field ID + operator + value). Set Include System Fields to return submission metadata such as IP and completion status.
   * @route GET /entries
   *
   * @paramDef {"type":"String","label":"Form Identifier","name":"formIdentifier","required":true,"dictionary":"getFormsDictionary","description":"The form Hash (from List Forms) or URL slug."}
   * @paramDef {"type":"Number","label":"Page Start","name":"pageStart","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based index of the first entry to return (default 0)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of entries to return (max 100, default 25)."}
   * @paramDef {"type":"String","label":"Sort Field","name":"sortField","description":"Field ID to sort by (e.g. \"EntryId\" or \"Field1\"). Use List Form Fields to find IDs."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort order. Requires a Sort Field."}
   * @paramDef {"type":"String","label":"Filter Field","name":"filterField","description":"Field ID to filter on (e.g. \"Field1\"). Required to apply a filter."}
   * @paramDef {"type":"String","label":"Filter Operator","name":"filterOperator","uiComponent":{"type":"DROPDOWN","options":{"values":["Contains","Does not contain","Begins with","Ends with","Is equal to","Is not equal to","Is less than","Is greater than","Is on","Is before","Is after","Is not null"]}},"description":"Comparison operator for the filter."}
   * @paramDef {"type":"String","label":"Filter Value","name":"filterValue","description":"Value to compare against. For date fields use YYYYMMDD."}
   *
   * @returns {Object}
   * @sampleResult {"Entries":[{"EntryId":"9","Field1":"Wufoo","Field105":"support@wufoo.com","DateCreated":"2015-04-20 15:50:34","CreatedBy":"public"}],"EntryCount":"1"}
   */
  async listEntries(formIdentifier, pageStart, pageSize, sortField, sortDirection, filterField, filterOperator, filterValue) {
    const query = {
      pageStart,
      pageSize: pageSize !== undefined ? Math.min(Number(pageSize), MAX_PAGE_SIZE) : undefined,
      sort: sortField,
      sortDirection: this.#resolveChoice(sortDirection, { 'Ascending': 'ASC', 'Descending': 'DESC' }),
    }

    if (filterField && filterOperator && filterValue !== undefined && filterValue !== '') {
      const operator = this.#resolveChoice(filterOperator, FILTER_OPERATORS)

      query.Field1 = filterField
      query.Operator1 = operator
      query.Value1 = filterValue
      query.match = 'AND'
    }

    return await this.#apiRequest({
      logTag: '[listEntries]',
      path: `/forms/${ encodeURIComponent(formIdentifier) }/entries.json`,
      method: 'get',
      query,
    })
  }

  /**
   * @operationName Get Entry Count
   * @category Entries
   * @description Returns the total number of entries (submissions) for a form as an EntryCount value. Useful for reporting or pagination without retrieving the entries themselves.
   * @route GET /entries-count
   *
   * @paramDef {"type":"String","label":"Form Identifier","name":"formIdentifier","required":true,"dictionary":"getFormsDictionary","description":"The form Hash (from List Forms) or URL slug."}
   *
   * @returns {Object}
   * @sampleResult {"EntryCount":"42"}
   */
  async getEntryCount(formIdentifier) {
    return await this.#apiRequest({
      logTag: '[getEntryCount]',
      path: `/forms/${ encodeURIComponent(formIdentifier) }/entries/count.json`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Entry
   * @category Entries
   * @description Submits a new entry to a form, exactly as if a user filled it out. Provide field values as a map keyed by Field ID (e.g. {"Field1":"Jane","Field105":"jane@example.com"}) — run List Form Fields first to discover the Field IDs and types. Date fields expect YYYYMMDD. Returns Success, the new EntryId, and links. Note: submissions are rate-limited to 50 per user per 5-minute window.
   * @route POST /entries
   *
   * @paramDef {"type":"String","label":"Form Identifier","name":"formIdentifier","required":true,"dictionary":"getFormsDictionary","description":"The form Hash (from List Forms) or URL slug."}
   * @paramDef {"type":"Object","label":"Field Values","name":"fieldValues","required":true,"description":"Map of Field ID to value, e.g. {\"Field1\":\"Jane\",\"Field105\":\"jane@example.com\"}. Use List Form Fields to find IDs. Date fields use YYYYMMDD format."}
   *
   * @returns {Object}
   * @sampleResult {"Success":1,"EntryId":10,"EntryLink":"https://sub.wufoo.com/api/v3/forms/s1afea8b1vk0jf7/entries/10.json"}
   */
  async createEntry(formIdentifier, fieldValues) {
    return await this.#apiRequest({
      logTag: '[createEntry]',
      path: `/forms/${ encodeURIComponent(formIdentifier) }/entries.json`,
      method: 'post',
      form: fieldValues || {},
    })
  }

  /**
   * @operationName List Reports
   * @category Reports
   * @description Lists all reports in the Wufoo account, each with its Name, Hash (report identifier), description, visibility, and links to its entries and widgets. Use a report's Hash with the other report operations.
   * @route GET /reports
   *
   * @returns {Object}
   * @sampleResult {"Reports":[{"Name":"Sales Dashboard","Hash":"z7x1a9b2c3d4e5","Description":"","IsPublic":"1","DateCreated":"2015-01-10 09:00:00","LinkEntries":"https://sub.wufoo.com/api/v3/reports/z7x1a9b2c3d4e5/entries.json","LinkWidgets":"https://sub.wufoo.com/api/v3/reports/z7x1a9b2c3d4e5/widgets.json"}]}
   */
  async listReports() {
    return await this.#apiRequest({
      logTag: '[listReports]',
      path: '/reports.json',
      method: 'get',
    })
  }

  /**
   * @operationName Get Report
   * @category Reports
   * @description Retrieves a single report by its identifier (the report Hash from List Reports, or the report URL slug). Returns the report's metadata including Name, description, visibility, and links to its entries and widgets.
   * @route GET /report
   *
   * @paramDef {"type":"String","label":"Report Identifier","name":"reportIdentifier","required":true,"description":"The report Hash (from List Reports) or report URL slug."}
   *
   * @returns {Object}
   * @sampleResult {"Reports":[{"Name":"Sales Dashboard","Hash":"z7x1a9b2c3d4e5","Description":"","IsPublic":"1","DateCreated":"2015-01-10 09:00:00","LinkEntries":"https://sub.wufoo.com/api/v3/reports/z7x1a9b2c3d4e5/entries.json","LinkWidgets":"https://sub.wufoo.com/api/v3/reports/z7x1a9b2c3d4e5/widgets.json"}]}
   */
  async getReport(reportIdentifier) {
    return await this.#apiRequest({
      logTag: '[getReport]',
      path: `/reports/${ encodeURIComponent(reportIdentifier) }.json`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Report Entries
   * @category Reports
   * @description Returns the entries included in a report, keyed by Field IDs just like form entries. Use List Form Fields on the underlying form to map Field IDs to labels.
   * @route GET /report-entries
   *
   * @paramDef {"type":"String","label":"Report Identifier","name":"reportIdentifier","required":true,"description":"The report Hash (from List Reports) or report URL slug."}
   * @paramDef {"type":"Number","label":"Page Start","name":"pageStart","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based index of the first entry to return (default 0)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of entries to return (max 100, default 25)."}
   *
   * @returns {Object}
   * @sampleResult {"Entries":[{"EntryId":"9","Field1":"Wufoo","Field105":"support@wufoo.com","DateCreated":"2015-04-20 15:50:34"}],"EntryCount":"1"}
   */
  async getReportEntries(reportIdentifier, pageStart, pageSize) {
    return await this.#apiRequest({
      logTag: '[getReportEntries]',
      path: `/reports/${ encodeURIComponent(reportIdentifier) }/entries.json`,
      method: 'get',
      query: {
        pageStart,
        pageSize: pageSize !== undefined ? Math.min(Number(pageSize), MAX_PAGE_SIZE) : undefined,
      },
    })
  }

  /**
   * @operationName Get Report Widgets
   * @category Reports
   * @description Returns the widgets (charts, graphs, and summary tiles) that make up a report, including each widget's type, title, size, and configuration. Useful for reconstructing report visualizations or reading aggregated metrics.
   * @route GET /report-widgets
   *
   * @paramDef {"type":"String","label":"Report Identifier","name":"reportIdentifier","required":true,"description":"The report Hash (from List Reports) or report URL slug."}
   *
   * @returns {Object}
   * @sampleResult {"Widgets":[{"Name":"Submissions Over Time","Type":"linegraph","Size":"large","FieldTitle":"","IsInReport":"1"}]}
   */
  async getReportWidgets(reportIdentifier) {
    return await this.#apiRequest({
      logTag: '[getReportWidgets]',
      path: `/reports/${ encodeURIComponent(reportIdentifier) }/widgets.json`,
      method: 'get',
    })
  }

  /**
   * @operationName List Users
   * @category Users
   * @description Lists all users on the Wufoo account, each with their Hash, name, email, and administrative flags (whether they can create/manage forms, reports, and users). Useful for auditing account access.
   * @route GET /users
   *
   * @returns {Object}
   * @sampleResult {"Users":[{"User":"jsmith","Hash":"a1b2c3d4","FirstName":"Jane","LastName":"Smith","Email":"jane@example.com","IsAdmin":"1","IsAccountOwner":"0"}]}
   */
  async listUsers() {
    return await this.#apiRequest({
      logTag: '[listUsers]',
      path: '/users.json',
      method: 'get',
    })
  }

  /**
   * @operationName Add Webhook
   * @category Webhooks
   * @description Registers (or updates) a webhook on a form so Wufoo POSTs entry data to your URL whenever the form is submitted. Provide the callback URL, an optional handshake key (echoed back on each POST so you can verify authenticity), and whether to include field metadata in the payload. Returns the created webhook's WebHookHash — save it to delete the webhook later.
   * @route PUT /webhooks
   *
   * @paramDef {"type":"String","label":"Form Identifier","name":"formIdentifier","required":true,"dictionary":"getFormsDictionary","description":"The form Hash (from List Forms) or URL slug to attach the webhook to."}
   * @paramDef {"type":"String","label":"Callback URL","name":"url","required":true,"description":"HTTPS endpoint Wufoo will POST entry data to on each submission."}
   * @paramDef {"type":"String","label":"Handshake Key","name":"handshakeKey","description":"Optional secret echoed back in each webhook POST so you can verify the request came from Wufoo."}
   * @paramDef {"type":"Boolean","label":"Include Metadata","name":"metadata","uiComponent":{"type":"CHECKBOX"},"description":"When true, Wufoo includes form/field metadata in the webhook payload."}
   *
   * @returns {Object}
   * @sampleResult {"WebHookPutResult":{"Hash":"m5f5z1a"}}
   */
  async addWebhook(formIdentifier, url, handshakeKey, metadata) {
    return await this.#apiRequest({
      logTag: '[addWebhook]',
      path: `/webhooks/${ encodeURIComponent(formIdentifier) }.json`,
      method: 'put',
      form: {
        url,
        handshakeKey,
        metadata: metadata ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Delete Webhook
   * @category Webhooks
   * @description Removes a webhook from a form so Wufoo stops POSTing submissions to it. Requires the form identifier and the webhook Hash returned by Add Webhook.
   * @route DELETE /webhooks
   *
   * @paramDef {"type":"String","label":"Form Identifier","name":"formIdentifier","required":true,"dictionary":"getFormsDictionary","description":"The form Hash (from List Forms) or URL slug the webhook is attached to."}
   * @paramDef {"type":"String","label":"Webhook Hash","name":"webhookHash","required":true,"description":"The webhook Hash returned by Add Webhook."}
   *
   * @returns {Object}
   * @sampleResult {"WebHookDeleteResult":{"Hash":"m5f5z1a"}}
   */
  async deleteWebhook(formIdentifier, webhookHash) {
    return await this.#apiRequest({
      logTag: '[deleteWebhook]',
      path: `/webhooks/${ encodeURIComponent(formIdentifier) }/${ encodeURIComponent(webhookHash) }.json`,
      method: 'delete',
    })
  }

  /**
   * @typedef {Object} getFormsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter forms by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number). Wufoo returns forms in pages of up to 1000."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Forms Dictionary
   * @description Provides a searchable list of forms for selecting a Form Identifier in other operations. Each option's value is the form Hash and the label is the form name.
   * @route POST /get-forms-dictionary
   * @paramDef {"type":"getFormsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing forms."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Contact Form","value":"s1afea8b1vk0jf7","note":"Hash: s1afea8b1vk0jf7"}],"cursor":null}
   */
  async getFormsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? Number(cursor) : 1

    const response = await this.#apiRequest({
      logTag: '[getFormsDictionary]',
      path: '/forms.json',
      method: 'get',
      query: { page, limit: 100 },
    })

    const forms = Array.isArray(response?.Forms) ? response.Forms : []
    const term = (search || '').trim().toLowerCase()

    const filtered = term
      ? forms.filter(form => (form.Name || '').toLowerCase().includes(term))
      : forms

    const nextCursor = forms.length === 100 ? String(page + 1) : null

    return {
      items: filtered.map(form => ({
        label: form.Name || form.Hash,
        value: form.Hash,
        note: `Hash: ${ form.Hash }`,
      })),
      cursor: nextCursor,
    }
  }
}

Flowrunner.ServerCode.addService(WufooService, [
  {
    name: 'subdomain',
    displayName: 'Subdomain',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Wufoo subdomain — e.g. \'fishbowl\' for fishbowl.wufoo.com',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Wufoo → Account → API Information → API Key',
  },
])
