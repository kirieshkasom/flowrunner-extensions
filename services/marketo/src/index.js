// ============================================================================
//  Marketo extension - leads, lists, campaigns, activities, custom objects, and
//  assets over the Marketo REST/Asset/Bulk APIs (self-managed OAuth bearer).
//  Triggers poll, since Marketo's REST API has no inbound-webhook subscribe API.
// ============================================================================

// ============================================================================
//  CONSTANTS
// ============================================================================
const TOKEN_PATH = '/identity/oauth/token'
const REST_PREFIX = '/rest/v1'
// Asset API and Bulk API live under their own path prefixes.
const ASSET_PREFIX = '/rest/asset/v1'
const BULK_PREFIX = '/bulk/v1'
// Re-fetch the bearer when within this many ms of expiry.
const TOKEN_EXPIRY_SKEW_MS = 60 * 1000

// Friendly remediation for Marketo's documented error codes (string codes per the API).
const ERROR_HINTS = {
  600: 'Empty access token — check the Client ID / Client Secret config.',
  601: 'Access token invalid — verify the Client ID and Client Secret in the service config.',
  602: 'Access token expired — it will be refreshed automatically; retry the action.',
  603: 'Access denied — the API user lacks permission for this resource.',
  606: 'Rate limit hit (100 calls / 20s) — retry in a moment.',
  607: 'Daily API quota reached — wait for the quota to reset (12:00AM CST) or raise the limit.',
  609: 'Invalid JSON in the request — check the records/fields you provided.',
  610: 'Requested resource not found — verify the ID or API name.',
  1003: 'Invalid data — check the field names and values against Describe Lead / Describe Custom Object.',
  1004: 'Lead not found — use Get Leads to pick a valid lead ID.',
  1013: 'Object not found — use the matching List/Describe action to pick a valid one.',
}

// ============================================================================
//  DROPDOWN CHOICE MAPPINGS (friendly label -> Marketo API value)
//  Dropdowns expose friendly labels; these map each label back to the API
//  value the endpoint expects. Unknown values pass through unchanged so
//  advanced users can still type raw field API names.
// ============================================================================
const ACTION_MAP = {
  'Create or Update': 'createOrUpdate',
  'Create Only': 'createOnly',
  'Update Only': 'updateOnly',
  'Create Duplicate': 'createDuplicate',
}
const LOOKUP_FIELD_MAP = { Email: 'email', 'Marketo ID': 'id', Cookie: 'cookies' }
const FILTER_FIELD_MAP = { Email: 'email', 'Marketo ID': 'id' }
const DEDUPE_MAP = { 'Dedupe Fields': 'dedupeFields', 'ID Field': 'idField' }
const PROGRAM_STATUS_MAP = { On: 'on', Off: 'off', Unlocked: 'unlocked' }
const VERSION_MAP = { Draft: 'draft', Approved: 'approved' }
const TOKEN_TYPE_MAP = {
  Text: 'text',
  Number: 'number',
  Date: 'date',
  'Rich Text': 'rich text',
  Score: 'score',
  'SFDC Campaign': 'sfdc campaign',
}
const FORMAT_LOWER_MAP = { CSV: 'csv', TSV: 'tsv', SFF: 'sff' }
const DATE_FILTER_MAP = { 'Created At': 'createdAt', 'Updated At': 'updatedAt' }

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Marketo] info:', ...args),
  debug: (...args) => console.log('[Marketo] debug:', ...args),
  error: (...args) => console.log('[Marketo] error:', ...args),
  warn: (...args) => console.log('[Marketo] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getListsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter lists by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getCampaignsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter campaigns by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getActivityTypesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter activity types by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getCustomObjectsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter custom object types by display name or API name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getProgramsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter programs by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) for the next page of results."}
 */

/**
 * @typedef {Object} getFoldersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter folders by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) for the next page of results."}
 */

/**
 * @typedef {Object} getEmailsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter emails by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) for the next page of results."}
 */

/**
 * @typedef {Object} getFormsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter forms by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) for the next page of results."}
 */

/**
 * @typedef {Object} getLandingPagesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter landing pages by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) for the next page of results."}
 */

/**
 * @typedef {Object} getSmartListsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter smart lists by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) for the next page of results."}
 */

// ============================================================================
//  SHARED ELEMENT TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} CampaignToken
 * @property {String} name - The My-Token name including braces, e.g. {{my.WebinarTitle}}
 * @property {String} value - The replacement value for this run.
 */

/**
 * @integrationName Marketo
 * @integrationIcon /icon.svg
 */
class Marketo {
  constructor(config) {
    this.config = config || {}
    this.clientId = this.config.clientId
    this.clientSecret = this.config.clientSecret
    // Normalize: strip any trailing slash so URL construction is predictable.
    this.baseUrl = (this.config.baseUrl || '').replace(/\/+$/, '')
    // Cached bearer token: { token, expiresAt }
    this._token = null
  }

  // Map a friendly dropdown label to its Marketo API value. Unknown values
  // (e.g. a custom field API name typed by an advanced user) pass through.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ==========================================================================
  //  AUTH - self-managed 2-legged client_credentials (no redirect flow)
  // ==========================================================================
  async #getAccessToken(forceRefresh) {
    const now = Date.now()

    if (!forceRefresh && this._token && this._token.expiresAt - TOKEN_EXPIRY_SKEW_MS > now) {
      return this._token.token
    }

    if (!this.clientId || !this.clientSecret || !this.baseUrl) {
      throw new Error('Marketo is not configured — set Client ID, Client Secret, and Base URL in the service config.')
    }

    const url = `${ this.baseUrl }${ TOKEN_PATH }`

    try {
      logger.debug(`getAccessToken GET ${ url }`)

      const response = await Flowrunner.Request.get(url).query({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      })

      if (!response || !response.access_token) {
        throw new Error('Token exchange returned no access_token — verify the Client ID, Client Secret, and Base URL.')
      }

      const expiresInMs = (Number(response.expires_in) || 3600) * 1000

      this._token = { token: response.access_token, expiresAt: now + expiresInMs }

      return this._token.token
    } catch (error) {
      this.#handleError(error, 'getAccessToken')
    }
  }

  // ==========================================================================
  //  CORE - every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ path, method, body, query, logTag, isRetry, prefix, form }) {
    method = method || 'get'

    const token = await this.#getAccessToken(false)
    const url = `${ this.baseUrl }${ prefix || REST_PREFIX }${ path }`

    // Asset API writes are application/x-www-form-urlencoded; everything else is JSON.
    const contentType = form ? 'application/x-www-form-urlencoded' : 'application/json'
    const payload = form && body && typeof body === 'object' ? this.#encodeForm(body) : body

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set({ Authorization: `Bearer ${ token }`, 'Content-Type': contentType })
        .query(query || {})

      const response = body != null ? await request.send(payload) : await request

      // Marketo returns HTTP 200 with success:false + token errors (601/602) in the body.
      if (response && response.success === false && !isRetry && this.#isTokenError(response)) {
        await this.#getAccessToken(true)

        return await this.#apiRequest({ path, method, body, query, logTag, prefix, form, isRetry: true })
      }

      if (response && response.success === false) {
        throw this.#buildApiError(response)
      }

      return response
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #isTokenError(response) {
    const errors = (response && response.errors) || []

    return errors.some(e => e && (String(e.code) === '601' || String(e.code) === '602'))
  }

  #buildApiError(response) {
    const first = (response.errors && response.errors[0]) || {}
    const code = first.code != null ? String(first.code) : null
    const hint = code && ERROR_HINTS[code]
    const message = hint || first.message || 'Marketo request failed.'

    const error = new Error(hint && first.message ? `${ hint } (${ first.message })` : message)

    error.marketoCode = code

    return error
  }

  #handleError(error, logTag) {
    // Already a normalized Marketo error from #buildApiError - surface as-is.
    if (error && error.marketoCode) {
      logger.error(`${ logTag } failed: ${ error.message }`)
      throw error
    }

    const apiMessage = error?.body?.errors?.[0]?.message ||
      error?.body?.error?.message ||
      error?.body?.message ||
      error?.message ||
      'Request failed'

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    throw new Error(apiMessage)
  }

  // ==========================================================================
  //  HELPERS
  // ==========================================================================
  // Accept an Array<String> OR a comma-separated string; return a trimmed string array.
  #toList(value) {
    if (value == null) return []
    const arr = Array.isArray(value) ? value : String(value).split(',')

    return arr.map(v => String(v).trim()).filter(Boolean)
  }

  // Build a query object that repeats `id` for each value (Marketo's list-membership style).
  #repeatIdQuery(ids, extra) {
    return Object.assign({ id: this.#toList(ids) }, extra || {})
  }

  // Serialize a flat object to an application/x-www-form-urlencoded string. Object/array values
  // (e.g. the Asset API's folder/parent/costs fields) are sent as their JSON-string form.
  #encodeForm(obj) {
    return Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => {
        const value = typeof v === 'object' ? JSON.stringify(v) : String(v)

        return `${ encodeURIComponent(k) }=${ encodeURIComponent(value) }`
      })
      .join('&')
  }

  // The Asset API expects folder/parent/root as a {"id":<id>,"type":"Folder"} JSON object in a form field.
  #folderRef(id, type) {
    return { id: Number(id) || id, type: type || 'Folder' }
  }

  // Shared describe/query/sync/delete for the five CRM-object families (JSON bodies, /rest/v1/<family>).
  async #crmDescribe(family, logTag) {
    return await this.#apiRequest({ path: `/${ family }/describe.json`, logTag })
  }

  async #crmQuery(family, logTag, filterType, filterValues, fields, batchSize, nextPageToken) {
    if (!filterType) throw new Error('Filter Field is required.')

    const values = this.#toList(filterValues)

    if (!values.length) throw new Error('Filter Values is required — provide at least one value.')

    const query = { filterType: this.#resolveChoice(filterType, FILTER_FIELD_MAP), filterValues: values.join(',') }
    const fieldList = this.#toList(fields)

    if (fieldList.length) query.fields = fieldList.join(',')
    if (batchSize) query.batchSize = batchSize
    if (nextPageToken) query.nextPageToken = nextPageToken

    return await this.#apiRequest({ path: `/${ family }.json`, query, logTag })
  }

  async #crmSync(family, logTag, records, action, dedupeBy) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Records is required — provide an array of records.')
    }

    const body = { action: this.#resolveChoice(action, ACTION_MAP) || 'createOrUpdate', input: records }

    if (dedupeBy) body.dedupeBy = this.#resolveChoice(dedupeBy, DEDUPE_MAP)

    return await this.#apiRequest({ path: `/${ family }.json`, method: 'post', body, logTag })
  }

  async #crmDelete(family, logTag, records, deleteBy) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Records is required — provide an array of records to delete.')
    }

    const body = { input: records }

    if (deleteBy) body.deleteBy = this.#resolveChoice(deleteBy, DEDUPE_MAP)

    return await this.#apiRequest({ path: `/${ family }/delete.json`, method: 'post', body, logTag })
  }

  // Shared export-job lifecycle for Bulk Lead/Activity Export (kind = 'leads' | 'activities').
  async #enqueueExport(kind, exportId, logTag) {
    if (!exportId) throw new Error('Export Job is required.')

    return await this.#apiRequest({
      path: `/${ kind }/export/${ encodeURIComponent(exportId) }/enqueue.json`,
      method: 'post', prefix: BULK_PREFIX, logTag,
    })
  }

  async #exportStatus(kind, exportId, logTag) {
    if (!exportId) throw new Error('Export Job is required.')

    return await this.#apiRequest({
      path: `/${ kind }/export/${ encodeURIComponent(exportId) }/status.json`,
      prefix: BULK_PREFIX, logTag,
    })
  }

  async #cancelExport(kind, exportId, logTag) {
    if (!exportId) throw new Error('Export Job is required.')

    return await this.#apiRequest({
      path: `/${ kind }/export/${ encodeURIComponent(exportId) }/cancel.json`,
      method: 'post', prefix: BULK_PREFIX, logTag,
    })
  }

  async #exportFile(kind, exportId, logTag) {
    if (!exportId) throw new Error('Export Job is required.')

    const content = await this.#apiRequest({
      path: `/${ kind }/export/${ encodeURIComponent(exportId) }/file.json`,
      prefix: BULK_PREFIX, logTag,
    })

    return { exportId, content: typeof content === 'string' ? content : (content || '') }
  }

  // ==========================================================================
  //  ACTIONS - LEADS
  // ==========================================================================
  /**
   * @operationName Sync Leads
   * @category Leads
   * @description Creates or updates lead (person) records in bulk. Each record is a free-form object of Marketo field API names (e.g. email, firstName, company). Use this to push contacts into Marketo; choose Create or Update to upsert on the lookup field. Up to 300 records per call.
   * @route POST /sync-leads
   * @paramDef {"type":"Array<Object>","label":"Leads","name":"leads","required":true,"description":"Array of lead records to create or update. Each object holds Marketo field API names as keys (e.g. email, firstName, lastName, company, phone). Up to 300 per call. Field names are instance-defined — use Describe Lead Fields to discover them."}
   * @paramDef {"type":"String","label":"Action","name":"action","uiComponent":{"type":"DROPDOWN","options":{"values":["Create or Update","Create Only","Update Only","Create Duplicate"]}},"description":"How to handle each record. Create or Update (default) upserts on the lookup field; Create Only inserts; Update Only updates existing; Create Duplicate always inserts a new record."}
   * @paramDef {"type":"String","label":"Lookup Field","name":"lookupField","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Marketo ID","Cookie"]}},"description":"The field used to match existing leads for dedup. Defaults to Email. Use Marketo ID when you already have the lead id."}
   * @paramDef {"type":"String","label":"Partition Name","name":"partitionName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Lead partition to assign new leads to (only applies with Create Only or Create or Update). Leave blank for the default partition."}
   * @returns {Object}
   * @sampleResult {"requestId":"e42b#14272d07d78","success":true,"result":[{"id":50,"status":"created"},{"id":51,"status":"updated"}]}
   */
  async syncLeads(leads, action, lookupField, partitionName) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/leads
    if (!Array.isArray(leads) || leads.length === 0) {
      throw new Error('Leads is required — provide an array of lead records.')
    }

    const body = { action: this.#resolveChoice(action, ACTION_MAP) || 'createOrUpdate', lookupField: this.#resolveChoice(lookupField, LOOKUP_FIELD_MAP) || 'email', input: leads }

    if (partitionName) body.partitionName = partitionName

    return await this.#apiRequest({ path: '/leads.json', method: 'post', body, logTag: 'syncLeads' })
  }

  /**
   * @operationName Get Lead by ID
   * @category Leads
   * @description Retrieves a single lead (person) by its Marketo ID. Use it after Get Leads or Sync Leads to fetch the full record. Optionally restrict the returned fields.
   * @route POST /get-lead-by-id
   * @paramDef {"type":"String","label":"Lead","name":"lead","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The Marketo lead (person) ID to retrieve. Get it from Get Leads or Sync Leads output (leads are too numerous for a dictionary)."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Optional list of field API names to return (e.g. email, firstName, company). Leave empty for the default field set. Use Describe Lead Fields to discover available names."}
   * @returns {Object}
   * @sampleResult {"requestId":"10226#14d3049e51b","success":true,"result":[{"id":318581,"updatedAt":"2015-05-07T11:47:30-08:00","lastName":"Doe","email":"jdoe@marketo.com","createdAt":"2015-05-01T16:47:30-08:00","firstName":"John"}]}
   */
  async getLeadById(lead, fields) {
    if (!lead) throw new Error('Lead is required.')

    const query = {}
    const fieldList = this.#toList(fields)

    if (fieldList.length) query.fields = fieldList.join(',')

    return await this.#apiRequest({ path: `/lead/${ encodeURIComponent(lead) }.json`, query, logTag: 'getLeadById' })
  }

  /**
   * @operationName Get Leads
   * @category Leads
   * @description Searches leads by a filter field and a list of values (e.g. all leads matching a set of emails or IDs). Use this to find leads before acting on them. For date-window lookups ("leads changed since T"), use the On New Lead trigger, Get Lead Field Changes, or Bulk Lead Export - timestamp ranges are not a valid Get Leads filter. Returns up to 300 per page with a Next Page Token for paging.
   * @route POST /get-leads
   * @paramDef {"type":"String","label":"Filter Field","name":"filterType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Marketo ID"]}},"description":"The field to filter leads on. Pair with Filter Values. Advanced users may also type a custom searchable field API name."}
   * @paramDef {"type":"Array<String>","label":"Filter Values","name":"filterValues","required":true,"description":"Values to match on the chosen filter field (e.g. a list of emails or IDs). Up to 300. Accepts a list or comma-separated string."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Optional list of field API names to return. Leave empty for the default field set."}
   * @paramDef {"type":"Number","label":"Batch Size","name":"batchSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page (max 300). Defaults to 300."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination token from a previous response. Leave blank for the first page."}
   * @returns {Object}
   * @sampleResult {"requestId":"12951#15699db5c97","success":true,"result":[{"id":318581,"updatedAt":"2016-05-17T22:11:45Z","lastName":"Lincoln","email":"abe@usa.gov","createdAt":"2015-03-17T00:18:40Z","firstName":"Abraham"}],"nextPageToken":null}
   */
  async getLeads(filterType, filterValues, fields, batchSize, nextPageToken) {
    if (!filterType) throw new Error('Filter Field is required.')

    const values = this.#toList(filterValues)

    if (!values.length) throw new Error('Filter Values is required — provide at least one value.')

    const query = { filterType: this.#resolveChoice(filterType, FILTER_FIELD_MAP), filterValues: values.join(',') }
    const fieldList = this.#toList(fields)

    if (fieldList.length) query.fields = fieldList.join(',')
    if (batchSize) query.batchSize = batchSize
    if (nextPageToken) query.nextPageToken = nextPageToken

    return await this.#apiRequest({ path: '/leads.json', query, logTag: 'getLeads' })
  }

  /**
   * @operationName Delete Leads
   * @category Leads
   * @description Permanently deletes leads by their Marketo IDs (up to 300). Skipped rows return a per-row reason. Use Get Leads to find the IDs first.
   * @route POST /delete-leads
   * @paramDef {"type":"Array<String>","label":"Lead IDs","name":"leadIds","required":true,"description":"Marketo lead IDs to permanently delete. Up to 300. Accepts a list or a comma-separated string."}
   * @returns {Object}
   * @sampleResult {"requestId":"3608#16664333670","success":true,"result":[{"id":235,"status":"deleted"},{"id":766,"status":"deleted"}]}
   */
  async deleteLeads(leadIds) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/leads
    const ids = this.#toList(leadIds)

    if (!ids.length) throw new Error('Lead IDs is required — provide at least one lead ID.')

    const body = { input: ids.map(id => ({ id: Number(id) || id })) }

    return await this.#apiRequest({ path: '/leads/delete.json', method: 'post', body, logTag: 'deleteLeads' })
  }

  /**
   * @operationName Describe Lead Fields
   * @category Leads
   * @description Returns the full schema of lead fields in this instance - each field's API name, display name, and data type. Use it to discover the exact field names to put in Sync Leads or the Fields parameter of Get Lead.
   * @route POST /describe-lead-fields
   * @returns {Object}
   * @sampleResult {"requestId":"37ca#1475b74e276","success":true,"result":[{"id":2,"displayName":"Company Name","dataType":"string","length":255,"rest":{"name":"company","readOnly":false}}]}
   */
  async describeLeadFields() {
    return await this.#apiRequest({ path: '/leads/describe.json', logTag: 'describeLeadFields' })
  }

  // ==========================================================================
  //  ACTIONS - LISTS (static list membership)
  // ==========================================================================
  /**
   * @operationName Get Lists
   * @category Lists
   * @description Returns static lists in the instance, optionally filtered by name or program. Use this to find a list before adding or removing members. Returns up to 300 per page.
   * @route POST /get-lists
   * @paramDef {"type":"String","label":"Name Filter","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional list name to filter by. Leave blank to return all lists."}
   * @paramDef {"type":"String","label":"Program Name Filter","name":"programName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional program name to filter lists by their parent program."}
   * @paramDef {"type":"Number","label":"Batch Size","name":"batchSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page (max 300). Defaults to 300."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination token from a previous response. Leave blank for the first page."}
   * @returns {Object}
   * @sampleResult {"requestId":"abc1#1700","success":true,"result":[{"id":1027,"name":"My Static List","description":"Newsletter subscribers","programName":"2025 Newsletter","workspaceName":"Default","createdAt":"2018-06-21T04:32:25Z","updatedAt":"2018-06-21T04:32:25Z"}],"nextPageToken":null}
   */
  async getLists(name, programName, batchSize, nextPageToken) {
    const query = {}

    if (name) query.name = name
    if (programName) query.programName = programName
    if (batchSize) query.batchSize = batchSize
    if (nextPageToken) query.nextPageToken = nextPageToken

    return await this.#apiRequest({ path: '/lists.json', query, logTag: 'getLists' })
  }

  /**
   * @operationName Get List by ID
   * @category Lists
   * @description Retrieves a single static list by ID, including its name, description, and parent program. The List field is a dropdown backed by a dictionary.
   * @route POST /get-list-by-id
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The static list to retrieve."}
   * @returns {Object}
   * @sampleResult {"requestId":"abc2#1700","success":true,"result":[{"id":1027,"name":"My Static List","description":"Newsletter subscribers","programName":"2025 Newsletter","workspaceName":"Default","createdAt":"2018-06-21T04:32:25Z","updatedAt":"2018-06-21T04:32:25Z"}]}
   */
  async getListById(listId) {
    if (!listId) throw new Error('List is required.')

    return await this.#apiRequest({ path: `/lists/${ encodeURIComponent(listId) }.json`, logTag: 'getListById' })
  }

  /**
   * @operationName Get Leads by List
   * @category Lists
   * @description Returns the lead members of a static list. Use it to read who is on a list before removing or processing them. Returns up to 300 per page with a Next Page Token for paging.
   * @route POST /get-leads-by-list
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The static list whose members to retrieve."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Optional list of field API names to return. Leave empty for the default field set."}
   * @paramDef {"type":"Number","label":"Batch Size","name":"batchSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page (max 300). Defaults to 300."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination token from a previous response. Leave blank for the first page."}
   * @returns {Object}
   * @sampleResult {"requestId":"ddae#170615ba0cc","success":true,"result":[{"id":318594,"firstName":"Hanna","lastName":"Crawford","email":"hanna@example.com","updatedAt":"2015-04-06T17:13:50Z","createdAt":"2015-04-06T17:13:50Z"}],"nextPageToken":null}
   */
  async getLeadsByList(listId, fields, batchSize, nextPageToken) {
    if (!listId) throw new Error('List is required.')

    const query = {}
    const fieldList = this.#toList(fields)

    if (fieldList.length) query.fields = fieldList.join(',')
    if (batchSize) query.batchSize = batchSize
    if (nextPageToken) query.nextPageToken = nextPageToken

    return await this.#apiRequest({
      path: `/lists/${ encodeURIComponent(listId) }/leads.json`,
      query,
      logTag: 'getLeadsByList',
    })
  }

  /**
   * @operationName Add Leads to List
   * @category Lists
   * @description Adds existing leads to a static list (up to 300). Lead IDs are sent as repeated id query parameters per the Marketo membership API. Skipped rows return a per-row reason.
   * @route POST /add-leads-to-list
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The static list to add members to."}
   * @paramDef {"type":"Array<String>","label":"Lead IDs","name":"leadIds","required":true,"description":"Marketo lead IDs to add to the list. Up to 300. Accepts a list or comma-separated string."}
   * @returns {Object}
   * @sampleResult {"requestId":"6860#1706170ba29","success":true,"result":[{"id":318594,"status":"added"},{"id":318595,"status":"skipped","reasons":[{"code":"1004","message":"Lead not found"}]}]}
   */
  async addLeadsToList(listId, leadIds) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/list-membership
    if (!listId) throw new Error('List is required.')

    const ids = this.#toList(leadIds)

    if (!ids.length) throw new Error('Lead IDs is required — provide at least one lead ID.')

    return await this.#apiRequest({
      path: `/lists/${ encodeURIComponent(listId) }/leads.json`,
      method: 'post',
      query: this.#repeatIdQuery(ids),
      logTag: 'addLeadsToList',
    })
  }

  /**
   * @operationName Remove Leads from List
   * @category Lists
   * @description Removes leads from a static list (up to 300). Lead IDs are sent as repeated id query parameters. Skipped rows return a per-row reason.
   * @route POST /remove-leads-from-list
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The static list to remove members from."}
   * @paramDef {"type":"Array<String>","label":"Lead IDs","name":"leadIds","required":true,"description":"Marketo lead IDs to remove from the list. Up to 300. Accepts a list or comma-separated string."}
   * @returns {Object}
   * @sampleResult {"requestId":"9e79#17061689ac3","success":true,"result":[{"id":318603,"status":"removed"},{"id":999999,"status":"skipped","reasons":[{"code":"1004","message":"Lead not found"}]}]}
   */
  async removeLeadsFromList(listId, leadIds) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/list-membership
    if (!listId) throw new Error('List is required.')

    const ids = this.#toList(leadIds)

    if (!ids.length) throw new Error('Lead IDs is required — provide at least one lead ID.')

    return await this.#apiRequest({
      path: `/lists/${ encodeURIComponent(listId) }/leads.json`,
      method: 'delete',
      query: this.#repeatIdQuery(ids),
      logTag: 'removeLeadsFromList',
    })
  }

  /**
   * @operationName Member of List
   * @category Lists
   * @description Checks whether each given lead is a member of a static list (up to 300). Returns memberof / notmemberof / skipped per lead. Use it to branch a flow on list membership.
   * @route POST /is-member-of-list
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The static list to check membership against."}
   * @paramDef {"type":"Array<String>","label":"Lead IDs","name":"leadIds","required":true,"description":"Marketo lead IDs to check. Up to 300. Accepts a list or comma-separated string."}
   * @returns {Object}
   * @sampleResult {"requestId":"693a#17061475cf9","success":true,"result":[{"id":309901,"status":"memberof"},{"id":318603,"status":"notmemberof"}]}
   */
  async isMemberOfList(listId, leadIds) {
    if (!listId) throw new Error('List is required.')

    const ids = this.#toList(leadIds)

    if (!ids.length) throw new Error('Lead IDs is required — provide at least one lead ID.')

    return await this.#apiRequest({
      path: `/lists/${ encodeURIComponent(listId) }/leads/ismember.json`,
      query: this.#repeatIdQuery(ids),
      logTag: 'isMemberOfList',
    })
  }

  // ==========================================================================
  //  ACTIONS - CAMPAIGNS
  // ==========================================================================
  /**
   * @operationName Get Campaigns
   * @category Campaigns
   * @description Returns smart campaigns in the instance, optionally filtered by name, program, or whether they are triggerable via the API. Use it to find a campaign before requesting or scheduling it.
   * @route POST /get-campaigns
   * @paramDef {"type":"String","label":"Name Filter","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional campaign name to filter by. Leave blank to return all smart campaigns."}
   * @paramDef {"type":"String","label":"Program Name Filter","name":"programName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional program name to filter campaigns by their parent program."}
   * @paramDef {"type":"Boolean","label":"Triggerable Only","name":"isTriggerable","uiComponent":{"type":"TOGGLE"},"description":"When on, returns only campaigns that can be requested via the API (have an active Web Service API trigger). Use before Request Campaign."}
   * @paramDef {"type":"Number","label":"Batch Size","name":"batchSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page (max 300). Defaults to 300."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination token from a previous response. Leave blank for the first page."}
   * @returns {Object}
   * @sampleResult {"requestId":"c1#1700","success":true,"result":[{"id":1069,"name":"Test Trigger Campaign","description":"","type":"trigger","programName":"Webinar 2025","programId":1011,"workspaceName":"Default","createdAt":"2018-02-16T01:34:39Z","updatedAt":"2018-02-16T01:34:39Z","active":true}],"nextPageToken":null}
   */
  async getCampaigns(name, programName, isTriggerable, batchSize, nextPageToken) {
    const query = {}

    if (name) query.name = name
    if (programName) query.programName = programName
    if (isTriggerable != null && isTriggerable !== '') query.isTriggerable = isTriggerable
    if (batchSize) query.batchSize = batchSize
    if (nextPageToken) query.nextPageToken = nextPageToken

    return await this.#apiRequest({ path: '/campaigns.json', query, logTag: 'getCampaigns' })
  }

  /**
   * @operationName Get Campaign by ID
   * @category Campaigns
   * @description Retrieves a single smart campaign by ID, including its type (trigger or batch) and parent program. The Campaign field is a dropdown backed by a dictionary.
   * @route POST /get-campaign-by-id
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The smart campaign to retrieve."}
   * @returns {Object}
   * @sampleResult {"requestId":"c2#1700","success":true,"result":[{"id":1069,"name":"Test Trigger Campaign","type":"trigger","programName":"Webinar 2025","programId":1011,"workspaceName":"Default","createdAt":"2018-02-16T01:34:39Z","updatedAt":"2018-02-16T01:34:39Z","active":true}]}
   */
  async getCampaignById(campaignId) {
    if (!campaignId) throw new Error('Campaign is required.')

    return await this.#apiRequest({
      path: `/campaigns/${ encodeURIComponent(campaignId) }.json`,
      logTag: 'getCampaignById',
    })
  }

  /**
   * @operationName Request Campaign
   * @category Campaigns
   * @description Runs the given leads through a trigger smart campaign immediately. The campaign must have an active "Campaign is Requested: Source = Web Service API" trigger step. Up to 100 leads per call; My-Token overrides must already exist under the program's My Tokens tab.
   * @route POST /request-campaign
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The trigger smart campaign to run. Must have an active \"Campaign is Requested: Source = Web Service API\" trigger step."}
   * @paramDef {"type":"Array<String>","label":"Lead IDs","name":"leadIds","required":true,"description":"Marketo lead IDs to run through the campaign. Up to 100 per call. Accepts a list or comma-separated string."}
   * @paramDef {"type":"Array<CampaignToken>","label":"My Tokens","name":"tokens","description":"Optional My-Token overrides applied during this run. Each token must already exist under the program's My Tokens tab."}
   * @returns {Object}
   * @sampleResult {"requestId":"2f0e#17bde6445ee","success":true,"result":[{"id":8304}]}
   */
  async requestCampaign(campaignId, leadIds, tokens) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-learn/tutorials/integrations/trigger-smart-campaign-rest-api
    if (!campaignId) throw new Error('Campaign is required.')

    const ids = this.#toList(leadIds)

    if (!ids.length) throw new Error('Lead IDs is required — provide at least one lead ID.')

    const input = { leads: ids.map(id => ({ id: Number(id) || id })) }

    if (Array.isArray(tokens) && tokens.length) input.tokens = tokens

    return await this.#apiRequest({
      path: `/campaigns/${ encodeURIComponent(campaignId) }/trigger.json`,
      method: 'post',
      body: { input },
      logTag: 'requestCampaign',
    })
  }

  /**
   * @operationName Schedule Campaign
   * @category Campaigns
   * @description Schedules a batch smart campaign to run at a future time (default: 5 minutes from now; must be at least 5 minutes out). Optionally clones the parent program and applies My-Token overrides. The target must be a batch (not trigger) campaign.
   * @route POST /schedule-campaign
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The batch smart campaign to schedule. Must be a batch (not trigger) campaign."}
   * @paramDef {"type":"String","label":"Run At","name":"runAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When to run the campaign (ISO-8601). Must be at least 5 minutes from now. Leave blank to run in 5 minutes."}
   * @paramDef {"type":"String","label":"Clone To Program Name","name":"cloneToProgramName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"When set, clones the campaign's parent program to this new name and runs the clone. Leave blank to run the campaign in place."}
   * @paramDef {"type":"Array<CampaignToken>","label":"My Tokens","name":"tokens","description":"Optional My-Token overrides applied during this run. Each token must already exist under the program's My Tokens tab."}
   * @returns {Object}
   * @sampleResult {"requestId":"d3#17bd","success":true}
   */
  async scheduleCampaign(campaignId, runAt, cloneToProgramName, tokens) {
    // API: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/smart-campaigns
    // The clone wire key (cloneToProgramName vs cloneToProgram) is inconsistent across Adobe's REST
    // pages; cloneToProgramName is the better-attested form. Confirm the exact key against a live
    // account before relying on cloning.
    if (!campaignId) throw new Error('Campaign is required.')

    const input = {}

    if (runAt) input.runAt = runAt
    if (cloneToProgramName) input.cloneToProgramName = cloneToProgramName
    if (Array.isArray(tokens) && tokens.length) input.tokens = tokens

    return await this.#apiRequest({
      path: `/campaigns/${ encodeURIComponent(campaignId) }/schedule.json`,
      method: 'post',
      body: { input },
      logTag: 'scheduleCampaign',
    })
  }

  // ==========================================================================
  //  ACTIONS - ACTIVITIES
  // ==========================================================================
  /**
   * @operationName Get Activity Types
   * @category Activities
   * @description Returns the activity types available in this instance, each with its ID, name, and attributes. Use it to discover the activity type IDs needed for Get Lead Activities.
   * @route POST /get-activity-types
   * @returns {Object}
   * @sampleResult {"requestId":"6e78#148ad3b76f1","success":true,"result":[{"id":2,"name":"Fill Out Form","description":"User fills out and submits form on web page","primaryAttribute":{"name":"Webform ID","dataType":"integer"},"attributes":[{"name":"Client IP Address","dataType":"string"}]}]}
   */
  async getActivityTypes() {
    return await this.#apiRequest({ path: '/activities/types.json', logTag: 'getActivityTypes' })
  }

  /**
   * @operationName Get Paging Token
   * @category Activities
   * @description Returns a paging token that anchors an activity stream at a given start time. Pass the token to Get Lead Activities to begin reading activities from that point.
   * @route POST /get-paging-token
   * @paramDef {"type":"String","label":"Since Date/Time","name":"sinceDatetime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the activity window (ISO-8601). The returned token anchors a Get Lead Activities stream from this point."}
   * @returns {Object}
   * @sampleResult {"requestId":"e1#1700","success":true,"nextPageToken":"WQV2VQVPPCKHC6AQYVK7JDSA3I3LCWXH3Y6IIZ7YSGQLXHCPVE5Q===="}
   */
  async getPagingToken(sinceDatetime) {
    if (!sinceDatetime) throw new Error('Since Date/Time is required.')

    return await this.#apiRequest({
      path: '/activities/pagingtoken.json',
      query: { sinceDatetime },
      logTag: 'getPagingToken',
    })
  }

  /**
   * @operationName Get Lead Activities
   * @category Activities
   * @description Returns lead activities of the chosen type(s) from a paging token (get the first token from Get Paging Token). Use it to read the activity log stream - form fills, clicks, etc. Optionally scope to specific leads or a list.
   * @route POST /get-lead-activities
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination/stream token. Get the first one from Get Paging Token; subsequent calls reuse the token returned by this method."}
   * @paramDef {"type":"Array<String>","label":"Activity Types","name":"activityTypeIds","required":true,"dictionary":"getActivityTypesDictionary","description":"Activity type IDs to retrieve (up to 10). Use Get Activity Types to discover them."}
   * @paramDef {"type":"Array<String>","label":"Lead IDs","name":"leadIds","description":"Optional Marketo lead IDs to scope the activities to (up to 30)."}
   * @paramDef {"type":"String","label":"List","name":"listId","dictionary":"getListsDictionary","description":"Optional static list to scope the activities to."}
   * @paramDef {"type":"Number","label":"Batch Size","name":"batchSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page (max 300). Defaults to 300."}
   * @returns {Object}
   * @sampleResult {"requestId":"24fd#15188a88d7f","success":true,"result":[{"id":102988,"marketoGUID":"102988","leadId":1,"activityDate":"2023-01-16T23:32:19Z","activityTypeId":1,"primaryAttributeValueId":71,"primaryAttributeValue":"localhost/page.html","attributes":[{"name":"Client IP Address","value":"10.0.19.252"}]}],"nextPageToken":"WQV2VQVPPCKHC6AQYVK7JDSA3J62DUSJ3EXJGDPTKPEBFW3SAVUA====","moreResult":false}
   */
  async getLeadActivities(nextPageToken, activityTypeIds, leadIds, listId, batchSize) {
    if (!nextPageToken) throw new Error('Next Page Token is required — get one from Get Paging Token.')

    const typeIds = this.#toList(activityTypeIds)

    if (!typeIds.length) throw new Error('Activity Types is required — provide at least one activity type ID.')

    const query = { nextPageToken, activityTypeIds: typeIds.join(',') }
    const leads = this.#toList(leadIds)

    if (leads.length) query.leadIds = leads.join(',')
    if (listId) query.listId = listId
    if (batchSize) query.batchSize = batchSize

    return await this.#apiRequest({ path: '/activities.json', query, logTag: 'getLeadActivities' })
  }

  // ==========================================================================
  //  ACTIONS - CUSTOM OBJECTS
  // ==========================================================================
  /**
   * @operationName List Custom Object Types
   * @category Custom Objects
   * @description Returns the custom object types defined in this instance, each with its API name, dedupe fields, and ID field. Use it to discover the API name needed for Query/Sync/Describe Custom Object. Requires a subscription that includes Custom Objects.
   * @route POST /list-custom-object-types
   * @paramDef {"type":"Array<String>","label":"Names Filter","name":"names","description":"Optional custom object API names to filter by. Leave empty to return all custom object types."}
   * @returns {Object}
   * @sampleResult {"requestId":"185d6#14b51985ff0","success":true,"result":[{"name":"Car","displayName":"Car","description":"Car owner","idField":"marketoGUID","dedupeFields":["vin"],"createdAt":"2015-02-03T22:36:23Z","updatedAt":"2015-02-03T22:36:24Z"}]}
   */
  async listCustomObjectTypes(names) {
    const query = {}
    const nameList = this.#toList(names)

    if (nameList.length) query.names = nameList.join(',')

    return await this.#apiRequest({ path: '/customobjects.json', query, logTag: 'listCustomObjectTypes' })
  }

  /**
   * @operationName Describe Custom Object
   * @category Custom Objects
   * @description Returns the schema of a custom object type - its fields, ID field, and dedupe fields. Use it to discover the exact field names to put in Sync/Query Custom Object. The Custom Object field is a dropdown backed by a dictionary.
   * @route POST /describe-custom-object
   * @paramDef {"type":"String","label":"Custom Object","name":"apiName","required":true,"dictionary":"getCustomObjectsDictionary","description":"The custom object type to describe (returns its fields, idField, and dedupe fields)."}
   * @returns {Object}
   * @sampleResult {"requestId":"185d6#14b51985ff0","success":true,"result":[{"name":"Car","displayName":"Car","idField":"marketoGUID","dedupeFields":["vin"],"fields":[{"name":"vin","displayName":"VIN","dataType":"string","length":36,"updateable":false},{"name":"make","displayName":"Make","dataType":"string","length":36,"updateable":true}]}]}
   */
  async describeCustomObject(apiName) {
    if (!apiName) throw new Error('Custom Object is required.')

    return await this.#apiRequest({
      path: `/customobjects/${ encodeURIComponent(apiName) }/describe.json`,
      logTag: 'describeCustomObject',
    })
  }

  /**
   * @operationName Query Custom Objects
   * @category Custom Objects
   * @description Searches records of a custom object type by a filter field and values. Use Describe Custom Object to learn the filterable field names. Returns up to 300 per page with a Next Page Token for paging.
   * @route POST /query-custom-objects
   * @paramDef {"type":"String","label":"Custom Object","name":"apiName","required":true,"dictionary":"getCustomObjectsDictionary","description":"The custom object type to query."}
   * @paramDef {"type":"String","label":"Filter Field","name":"filterType","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The field to filter records on (e.g. idField, or a dedupe/searchable field API name from Describe Custom Object)."}
   * @paramDef {"type":"Array<String>","label":"Filter Values","name":"filterValues","required":true,"description":"Values to match on the chosen filter field. Up to 300. Accepts a list or comma-separated string."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Optional list of field API names to return. Leave empty for the default set."}
   * @paramDef {"type":"Number","label":"Batch Size","name":"batchSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page (max 300). Defaults to 300."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination token from a previous response. Leave blank for the first page."}
   * @returns {Object}
   * @sampleResult {"requestId":"e42b#14272d07d78","success":true,"result":[{"seq":0,"marketoGUID":"dff23271-f996-47d7-984f-f2676861b5fa","vin":"19UYA31581L000000","createdAt":"2015-02-23T18:21:53Z","updatedAt":"2015-02-23T18:23:41Z"}],"nextPageToken":null}
   */
  async queryCustomObjects(apiName, filterType, filterValues, fields, batchSize, nextPageToken) {
    if (!apiName) throw new Error('Custom Object is required.')
    if (!filterType) throw new Error('Filter Field is required.')

    const values = this.#toList(filterValues)

    if (!values.length) throw new Error('Filter Values is required — provide at least one value.')

    const query = { filterType: this.#resolveChoice(filterType, FILTER_FIELD_MAP), filterValues: values.join(',') }
    const fieldList = this.#toList(fields)

    if (fieldList.length) query.fields = fieldList.join(',')
    if (batchSize) query.batchSize = batchSize
    if (nextPageToken) query.nextPageToken = nextPageToken

    return await this.#apiRequest({
      path: `/customobjects/${ encodeURIComponent(apiName) }.json`,
      query,
      logTag: 'queryCustomObjects',
    })
  }

  /**
   * @operationName Sync Custom Objects
   * @category Custom Objects
   * @description Creates or updates custom object records in bulk (up to 300). Each record is a free-form object of the object type's field API names (discover them via Describe Custom Object). Choose Create or Update to upsert on the dedupe fields.
   * @route POST /sync-custom-objects
   * @paramDef {"type":"String","label":"Custom Object","name":"apiName","required":true,"dictionary":"getCustomObjectsDictionary","description":"The custom object type to create or update records for."}
   * @paramDef {"type":"Array<Object>","label":"Records","name":"records","required":true,"description":"Array of custom object records. Each object holds the object's field API names as keys (discover them via Describe Custom Object). Up to 300. Field keys are instance-defined per object type."}
   * @paramDef {"type":"String","label":"Action","name":"action","uiComponent":{"type":"DROPDOWN","options":{"values":["Create or Update","Create Only","Update Only"]}},"description":"How to handle each record. Create or Update (default) upserts; Create Only inserts; Update Only updates existing."}
   * @paramDef {"type":"String","label":"Dedupe By","name":"dedupeBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Dedupe Fields","ID Field"]}},"description":"How records are matched. Dedupe Fields uses the object's dedupe field(s); ID Field matches on the Marketo GUID (only valid with Update Only)."}
   * @returns {Object}
   * @sampleResult {"requestId":"e42b#14272d07d78","success":true,"result":[{"seq":0,"status":"updated","marketoGUID":"dff23271-f996-47d7-984f-f2676861b5fb"},{"seq":1,"status":"created","marketoGUID":"cff23271-f996-47d7-984f-f2676861b5fb"}]}
   */
  async syncCustomObjects(apiName, records, action, dedupeBy) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/custom-objects
    if (!apiName) throw new Error('Custom Object is required.')

    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Records is required — provide an array of custom object records.')
    }

    const body = { action: this.#resolveChoice(action, ACTION_MAP) || 'createOrUpdate', input: records }

    if (dedupeBy) body.dedupeBy = this.#resolveChoice(dedupeBy, DEDUPE_MAP)

    return await this.#apiRequest({
      path: `/customobjects/${ encodeURIComponent(apiName) }.json`,
      method: 'post',
      body,
      logTag: 'syncCustomObjects',
    })
  }

  /**
   * @operationName Delete Custom Objects
   * @category Custom Objects
   * @description Deletes custom object records in bulk (up to 300). Each record identifies a row by its dedupe field(s) or marketoGUID per the Delete By setting. Skipped rows return a per-row reason.
   * @route POST /delete-custom-objects
   * @paramDef {"type":"String","label":"Custom Object","name":"apiName","required":true,"dictionary":"getCustomObjectsDictionary","description":"The custom object type to delete records from."}
   * @paramDef {"type":"Array<Object>","label":"Records","name":"records","required":true,"description":"Array of objects identifying the records to delete — each holds the dedupe field(s) or marketoGUID per the Delete By setting. Up to 300. Key set is instance-defined per object type."}
   * @paramDef {"type":"String","label":"Delete By","name":"deleteBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Dedupe Fields","ID Field"]}},"description":"How records are matched for deletion. Dedupe Fields uses the object's dedupe field(s); ID Field matches on the Marketo GUID."}
   * @returns {Object}
   * @sampleResult {"requestId":"e42b#14272d07d78","success":true,"result":[{"seq":0,"marketoGUID":"dff23271-f996-47d7-984f-f2676861b5fb","status":"deleted"},{"seq":1,"status":"skipped","reasons":[{"code":"1013","message":"Object not found"}]}]}
   */
  async deleteCustomObjects(apiName, records, deleteBy) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/custom-objects
    if (!apiName) throw new Error('Custom Object is required.')

    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Records is required — provide an array of records to delete.')
    }

    const body = { input: records }

    if (deleteBy) body.deleteBy = this.#resolveChoice(deleteBy, DEDUPE_MAP)

    return await this.#apiRequest({
      path: `/customobjects/${ encodeURIComponent(apiName) }/delete.json`,
      method: 'post',
      body,
      logTag: 'deleteCustomObjects',
    })
  }

  // ==========================================================================
  //  ACTIONS - ASSET API - PROGRAMS  (base /rest/asset/v1; writes are form-encoded)
  // ==========================================================================
  /**
   * @operationName Browse Programs
   * @category Assets
   * @description Returns programs from the instance with offset paging. Use it to find a program before reading, cloning, or approving it.
   * @route POST /browse-programs
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["On","Off","Unlocked"]}},"description":"Optional status filter for Engagement/Email programs."}
   * @paramDef {"type":"Number","label":"Max Return","name":"maxReturn","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max programs to return (max 200). Defaults to 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip for paging. Defaults to 0."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#1","success":true,"result":[{"id":1107,"name":"Program Name","description":"Description","type":"Default","channel":"Online Advertising","folder":{"type":"Folder","value":1910,"folderName":"FolderName"},"status":"","workspace":"Default","url":"https://app.marketo.com/#PG1107A1","createdAt":"2015-05-21T22:45:13Z","updatedAt":"2015-05-21T22:45:13Z"}]}
   */
  async browsePrograms(status, maxReturn, offset) {
    const query = {}

    if (status) query.status = this.#resolveChoice(status, PROGRAM_STATUS_MAP)
    if (maxReturn) query.maxReturn = maxReturn
    if (offset) query.offset = offset

    return await this.#apiRequest({ path: '/programs.json', prefix: ASSET_PREFIX, query, logTag: 'browsePrograms' })
  }

  /**
   * @operationName Get Program by ID
   * @category Assets
   * @description Retrieves a single program by ID. The Program field is a dropdown backed by a dictionary.
   * @route POST /get-program-by-id
   * @paramDef {"type":"String","label":"Program","name":"programId","required":true,"dictionary":"getProgramsDictionary","description":"The program to retrieve."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#2","success":true,"result":[{"id":1107,"name":"Program Name","type":"Default","channel":"Online Advertising","folder":{"type":"Folder","value":1910},"status":"","workspace":"Default"}]}
   */
  async getProgramById(programId) {
    if (!programId) throw new Error('Program is required.')

    return await this.#apiRequest({
      path: `/program/${ encodeURIComponent(programId) }.json`,
      prefix: ASSET_PREFIX,
      logTag: 'getProgramById',
    })
  }

  /**
   * @operationName Create Program
   * @category Assets
   * @description Creates a new program in the chosen folder. The name must be unique within the folder.
   * @route POST /create-program
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Program name (must be unique within the folder)."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"Parent folder for the program (sent as folder={\"id\":<id>,\"type\":\"Folder\"})."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Default","Event","Event with Webinar","Engagement","Email"]}},"description":"The program type."}
   * @paramDef {"type":"String","label":"Channel","name":"channel","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The program channel (e.g. Email Blast). Channels are instance-defined under Admin > Tags."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional program description."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#3","success":true,"result":[{"id":1108,"name":"API Test Program","type":"Default","channel":"Email Blast","folder":{"type":"Folder","value":1035}}]}
   */
  async createProgram(name, folderId, type, channel, description) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/programs
    if (!name) throw new Error('Name is required.')
    if (!folderId) throw new Error('Folder is required.')
    if (!type) throw new Error('Type is required.')
    if (!channel) throw new Error('Channel is required.')

    const body = { name, folder: this.#folderRef(folderId), type, channel }

    if (description) body.description = description

    return await this.#apiRequest({ path: '/programs.json', method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'createProgram' })
  }

  /**
   * @operationName Update Program
   * @category Assets
   * @description Updates a program's name and/or description.
   * @route POST /update-program
   * @paramDef {"type":"String","label":"Program","name":"programId","required":true,"dictionary":"getProgramsDictionary","description":"The program to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New program name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#4","success":true,"result":[{"id":1108,"name":"Updated Program Name","description":"This is an updated description"}]}
   */
  async updateProgram(programId, name, description) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/programs
    if (!programId) throw new Error('Program is required.')

    const body = {}

    if (name) body.name = name
    if (description) body.description = description

    return await this.#apiRequest({
      path: `/program/${ encodeURIComponent(programId) }.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'updateProgram',
    })
  }

  /**
   * @operationName Clone Program
   * @category Assets
   * @description Clones a program into a destination folder under a new globally-unique name. Programs with Push/In-App/Reports/Social assets cannot be cloned.
   * @route POST /clone-program
   * @paramDef {"type":"String","label":"Program","name":"programId","required":true,"dictionary":"getProgramsDictionary","description":"The program to clone."}
   * @paramDef {"type":"String","label":"New Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Name for the clone (globally unique, max 255). Programs with Push/In-App/Reports/Social assets cannot be cloned."}
   * @paramDef {"type":"String","label":"Destination Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"Folder to place the clone in (sent as folder={\"id\":<id>,\"type\":\"Folder\"})."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description for the clone."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#5","success":true,"result":[{"id":1109,"name":"API Test Program Copy","type":"Default"}]}
   */
  async cloneProgram(programId, name, folderId, description) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/programs
    if (!programId) throw new Error('Program is required.')
    if (!name) throw new Error('New Name is required.')
    if (!folderId) throw new Error('Destination Folder is required.')

    const body = { name, folder: this.#folderRef(folderId) }

    if (description) body.description = description

    return await this.#apiRequest({
      path: `/program/${ encodeURIComponent(programId) }/clone.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'cloneProgram',
    })
  }

  /**
   * @operationName Delete Program
   * @category Assets
   * @description Permanently deletes a program.
   * @route POST /delete-program
   * @paramDef {"type":"String","label":"Program","name":"programId","required":true,"dictionary":"getProgramsDictionary","description":"The program to permanently delete."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#6","success":true,"result":[{"id":1109}]}
   */
  async deleteProgram(programId) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/programs
    if (!programId) throw new Error('Program is required.')

    return await this.#apiRequest({
      path: `/program/${ encodeURIComponent(programId) }/delete.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'deleteProgram',
    })
  }

  /**
   * @operationName Approve Email Program
   * @category Assets
   * @description Approve an Email program for send. Requires start/end dates plus a valid approved email and smart list (set in Marketo).
   * @route POST /approve-email-program
   * @paramDef {"type":"String","label":"Program","name":"programId","required":true,"dictionary":"getProgramsDictionary","description":"The Email program to approve."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#7","success":true,"result":[{"id":1108}]}
   */
  async approveEmailProgram(programId) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/programs
    if (!programId) throw new Error('Program is required.')

    return await this.#apiRequest({
      path: `/program/${ encodeURIComponent(programId) }/approve.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'approveEmailProgram',
    })
  }

  /**
   * @operationName Unapprove Email Program
   * @category Assets
   * @description Unapprove a previously-approved Email program.
   * @route POST /unapprove-email-program
   * @paramDef {"type":"String","label":"Program","name":"programId","required":true,"dictionary":"getProgramsDictionary","description":"The Email program to unapprove."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#7","success":true,"result":[{"id":1108}]}
   */
  async unapproveEmailProgram(programId) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/programs
    if (!programId) throw new Error('Program is required.')

    return await this.#apiRequest({
      path: `/program/${ encodeURIComponent(programId) }/unapprove.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'unapproveEmailProgram',
    })
  }

  // ==========================================================================
  //  ACTIONS - ASSET API - FOLDERS
  // ==========================================================================
  /**
   * @operationName Browse Folders
   * @category Assets
   * @description Returns folders under a root folder, traversing to a chosen depth. Use it to navigate the asset tree.
   * @route POST /browse-folders
   * @paramDef {"type":"String","label":"Root Folder","name":"rootId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to browse under (sent as root={\"id\":<id>,\"type\":\"Folder\"}). Use a top-level folder/workspace id."}
   * @paramDef {"type":"Number","label":"Max Depth","name":"maxDepth","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many levels deep to traverse. Defaults to 2."}
   * @paramDef {"type":"Number","label":"Max Return","name":"maxReturn","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max folders to return (max 200). Defaults to 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip. Defaults to 0."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#8","success":true,"result":[{"id":1035,"name":"Marketing","description":"","folderType":"Folder","path":"/Marketing","isArchive":false}]}
   */
  async browseFolders(rootId, maxDepth, maxReturn, offset) {
    if (!rootId) throw new Error('Root Folder is required.')

    const query = { root: JSON.stringify(this.#folderRef(rootId)) }

    if (maxDepth) query.maxDepth = maxDepth
    if (maxReturn) query.maxReturn = maxReturn
    if (offset) query.offset = offset

    return await this.#apiRequest({ path: '/folders.json', prefix: ASSET_PREFIX, query, logTag: 'browseFolders' })
  }

  /**
   * @operationName Get Folder by ID
   * @category Assets
   * @description Retrieves a single folder by ID.
   * @route POST /get-folder-by-id
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to retrieve."}
   * @paramDef {"type":"String","label":"Folder Type","name":"folderType","uiComponent":{"type":"DROPDOWN","options":{"values":["Folder","Program"]}},"description":"Whether the id is a Folder or a Program. Defaults to Folder."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#9","success":true,"result":[{"id":1035,"name":"Marketing","folderType":"Folder","isArchive":false}]}
   */
  async getFolderById(folderId, folderType) {
    if (!folderId) throw new Error('Folder is required.')

    return await this.#apiRequest({
      path: `/folder/${ encodeURIComponent(folderId) }.json`,
      prefix: ASSET_PREFIX, query: { type: folderType || 'Folder' }, logTag: 'getFolderById',
    })
  }

  /**
   * @operationName Create Folder
   * @category Assets
   * @description Creates a new folder under a parent folder.
   * @route POST /create-folder
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New folder name."}
   * @paramDef {"type":"String","label":"Parent Folder","name":"parentId","required":true,"dictionary":"getFoldersDictionary","description":"Parent folder (sent as parent={\"id\":<id>,\"type\":\"Folder\"})."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description (max 2000 chars)."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#10","success":true,"result":[{"id":1240,"name":"New Folder","folderType":"Folder"}]}
   */
  async createFolder(name, parentId, description) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/folders
    if (!name) throw new Error('Name is required.')
    if (!parentId) throw new Error('Parent Folder is required.')

    const body = { name, parent: this.#folderRef(parentId) }

    if (description) body.description = description

    return await this.#apiRequest({ path: '/folders.json', method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'createFolder' })
  }

  /**
   * @operationName Update Folder
   * @category Assets
   * @description Updates a folder's name, description, or archive state.
   * @route POST /update-folder
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to update."}
   * @paramDef {"type":"String","label":"Folder Type","name":"folderType","uiComponent":{"type":"DROPDOWN","options":{"values":["Folder","Program"]}},"description":"Folder or Program. Defaults to Folder."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New folder name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"Boolean","label":"Archive","name":"isArchive","uiComponent":{"type":"TOGGLE"},"description":"Set on to archive the folder."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#11","success":true,"result":[{"id":1240,"name":"Renamed Folder"}]}
   */
  async updateFolder(folderId, folderType, name, description, isArchive) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/folders
    if (!folderId) throw new Error('Folder is required.')

    const body = { type: folderType || 'Folder' }

    if (name) body.name = name
    if (description) body.description = description
    if (isArchive != null && isArchive !== '') body.isArchive = isArchive

    return await this.#apiRequest({
      path: `/folder/${ encodeURIComponent(folderId) }.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'updateFolder',
    })
  }

  /**
   * @operationName Delete Folder
   * @category Assets
   * @description Deletes an (empty) folder. Programs and system folders cannot be deleted.
   * @route POST /delete-folder
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to delete (must be empty; Programs/system folders cannot be deleted)."}
   * @paramDef {"type":"String","label":"Folder Type","name":"folderType","uiComponent":{"type":"DROPDOWN","options":{"values":["Folder","Program"]}},"description":"Folder or Program. Defaults to Folder."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#12","success":true,"result":[{"id":1240}]}
   */
  async deleteFolder(folderId, folderType) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/folders
    if (!folderId) throw new Error('Folder is required.')

    return await this.#apiRequest({
      path: `/folder/${ encodeURIComponent(folderId) }/delete.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body: { type: folderType || 'Folder' }, logTag: 'deleteFolder',
    })
  }

  // ==========================================================================
  //  ACTIONS - ASSET API - MY TOKENS
  // ==========================================================================
  /**
   * @operationName Get Tokens by Folder
   * @category Assets
   * @description Lists the My-Tokens defined on a folder or program.
   * @route POST /get-tokens-by-folder
   * @paramDef {"type":"String","label":"Folder / Program","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder or program whose My-Tokens to list."}
   * @paramDef {"type":"String","label":"Folder Type","name":"folderType","uiComponent":{"type":"DROPDOWN","options":{"values":["Folder","Program"]}},"description":"Whether the id is a Folder or a Program. Defaults to Folder."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#13","success":true,"result":[{"folder":{"type":"Folder","value":1035},"tokens":[{"name":"{{my.Token}}","type":"text","value":"hello","computedUrl":""}]}]}
   */
  async getTokensByFolder(folderId, folderType) {
    if (!folderId) throw new Error('Folder / Program is required.')

    return await this.#apiRequest({
      path: `/folder/${ encodeURIComponent(folderId) }/tokens.json`,
      prefix: ASSET_PREFIX, query: { folderType: folderType || 'Folder' }, logTag: 'getTokensByFolder',
    })
  }

  /**
   * @operationName Create Token
   * @category Assets
   * @description Adds a My-Token to a folder or program.
   * @route POST /create-token
   * @paramDef {"type":"String","label":"Folder / Program","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder or program to add the My-Token to."}
   * @paramDef {"type":"String","label":"Folder Type","name":"folderType","uiComponent":{"type":"DROPDOWN","options":{"values":["Folder","Program"]}},"description":"Folder or Program. Defaults to Folder."}
   * @paramDef {"type":"String","label":"Token Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"My-Token name including braces, e.g. {{my.WebinarTitle}} (max 50 chars)."}
   * @paramDef {"type":"String","label":"Token Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Number","Date","Rich Text","Score","SFDC Campaign"]}},"description":"The token data type."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The token value (for Date use yyyy-MM-dd; for Rich Text use an HTML string)."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#14","success":true,"result":[{"folder":{"type":"Folder","value":1035},"tokens":[{"name":"{{my.WebinarTitle}}","type":"text","value":"Scaling in 2025","computedUrl":""}]}]}
   */
  async createToken(folderId, folderType, name, type, value) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/tokens
    if (!folderId) throw new Error('Folder / Program is required.')
    if (!name) throw new Error('Token Name is required.')
    if (!type) throw new Error('Token Type is required.')
    if (value == null || value === '') throw new Error('Value is required.')

    return await this.#apiRequest({
      path: `/folder/${ encodeURIComponent(folderId) }/tokens.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true,
      body: { name, type: this.#resolveChoice(type, TOKEN_TYPE_MAP), value, folderType: folderType || 'Folder' }, logTag: 'createToken',
    })
  }

  /**
   * @operationName Delete Token
   * @category Assets
   * @description Deletes a My-Token from a folder or program.
   * @route POST /delete-token
   * @paramDef {"type":"String","label":"Folder / Program","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder or program to remove the My-Token from."}
   * @paramDef {"type":"String","label":"Folder Type","name":"folderType","uiComponent":{"type":"DROPDOWN","options":{"values":["Folder","Program"]}},"description":"Folder or Program. Defaults to Folder."}
   * @paramDef {"type":"String","label":"Token Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The My-Token name to delete (including braces)."}
   * @paramDef {"type":"String","label":"Token Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Number","Date","Rich Text","Score","SFDC Campaign"]}},"description":"The token's data type (must match the existing token)."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#15","success":true,"result":[{"id":42}]}
   */
  async deleteToken(folderId, folderType, name, type) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/tokens
    if (!folderId) throw new Error('Folder / Program is required.')
    if (!name) throw new Error('Token Name is required.')
    if (!type) throw new Error('Token Type is required.')

    return await this.#apiRequest({
      path: `/folder/${ encodeURIComponent(folderId) }/tokens/delete.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true,
      body: { name, type: this.#resolveChoice(type, TOKEN_TYPE_MAP), folderType: folderType || 'Folder' }, logTag: 'deleteToken',
    })
  }

  // ==========================================================================
  //  ACTIONS - ASSET API - EMAILS
  // ==========================================================================
  /**
   * @operationName Browse Emails
   * @category Assets
   * @description Returns email assets with offset paging, optionally filtered by status or folder.
   * @route POST /browse-emails
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Approved","Draft"]}},"description":"Filter by approval status."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getFoldersDictionary","description":"Optional folder to scope to (sent as folder={\"id\":<id>,\"type\":\"Folder\"})."}
   * @paramDef {"type":"Number","label":"Max Return","name":"maxReturn","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max emails to return (max 200). Defaults to 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip. Defaults to 0."}
   * @returns {Object}
   * @sampleResult {"requestId":"17576#14e22eb29cb","success":true,"result":[{"id":2137,"name":"Social Sharing in Email","status":"approved","template":null}]}
   */
  async browseEmails(status, folderId, maxReturn, offset) {
    const query = {}

    if (status) query.status = status
    if (folderId) query.folder = JSON.stringify(this.#folderRef(folderId))
    if (maxReturn) query.maxReturn = maxReturn
    if (offset) query.offset = offset

    return await this.#apiRequest({ path: '/emails.json', prefix: ASSET_PREFIX, query, logTag: 'browseEmails' })
  }

  /**
   * @operationName Get Email by ID
   * @category Assets
   * @description Retrieves a single email asset by ID.
   * @route POST /get-email-by-id
   * @paramDef {"type":"String","label":"Email","name":"emailId","required":true,"dictionary":"getEmailsDictionary","description":"The email asset to retrieve."}
   * @paramDef {"type":"String","label":"Version","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Approved"]}},"description":"Which version to read."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#16","success":true,"result":[{"id":1356,"name":"sakZxhxkwV","subject":{"type":"Text","value":"sample subject"},"status":false,"template":338}]}
   */
  async getEmailById(emailId, status) {
    if (!emailId) throw new Error('Email is required.')

    const query = {}

    if (status) query.status = this.#resolveChoice(status, VERSION_MAP)

    return await this.#apiRequest({
      path: `/email/${ encodeURIComponent(emailId) }.json`,
      prefix: ASSET_PREFIX, query, logTag: 'getEmailById',
    })
  }

  /**
   * @operationName Get Email Content
   * @category Assets
   * @description Retrieves the content sections of an email asset.
   * @route POST /get-email-content
   * @paramDef {"type":"String","label":"Email","name":"emailId","required":true,"dictionary":"getEmailsDictionary","description":"The email asset whose content to retrieve."}
   * @paramDef {"type":"String","label":"Version","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Approved"]}},"description":"Draft or approved content."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#17","success":true,"result":[{"htmlId":"edit_text_3","contentType":"Text","value":[{"type":"HTML","value":"Content text"}]}]}
   */
  async getEmailContent(emailId, status) {
    if (!emailId) throw new Error('Email is required.')

    const query = {}

    if (status) query.status = this.#resolveChoice(status, VERSION_MAP)

    return await this.#apiRequest({
      path: `/email/${ encodeURIComponent(emailId) }/content.json`,
      prefix: ASSET_PREFIX, query, logTag: 'getEmailContent',
    })
  }

  /**
   * @operationName Create Email
   * @category Assets
   * @description Creates a new email asset from an email template in the chosen folder.
   * @route POST /create-email
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email asset name."}
   * @paramDef {"type":"String","label":"Email Template ID","name":"template","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The email template ID to base the email on. (Template assets are out of scope; supply the numeric template id.)"}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"Parent folder (sent as folder={\"id\":<id>,\"type\":\"Folder\"})."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email subject line."}
   * @paramDef {"type":"String","label":"From Name","name":"fromName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Sender display name."}
   * @paramDef {"type":"String","label":"From Email","name":"fromEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Sender email address."}
   * @paramDef {"type":"String","label":"Reply-To Email","name":"replyEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Reply-to address."}
   * @paramDef {"type":"Boolean","label":"Operational","name":"operational","uiComponent":{"type":"TOGGLE"},"description":"Mark as operational (bypasses unsubscribe). Use only for transactional mail."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#18","success":true,"result":[{"id":2212,"name":"My New Email 02 - deverly","status":"draft","template":24}]}
   */
  async createEmail(name, template, folderId, subject, fromName, fromEmail, replyEmail, operational, description) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/emails
    if (!name) throw new Error('Name is required.')
    if (!template) throw new Error('Email Template ID is required.')
    if (!folderId) throw new Error('Folder is required.')

    const body = { name, template, folder: this.#folderRef(folderId) }

    if (subject) body.subject = subject
    if (fromName) body.fromName = fromName
    if (fromEmail) body.fromEmail = fromEmail
    if (replyEmail) body.replyEmail = replyEmail
    if (operational != null && operational !== '') body.operational = operational
    if (description) body.description = description

    return await this.#apiRequest({ path: '/emails.json', method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'createEmail' })
  }

  /**
   * @operationName Update Email
   * @category Assets
   * @description Updates an email asset's name and/or description.
   * @route POST /update-email
   * @paramDef {"type":"String","label":"Email","name":"emailId","required":true,"dictionary":"getEmailsDictionary","description":"The email asset to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#19","success":true,"result":[{"id":2212,"name":"Renamed Email"}]}
   */
  async updateEmail(emailId, name, description) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/emails
    if (!emailId) throw new Error('Email is required.')

    const body = {}

    if (name) body.name = name
    if (description) body.description = description

    return await this.#apiRequest({
      path: `/email/${ encodeURIComponent(emailId) }.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'updateEmail',
    })
  }

  /**
   * @operationName Clone Email
   * @category Assets
   * @description Clones an email asset into a destination folder under a new name.
   * @route POST /clone-email
   * @paramDef {"type":"String","label":"Email","name":"emailId","required":true,"dictionary":"getEmailsDictionary","description":"The email asset to clone."}
   * @paramDef {"type":"String","label":"New Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Name for the clone."}
   * @paramDef {"type":"String","label":"Destination Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"Folder for the clone (sent as folder={\"id\":<id>,\"type\":\"Folder\"})."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#20","success":true,"result":[{"id":2213,"name":"My New Email Copy","status":"draft","template":24}]}
   */
  async cloneEmail(emailId, name, folderId, description) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/emails
    if (!emailId) throw new Error('Email is required.')
    if (!name) throw new Error('New Name is required.')
    if (!folderId) throw new Error('Destination Folder is required.')

    const body = { name, folder: this.#folderRef(folderId) }

    if (description) body.description = description

    return await this.#apiRequest({
      path: `/email/${ encodeURIComponent(emailId) }/clone.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'cloneEmail',
    })
  }

  /**
   * @operationName Delete Email
   * @category Assets
   * @description Permanently deletes an email asset.
   * @route POST /delete-email
   * @paramDef {"type":"String","label":"Email","name":"emailId","required":true,"dictionary":"getEmailsDictionary","description":"The email asset to delete."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#21","success":true,"result":[{"id":1361}]}
   */
  async deleteEmail(emailId) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/emails
    if (!emailId) throw new Error('Email is required.')

    return await this.#apiRequest({
      path: `/email/${ encodeURIComponent(emailId) }/delete.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'deleteEmail',
    })
  }

  /**
   * @operationName Approve Email
   * @category Assets
   * @description Approve the email draft for send. Requires from-name, from-email, reply-to, and subject to be set.
   * @route POST /approve-email
   * @paramDef {"type":"String","label":"Email","name":"emailId","required":true,"dictionary":"getEmailsDictionary","description":"The email asset to approve."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#22","success":true,"result":[{"id":1362}]}
   */
  async approveEmail(emailId) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/emails
    if (!emailId) throw new Error('Email is required.')

    return await this.#apiRequest({
      path: `/email/${ encodeURIComponent(emailId) }/approveDraft.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'approveEmail',
    })
  }

  /**
   * @operationName Unapprove Email
   * @category Assets
   * @description Unapprove a previously-approved email asset.
   * @route POST /unapprove-email
   * @paramDef {"type":"String","label":"Email","name":"emailId","required":true,"dictionary":"getEmailsDictionary","description":"The email asset to unapprove."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#22","success":true,"result":[{"id":1364}]}
   */
  async unapproveEmail(emailId) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/emails
    if (!emailId) throw new Error('Email is required.')

    return await this.#apiRequest({
      path: `/email/${ encodeURIComponent(emailId) }/unapprove.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'unapproveEmail',
    })
  }

  /**
   * @operationName Send Sample Email
   * @category Assets
   * @description Sends a sample of an email asset to a recipient, optionally rendered as a specific lead.
   * @route POST /send-sample-email
   * @paramDef {"type":"String","label":"Email","name":"emailId","required":true,"dictionary":"getEmailsDictionary","description":"The email asset to send a sample of."}
   * @paramDef {"type":"String","label":"Recipient","name":"emailAddress","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Address to send the sample to."}
   * @paramDef {"type":"String","label":"Render As Lead","name":"renderAsLead","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional lead id to render the sample with that lead's token/personalization values."}
   * @paramDef {"type":"Boolean","label":"Text Only","name":"textOnly","uiComponent":{"type":"TOGGLE"},"description":"Send the text-only version."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#23","success":true,"result":[{"id":2179}]}
   */
  async sendSampleEmail(emailId, emailAddress, renderAsLead, textOnly) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/emails
    if (!emailId) throw new Error('Email is required.')
    if (!emailAddress) throw new Error('Recipient is required.')

    const body = { emailAddress }

    if (renderAsLead) body.leadId = renderAsLead
    if (textOnly != null && textOnly !== '') body.textOnly = textOnly

    return await this.#apiRequest({
      path: `/email/${ encodeURIComponent(emailId) }/sendSample.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'sendSampleEmail',
    })
  }

  // ==========================================================================
  //  ACTIONS - ASSET API - FORMS
  // ==========================================================================
  /**
   * @operationName Browse Forms
   * @category Assets
   * @description Returns form assets with offset paging, optionally filtered by status.
   * @route POST /browse-forms
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Approved","Draft"]}},"description":"Filter by approval status."}
   * @paramDef {"type":"Number","label":"Max Return","name":"maxReturn","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max forms to return (max 200). Defaults to 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip. Defaults to 0."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#24","success":true,"result":[{"id":1029,"name":"Contact Us","description":"","status":"approved","language":"English","locale":"en_US","theme":"simple"}]}
   */
  async browseForms(status, maxReturn, offset) {
    const query = {}

    if (status) query.status = status
    if (maxReturn) query.maxReturn = maxReturn
    if (offset) query.offset = offset

    return await this.#apiRequest({ path: '/forms.json', prefix: ASSET_PREFIX, query, logTag: 'browseForms' })
  }

  /**
   * @operationName Get Form by ID
   * @category Assets
   * @description Retrieves a single form asset by ID.
   * @route POST /get-form-by-id
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form to retrieve."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#25","success":true,"result":[{"id":1029,"name":"Contact Us","status":"approved","theme":"simple"}]}
   */
  async getFormById(formId) {
    if (!formId) throw new Error('Form is required.')

    return await this.#apiRequest({
      path: `/form/${ encodeURIComponent(formId) }.json`,
      prefix: ASSET_PREFIX, logTag: 'getFormById',
    })
  }

  /**
   * @operationName Get Form Fields
   * @category Assets
   * @description Lists the fields on a form asset.
   * @route POST /get-form-fields
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form whose fields to list."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#26","success":true,"result":[{"id":"Email","label":"Email Address","dataType":"email","required":true}]}
   */
  async getFormFields(formId) {
    if (!formId) throw new Error('Form is required.')

    return await this.#apiRequest({
      path: `/form/${ encodeURIComponent(formId) }/fields.json`,
      prefix: ASSET_PREFIX, logTag: 'getFormFields',
    })
  }

  /**
   * @operationName Create Form
   * @category Assets
   * @description Creates a new form asset in the chosen folder.
   * @route POST /create-form
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Form name."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"Parent folder (sent as folder={\"id\":<id>,\"type\":\"Folder\"})."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description."}
   * @paramDef {"type":"String","label":"Language","name":"language","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Form language (e.g. English)."}
   * @paramDef {"type":"String","label":"Theme","name":"theme","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Form theme name."}
   * @paramDef {"type":"Boolean","label":"Progressive Profiling","name":"progressiveProfiling","uiComponent":{"type":"TOGGLE"},"description":"Enable progressive profiling."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#27","success":true,"result":[{"id":1099,"name":"Newsletter Signup","status":"draft"}]}
   */
  async createForm(name, folderId, description, language, theme, progressiveProfiling) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/forms
    if (!name) throw new Error('Name is required.')
    if (!folderId) throw new Error('Folder is required.')

    const body = { name, folder: this.#folderRef(folderId) }

    if (description) body.description = description
    if (language) body.language = language
    if (theme) body.theme = theme
    if (progressiveProfiling != null && progressiveProfiling !== '') body.progressiveProfiling = progressiveProfiling

    return await this.#apiRequest({ path: '/forms.json', method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'createForm' })
  }

  /**
   * @operationName Update Form
   * @category Assets
   * @description Updates a form asset's metadata.
   * @route POST /update-form
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"Boolean","label":"Progressive Profiling","name":"progressiveProfiling","uiComponent":{"type":"TOGGLE"},"description":"Toggle progressive profiling."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#28","success":true,"result":[{"id":1099,"name":"Renamed Form"}]}
   */
  async updateForm(formId, name, description, progressiveProfiling) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/forms
    if (!formId) throw new Error('Form is required.')

    const body = {}

    if (name) body.name = name
    if (description) body.description = description
    if (progressiveProfiling != null && progressiveProfiling !== '') body.progressiveProfiling = progressiveProfiling

    return await this.#apiRequest({
      path: `/form/${ encodeURIComponent(formId) }.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'updateForm',
    })
  }

  /**
   * @operationName Clone Form
   * @category Assets
   * @description Clones a form asset into a destination folder under a new name.
   * @route POST /clone-form
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form to clone."}
   * @paramDef {"type":"String","label":"New Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Name for the clone."}
   * @paramDef {"type":"String","label":"Destination Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"Folder for the clone (sent as folder={\"id\":<id>,\"type\":\"Folder\"})."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#29","success":true,"result":[{"id":1100,"name":"Newsletter Signup Copy","status":"draft"}]}
   */
  async cloneForm(formId, name, folderId, description) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/forms
    if (!formId) throw new Error('Form is required.')
    if (!name) throw new Error('New Name is required.')
    if (!folderId) throw new Error('Destination Folder is required.')

    const body = { name, folder: this.#folderRef(folderId) }

    if (description) body.description = description

    return await this.#apiRequest({
      path: `/form/${ encodeURIComponent(formId) }/clone.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'cloneForm',
    })
  }

  /**
   * @operationName Approve Form
   * @category Assets
   * @description Approves a form asset.
   * @route POST /approve-form
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form to approve."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#30","success":true,"result":[{"id":1029}]}
   */
  async approveForm(formId) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/forms
    if (!formId) throw new Error('Form is required.')

    return await this.#apiRequest({
      path: `/form/${ encodeURIComponent(formId) }/approve.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'approveForm',
    })
  }

  /**
   * @operationName Unapprove Form
   * @category Assets
   * @description Unapproves a form asset.
   * @route POST /unapprove-form
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form to unapprove."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#30","success":true,"result":[{"id":1029}]}
   */
  async unapproveForm(formId) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/forms
    if (!formId) throw new Error('Form is required.')

    return await this.#apiRequest({
      path: `/form/${ encodeURIComponent(formId) }/unapprove.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'unapproveForm',
    })
  }

  /**
   * @operationName Delete Form
   * @category Assets
   * @description Deletes a form asset. The form must be unapproved first.
   * @route POST /delete-form
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form to delete. Must be unapproved first."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#31","success":true,"result":[{"id":1100}]}
   */
  async deleteForm(formId) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/forms
    if (!formId) throw new Error('Form is required.')

    return await this.#apiRequest({
      path: `/form/${ encodeURIComponent(formId) }/delete.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'deleteForm',
    })
  }

  // ==========================================================================
  //  ACTIONS - ASSET API - LANDING PAGES
  // ==========================================================================
  /**
   * @operationName Browse Landing Pages
   * @category Assets
   * @description Returns landing page assets with offset paging, optionally filtered by status or folder.
   * @route POST /browse-landing-pages
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Approved","Draft"]}},"description":"Filter by approval status."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getFoldersDictionary","description":"Optional folder to scope to (sent as folder={\"id\":<id>,\"type\":\"Folder\"})."}
   * @paramDef {"type":"Number","label":"Max Return","name":"maxReturn","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max pages (max 200). Defaults to 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip. Defaults to 0."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#32","success":true,"result":[{"id":1055,"name":"Webinar LP","status":"approved","url":"https://app.marketo.com/...","template":42}]}
   */
  async browseLandingPages(status, folderId, maxReturn, offset) {
    const query = {}

    if (status) query.status = status
    if (folderId) query.folder = JSON.stringify(this.#folderRef(folderId))
    if (maxReturn) query.maxReturn = maxReturn
    if (offset) query.offset = offset

    return await this.#apiRequest({ path: '/landingPages.json', prefix: ASSET_PREFIX, query, logTag: 'browseLandingPages' })
  }

  /**
   * @operationName Get Landing Page by ID
   * @category Assets
   * @description Retrieves a single landing page asset by ID.
   * @route POST /get-landing-page-by-id
   * @paramDef {"type":"String","label":"Landing Page","name":"landingPageId","required":true,"dictionary":"getLandingPagesDictionary","description":"The landing page to retrieve."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#33","success":true,"result":[{"id":1055,"name":"Webinar LP","status":"approved","template":42}]}
   */
  async getLandingPageById(landingPageId) {
    if (!landingPageId) throw new Error('Landing Page is required.')

    return await this.#apiRequest({
      path: `/landingPage/${ encodeURIComponent(landingPageId) }.json`,
      prefix: ASSET_PREFIX, logTag: 'getLandingPageById',
    })
  }

  /**
   * @operationName Get Landing Page Content
   * @category Assets
   * @description Retrieves the content sections of a landing page asset.
   * @route POST /get-landing-page-content
   * @paramDef {"type":"String","label":"Landing Page","name":"landingPageId","required":true,"dictionary":"getLandingPagesDictionary","description":"The landing page whose content to retrieve."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#34","success":true,"result":[{"id":"section1","type":"RichText","content":"<p>Hello</p>","index":0}]}
   */
  async getLandingPageContent(landingPageId) {
    if (!landingPageId) throw new Error('Landing Page is required.')

    return await this.#apiRequest({
      path: `/landingPage/${ encodeURIComponent(landingPageId) }/content.json`,
      prefix: ASSET_PREFIX, logTag: 'getLandingPageContent',
    })
  }

  /**
   * @operationName Create Landing Page
   * @category Assets
   * @description Creates a new landing page asset from an LP template in the chosen folder.
   * @route POST /create-landing-page
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Landing page name."}
   * @paramDef {"type":"String","label":"Landing Page Template ID","name":"template","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The LP template id to base the page on. (Template assets are out of scope; supply the numeric template id.)"}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"Parent folder (sent as folder={\"id\":<id>,\"type\":\"Folder\"})."}
   * @paramDef {"type":"String","label":"Page Title","name":"title","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"HTML page title."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description."}
   * @paramDef {"type":"Boolean","label":"Mobile Enabled","name":"mobileEnabled","uiComponent":{"type":"TOGGLE"},"description":"Enable the mobile-optimized view."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#35","success":true,"result":[{"id":1056,"name":"New LP","status":"draft","template":42,"url":"https://app.marketo.com/..."}]}
   */
  async createLandingPage(name, template, folderId, title, description, mobileEnabled) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/landing-pages
    if (!name) throw new Error('Name is required.')
    if (!template) throw new Error('Landing Page Template ID is required.')
    if (!folderId) throw new Error('Folder is required.')

    const body = { name, template, folder: this.#folderRef(folderId) }

    if (title) body.title = title
    if (description) body.description = description
    if (mobileEnabled != null && mobileEnabled !== '') body.mobileEnabled = mobileEnabled

    return await this.#apiRequest({ path: '/landingPages.json', method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'createLandingPage' })
  }

  /**
   * @operationName Update Landing Page
   * @category Assets
   * @description Updates a landing page asset's metadata.
   * @route POST /update-landing-page
   * @paramDef {"type":"String","label":"Landing Page","name":"landingPageId","required":true,"dictionary":"getLandingPagesDictionary","description":"The page to update."}
   * @paramDef {"type":"String","label":"Page Title","name":"title","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New HTML page title."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"Boolean","label":"Mobile Enabled","name":"mobileEnabled","uiComponent":{"type":"TOGGLE"},"description":"Toggle the mobile-optimized view."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#36","success":true,"result":[{"id":1056,"name":"New LP","title":"Updated Title"}]}
   */
  async updateLandingPage(landingPageId, title, description, mobileEnabled) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/landing-pages
    if (!landingPageId) throw new Error('Landing Page is required.')

    const body = {}

    if (title) body.title = title
    if (description) body.description = description
    if (mobileEnabled != null && mobileEnabled !== '') body.mobileEnabled = mobileEnabled

    return await this.#apiRequest({
      path: `/landingPage/${ encodeURIComponent(landingPageId) }.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'updateLandingPage',
    })
  }

  /**
   * @operationName Clone Landing Page
   * @category Assets
   * @description Clones a landing page asset into a destination folder under a new name.
   * @route POST /clone-landing-page
   * @paramDef {"type":"String","label":"Landing Page","name":"landingPageId","required":true,"dictionary":"getLandingPagesDictionary","description":"The page to clone."}
   * @paramDef {"type":"String","label":"New Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Name for the clone."}
   * @paramDef {"type":"String","label":"Destination Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"Folder for the clone (sent as folder={\"id\":<id>,\"type\":\"Folder\"})."}
   * @paramDef {"type":"String","label":"Template ID","name":"template","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The LP template id for the clone."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#37","success":true,"result":[{"id":1057,"name":"Webinar LP Copy","status":"draft"}]}
   */
  async cloneLandingPage(landingPageId, name, folderId, template, description) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/landing-pages
    if (!landingPageId) throw new Error('Landing Page is required.')
    if (!name) throw new Error('New Name is required.')
    if (!folderId) throw new Error('Destination Folder is required.')
    if (!template) throw new Error('Template ID is required.')

    const body = { name, folder: this.#folderRef(folderId), template }

    if (description) body.description = description

    return await this.#apiRequest({
      path: `/landingPage/${ encodeURIComponent(landingPageId) }/clone.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'cloneLandingPage',
    })
  }

  /**
   * @operationName Approve Landing Page
   * @category Assets
   * @description Approves a landing page asset.
   * @route POST /approve-landing-page
   * @paramDef {"type":"String","label":"Landing Page","name":"landingPageId","required":true,"dictionary":"getLandingPagesDictionary","description":"The page to approve."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#38","success":true,"result":[{"id":1055}]}
   */
  async approveLandingPage(landingPageId) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/landing-pages
    if (!landingPageId) throw new Error('Landing Page is required.')

    return await this.#apiRequest({
      path: `/landingPage/${ encodeURIComponent(landingPageId) }/approve.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'approveLandingPage',
    })
  }

  /**
   * @operationName Unapprove Landing Page
   * @category Assets
   * @description Unapproves a landing page asset.
   * @route POST /unapprove-landing-page
   * @paramDef {"type":"String","label":"Landing Page","name":"landingPageId","required":true,"dictionary":"getLandingPagesDictionary","description":"The page to unapprove."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#38","success":true,"result":[{"id":1055}]}
   */
  async unapproveLandingPage(landingPageId) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/landing-pages
    if (!landingPageId) throw new Error('Landing Page is required.')

    return await this.#apiRequest({
      path: `/landingPage/${ encodeURIComponent(landingPageId) }/unapprove.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'unapproveLandingPage',
    })
  }

  /**
   * @operationName Delete Landing Page
   * @category Assets
   * @description Deletes a landing page asset. The page must be unapproved and unreferenced.
   * @route POST /delete-landing-page
   * @paramDef {"type":"String","label":"Landing Page","name":"landingPageId","required":true,"dictionary":"getLandingPagesDictionary","description":"The page to delete. Must be unapproved and unreferenced."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#39","success":true,"result":[{"id":1057}]}
   */
  async deleteLandingPage(landingPageId) {
    // API: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/landing-pages
    // Confirm the exact delete route against a live account (docs show raw delete as POST
    // /landingPage/{id}.json; this build uses /delete.json for consistency with programs/emails/forms).
    if (!landingPageId) throw new Error('Landing Page is required.')

    return await this.#apiRequest({
      path: `/landingPage/${ encodeURIComponent(landingPageId) }/delete.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'deleteLandingPage',
    })
  }

  // ==========================================================================
  //  ACTIONS - ASSET API - SMART LISTS & SNIPPETS
  // ==========================================================================
  /**
   * @operationName Browse Smart Lists
   * @category Assets
   * @description Returns user-created smart list assets in a folder (built-in/system smart lists are not supported by this API).
   * @route POST /browse-smart-lists
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"Folder to browse smart lists in (sent as folder={\"id\":<id>,\"type\":\"Folder\"}). User-created smart lists only."}
   * @paramDef {"type":"Number","label":"Max Return","name":"maxReturn","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Max smart lists (max 200). Defaults to 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip. Defaults to 0."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#40","success":true,"result":[{"id":2055,"name":"Engaged Leads","description":"","createdAt":"2018-01-01T00:00:00Z","updatedAt":"2018-01-01T00:00:00Z"}]}
   */
  async browseSmartLists(folderId, maxReturn, offset) {
    if (!folderId) throw new Error('Folder is required.')

    const query = { folder: JSON.stringify(this.#folderRef(folderId)) }

    if (maxReturn) query.maxReturn = maxReturn
    if (offset) query.offset = offset

    return await this.#apiRequest({ path: '/smartLists.json', prefix: ASSET_PREFIX, query, logTag: 'browseSmartLists' })
  }

  /**
   * @operationName Get Smart List by ID
   * @category Assets
   * @description Retrieves a single smart list asset by ID, optionally including its rule definitions.
   * @route POST /get-smart-list-by-id
   * @paramDef {"type":"String","label":"Smart List","name":"smartListId","required":true,"dictionary":"getSmartListsDictionary","description":"The smart list asset to retrieve."}
   * @paramDef {"type":"Boolean","label":"Include Rules","name":"includeRules","uiComponent":{"type":"TOGGLE"},"description":"Include the smart list's rule definitions in the response."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#41","success":true,"result":[{"id":2055,"name":"Engaged Leads"}]}
   */
  async getSmartListById(smartListId, includeRules) {
    if (!smartListId) throw new Error('Smart List is required.')

    const query = {}

    if (includeRules != null && includeRules !== '') query.includeRules = includeRules

    return await this.#apiRequest({
      path: `/smartList/${ encodeURIComponent(smartListId) }.json`,
      prefix: ASSET_PREFIX, query, logTag: 'getSmartListById',
    })
  }

  /**
   * @operationName Clone Smart List
   * @category Assets
   * @description Clones a smart list asset into a destination folder under a new name.
   * @route POST /clone-smart-list
   * @paramDef {"type":"String","label":"Smart List","name":"smartListId","required":true,"dictionary":"getSmartListsDictionary","description":"The smart list to clone."}
   * @paramDef {"type":"String","label":"New Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Name for the clone."}
   * @paramDef {"type":"String","label":"Destination Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"Folder for the clone (sent as folder={\"id\":<id>,\"type\":\"Folder\"})."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#42","success":true,"result":[{"id":2056,"name":"Engaged Leads Copy"}]}
   */
  async cloneSmartList(smartListId, name, folderId, description) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/smart-lists
    if (!smartListId) throw new Error('Smart List is required.')
    if (!name) throw new Error('New Name is required.')
    if (!folderId) throw new Error('Destination Folder is required.')

    const body = { name, folder: this.#folderRef(folderId) }

    if (description) body.description = description

    return await this.#apiRequest({
      path: `/smartList/${ encodeURIComponent(smartListId) }/clone.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'cloneSmartList',
    })
  }

  /**
   * @operationName Delete Smart List
   * @category Assets
   * @description Deletes a user-created smart list asset.
   * @route POST /delete-smart-list
   * @paramDef {"type":"String","label":"Smart List","name":"smartListId","required":true,"dictionary":"getSmartListsDictionary","description":"The user-created smart list to delete."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#43","success":true,"result":[{"id":2056}]}
   */
  async deleteSmartList(smartListId) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/smart-lists
    if (!smartListId) throw new Error('Smart List is required.')

    return await this.#apiRequest({
      path: `/smartList/${ encodeURIComponent(smartListId) }/delete.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'deleteSmartList',
    })
  }

  /**
   * @operationName Get Snippet by ID
   * @category Assets
   * @description Retrieves a single snippet asset by ID (no browse-list endpoint; supply the id).
   * @route POST /get-snippet-by-id
   * @paramDef {"type":"String","label":"Snippet","name":"snippet","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The snippet asset id (no browse-list endpoint; supply the id)."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#44","success":true,"result":[{"id":33,"name":"Footer Snippet","status":"approved"}]}
   */
  async getSnippetById(snippet) {
    if (!snippet) throw new Error('Snippet is required.')

    return await this.#apiRequest({
      path: `/snippet/${ encodeURIComponent(snippet) }.json`,
      prefix: ASSET_PREFIX, logTag: 'getSnippetById',
    })
  }

  /**
   * @operationName Get Snippet Content
   * @category Assets
   * @description Retrieves the content of a snippet asset.
   * @route POST /get-snippet-content
   * @paramDef {"type":"String","label":"Snippet","name":"snippet","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The snippet whose content to retrieve."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#45","success":true,"result":[{"type":"HTML","content":"<p>Footer</p>","index":0}]}
   */
  async getSnippetContent(snippet) {
    if (!snippet) throw new Error('Snippet is required.')

    return await this.#apiRequest({
      path: `/snippet/${ encodeURIComponent(snippet) }/content.json`,
      prefix: ASSET_PREFIX, logTag: 'getSnippetContent',
    })
  }

  /**
   * @operationName Create Snippet
   * @category Assets
   * @description Creates a new snippet asset in the chosen folder.
   * @route POST /create-snippet
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Snippet name."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"Parent folder (sent as folder={\"id\":<id>,\"type\":\"Folder\"})."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#46","success":true,"result":[{"id":34,"name":"New Snippet","status":"draft"}]}
   */
  async createSnippet(name, folderId, description) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/endpoint-reference
    if (!name) throw new Error('Name is required.')
    if (!folderId) throw new Error('Folder is required.')

    const body = { name, folder: this.#folderRef(folderId) }

    if (description) body.description = description

    return await this.#apiRequest({ path: '/snippets.json', method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'createSnippet' })
  }

  /**
   * @operationName Update Snippet
   * @category Assets
   * @description Updates a snippet asset's metadata.
   * @route POST /update-snippet
   * @paramDef {"type":"String","label":"Snippet","name":"snippet","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The snippet to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#47","success":true,"result":[{"id":34,"name":"Renamed Snippet"}]}
   */
  async updateSnippet(snippet, name, description) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/endpoint-reference
    if (!snippet) throw new Error('Snippet is required.')

    const body = {}

    if (name) body.name = name
    if (description) body.description = description

    return await this.#apiRequest({
      path: `/snippet/${ encodeURIComponent(snippet) }.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body, logTag: 'updateSnippet',
    })
  }

  /**
   * @operationName Update Snippet Content
   * @category Assets
   * @description Sets the HTML content of a snippet asset.
   * @route POST /update-snippet-content
   * @paramDef {"type":"String","label":"Snippet","name":"snippet","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The snippet to set content on."}
   * @paramDef {"type":"String","label":"HTML Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The snippet HTML content."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#48","success":true,"result":[{"id":34}]}
   */
  async updateSnippetContent(snippet, content) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/endpoint-reference
    if (!snippet) throw new Error('Snippet is required.')
    if (content == null || content === '') throw new Error('HTML Content is required.')

    return await this.#apiRequest({
      path: `/snippet/${ encodeURIComponent(snippet) }/content.json`,
      method: 'post', prefix: ASSET_PREFIX, form: true, body: { content, type: 'HTML' }, logTag: 'updateSnippetContent',
    })
  }

  /**
   * @operationName Approve Snippet Draft
   * @category Assets
   * @description Approves the draft of a snippet asset.
   * @route POST /approve-snippet-draft
   * @paramDef {"type":"String","label":"Snippet","name":"snippet","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The snippet whose draft to approve."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#49","success":true,"result":[{"id":34}]}
   */
  async approveSnippetDraft(snippet) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/endpoint-reference
    if (!snippet) throw new Error('Snippet is required.')

    return await this.#apiRequest({
      path: `/snippet/${ encodeURIComponent(snippet) }/approveDraft.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'approveSnippetDraft',
    })
  }

  /**
   * @operationName Delete Snippet
   * @category Assets
   * @description Deletes a snippet asset.
   * @route POST /delete-snippet
   * @paramDef {"type":"String","label":"Snippet","name":"snippet","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The snippet to delete."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#50","success":true,"result":[{"id":34}]}
   */
  async deleteSnippet(snippet) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/endpoint-reference
    if (!snippet) throw new Error('Snippet is required.')

    return await this.#apiRequest({
      path: `/snippet/${ encodeURIComponent(snippet) }/delete.json`,
      method: 'post', prefix: ASSET_PREFIX, logTag: 'deleteSnippet',
    })
  }

  // ==========================================================================
  //  ACTIONS - CRM OBJECTS  (shared describe/query/sync/delete family; entitlement-gated)
  // ==========================================================================
  /**
   * @operationName Describe Opportunity
   * @category CRM Objects
   * @description Returns the Opportunity object schema - its fields, idField, and dedupe fields. Requires a CRM-sync-enabled subscription.
   * @route POST /describe-opportunity
   * @returns {Object}
   * @sampleResult {"requestId":"r#51","success":true,"result":[{"name":"opportunity","idField":"marketoGUID","dedupeFields":["externalOpportunityId"],"fields":[{"name":"name","dataType":"string"},{"name":"amount","dataType":"float"}]}]}
   */
  async describeOpportunity() {
    return await this.#crmDescribe('opportunities', 'describeOpportunity')
  }

  /**
   * @operationName Query Opportunities
   * @category CRM Objects
   * @description Searches Opportunity records by a searchable field and values. Returns up to 300 per page with a Next Page Token.
   * @route POST /query-opportunities
   * @paramDef {"type":"String","label":"Filter Field","name":"filterType","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Searchable field to filter on (e.g. marketoGUID or externalOpportunityId). Use Describe Opportunity to discover."}
   * @paramDef {"type":"Array<String>","label":"Filter Values","name":"filterValues","required":true,"description":"Values to match. Up to 300. Accepts a list or comma-separated string."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Optional field API names to return."}
   * @paramDef {"type":"Number","label":"Batch Size","name":"batchSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page (max 300). Defaults to 300."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination token from a previous response."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#52","success":true,"result":[{"seq":0,"marketoGUID":"abc-123","externalOpportunityId":"OPP-1","name":"Q1 Renewal","amount":5000}],"nextPageToken":null}
   */
  async queryOpportunities(filterType, filterValues, fields, batchSize, nextPageToken) {
    return await this.#crmQuery('opportunities', 'queryOpportunities', filterType, filterValues, fields, batchSize, nextPageToken)
  }

  /**
   * @operationName Sync Opportunities
   * @category CRM Objects
   * @description Creates or updates Opportunity records in bulk (up to 300). externalOpportunityId is required for create; name must not be null.
   * @route POST /sync-opportunities
   * @paramDef {"type":"Array<Object>","label":"Opportunities","name":"records","required":true,"description":"Opportunity records. Each holds field API names as keys; externalOpportunityId is required for create, name must not be null. Up to 300. Field keys are CRM/instance-defined — discover them via Describe Opportunity."}
   * @paramDef {"type":"String","label":"Action","name":"action","uiComponent":{"type":"DROPDOWN","options":{"values":["Create or Update","Create Only","Update Only"]}},"description":"Create or Update (default), Create Only, or Update Only."}
   * @paramDef {"type":"String","label":"Dedupe By","name":"dedupeBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Dedupe Fields","ID Field"]}},"description":"Match records on the object's dedupe field(s) or the Marketo GUID (idField only valid with Update Only)."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#53","success":true,"result":[{"seq":0,"status":"created","marketoGUID":"abc-123"}]}
   */
  async syncOpportunities(records, action, dedupeBy) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/opportunities
    return await this.#crmSync('opportunities', 'syncOpportunities', records, action, dedupeBy)
  }

  /**
   * @operationName Delete Opportunities
   * @category CRM Objects
   * @description Deletes Opportunity records in bulk (up to 300) by dedupe field(s) or marketoGUID.
   * @route POST /delete-opportunities
   * @paramDef {"type":"Array<Object>","label":"Opportunities","name":"records","required":true,"description":"Records to delete — each holds the dedupe field(s) or marketoGUID per Delete By. Up to 300. Field keys are CRM/instance-defined — irreducible."}
   * @paramDef {"type":"String","label":"Delete By","name":"deleteBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Dedupe Fields","ID Field"]}},"description":"Match on dedupe field(s) or the Marketo GUID. Defaults to Dedupe Fields."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#54","success":true,"result":[{"seq":0,"marketoGUID":"abc-123","status":"deleted"}]}
   */
  async deleteOpportunities(records, deleteBy) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/opportunities
    return await this.#crmDelete('opportunities', 'deleteOpportunities', records, deleteBy)
  }

  /**
   * @operationName Describe Opportunity Role
   * @category CRM Objects
   * @description Returns the Opportunity Role object schema. Requires a CRM-sync-enabled subscription.
   * @route POST /describe-opportunity-role
   * @returns {Object}
   * @sampleResult {"requestId":"r#55","success":true,"result":[{"name":"opportunityrole","idField":"marketoGUID","dedupeFields":["externalOpportunityId","leadId","role"],"fields":[{"name":"role","dataType":"string"}]}]}
   */
  async describeOpportunityRole() {
    return await this.#crmDescribe('opportunities/roles', 'describeOpportunityRole')
  }

  /**
   * @operationName Query Opportunity Roles
   * @category CRM Objects
   * @description Searches Opportunity Role records by a searchable field and values.
   * @route POST /query-opportunity-roles
   * @paramDef {"type":"String","label":"Filter Field","name":"filterType","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Searchable field to filter on (e.g. marketoGUID, externalOpportunityId). Use Describe Opportunity Role to discover."}
   * @paramDef {"type":"Array<String>","label":"Filter Values","name":"filterValues","required":true,"description":"Values to match. Up to 300. Accepts a list or comma-separated string."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Optional field API names to return."}
   * @paramDef {"type":"Number","label":"Batch Size","name":"batchSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page (max 300). Defaults to 300."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination token from a previous response."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#56","success":true,"result":[{"seq":0,"marketoGUID":"role-1","externalOpportunityId":"OPP-1","leadId":318581,"role":"Decision Maker","isPrimary":true}],"nextPageToken":null}
   */
  async queryOpportunityRoles(filterType, filterValues, fields, batchSize, nextPageToken) {
    return await this.#crmQuery('opportunities/roles', 'queryOpportunityRoles', filterType, filterValues, fields, batchSize, nextPageToken)
  }

  /**
   * @operationName Sync Opportunity Roles
   * @category CRM Objects
   * @description Creates or updates Opportunity Role records (up to 300). Dedupes on the composite { externalOpportunityId, leadId, role }.
   * @route POST /sync-opportunity-roles
   * @paramDef {"type":"Array<Object>","label":"Opportunity Roles","name":"records","required":true,"description":"Opportunity Role records — each holds { externalOpportunityId, leadId, role, isPrimary } plus any CRM fields. Up to 300. Field keys are CRM/instance-defined."}
   * @paramDef {"type":"String","label":"Action","name":"action","uiComponent":{"type":"DROPDOWN","options":{"values":["Create or Update","Create Only","Update Only"]}},"description":"Create or Update (default), Create Only, or Update Only."}
   * @paramDef {"type":"String","label":"Dedupe By","name":"dedupeBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Dedupe Fields","ID Field"]}},"description":"Match records on the composite dedupe key or the Marketo GUID (idField only valid with Update Only)."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#57","success":true,"result":[{"seq":0,"status":"created","marketoGUID":"role-1"}]}
   */
  async syncOpportunityRoles(records, action, dedupeBy) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/opportunities
    return await this.#crmSync('opportunities/roles', 'syncOpportunityRoles', records, action, dedupeBy)
  }

  /**
   * @operationName Delete Opportunity Roles
   * @category CRM Objects
   * @description Deletes Opportunity Role records (up to 300) by dedupe field(s) or marketoGUID.
   * @route POST /delete-opportunity-roles
   * @paramDef {"type":"Array<Object>","label":"Opportunity Roles","name":"records","required":true,"description":"Records to delete — each holds the composite dedupe key or marketoGUID per Delete By. Up to 300. Field keys are CRM/instance-defined — irreducible."}
   * @paramDef {"type":"String","label":"Delete By","name":"deleteBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Dedupe Fields","ID Field"]}},"description":"Match on dedupe field(s) or the Marketo GUID. Defaults to Dedupe Fields."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#58","success":true,"result":[{"seq":0,"marketoGUID":"role-1","status":"deleted"}]}
   */
  async deleteOpportunityRoles(records, deleteBy) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/opportunities
    return await this.#crmDelete('opportunities/roles', 'deleteOpportunityRoles', records, deleteBy)
  }

  /**
   * @operationName Describe Company
   * @category CRM Objects
   * @description Returns the Company object schema. Requires a CRM-sync-enabled subscription.
   * @route POST /describe-company
   * @returns {Object}
   * @sampleResult {"requestId":"r#59","success":true,"result":[{"name":"company","idField":"marketoGUID","dedupeFields":["externalCompanyId"],"fields":[{"name":"company","dataType":"string"}]}]}
   */
  async describeCompany() {
    return await this.#crmDescribe('companies', 'describeCompany')
  }

  /**
   * @operationName Query Companies
   * @category CRM Objects
   * @description Searches Company records by a searchable field and values.
   * @route POST /query-companies
   * @paramDef {"type":"String","label":"Filter Field","name":"filterType","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Searchable field to filter on (e.g. marketoGUID, externalCompanyId). Use Describe Company to discover."}
   * @paramDef {"type":"Array<String>","label":"Filter Values","name":"filterValues","required":true,"description":"Values to match. Up to 300. Accepts a list or comma-separated string."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Optional field API names to return."}
   * @paramDef {"type":"Number","label":"Batch Size","name":"batchSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page (max 300). Defaults to 300."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination token from a previous response."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#60","success":true,"result":[{"seq":0,"marketoGUID":"comp-1","externalCompanyId":"ACME-001","company":"Acme Inc","billingCity":"Boston"}],"nextPageToken":null}
   */
  async queryCompanies(filterType, filterValues, fields, batchSize, nextPageToken) {
    return await this.#crmQuery('companies', 'queryCompanies', filterType, filterValues, fields, batchSize, nextPageToken)
  }

  /**
   * @operationName Sync Companies
   * @category CRM Objects
   * @description Creates or updates Company records in bulk (up to 300). Dedupes on externalCompanyId.
   * @route POST /sync-companies
   * @paramDef {"type":"Array<Object>","label":"Companies","name":"records","required":true,"description":"Company records — each holds field API names as keys (e.g. externalCompanyId, company, billingCity). Up to 300. Field keys are CRM/instance-defined."}
   * @paramDef {"type":"String","label":"Action","name":"action","uiComponent":{"type":"DROPDOWN","options":{"values":["Create or Update","Create Only","Update Only"]}},"description":"Create or Update (default), Create Only, or Update Only."}
   * @paramDef {"type":"String","label":"Dedupe By","name":"dedupeBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Dedupe Fields","ID Field"]}},"description":"Match records on the object's dedupe field(s) or the Marketo GUID (idField only valid with Update Only)."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#61","success":true,"result":[{"seq":0,"status":"created","marketoGUID":"comp-1"}]}
   */
  async syncCompanies(records, action, dedupeBy) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/companies
    return await this.#crmSync('companies', 'syncCompanies', records, action, dedupeBy)
  }

  /**
   * @operationName Delete Companies
   * @category CRM Objects
   * @description Deletes Company records in bulk (up to 300) by dedupe field(s) or marketoGUID.
   * @route POST /delete-companies
   * @paramDef {"type":"Array<Object>","label":"Companies","name":"records","required":true,"description":"Records to delete — each holds the dedupe field(s) or marketoGUID per Delete By. Up to 300. Field keys are CRM/instance-defined — irreducible."}
   * @paramDef {"type":"String","label":"Delete By","name":"deleteBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Dedupe Fields","ID Field"]}},"description":"Match on dedupe field(s) or the Marketo GUID. Defaults to Dedupe Fields."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#62","success":true,"result":[{"seq":0,"marketoGUID":"comp-1","status":"deleted"}]}
   */
  async deleteCompanies(records, deleteBy) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/companies
    return await this.#crmDelete('companies', 'deleteCompanies', records, deleteBy)
  }

  /**
   * @operationName Describe Sales Person
   * @category CRM Objects
   * @description Returns the Sales Person object schema. Requires a CRM-sync-enabled subscription.
   * @route POST /describe-sales-person
   * @returns {Object}
   * @sampleResult {"requestId":"r#63","success":true,"result":[{"name":"salesperson","idField":"marketoGUID","dedupeFields":["externalSalesPersonId"],"fields":[{"name":"email","dataType":"email"}]}]}
   */
  async describeSalesPerson() {
    return await this.#crmDescribe('salespersons', 'describeSalesPerson')
  }

  /**
   * @operationName Query Sales Persons
   * @category CRM Objects
   * @description Searches Sales Person records by a searchable field and values.
   * @route POST /query-sales-persons
   * @paramDef {"type":"String","label":"Filter Field","name":"filterType","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Searchable field to filter on (e.g. marketoGUID, externalSalesPersonId). Use Describe Sales Person to discover."}
   * @paramDef {"type":"Array<String>","label":"Filter Values","name":"filterValues","required":true,"description":"Values to match. Up to 300. Accepts a list or comma-separated string."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Optional field API names to return."}
   * @paramDef {"type":"Number","label":"Batch Size","name":"batchSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page (max 300). Defaults to 300."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination token from a previous response."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#64","success":true,"result":[{"seq":0,"marketoGUID":"sp-1","externalSalesPersonId":"SP-77","email":"rep@acme.com","firstName":"Sam","lastName":"Rep"}],"nextPageToken":null}
   */
  async querySalesPersons(filterType, filterValues, fields, batchSize, nextPageToken) {
    return await this.#crmQuery('salespersons', 'querySalesPersons', filterType, filterValues, fields, batchSize, nextPageToken)
  }

  /**
   * @operationName Sync Sales Persons
   * @category CRM Objects
   * @description Creates or updates Sales Person records in bulk (up to 300). Dedupes on externalSalesPersonId.
   * @route POST /sync-sales-persons
   * @paramDef {"type":"Array<Object>","label":"Sales Persons","name":"records","required":true,"description":"Sales Person records — each holds field API names as keys (e.g. externalSalesPersonId, email, firstName). Up to 300. Field keys are CRM/instance-defined."}
   * @paramDef {"type":"String","label":"Action","name":"action","uiComponent":{"type":"DROPDOWN","options":{"values":["Create or Update","Create Only","Update Only"]}},"description":"Create or Update (default), Create Only, or Update Only."}
   * @paramDef {"type":"String","label":"Dedupe By","name":"dedupeBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Dedupe Fields","ID Field"]}},"description":"Match records on the object's dedupe field(s) or the Marketo GUID (idField only valid with Update Only)."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#65","success":true,"result":[{"seq":0,"status":"created","marketoGUID":"sp-1"}]}
   */
  async syncSalesPersons(records, action, dedupeBy) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/endpoint-reference
    return await this.#crmSync('salespersons', 'syncSalesPersons', records, action, dedupeBy)
  }

  /**
   * @operationName Delete Sales Persons
   * @category CRM Objects
   * @description Deletes Sales Person records in bulk (up to 300) by dedupe field(s) or marketoGUID.
   * @route POST /delete-sales-persons
   * @paramDef {"type":"Array<Object>","label":"Sales Persons","name":"records","required":true,"description":"Records to delete — each holds the dedupe field(s) or marketoGUID per Delete By. Up to 300. Field keys are CRM/instance-defined — irreducible."}
   * @paramDef {"type":"String","label":"Delete By","name":"deleteBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Dedupe Fields","ID Field"]}},"description":"Match on dedupe field(s) or the Marketo GUID. Defaults to Dedupe Fields."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#66","success":true,"result":[{"seq":0,"marketoGUID":"sp-1","status":"deleted"}]}
   */
  async deleteSalesPersons(records, deleteBy) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/endpoint-reference
    return await this.#crmDelete('salespersons', 'deleteSalesPersons', records, deleteBy)
  }

  /**
   * @operationName Describe Named Account
   * @category CRM Objects
   * @description Returns the Named Account object schema. Requires the Marketo ABM / Account-Based add-on.
   * @route POST /describe-named-account
   * @returns {Object}
   * @sampleResult {"requestId":"r#67","success":true,"result":[{"name":"namedaccount","idField":"marketoGUID","dedupeFields":["name"],"fields":[{"name":"annualRevenue","dataType":"currency"}]}]}
   */
  async describeNamedAccount() {
    return await this.#crmDescribe('namedaccounts', 'describeNamedAccount')
  }

  /**
   * @operationName Query Named Accounts
   * @category CRM Objects
   * @description Searches Named Account records by a searchable field and values. Requires the ABM add-on.
   * @route POST /query-named-accounts
   * @paramDef {"type":"String","label":"Filter Field","name":"filterType","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Searchable field to filter on (e.g. marketoGUID, name). Use Describe Named Account to discover."}
   * @paramDef {"type":"Array<String>","label":"Filter Values","name":"filterValues","required":true,"description":"Values to match. Up to 300. Accepts a list or comma-separated string."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Optional field API names to return."}
   * @paramDef {"type":"Number","label":"Batch Size","name":"batchSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page (max 300). Defaults to 300."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination token from a previous response."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#68","success":true,"result":[{"seq":0,"marketoGUID":"na-1","name":"Acme Corp","annualRevenue":5000000,"industry":"Software"}],"nextPageToken":null}
   */
  async queryNamedAccounts(filterType, filterValues, fields, batchSize, nextPageToken) {
    return await this.#crmQuery('namedaccounts', 'queryNamedAccounts', filterType, filterValues, fields, batchSize, nextPageToken)
  }

  /**
   * @operationName Sync Named Accounts
   * @category CRM Objects
   * @description Creates or updates Named Account records in bulk (up to 300). Dedupes on name. Requires the ABM add-on.
   * @route POST /sync-named-accounts
   * @paramDef {"type":"Array<Object>","label":"Named Accounts","name":"records","required":true,"description":"Named Account records — each holds field API names as keys (e.g. name, annualRevenue, industry). Up to 300. Field keys are CRM/instance-defined."}
   * @paramDef {"type":"String","label":"Action","name":"action","uiComponent":{"type":"DROPDOWN","options":{"values":["Create or Update","Create Only","Update Only"]}},"description":"Create or Update (default), Create Only, or Update Only."}
   * @paramDef {"type":"String","label":"Dedupe By","name":"dedupeBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Dedupe Fields","ID Field"]}},"description":"Match records on the object's dedupe field(s) or the Marketo GUID (idField only valid with Update Only)."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#69","success":true,"result":[{"seq":0,"status":"created","marketoGUID":"na-1"}]}
   */
  async syncNamedAccounts(records, action, dedupeBy) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/named-accounts
    return await this.#crmSync('namedaccounts', 'syncNamedAccounts', records, action, dedupeBy)
  }

  /**
   * @operationName Delete Named Accounts
   * @category CRM Objects
   * @description Deletes Named Account records in bulk (up to 300) by name or marketoGUID. Requires the ABM add-on.
   * @route POST /delete-named-accounts
   * @paramDef {"type":"Array<Object>","label":"Named Accounts","name":"records","required":true,"description":"Records to delete — each holds name or marketoGUID per Delete By. Up to 300. Field keys are CRM/instance-defined — irreducible."}
   * @paramDef {"type":"String","label":"Delete By","name":"deleteBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Dedupe Fields","ID Field"]}},"description":"Match on dedupe field(s) (name) or the Marketo GUID. Defaults to Dedupe Fields."}
   * @returns {Object}
   * @sampleResult {"requestId":"r#70","success":true,"result":[{"seq":0,"marketoGUID":"na-1","status":"deleted"}]}
   */
  async deleteNamedAccounts(records, deleteBy) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/named-accounts
    return await this.#crmDelete('namedaccounts', 'deleteNamedAccounts', records, deleteBy)
  }

  // ==========================================================================
  //  ACTIONS - LEAD-LIFECYCLE  (/rest/v1/leads/*)
  // ==========================================================================
  /**
   * @operationName Merge Leads
   * @category Leads
   * @description Merges up to 25 losing leads into a winning lead, then permanently destroys the losing records. IRREVERSIBLE.
   * @route POST /merge-leads
   * @paramDef {"type":"String","label":"Winning Lead","name":"winningLead","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The lead to KEEP. Losing leads are merged into this one and then permanently removed. Use the id from Get Leads / Sync Leads output."}
   * @paramDef {"type":"Array<String>","label":"Losing Leads","name":"losingLeadIds","required":true,"description":"Up to 25 lead IDs to merge into the winning lead. These records are destroyed. Accepts a list or comma-separated string."}
   * @paramDef {"type":"Boolean","label":"Merge In CRM","name":"mergeInCRM","uiComponent":{"type":"TOGGLE"},"description":"Also perform the merge in the connected CRM (e.g. Salesforce)."}
   * @returns {Object}
   * @sampleResult {"requestId":"e42b#14272d07d78","success":true}
   */
  async mergeLeads(winningLead, losingLeadIds, mergeInCRM) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/leads
    if (!winningLead) throw new Error('Winning Lead is required.')

    const ids = this.#toList(losingLeadIds)

    if (!ids.length) throw new Error('Losing Leads is required — provide at least one lead ID.')

    const query = { leadIds: ids.join(',') }

    if (mergeInCRM != null && mergeInCRM !== '') query.mergeInCRM = mergeInCRM

    return await this.#apiRequest({
      path: `/leads/${ encodeURIComponent(winningLead) }/merge.json`,
      method: 'post', query, logTag: 'mergeLeads',
    })
  }

  /**
   * @operationName Push Lead
   * @category Leads
   * @description Pushes lead records into a program, logging a "Push Lead to Marketo" activity. Up to 300 records.
   * @route POST /push-lead
   * @paramDef {"type":"String","label":"Program","name":"programName","required":true,"dictionary":"getProgramsDictionary","description":"The program to push the lead into (a \"Push Lead to Marketo\" activity is logged against it)."}
   * @paramDef {"type":"Array<Object>","label":"Leads","name":"leads","required":true,"description":"Lead records to push (each holds field API names as keys, e.g. email, firstName). Up to 300. Field keys are instance-defined — discover via Describe Lead Fields."}
   * @paramDef {"type":"String","label":"Lookup Field","name":"lookupField","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Marketo ID"]}},"description":"Field used to dedupe. Defaults to Email."}
   * @paramDef {"type":"String","label":"Source","name":"source","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional source label recorded on the push activity."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional reason label recorded on the push activity."}
   * @returns {Object}
   * @sampleResult {"requestId":"939079529805","success":true,"result":[{"id":483894,"status":"created"}]}
   */
  async pushLead(programName, leads, lookupField, source, reason) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/leads
    if (!programName) throw new Error('Program is required.')

    if (!Array.isArray(leads) || leads.length === 0) {
      throw new Error('Leads is required — provide an array of lead records.')
    }

    const body = { programName, lookupField: this.#resolveChoice(lookupField, LOOKUP_FIELD_MAP) || 'email', input: leads }

    if (source) body.source = source
    if (reason) body.reason = reason

    return await this.#apiRequest({ path: '/leads/push.json', method: 'post', body, logTag: 'pushLead' })
  }

  /**
   * @operationName Submit Form
   * @category Leads
   * @description Submits data to a Marketo form on behalf of a lead, triggering the form's fill-out flows just like a real submission.
   * @route POST /submit-form
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The Marketo form to submit against (triggers form-fillout flows, just like a real submission)."}
   * @paramDef {"type":"Object","label":"Form Fields","name":"leadFormFields","required":true,"description":"Field name/value pairs for the submission (e.g. firstName, lastName, email). Keys are the form's field API names — they vary per form and are only known at runtime, so this is a freeform merge-field map."}
   * @paramDef {"type":"String","label":"Munchkin Cookie","name":"cookie","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional _mch/_mkto_trk cookie value to associate the submission with a known web visitor."}
   * @paramDef {"type":"String","label":"Page URL","name":"pageURL","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional page URL recorded as visitor data on the submission."}
   * @paramDef {"type":"String","label":"Query String","name":"queryString","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional query string recorded as visitor data."}
   * @returns {Object}
   * @sampleResult {"requestId":"10667#173bc585ca5","success":true,"result":[{"id":319174,"status":"updated"}]}
   */
  async submitForm(formId, leadFormFields, cookie, pageURL, queryString) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/leads
    if (!formId) throw new Error('Form is required.')

    if (!leadFormFields || typeof leadFormFields !== 'object') {
      throw new Error('Form Fields is required — provide a map of field name/value pairs.')
    }

    const item = { leadFormFields }

    if (cookie) item.cookie = cookie

    const visitorData = {}

    if (pageURL) visitorData.pageURL = pageURL
    if (queryString) visitorData.queryString = queryString
    if (Object.keys(visitorData).length) item.visitorData = visitorData

    return await this.#apiRequest({
      path: '/leads/submitForm.json',
      method: 'post', body: { formId: Number(formId) || formId, input: [item] }, logTag: 'submitForm',
    })
  }

  /**
   * @operationName Associate Lead
   * @category Leads
   * @description Associates an anonymous web session (via its Munchkin cookie) with a known Marketo lead.
   * @route POST /associate-lead
   * @paramDef {"type":"String","label":"Lead","name":"lead","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The known Marketo lead to associate the web session with. Use the id from Get Leads / Sync Leads output."}
   * @paramDef {"type":"String","label":"Munchkin Cookie","name":"cookie","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The visitor's _mkto_trk cookie value (captured client-side). Associates the anonymous web activity with this lead."}
   * @returns {Object}
   * @sampleResult {"requestId":"e42b#14272d07d78","success":true}
   */
  async associateLead(lead, cookie) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/leads
    if (!lead) throw new Error('Lead is required.')
    if (!cookie) throw new Error('Munchkin Cookie is required.')

    return await this.#apiRequest({
      path: `/leads/${ encodeURIComponent(lead) }/associate.json`,
      method: 'post', query: { cookie }, logTag: 'associateLead',
    })
  }

  // ==========================================================================
  //  ACTIONS - BULK - LEAD IMPORT  (base /bulk/v1)
  // ==========================================================================
  /**
   * @operationName Import Leads
   * @category Bulk
   * @description Imports a lead file (CSV/TSV) into Marketo asynchronously. The first row must be a header of Marketo field API names; the file must be under 10MB. Returns a batch id to poll for status.
   * @route POST /import-leads
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"A Flowrunner file containing the leads to import (CSV/TSV; first row must be a header of Marketo field API names; under 10MB)."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["CSV","TSV","SFF"]}},"description":"File format. Defaults to CSV."}
   * @paramDef {"type":"String","label":"Lookup Field","name":"lookupField","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Marketo ID"]}},"description":"Field used to dedupe rows. Defaults to Email. Use Marketo ID to force update-only."}
   * @paramDef {"type":"String","label":"Add To List","name":"listId","dictionary":"getListsDictionary","description":"Optional static list to add the imported leads to."}
   * @paramDef {"type":"String","label":"Partition Name","name":"partitionName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional lead partition for new leads."}
   * @returns {Object}
   * @sampleResult {"requestId":"d01f#15d672f8560","success":true,"result":[{"batchId":3404,"importId":"3404","status":"Queued"}]}
   */
  async importLeads(fileUrl, format, lookupField, listId, partitionName) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/bulk-import/bulk-lead-import
    if (!fileUrl) throw new Error('File is required.')

    // Stream the Flowrunner file as the multipart "file" part. Marketo accepts the access token
    // either in the Authorization header or as a form field; the #apiRequest header path covers it.
    const form = new Flowrunner.Request.FormData()
    const fileResp = await Flowrunner.Request.get(fileUrl)

    form.append('format', (this.#resolveChoice(format, FORMAT_LOWER_MAP) || 'csv'))
    form.append('file', Buffer.isBuffer(fileResp) ? fileResp : Buffer.from(String(fileResp)), { filename: `leads.${ (this.#resolveChoice(format, FORMAT_LOWER_MAP) || 'csv') }` })

    const query = {}

    if (lookupField) query.lookupField = this.#resolveChoice(lookupField, LOOKUP_FIELD_MAP)
    if (listId) query.listId = listId
    if (partitionName) query.partitionName = partitionName

    const token = await this.#getAccessToken(false)
    const url = `${ this.baseUrl }${ BULK_PREFIX }/leads.json`

    try {
      logger.debug(`importLeads POST ${ url }`)

      const response = await Flowrunner.Request.post(url)
        .set({ Authorization: `Bearer ${ token }` })
        .query(query)
        .form(form)

      if (response && response.success === false) throw this.#buildApiError(response)

      return response
    } catch (error) {
      this.#handleError(error, 'importLeads')
    }
  }

  /**
   * @operationName Get Import Lead Status
   * @category Bulk
   * @description Returns the status of a lead-import batch (Queued / Importing / Complete / Failed) with row counts.
   * @route POST /get-import-lead-status
   * @paramDef {"type":"String","label":"Import Batch","name":"importBatch","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The import batch id returned by Import Leads."}
   * @returns {Object}
   * @sampleResult {"requestId":"8136#146daebc2ed","success":true,"result":[{"batchId":1022,"status":"Complete","numOfLeadsProcessed":2,"numOfRowsFailed":1,"numOfRowsWithWarning":0,"message":"Import completed with errors, 2 records imported (2 members), 1 failed"}]}
   */
  async getImportLeadStatus(importBatch) {
    if (!importBatch) throw new Error('Import Batch is required.')

    return await this.#apiRequest({
      path: `/leads/batch/${ encodeURIComponent(importBatch) }.json`,
      prefix: BULK_PREFIX, logTag: 'getImportLeadStatus',
    })
  }

  /**
   * @operationName Get Import Lead Failures
   * @category Bulk
   * @description Returns the failed rows of a lead-import batch as raw CSV (with a reason column).
   * @route POST /get-import-lead-failures
   * @paramDef {"type":"String","label":"Import Batch","name":"importBatch","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The import batch id returned by Import Leads."}
   * @returns {Object}
   * @sampleResult {"batchId":"1022","csv":"email,firstName,reason\nbad@,,Invalid email address"}
   */
  async getImportLeadFailures(importBatch) {
    if (!importBatch) throw new Error('Import Batch is required.')

    const csv = await this.#apiRequest({
      path: `/leads/batch/${ encodeURIComponent(importBatch) }/failures.json`,
      prefix: BULK_PREFIX, logTag: 'getImportLeadFailures',
    })

    return { batchId: String(importBatch), csv: typeof csv === 'string' ? csv : (csv || '') }
  }

  /**
   * @operationName Get Import Lead Warnings
   * @category Bulk
   * @description Returns the warning rows of a lead-import batch as raw CSV (with a reason column).
   * @route POST /get-import-lead-warnings
   * @paramDef {"type":"String","label":"Import Batch","name":"importBatch","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The import batch id returned by Import Leads."}
   * @returns {Object}
   * @sampleResult {"batchId":"1022","csv":"email,firstName,reason\nx@y.com,,Value truncated"}
   */
  async getImportLeadWarnings(importBatch) {
    if (!importBatch) throw new Error('Import Batch is required.')

    const csv = await this.#apiRequest({
      path: `/leads/batch/${ encodeURIComponent(importBatch) }/warnings.json`,
      prefix: BULK_PREFIX, logTag: 'getImportLeadWarnings',
    })

    return { batchId: String(importBatch), csv: typeof csv === 'string' ? csv : (csv || '') }
  }

  // ==========================================================================
  //  ACTIONS - BULK - LEAD EXPORT
  // ==========================================================================
  /**
   * @operationName Create Lead Export
   * @category Bulk
   * @description Creates a bulk lead export job (does not start it - use Enqueue Lead Export). Define the columns and an optional date window or static list. Limits: 500MB/day, 2 concurrent + 10 queued.
   * @route POST /create-lead-export
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","required":true,"description":"Lead field API names to include as columns (e.g. id, email, firstName). Use Describe Lead Fields to discover. Accepts a list or comma-separated string."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["CSV","TSV","SSV"]}},"description":"Output file format. Defaults to CSV."}
   * @paramDef {"type":"String","label":"Date Filter Field","name":"filterType","uiComponent":{"type":"DROPDOWN","options":{"values":["Created At","Updated At"]}},"description":"Which date field to window on. Use with Start/End (31-day max window). Defaults to Created At."}
   * @paramDef {"type":"String","label":"Start","name":"startAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the date window (ISO-8601). Required if using a date filter."}
   * @paramDef {"type":"String","label":"End","name":"endAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the date window (ISO-8601; within 31 days of Start)."}
   * @paramDef {"type":"String","label":"Static List","name":"staticListId","dictionary":"getListsDictionary","description":"Optional static list to export instead of (or with) a date window."}
   * @returns {Object}
   * @sampleResult {"requestId":"e42b#14272d07d78","success":true,"result":[{"exportId":"ce45a7a1-f19d-4ce2-882c-a3c795940a7d","status":"Created","createdAt":"2017-01-21T11:47:30-08:00","format":"CSV"}]}
   */
  async createLeadExport(fields, format, filterType, startAt, endAt, staticListId) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/bulk-extract/bulk-lead-extract
    const fieldList = this.#toList(fields)

    if (!fieldList.length) throw new Error('Fields is required — provide at least one field.')

    const filter = {}

    if (staticListId) filter.staticListId = Number(staticListId) || staticListId

    if (startAt || endAt) {
      const window = {}

      if (startAt) window.startAt = startAt
      if (endAt) window.endAt = endAt
      filter[this.#resolveChoice(filterType, DATE_FILTER_MAP) || 'createdAt'] = window
    }

    return await this.#apiRequest({
      path: '/leads/export/create.json',
      method: 'post', prefix: BULK_PREFIX,
      body: { fields: fieldList, format: format || 'CSV', filter }, logTag: 'createLeadExport',
    })
  }

  /**
   * @operationName Enqueue Lead Export
   * @category Bulk
   * @description Starts (enqueues) a created lead export job so Marketo begins processing it.
   * @route POST /enqueue-lead-export
   * @paramDef {"type":"String","label":"Export Job","name":"exportJob","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The export job id from Create Lead Export."}
   * @returns {Object}
   * @sampleResult {"requestId":"147e4#16b24d9b913","success":true,"result":[{"exportId":"fad2cd1b-e822-4025-be1e-9caa9cf1d4b8","status":"Queued","format":"CSV","createdAt":"2019-06-04T23:35:43Z","queuedAt":"2019-06-04T23:36:17Z"}]}
   */
  async enqueueLeadExport(exportJob) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/bulk-extract/bulk-lead-extract
    return await this.#enqueueExport('leads', exportJob, 'enqueueLeadExport')
  }

  /**
   * @operationName Get Lead Export Status
   * @category Bulk
   * @description Returns the status of a lead export job (Created / Queued / Processing / Completed / Failed / Canceled).
   * @route POST /get-lead-export-status
   * @paramDef {"type":"String","label":"Export Job","name":"exportJob","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The export job id from Create Lead Export."}
   * @returns {Object}
   * @sampleResult {"requestId":"147e4#16b24d9b913","success":true,"result":[{"exportId":"fad2cd1b-e822-4025-be1e-9caa9cf1d4b8","status":"Completed","format":"CSV","createdAt":"2019-06-04T23:35:43Z"}]}
   */
  async getLeadExportStatus(exportJob) {
    return await this.#exportStatus('leads', exportJob, 'getLeadExportStatus')
  }

  /**
   * @operationName Get Lead Export File
   * @category Bulk
   * @description Returns the exported lead file as raw delimited text. Only valid once the job status is Completed.
   * @route POST /get-lead-export-file
   * @paramDef {"type":"String","label":"Export Job","name":"exportJob","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The completed export job id. Only valid once status is Completed."}
   * @returns {Object}
   * @sampleResult {"exportId":"ce45a7a1-f19d-4ce2-882c-a3c795940a7d","content":"firstName,lastName,email,cookies\nRussell,Wilson,null,_mch-localhost-1536605780000-12105"}
   */
  async getLeadExportFile(exportJob) {
    return await this.#exportFile('leads', exportJob, 'getLeadExportFile')
  }

  /**
   * @operationName Cancel Lead Export
   * @category Bulk
   * @description Cancels a queued or processing lead export job.
   * @route POST /cancel-lead-export
   * @paramDef {"type":"String","label":"Export Job","name":"exportJob","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The export job id to cancel."}
   * @returns {Object}
   * @sampleResult {"requestId":"147e4#16b24d9b913","success":true,"result":[{"exportId":"fad2cd1b-e822-4025-be1e-9caa9cf1d4b8","status":"Canceled","format":"CSV"}]}
   */
  async cancelLeadExport(exportJob) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/bulk-extract/bulk-lead-extract
    return await this.#cancelExport('leads', exportJob, 'cancelLeadExport')
  }

  // ==========================================================================
  //  ACTIONS - BULK - ACTIVITY EXPORT
  // ==========================================================================
  /**
   * @operationName Create Activity Export
   * @category Bulk
   * @description Creates a bulk activity export job (does not start it - use Enqueue Activity Export). Requires a createdAt date window (31-day max).
   * @route POST /create-activity-export
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","required":true,"description":"Activity field names to include (e.g. marketoGUID, leadId, activityDate, activityTypeId). Accepts a list or comma-separated string."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["CSV","TSV","SSV"]}},"description":"Output format. Defaults to CSV."}
   * @paramDef {"type":"String","label":"Start","name":"startAt","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the createdAt window (ISO-8601)."}
   * @paramDef {"type":"String","label":"End","name":"endAt","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the createdAt window (ISO-8601; within 31 days of Start)."}
   * @paramDef {"type":"Array<String>","label":"Activity Types","name":"activityTypeIds","dictionary":"getActivityTypesDictionary","description":"Optional activity type IDs to limit the export to."}
   * @returns {Object}
   * @sampleResult {"requestId":"e42b#14272d07d78","success":true,"result":[{"exportId":"af1234-...","status":"Created","format":"CSV","createdAt":"2017-01-21T11:47:30-08:00"}]}
   */
  async createActivityExport(fields, format, startAt, endAt, activityTypeIds) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/bulk-extract/bulk-extract
    const fieldList = this.#toList(fields)

    if (!fieldList.length) throw new Error('Fields is required — provide at least one field.')
    if (!startAt) throw new Error('Start is required.')
    if (!endAt) throw new Error('End is required.')

    const filter = { createdAt: { startAt, endAt } }
    const types = this.#toList(activityTypeIds)

    if (types.length) filter.activityTypeIds = types.map(id => Number(id) || id)

    return await this.#apiRequest({
      path: '/activities/export/create.json',
      method: 'post', prefix: BULK_PREFIX,
      body: { fields: fieldList, format: format || 'CSV', filter }, logTag: 'createActivityExport',
    })
  }

  /**
   * @operationName Enqueue Activity Export
   * @category Bulk
   * @description Starts (enqueues) a created activity export job.
   * @route POST /enqueue-activity-export
   * @paramDef {"type":"String","label":"Export Job","name":"exportJob","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The export job id from Create Activity Export."}
   * @returns {Object}
   * @sampleResult {"requestId":"e42b","success":true,"result":[{"exportId":"af1234-...","status":"Queued","format":"CSV"}]}
   */
  async enqueueActivityExport(exportJob) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/bulk-extract/bulk-extract
    return await this.#enqueueExport('activities', exportJob, 'enqueueActivityExport')
  }

  /**
   * @operationName Get Activity Export Status
   * @category Bulk
   * @description Returns the status of an activity export job.
   * @route POST /get-activity-export-status
   * @paramDef {"type":"String","label":"Export Job","name":"exportJob","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The export job id from Create Activity Export."}
   * @returns {Object}
   * @sampleResult {"requestId":"e42b","success":true,"result":[{"exportId":"af1234-...","status":"Completed","format":"CSV"}]}
   */
  async getActivityExportStatus(exportJob) {
    return await this.#exportStatus('activities', exportJob, 'getActivityExportStatus')
  }

  /**
   * @operationName Get Activity Export File
   * @category Bulk
   * @description Returns the exported activity file as raw delimited text. Only valid once the job status is Completed.
   * @route POST /get-activity-export-file
   * @paramDef {"type":"String","label":"Export Job","name":"exportJob","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The completed export job id. Only valid once status is Completed."}
   * @returns {Object}
   * @sampleResult {"exportId":"af1234-...","content":"marketoGUID,leadId,activityDate,activityTypeId\n102988,1,2023-01-16T23:32:19Z,1"}
   */
  async getActivityExportFile(exportJob) {
    return await this.#exportFile('activities', exportJob, 'getActivityExportFile')
  }

  /**
   * @operationName Cancel Activity Export
   * @category Bulk
   * @description Cancels a queued or processing activity export job.
   * @route POST /cancel-activity-export
   * @paramDef {"type":"String","label":"Export Job","name":"exportJob","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The export job id to cancel."}
   * @returns {Object}
   * @sampleResult {"requestId":"e42b","success":true,"result":[{"exportId":"af1234-...","status":"Canceled","format":"CSV"}]}
   */
  async cancelActivityExport(exportJob) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/bulk-extract/bulk-extract
    return await this.#cancelExport('activities', exportJob, 'cancelActivityExport')
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Lists Dictionary
   * @description Provides a searchable list of static lists for dropdown selection in other actions.
   * @route POST /get-lists-dictionary
   * @paramDef {"type":"getListsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Static List","value":"1027","note":"ID: 1027 · 2025 Newsletter"}],"cursor":null}
   */
  async getListsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { batchSize: 300 }

    if (cursor) query.nextPageToken = cursor

    const response = await this.#apiRequest({ path: '/lists.json', query, logTag: 'getListsDictionary' })
    const result = (response && response.result) || []
    const term = (search || '').toLowerCase()
    const filtered = term ? result.filter(l => (l.name || '').toLowerCase().includes(term)) : result

    return {
      items: filtered.map(l => ({
        label: l.name,
        value: String(l.id),
        note: `ID: ${ l.id }${ l.programName ? ` · ${ l.programName }` : '' }`,
      })),
      cursor: (response && response.nextPageToken) || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Campaigns Dictionary
   * @description Provides a searchable list of smart campaigns for dropdown selection in other actions.
   * @route POST /get-campaigns-dictionary
   * @paramDef {"type":"getCampaignsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Test Trigger Campaign","value":"1069","note":"trigger · ID: 1069"}],"cursor":null}
   */
  async getCampaignsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { batchSize: 300 }

    if (cursor) query.nextPageToken = cursor

    const response = await this.#apiRequest({ path: '/campaigns.json', query, logTag: 'getCampaignsDictionary' })
    const result = (response && response.result) || []
    const term = (search || '').toLowerCase()
    const filtered = term ? result.filter(c => (c.name || '').toLowerCase().includes(term)) : result

    return {
      items: filtered.map(c => ({
        label: c.name,
        value: String(c.id),
        note: `${ c.type || 'campaign' } · ID: ${ c.id }`,
      })),
      cursor: (response && response.nextPageToken) || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Activity Types Dictionary
   * @description Provides a searchable list of activity types for dropdown selection in Get Lead Activities and the New Activity trigger.
   * @route POST /get-activity-types-dictionary
   * @paramDef {"type":"getActivityTypesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Fill Out Form","value":"2","note":"User fills out and submits form on web page"}],"cursor":null}
   */
  async getActivityTypesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({ path: '/activities/types.json', logTag: 'getActivityTypesDictionary' })
    const result = (response && response.result) || []
    const term = (search || '').toLowerCase()
    const filtered = term ? result.filter(t => (t.name || '').toLowerCase().includes(term)) : result

    return {
      items: filtered.map(t => ({
        label: t.name,
        value: String(t.id),
        note: t.description || `ID: ${ t.id }`,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Custom Objects Dictionary
   * @description Provides a searchable list of custom object types for dropdown selection in other actions.
   * @route POST /get-custom-objects-dictionary
   * @paramDef {"type":"getCustomObjectsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Car","value":"car_c","note":"API name: car_c"}],"cursor":null}
   */
  async getCustomObjectsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({ path: '/customobjects.json', logTag: 'getCustomObjectsDictionary' })
    const result = (response && response.result) || []
    const term = (search || '').toLowerCase()
    const filtered = term
      ? result.filter(o => `${ o.displayName || '' } ${ o.name || '' }`.toLowerCase().includes(term))
      : result

    return {
      items: filtered.map(o => ({
        label: o.displayName || o.name,
        value: o.name,
        note: `API name: ${ o.name }`,
      })),
      cursor: null,
    }
  }

  // Shared offset-paged Asset-API dictionary (programs/emails/forms/landingPages). Filters
  // payload.search locally by name and advances the cursor as a numeric offset.
  async #assetDictionary(path, payload, mapItem, extraQuery, logTag) {
    const { search, cursor } = payload || {}
    const maxReturn = 200
    const offset = Number(cursor) || 0
    const query = Object.assign({ maxReturn, offset }, extraQuery || {})

    const response = await this.#apiRequest({ path, prefix: ASSET_PREFIX, query, logTag })
    const result = (response && response.result) || []
    const term = (search || '').toLowerCase()
    const filtered = term ? result.filter(r => (r.name || '').toLowerCase().includes(term)) : result

    return {
      items: filtered.map(mapItem),
      // Offer the next offset only when the page came back full.
      cursor: result.length === maxReturn ? String(offset + maxReturn) : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Programs Dictionary
   * @description Provides a searchable list of programs for dropdown selection in other actions.
   * @route POST /get-programs-dictionary
   * @paramDef {"type":"getProgramsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Program Name","value":"1107","note":"Default · ID: 1107"}],"cursor":null}
   */
  async getProgramsDictionary(payload) {
    return await this.#assetDictionary('/programs.json', payload,
      p => ({ label: p.name, value: String(p.id), note: `${ p.type || 'Program' } · ID: ${ p.id }` }),
      null, 'getProgramsDictionary')
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Folders Dictionary
   * @description Provides a searchable list of folders for dropdown selection in other actions. Requires the Root Folder ID config item (the instance top-level/workspace folder).
   * @route POST /get-folders-dictionary
   * @paramDef {"type":"getFoldersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Marketing","value":"1035","note":"Folder · ID: 1035"}],"cursor":null}
   */
  async getFoldersDictionary(payload) {
    const { search, cursor } = payload || {}
    const root = this.config.rootFolderId

    // The Browse Folders endpoint requires a root; without a configured top-level folder we
    // cannot enumerate, so return an empty list (users can still type the id directly).
    if (!root) return { items: [], cursor: null }

    const maxReturn = 200
    const offset = Number(cursor) || 0
    const query = { root: JSON.stringify(this.#folderRef(root)), maxReturn, offset }
    const response = await this.#apiRequest({ path: '/folders.json', prefix: ASSET_PREFIX, query, logTag: 'getFoldersDictionary' })
    const result = (response && response.result) || []
    const term = (search || '').toLowerCase()
    const filtered = term ? result.filter(f => (f.name || '').toLowerCase().includes(term)) : result

    return {
      items: filtered.map(f => ({ label: f.name, value: String(f.id), note: `Folder · ID: ${ f.id }` })),
      cursor: result.length === maxReturn ? String(offset + maxReturn) : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Emails Dictionary
   * @description Provides a searchable list of email assets for dropdown selection in other actions.
   * @route POST /get-emails-dictionary
   * @paramDef {"type":"getEmailsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Social Sharing in Email","value":"2137","note":"approved · ID: 2137"}],"cursor":null}
   */
  async getEmailsDictionary(payload) {
    return await this.#assetDictionary('/emails.json', payload,
      e => ({ label: e.name, value: String(e.id), note: `${ e.status || 'email' } · ID: ${ e.id }` }),
      null, 'getEmailsDictionary')
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Forms Dictionary
   * @description Provides a searchable list of form assets for dropdown selection in other actions.
   * @route POST /get-forms-dictionary
   * @paramDef {"type":"getFormsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Contact Us","value":"1029","note":"approved · ID: 1029"}],"cursor":null}
   */
  async getFormsDictionary(payload) {
    return await this.#assetDictionary('/forms.json', payload,
      f => ({ label: f.name, value: String(f.id), note: `${ f.status || 'form' } · ID: ${ f.id }` }),
      null, 'getFormsDictionary')
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Landing Pages Dictionary
   * @description Provides a searchable list of landing page assets for dropdown selection in other actions.
   * @route POST /get-landing-pages-dictionary
   * @paramDef {"type":"getLandingPagesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Webinar LP","value":"1055","note":"approved · ID: 1055"}],"cursor":null}
   */
  async getLandingPagesDictionary(payload) {
    return await this.#assetDictionary('/landingPages.json', payload,
      l => ({ label: l.name, value: String(l.id), note: `${ l.status || 'page' } · ID: ${ l.id }` }),
      null, 'getLandingPagesDictionary')
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Smart Lists Dictionary
   * @description Provides a searchable list of user-created smart list assets for dropdown selection. Requires the Root Folder ID config item.
   * @route POST /get-smart-lists-dictionary
   * @paramDef {"type":"getSmartListsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engaged Leads","value":"2055","note":"ID: 2055"}],"cursor":null}
   */
  async getSmartListsDictionary(payload) {
    const { search, cursor } = payload || {}
    const root = this.config.rootFolderId

    if (!root) return { items: [], cursor: null }

    const maxReturn = 200
    const offset = Number(cursor) || 0
    const query = { folder: JSON.stringify(this.#folderRef(root)), maxReturn, offset }
    const response = await this.#apiRequest({ path: '/smartLists.json', prefix: ASSET_PREFIX, query, logTag: 'getSmartListsDictionary' })
    const result = (response && response.result) || []
    const term = (search || '').toLowerCase()
    const filtered = term ? result.filter(s => (s.name || '').toLowerCase().includes(term)) : result

    return {
      items: filtered.map(s => ({ label: s.name, value: String(s.id), note: `ID: ${ s.id }` })),
      cursor: result.length === maxReturn ? String(offset + maxReturn) : null,
    }
  }

  // ==========================================================================
  //  TRIGGERS (polling)
  // ==========================================================================
  /**
   * @registerAs POLLING_TRIGGER
   * @operationName On New Lead
   * @category Triggers
   * @description Fires for each newly created lead since the last poll, riding Marketo's "New Lead" activity stream. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-new-lead
   * @returns {Object}
   * @sampleResult {"id":318581,"marketoGUID":"318581","leadId":318581,"activityDate":"2023-01-16T23:32:19Z","activityTypeId":12,"primaryAttributeValue":"jdoe@marketo.com"}
   */
  async onNewLead(invocation) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/activities
    // "Newer-than" for leads is the activity stream, not a Get-Leads timestamp filter (updatedAt is not a
    // valid filterType). Ride the "New Lead" activity (activityTypeId resolved at runtime via Get Activity Types).
    const state = (invocation && invocation.state) || {}

    // On the first poll, anchor the stream at "now" and emit nothing historical.
    if (!state.nextPageToken) {
      const anchor = await this.#apiRequest({
        path: '/activities/pagingtoken.json',
        query: { sinceDatetime: new Date().toISOString() },
        logTag: 'onNewLead',
      })

      return { events: [], state: { nextPageToken: (anchor && anchor.nextPageToken) || null } }
    }

    const newLeadTypeId = await this.#resolveNewLeadActivityTypeId()
    let token = state.nextPageToken
    const events = []

    do {
      const response = await this.#apiRequest({
        path: '/activities.json',
        query: { nextPageToken: token, activityTypeIds: newLeadTypeId },
        logTag: 'onNewLead',
      })

      const result = (response && response.result) || []

      events.push(...result)
      token = (response && response.nextPageToken) || token

      if (!response || !response.moreResult) break
    } while (token)

    return { events, state: { nextPageToken: token } }
  }

  // Resolve the "New Lead" activity type id at runtime (id 12 by convention, but never hardcoded).
  async #resolveNewLeadActivityTypeId() {
    const response = await this.#apiRequest({ path: '/activities/types.json', logTag: 'onNewLead' })
    const types = (response && response.result) || []
    const match = types.find(t => (t.name || '').toLowerCase() === 'new lead')

    return match ? match.id : 12
  }

  /**
   * @registerAs POLLING_TRIGGER
   * @operationName On New Activity
   * @category Triggers
   * @description Fires for each new lead activity of the chosen type(s) since the last poll, using Marketo's paging-token stream. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-new-activity
   * @paramDef {"type":"Array<String>","label":"Activity Types","name":"activityTypeIds","required":true,"dictionary":"getActivityTypesDictionary","description":"Activity type IDs to watch (up to 10). Use Get Activity Types to discover them."}
   * @returns {Object}
   * @sampleResult {"id":102988,"marketoGUID":"102988","leadId":1,"activityDate":"2023-01-16T23:32:19Z","activityTypeId":1,"primaryAttributeValue":"localhost/page.html","attributes":[{"name":"Client IP Address","value":"10.0.19.252"}]}
   */
  async onNewActivity(invocation) {
    const state = (invocation && invocation.state) || {}
    const triggerData = (invocation && invocation.triggerData) || {}
    const typeIds = this.#toList(triggerData.activityTypeIds)

    if (!typeIds.length) {
      throw new Error('Activity Types is required — choose at least one activity type to watch.')
    }

    // On the first poll, anchor the stream at "now" and emit nothing historical.
    let token = state.nextPageToken

    if (!token) {
      const anchor = await this.#apiRequest({
        path: '/activities/pagingtoken.json',
        query: { sinceDatetime: new Date().toISOString() },
        logTag: 'onNewActivity',
      })

      return { events: [], state: { nextPageToken: (anchor && anchor.nextPageToken) || null } }
    }

    const events = []

    // Drain all pages available this poll, advancing the stored token each page.
    do {
      const response = await this.#apiRequest({
        path: '/activities.json',
        query: { nextPageToken: token, activityTypeIds: typeIds.join(',') },
        logTag: 'onNewActivity',
      })

      const result = (response && response.result) || []

      events.push(...result)
      token = (response && response.nextPageToken) || token

      if (!response || !response.moreResult) break
    } while (token)

    return { events, state: { nextPageToken: token } }
  }

  /**
   * @registerAs POLLING_TRIGGER
   * @operationName On Lead Field Change
   * @category Triggers
   * @description Fires for each watched lead-field change since the last poll, riding Marketo's Get-Lead-Changes activity stream. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-lead-field-change
   * @paramDef {"type":"Array<String>","label":"Fields to Watch","name":"fields","required":true,"description":"Lead field API names to watch for changes (e.g. email, leadScore). Use Describe Lead Fields to discover them."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":false,"dictionary":"getListsDictionary","description":"Optional static list to scope the watch to."}
   * @returns {Object}
   * @sampleResult {"id":54,"leadId":318581,"activityDate":"2023-01-16T23:32:19Z","activityTypeId":13,"fields":[{"id":2,"name":"Email","newValue":"new@x.com","oldValue":"old@x.com"}]}
   */
  async onLeadFieldChange(invocation) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/activities
    const state = (invocation && invocation.state) || {}
    const triggerData = (invocation && invocation.triggerData) || {}
    const fields = this.#toList(triggerData.fields)

    if (!fields.length) {
      throw new Error('Fields to Watch is required — choose at least one lead field to watch.')
    }

    // On the first poll, anchor the stream at "now" and emit nothing historical.
    let token = state.nextPageToken

    if (!token) {
      const anchor = await this.#apiRequest({
        path: '/activities/pagingtoken.json',
        query: { sinceDatetime: new Date().toISOString() },
        logTag: 'onLeadFieldChange',
      })

      return { events: [], state: { nextPageToken: (anchor && anchor.nextPageToken) || null } }
    }

    const events = []

    // Drain all pages available this poll, advancing the stored token each page.
    do {
      const query = { nextPageToken: token, fields: fields.join(',') }

      if (triggerData.listId) query.listId = triggerData.listId

      const response = await this.#apiRequest({
        path: '/activities/leadchanges.json',
        query,
        logTag: 'onLeadFieldChange',
      })

      const result = (response && response.result) || []

      events.push(...result)
      token = (response && response.nextPageToken) || token

      if (!response || !response.moreResult) break
    } while (token)

    return { events, state: { nextPageToken: token } }
  }

  /**
   * @registerAs POLLING_TRIGGER
   * @operationName On Deleted Lead
   * @category Triggers
   * @description Fires for each lead deleted from the instance since the last poll, riding Marketo's Get-Deleted-Leads activity stream. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-deleted-lead
   * @returns {Object}
   * @sampleResult {"id":102999,"marketoGUID":"102999","leadId":1,"activityDate":"2023-01-16T23:40:00Z","activityTypeId":37}
   */
  async onDeletedLead(invocation) {
    // docs: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/activities
    const state = (invocation && invocation.state) || {}

    // On the first poll, anchor the stream at "now" and emit nothing historical.
    let token = state.nextPageToken

    if (!token) {
      const anchor = await this.#apiRequest({
        path: '/activities/pagingtoken.json',
        query: { sinceDatetime: new Date().toISOString() },
        logTag: 'onDeletedLead',
      })

      return { events: [], state: { nextPageToken: (anchor && anchor.nextPageToken) || null } }
    }

    const events = []

    // Drain all pages available this poll, advancing the stored token each page.
    do {
      const response = await this.#apiRequest({
        path: '/activities/deletedleads.json',
        query: { nextPageToken: token },
        logTag: 'onDeletedLead',
      })

      const result = (response && response.result) || []

      events.push(...result)
      token = (response && response.nextPageToken) || token

      if (!response || !response.moreResult) break
    } while (token)

    return { events, state: { nextPageToken: token } }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }
}

Flowrunner.ServerCode.addService(Marketo, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'LaunchPoint custom service Client ID (Admin > Integration > LaunchPoint > View Details).',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'LaunchPoint custom service Client Secret.',
  },
  {
    name: 'baseUrl',
    displayName: 'Base URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your REST endpoint base, e.g. https://123-ABC-456.mktorest.com (Admin > Integration > Web Services).',
  },
])
