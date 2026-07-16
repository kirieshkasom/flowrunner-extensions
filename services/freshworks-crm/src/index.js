const logger = {
  info: (...args) => console.log('[Freshworks CRM] info:', ...args),
  debug: (...args) => console.log('[Freshworks CRM] debug:', ...args),
  error: (...args) => console.log('[Freshworks CRM] error:', ...args),
  warn: (...args) => console.log('[Freshworks CRM] warn:', ...args),
}

const DEFAULT_PAGE_SIZE = 25

// Maps the friendly targetable-entity label shown in dropdowns to the API token.
const TARGETABLE_TYPE_MAP = {
  'Contact': 'Contact',
  'Deal': 'Deal',
  'Account': 'SalesAccount',
}

// Maps friendly search-entity labels to the Freshsales entity tokens.
const SEARCH_ENTITY_MAP = {
  'Contacts': 'contact',
  'Deals': 'deal',
  'Accounts': 'sales_account',
  'Leads': 'lead',
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
 * @integrationName Freshworks CRM
 * @integrationIcon /icon.png
 */
class FreshworksCrmService {
  constructor(config) {
    this.domain = String(config.domain || '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\.myfreshworks\.com.*$/i, '')
      .replace(/\.freshworks\.com.*$/i, '')
      .replace(/\/.*$/, '')

    this.apiKey = config.apiKey
  }

  get #baseUrl() {
    return `https://${ this.domain }.myfreshworks.com/crm/sales/api`
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Freshsales wraps single-resource responses under the singular resource key
  // (e.g. { "contact": {...} }); unwrap it so callers get the plain object.
  #unwrap(response, key) {
    if (response && typeof response === 'object' && response[key] !== undefined) {
      return response[key]
    }

    return response
  }

  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.#baseUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Token token=${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const errorBody = error.body || {}
      const errors = errorBody.errors || {}

      let message = errors.message || errorBody.message || error.message || 'Unknown error'

      // Field-level validation errors can arrive as an array or a keyed map.
      if (Array.isArray(errors)) {
        const details = errors.map(item => item.message || JSON.stringify(item)).filter(Boolean).join('; ')

        if (details) {
          message = details
        }
      }

      const status = error.status || error.statusCode

      if (status === 429) {
        const retryAfter = error.response?.headers?.['retry-after'] || error.headers?.['retry-after']

        message = `Rate limit exceeded${ retryAfter ? `, retry after ${ retryAfter } seconds` : '' }. ${ message }`
      }

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Freshworks CRM API error: ${ message }`)
    }
  }

  // ==================== Contacts ====================

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new contact in Freshworks CRM (Freshsales). Provide the contact's name and at least an email or mobile number. The contact can be linked to a primary sales account, and account-specific custom fields are set via Custom Fields (keys must match the internal field names configured in your account, e.g. cf_region). The API wraps and returns the contact object, which is unwrapped in the result.
   * @route POST /create-contact
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"First name of the contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Last name of the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address of the contact. Used as the unique key for upsert."}
   * @paramDef {"type":"String","label":"Mobile Number","name":"mobileNumber","description":"Mobile phone number of the contact."}
   * @paramDef {"type":"String","label":"Work Number","name":"workNumber","description":"Work phone number of the contact."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"Job title / designation of the contact."}
   * @paramDef {"type":"Number","label":"Primary Account","name":"salesAccountId","dictionary":"getAccountsDictionary","description":"ID of the sales account (company) to link as the contact's primary account. Select from your accounts or enter an ID."}
   * @paramDef {"type":"Number","label":"Owner","name":"ownerId","dictionary":"getOwnersDictionary","description":"ID of the user who owns this contact. Select from your users or enter an ID."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom contact fields, e.g. {\"cf_region\":\"EMEA\"}. Keys must match the internal names configured in your account."}
   *
   * @returns {Object}
   * @sampleResult {"id":16000123456,"first_name":"Jane","last_name":"Doe","display_name":"Jane Doe","email":"jane.doe@example.com","mobile_number":"+15550100","job_title":"CTO","owner_id":16000098765,"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}
   */
  async createContact(firstName, lastName, email, mobileNumber, workNumber, jobTitle, salesAccountId, ownerId, customFields) {
    const logTag = '[createContact]'

    const response = await this.#apiRequest({
      logTag,
      path: '/contacts',
      method: 'post',
      body: {
        contact: clean({
          first_name: firstName,
          last_name: lastName,
          email,
          mobile_number: mobileNumber,
          work_number: workNumber,
          job_title: jobTitle,
          sales_accounts: salesAccountId ? [{ id: Number(salesAccountId), is_primary: true }] : undefined,
          owner_id: ownerId ? Number(ownerId) : undefined,
          custom_field: customFields,
        }),
      },
    })

    return this.#unwrap(response, 'contact')
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact by its ID, including name, email, phone numbers, owner, and custom fields. Optionally embeds related records (e.g. linked deals, notes, or the primary sales account) via the Include option.
   * @route GET /get-contact
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact to retrieve."}
   * @paramDef {"type":"Array<String>","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Deals","Notes","Tasks","Appointments","Sales Account"]}},"description":"Related records to embed in the response. Leave empty to return only the contact fields."}
   *
   * @returns {Object}
   * @sampleResult {"id":16000123456,"first_name":"Jane","last_name":"Doe","display_name":"Jane Doe","email":"jane.doe@example.com","mobile_number":"+15550100","job_title":"CTO","owner_id":16000098765,"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}
   */
  async getContact(contactId, include) {
    const logTag = '[getContact]'

    const includeMap = {
      'Deals': 'deals',
      'Notes': 'notes',
      'Tasks': 'tasks',
      'Appointments': 'appointments',
      'Sales Account': 'sales_accounts',
    }

    const includeValues = (include || [])
      .map(item => this.#resolveChoice(item, includeMap))
      .filter(Boolean)
      .join(',')

    const response = await this.#apiRequest({
      logTag,
      path: `/contacts/${ contactId }`,
      method: 'get',
      query: { include: includeValues || undefined },
    })

    return this.#unwrap(response, 'contact')
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Lists contacts belonging to a filtered view. Freshworks CRM organizes list access around views (filters) rather than a flat list, so a View is required — use the Get Contact Views dictionary to pick one (e.g. "All Contacts", "My Contacts"). Supports pagination and sorting.
   * @route GET /list-contacts
   *
   * @paramDef {"type":"Number","label":"View","name":"viewId","required":true,"dictionary":"getContactViewsDictionary","description":"ID of the contact view (filter) to list from. Select from your views."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of contacts per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"contacts":[{"id":16000123456,"first_name":"Jane","last_name":"Doe","display_name":"Jane Doe","email":"jane.doe@example.com","owner_id":16000098765,"created_at":"2026-07-13T10:00:00Z"}],"meta":{"total_pages":1,"total":1}}
   */
  async listContacts(viewId, page, perPage) {
    const logTag = '[listContacts]'

    return await this.#apiRequest({
      logTag,
      path: `/contacts/view/${ viewId }`,
      method: 'get',
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing contact. Only the provided fields are changed; all other fields keep their current values. The API wraps and returns the updated contact object, which is unwrapped in the result.
   * @route PUT /update-contact
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name of the contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name of the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New primary email address of the contact."}
   * @paramDef {"type":"String","label":"Mobile Number","name":"mobileNumber","description":"New mobile phone number of the contact."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"New job title / designation of the contact."}
   * @paramDef {"type":"Number","label":"Owner","name":"ownerId","dictionary":"getOwnersDictionary","description":"ID of the user who owns this contact. Select from your users or enter an ID."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom contact fields to update, e.g. {\"cf_region\":\"EMEA\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":16000123456,"first_name":"Jane","last_name":"Doe","display_name":"Jane Doe","email":"jane.doe@newexample.com","mobile_number":"+15550199","job_title":"CTO","owner_id":16000098765,"updated_at":"2026-07-13T13:00:00Z"}
   */
  async updateContact(contactId, firstName, lastName, email, mobileNumber, jobTitle, ownerId, customFields) {
    const logTag = '[updateContact]'

    const response = await this.#apiRequest({
      logTag,
      path: `/contacts/${ contactId }`,
      method: 'put',
      body: {
        contact: clean({
          first_name: firstName,
          last_name: lastName,
          email,
          mobile_number: mobileNumber,
          job_title: jobTitle,
          owner_id: ownerId ? Number(ownerId) : undefined,
          custom_field: customFields,
        }),
      },
    })

    return this.#unwrap(response, 'contact')
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Deletes a contact by its ID. The contact is moved to the recycle bin and can be restored from the Freshworks CRM UI.
   * @route DELETE /delete-contact
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"contactId":16000123456}
   */
  async deleteContact(contactId) {
    const logTag = '[deleteContact]'

    await this.#apiRequest({
      logTag,
      path: `/contacts/${ contactId }`,
      method: 'delete',
    })

    return { deleted: true, contactId }
  }

  /**
   * @operationName Upsert Contact
   * @category Contacts
   * @description Creates a contact, or updates the existing one if a contact with the same unique field (email by default) already exists. Provide the identifying field plus any values to set. The API wraps and returns the contact object, which is unwrapped in the result.
   * @route POST /upsert-contact
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address used to match an existing contact. If no contact matches, a new one is created with this email."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"First name to set on the contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Last name to set on the contact."}
   * @paramDef {"type":"String","label":"Mobile Number","name":"mobileNumber","description":"Mobile phone number to set on the contact."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"Job title / designation to set on the contact."}
   * @paramDef {"type":"Number","label":"Owner","name":"ownerId","dictionary":"getOwnersDictionary","description":"ID of the user who owns this contact. Select from your users or enter an ID."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom contact fields to set, e.g. {\"cf_region\":\"EMEA\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":16000123456,"first_name":"Jane","last_name":"Doe","display_name":"Jane Doe","email":"jane.doe@example.com","mobile_number":"+15550100","job_title":"CTO","owner_id":16000098765,"updated_at":"2026-07-13T13:00:00Z"}
   */
  async upsertContact(email, firstName, lastName, mobileNumber, jobTitle, ownerId, customFields) {
    const logTag = '[upsertContact]'

    const response = await this.#apiRequest({
      logTag,
      path: '/contacts/upsert',
      method: 'post',
      query: { unique_identifier: JSON.stringify({ email }) },
      body: {
        contact: clean({
          email,
          first_name: firstName,
          last_name: lastName,
          mobile_number: mobileNumber,
          job_title: jobTitle,
          owner_id: ownerId ? Number(ownerId) : undefined,
          custom_field: customFields,
        }),
      },
    })

    return this.#unwrap(response, 'contact')
  }

  /**
   * @operationName Search CRM
   * @category Contacts
   * @description Performs a free-text search across Freshworks CRM records and returns matching records of the selected entity types. Use it to quickly look up contacts, deals, or accounts by name, email, or other indexed fields. Returns up to 25 results.
   * @route GET /search
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Text to search for, e.g. a name, email address, or company name."}
   * @paramDef {"type":"Array<String>","label":"Entities","name":"entities","uiComponent":{"type":"DROPDOWN","options":{"values":["Contacts","Deals","Accounts","Leads"]}},"description":"Record types to search across. Defaults to Contacts when left empty."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":16000123456,"type":"contact","display_name":"Jane Doe","email":"jane.doe@example.com"}]
   */
  async searchCrm(query, entities) {
    const logTag = '[searchCrm]'

    const entityTokens = (entities && entities.length ? entities : ['Contacts'])
      .map(item => this.#resolveChoice(item, SEARCH_ENTITY_MAP))
      .filter(Boolean)
      .join(',')

    return await this.#apiRequest({
      logTag,
      path: '/search',
      method: 'get',
      query: {
        q: query,
        include: entityTokens,
      },
    })
  }

  // ==================== Accounts ====================

  /**
   * @operationName Create Account
   * @category Accounts
   * @description Creates a new sales account (company) in Freshworks CRM. Provide the account name and optional firmographic details. The API wraps and returns the sales account object, which is unwrapped in the result.
   * @route POST /create-account
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the sales account (company)."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"Website URL of the account, e.g. https://acme.com."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number of the account."}
   * @paramDef {"type":"String","label":"Industry Type","name":"industryType","description":"Industry the account operates in."}
   * @paramDef {"type":"Number","label":"Number of Employees","name":"numberOfEmployees","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Approximate number of employees at the account."}
   * @paramDef {"type":"Number","label":"Owner","name":"ownerId","dictionary":"getOwnersDictionary","description":"ID of the user who owns this account. Select from your users or enter an ID."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom account fields, e.g. {\"cf_tier\":\"Enterprise\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":16000200001,"name":"Acme Inc","website":"https://acme.com","phone":"+15550111","industry_type_id":null,"number_of_employees":250,"owner_id":16000098765,"created_at":"2026-07-13T10:00:00Z"}
   */
  async createAccount(name, website, phone, industryType, numberOfEmployees, ownerId, customFields) {
    const logTag = '[createAccount]'

    const response = await this.#apiRequest({
      logTag,
      path: '/sales_accounts',
      method: 'post',
      body: {
        sales_account: clean({
          name,
          website,
          phone,
          industry_type: industryType,
          number_of_employees: numberOfEmployees,
          owner_id: ownerId ? Number(ownerId) : undefined,
          custom_field: customFields,
        }),
      },
    })

    return this.#unwrap(response, 'sales_account')
  }

  /**
   * @operationName Get Account
   * @category Accounts
   * @description Retrieves a single sales account (company) by its ID, including name, website, firmographics, owner, and custom fields.
   * @route GET /get-account
   *
   * @paramDef {"type":"Number","label":"Account ID","name":"accountId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the sales account to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":16000200001,"name":"Acme Inc","website":"https://acme.com","phone":"+15550111","number_of_employees":250,"owner_id":16000098765,"created_at":"2026-07-13T10:00:00Z"}
   */
  async getAccount(accountId) {
    const logTag = '[getAccount]'

    const response = await this.#apiRequest({
      logTag,
      path: `/sales_accounts/${ accountId }`,
      method: 'get',
    })

    return this.#unwrap(response, 'sales_account')
  }

  /**
   * @operationName List Accounts
   * @category Accounts
   * @description Lists sales accounts (companies) belonging to a filtered view. Freshworks CRM organizes list access around views (filters), so a View ID is required — retrieve available view IDs from the Freshworks CRM UI or the account filters endpoint. Supports pagination.
   * @route GET /list-accounts
   *
   * @paramDef {"type":"Number","label":"View ID","name":"viewId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the account view (filter) to list from. Retrieve available view IDs from the Freshworks CRM UI or the account filters endpoint."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of accounts per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"sales_accounts":[{"id":16000200001,"name":"Acme Inc","website":"https://acme.com","owner_id":16000098765,"created_at":"2026-07-13T10:00:00Z"}],"meta":{"total_pages":1,"total":1}}
   */
  async listAccounts(viewId, page, perPage) {
    const logTag = '[listAccounts]'

    return await this.#apiRequest({
      logTag,
      path: `/sales_accounts/view/${ viewId }`,
      method: 'get',
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Update Account
   * @category Accounts
   * @description Updates an existing sales account (company). Only the provided fields are changed; all other fields keep their current values. The API wraps and returns the updated account object, which is unwrapped in the result.
   * @route PUT /update-account
   *
   * @paramDef {"type":"Number","label":"Account ID","name":"accountId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the sales account to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name of the account."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"New website URL of the account."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New primary phone number of the account."}
   * @paramDef {"type":"Number","label":"Number of Employees","name":"numberOfEmployees","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New approximate number of employees at the account."}
   * @paramDef {"type":"Number","label":"Owner","name":"ownerId","dictionary":"getOwnersDictionary","description":"ID of the user who owns this account. Select from your users or enter an ID."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom account fields to update."}
   *
   * @returns {Object}
   * @sampleResult {"id":16000200001,"name":"Acme Corporation","website":"https://acme.com","phone":"+15550111","number_of_employees":300,"owner_id":16000098765,"updated_at":"2026-07-13T13:00:00Z"}
   */
  async updateAccount(accountId, name, website, phone, numberOfEmployees, ownerId, customFields) {
    const logTag = '[updateAccount]'

    const response = await this.#apiRequest({
      logTag,
      path: `/sales_accounts/${ accountId }`,
      method: 'put',
      body: {
        sales_account: clean({
          name,
          website,
          phone,
          number_of_employees: numberOfEmployees,
          owner_id: ownerId ? Number(ownerId) : undefined,
          custom_field: customFields,
        }),
      },
    })

    return this.#unwrap(response, 'sales_account')
  }

  /**
   * @operationName Delete Account
   * @category Accounts
   * @description Deletes a sales account (company) by its ID. The account is moved to the recycle bin and can be restored from the Freshworks CRM UI.
   * @route DELETE /delete-account
   *
   * @paramDef {"type":"Number","label":"Account ID","name":"accountId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the sales account to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"accountId":16000200001}
   */
  async deleteAccount(accountId) {
    const logTag = '[deleteAccount]'

    await this.#apiRequest({
      logTag,
      path: `/sales_accounts/${ accountId }`,
      method: 'delete',
    })

    return { deleted: true, accountId }
  }

  // ==================== Deals ====================

  /**
   * @operationName Create Deal
   * @category Deals
   * @description Creates a new deal in Freshworks CRM. A deal name, amount, and the associated sales account are the core fields; the deal stage and pipeline can be selected from your account, and contacts can be attached. The API wraps and returns the deal object, which is unwrapped in the result.
   * @route POST /create-deal
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the deal."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Monetary value of the deal in the account's default currency."}
   * @paramDef {"type":"Number","label":"Account","name":"salesAccountId","dictionary":"getAccountsDictionary","description":"ID of the sales account (company) this deal belongs to. Select from your accounts or enter an ID."}
   * @paramDef {"type":"Number","label":"Deal Stage","name":"dealStageId","dictionary":"getDealStagesDictionary","description":"ID of the pipeline stage the deal is in. Select from your deal stages or enter an ID."}
   * @paramDef {"type":"Number","label":"Owner","name":"ownerId","dictionary":"getOwnersDictionary","description":"ID of the user who owns this deal. Select from your users or enter an ID."}
   * @paramDef {"type":"String","label":"Expected Close","name":"expectedClose","uiComponent":{"type":"DATE_PICKER"},"description":"Expected close date of the deal (ISO date, e.g. 2026-08-01)."}
   * @paramDef {"type":"Number","label":"Probability","name":"probability","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Win probability from 0 to 100."}
   * @paramDef {"type":"Array<String>","label":"Contact IDs","name":"contactIds","description":"IDs of contacts to associate with the deal."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom deal fields, e.g. {\"cf_source\":\"Referral\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":16000300001,"name":"Acme Renewal","amount":"25000.0","sales_account_id":16000200001,"deal_stage_id":16000004001,"owner_id":16000098765,"expected_close":"2026-08-01","probability":60,"created_at":"2026-07-13T10:00:00Z"}
   */
  async createDeal(name, amount, salesAccountId, dealStageId, ownerId, expectedClose, probability, contactIds, customFields) {
    const logTag = '[createDeal]'

    const response = await this.#apiRequest({
      logTag,
      path: '/deals',
      method: 'post',
      body: {
        deal: clean({
          name,
          amount,
          sales_account_id: salesAccountId ? Number(salesAccountId) : undefined,
          deal_stage_id: dealStageId ? Number(dealStageId) : undefined,
          owner_id: ownerId ? Number(ownerId) : undefined,
          expected_close: expectedClose,
          probability,
          contacts_added_list: contactIds && contactIds.length ? contactIds.map(id => Number(id)) : undefined,
          custom_field: customFields,
        }),
      },
    })

    return this.#unwrap(response, 'deal')
  }

  /**
   * @operationName Get Deal
   * @category Deals
   * @description Retrieves a single deal by its ID, including name, amount, stage, associated account and contacts, owner, and custom fields.
   * @route GET /get-deal
   *
   * @paramDef {"type":"Number","label":"Deal ID","name":"dealId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the deal to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":16000300001,"name":"Acme Renewal","amount":"25000.0","sales_account_id":16000200001,"deal_stage_id":16000004001,"owner_id":16000098765,"expected_close":"2026-08-01","created_at":"2026-07-13T10:00:00Z"}
   */
  async getDeal(dealId) {
    const logTag = '[getDeal]'

    const response = await this.#apiRequest({
      logTag,
      path: `/deals/${ dealId }`,
      method: 'get',
    })

    return this.#unwrap(response, 'deal')
  }

  /**
   * @operationName List Deals
   * @category Deals
   * @description Lists deals belonging to a filtered view (e.g. Open Deals, Won Deals, My Deals). Freshworks CRM organizes list access around views (filters), so a View ID is required — retrieve available view IDs from the deal filters. Supports pagination.
   * @route GET /list-deals
   *
   * @paramDef {"type":"Number","label":"View ID","name":"viewId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the deal view (filter) to list from, e.g. the ID for Open Deals or Won Deals. Retrieve available view IDs from the Freshworks CRM UI or the deal filters endpoint."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of deals per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"deals":[{"id":16000300001,"name":"Acme Renewal","amount":"25000.0","deal_stage_id":16000004001,"owner_id":16000098765,"expected_close":"2026-08-01"}],"meta":{"total_pages":1,"total":1}}
   */
  async listDeals(viewId, page, perPage) {
    const logTag = '[listDeals]'

    return await this.#apiRequest({
      logTag,
      path: `/deals/view/${ viewId }`,
      method: 'get',
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Update Deal
   * @category Deals
   * @description Updates an existing deal, for example to move it to a new stage or change its amount. Only the provided fields are changed; all other fields keep their current values. The API wraps and returns the updated deal object, which is unwrapped in the result.
   * @route PUT /update-deal
   *
   * @paramDef {"type":"Number","label":"Deal ID","name":"dealId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the deal to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name of the deal."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New monetary value of the deal."}
   * @paramDef {"type":"Number","label":"Deal Stage","name":"dealStageId","dictionary":"getDealStagesDictionary","description":"ID of the pipeline stage to move the deal to. Select from your deal stages or enter an ID."}
   * @paramDef {"type":"Number","label":"Owner","name":"ownerId","dictionary":"getOwnersDictionary","description":"ID of the user who owns this deal. Select from your users or enter an ID."}
   * @paramDef {"type":"String","label":"Expected Close","name":"expectedClose","uiComponent":{"type":"DATE_PICKER"},"description":"New expected close date (ISO date, e.g. 2026-08-01)."}
   * @paramDef {"type":"Number","label":"Probability","name":"probability","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New win probability from 0 to 100."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom deal fields to update."}
   *
   * @returns {Object}
   * @sampleResult {"id":16000300001,"name":"Acme Renewal","amount":"30000.0","deal_stage_id":16000004002,"owner_id":16000098765,"expected_close":"2026-09-01","probability":80,"updated_at":"2026-07-13T13:00:00Z"}
   */
  async updateDeal(dealId, name, amount, dealStageId, ownerId, expectedClose, probability, customFields) {
    const logTag = '[updateDeal]'

    const response = await this.#apiRequest({
      logTag,
      path: `/deals/${ dealId }`,
      method: 'put',
      body: {
        deal: clean({
          name,
          amount,
          deal_stage_id: dealStageId ? Number(dealStageId) : undefined,
          owner_id: ownerId ? Number(ownerId) : undefined,
          expected_close: expectedClose,
          probability,
          custom_field: customFields,
        }),
      },
    })

    return this.#unwrap(response, 'deal')
  }

  /**
   * @operationName Delete Deal
   * @category Deals
   * @description Deletes a deal by its ID. The deal is moved to the recycle bin and can be restored from the Freshworks CRM UI.
   * @route DELETE /delete-deal
   *
   * @paramDef {"type":"Number","label":"Deal ID","name":"dealId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the deal to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"dealId":16000300001}
   */
  async deleteDeal(dealId) {
    const logTag = '[deleteDeal]'

    await this.#apiRequest({
      logTag,
      path: `/deals/${ dealId }`,
      method: 'delete',
    })

    return { deleted: true, dealId }
  }

  // ==================== Activities ====================

  /**
   * @operationName Create Task
   * @category Activities
   * @description Creates a task linked to a contact, deal, or account. Provide a title, a due date, and the target record (type and ID). The due date is a Unix-independent ISO timestamp. The API wraps and returns the task object, which is unwrapped in the result.
   * @route POST /create-task
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the task."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Due date/time of the task (ISO 8601, e.g. 2026-08-01T17:00:00Z)."}
   * @paramDef {"type":"String","label":"Related To","name":"targetableType","required":true,"defaultValue":"Contact","uiComponent":{"type":"DROPDOWN","options":{"values":["Contact","Deal","Account"]}},"description":"Type of record the task is linked to."}
   * @paramDef {"type":"Number","label":"Related Record ID","name":"targetableId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact, deal, or account the task is linked to."}
   * @paramDef {"type":"Number","label":"Owner","name":"ownerId","dictionary":"getOwnersDictionary","description":"ID of the user assigned to the task. Select from your users or enter an ID."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Additional details about the task."}
   *
   * @returns {Object}
   * @sampleResult {"id":16000400001,"title":"Follow up call","description":"Discuss renewal terms","due_date":"2026-08-01T17:00:00Z","owner_id":16000098765,"targetable_type":"Contact","targetable_id":16000123456,"status":0,"created_at":"2026-07-13T10:00:00Z"}
   */
  async createTask(title, dueDate, targetableType, targetableId, ownerId, description) {
    const logTag = '[createTask]'

    const response = await this.#apiRequest({
      logTag,
      path: '/tasks',
      method: 'post',
      body: {
        task: clean({
          title,
          description,
          due_date: dueDate,
          owner_id: ownerId ? Number(ownerId) : undefined,
          targetable_type: this.#resolveChoice(targetableType, TARGETABLE_TYPE_MAP),
          targetable_id: targetableId ? Number(targetableId) : undefined,
        }),
      },
    })

    return this.#unwrap(response, 'task')
  }

  /**
   * @operationName List Tasks
   * @category Activities
   * @description Lists tasks filtered by status and scope. Status selects open, completed, overdue, or due-today tasks; the filter narrows to tasks owned by you or all users. Results are paginated.
   * @route GET /list-tasks
   *
   * @paramDef {"type":"String","label":"Status","name":"status","defaultValue":"Open","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Completed"]}},"description":"Whether to list open or completed tasks. Defaults to Open."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","defaultValue":"My Tasks","uiComponent":{"type":"DROPDOWN","options":{"values":["Open Tasks","My Tasks","Today's Tasks","Overdue Tasks","Completed Tasks"]}},"description":"Predefined task scope to list. Defaults to My Tasks."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"tasks":[{"id":16000400001,"title":"Follow up call","due_date":"2026-08-01T17:00:00Z","owner_id":16000098765,"targetable_type":"Contact","targetable_id":16000123456,"status":0}],"meta":{"total":1}}
   */
  async listTasks(status, filter, page) {
    const logTag = '[listTasks]'

    const statusMap = { 'Open': 'open', 'Completed': 'completed' }
    const filterMap = {
      'Open Tasks': 'open',
      'My Tasks': 'due_today',
      "Today's Tasks": 'due_today',
      'Overdue Tasks': 'overdue',
      'Completed Tasks': 'completed',
    }

    return await this.#apiRequest({
      logTag,
      path: '/tasks',
      method: 'get',
      query: {
        filter: this.#resolveChoice(status, statusMap) || this.#resolveChoice(filter, filterMap),
        page: page || 1,
      },
    })
  }

  /**
   * @operationName Create Appointment
   * @category Activities
   * @description Creates a calendar appointment in Freshworks CRM, optionally linked to a contact, deal, or account. Provide a title and the start and end times. The API wraps and returns the appointment object, which is unwrapped in the result.
   * @route POST /create-appointment
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the appointment."}
   * @paramDef {"type":"String","label":"From","name":"fromDate","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start date/time of the appointment (ISO 8601, e.g. 2026-08-01T15:00:00Z)."}
   * @paramDef {"type":"String","label":"To","name":"endDate","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End date/time of the appointment (ISO 8601, e.g. 2026-08-01T16:00:00Z)."}
   * @paramDef {"type":"String","label":"Location","name":"location","description":"Location of the appointment."}
   * @paramDef {"type":"String","label":"Related To","name":"targetableType","defaultValue":"Contact","uiComponent":{"type":"DROPDOWN","options":{"values":["Contact","Deal","Account"]}},"description":"Type of record the appointment is linked to."}
   * @paramDef {"type":"Number","label":"Related Record ID","name":"targetableId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact, deal, or account the appointment is linked to."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Additional details about the appointment."}
   *
   * @returns {Object}
   * @sampleResult {"id":16000500001,"title":"Renewal review","from_date":"2026-08-01T15:00:00Z","end_date":"2026-08-01T16:00:00Z","location":"Zoom","targetable_type":"Deal","targetable_id":16000300001,"created_at":"2026-07-13T10:00:00Z"}
   */
  async createAppointment(title, fromDate, endDate, location, targetableType, targetableId, description) {
    const logTag = '[createAppointment]'

    const response = await this.#apiRequest({
      logTag,
      path: '/appointments',
      method: 'post',
      body: {
        appointment: clean({
          title,
          from_date: fromDate,
          end_date: endDate,
          location,
          description,
          targetable_type: this.#resolveChoice(targetableType, TARGETABLE_TYPE_MAP),
          targetable_id: targetableId ? Number(targetableId) : undefined,
        }),
      },
    })

    return this.#unwrap(response, 'appointment')
  }

  /**
   * @operationName Create Note
   * @category Activities
   * @description Adds a note to a contact, deal, or account. Provide the note text and the target record (type and ID). The API wraps and returns the note object, which is unwrapped in the result.
   * @route POST /create-note
   *
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text content of the note."}
   * @paramDef {"type":"String","label":"Related To","name":"targetableType","required":true,"defaultValue":"Contact","uiComponent":{"type":"DROPDOWN","options":{"values":["Contact","Deal","Account"]}},"description":"Type of record the note is attached to."}
   * @paramDef {"type":"Number","label":"Related Record ID","name":"targetableId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact, deal, or account the note is attached to."}
   *
   * @returns {Object}
   * @sampleResult {"id":16000600001,"description":"Customer confirmed budget approval.","targetable_type":"Deal","targetable_id":16000300001,"user_id":16000098765,"created_at":"2026-07-13T10:00:00Z"}
   */
  async createNote(description, targetableType, targetableId) {
    const logTag = '[createNote]'

    const response = await this.#apiRequest({
      logTag,
      path: '/notes',
      method: 'post',
      body: {
        note: clean({
          description,
          targetable_type: this.#resolveChoice(targetableType, TARGETABLE_TYPE_MAP),
          targetable_id: targetableId ? Number(targetableId) : undefined,
        }),
      },
    })

    return this.#unwrap(response, 'note')
  }

  /**
   * @operationName List Sales Activities
   * @category Activities
   * @description Lists sales activities (logged calls, emails, status changes, and other tracked interactions) recorded in Freshworks CRM, with pagination. Use this to review the activity history in the account.
   * @route GET /list-sales-activities
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of activities per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"sales_activities":[{"id":16000700001,"title":"Outbound call","sales_activity_type_id":16000001,"targetable_type":"Contact","targetable_id":16000123456,"owner_id":16000098765,"created_at":"2026-07-13T10:00:00Z"}],"meta":{"total":1}}
   */
  async listSalesActivities(page, perPage) {
    const logTag = '[listSalesActivities]'

    return await this.#apiRequest({
      logTag,
      path: '/sales_activities',
      method: 'get',
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  // ==================== Dictionaries ====================

  /**
   * @typedef {Object} getOwnersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter users by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; owners are returned in a single call)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Owners Dictionary
   * @description Provides a searchable list of Freshworks CRM users for selecting a record owner or assignee. The option value is the user ID.
   * @route POST /get-owners-dictionary
   * @paramDef {"type":"getOwnersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Alex Rep","value":"16000098765","note":"alex@yourcompany.com"}],"cursor":null}
   */
  async getOwnersDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getOwnersDictionary]'

    const response = await this.#apiRequest({
      logTag,
      path: '/selector/owners',
      method: 'get',
    })

    const searchText = (search || '').toLowerCase()
    const users = response?.users || []

    const items = users
      .filter(user => {
        if (!searchText) {
          return true
        }

        const name = user.display_name || user.name || ''
        const userEmail = user.email || ''

        return name.toLowerCase().includes(searchText) || userEmail.toLowerCase().includes(searchText)
      })
      .map(user => ({
        label: user.display_name || user.name || String(user.id),
        value: String(user.id),
        note: user.email || undefined,
      }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getDealStagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter deal stages by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; stages are returned in a single call)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Deal Stages Dictionary
   * @description Provides a searchable list of deal stages configured across your pipelines for selecting a deal's stage. The option value is the deal stage ID.
   * @route POST /get-deal-stages-dictionary
   * @paramDef {"type":"getDealStagesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Qualification","value":"16000004001","note":null}],"cursor":null}
   */
  async getDealStagesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getDealStagesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      path: '/selector/deal_stages',
      method: 'get',
    })

    const searchText = (search || '').toLowerCase()
    const stages = response?.deal_stages || []

    const items = stages
      .filter(stage => !searchText || (stage.name || '').toLowerCase().includes(searchText))
      .map(stage => ({
        label: stage.name,
        value: String(stage.id),
        note: stage.deal_pipeline_id ? `Pipeline ${ stage.deal_pipeline_id }` : undefined,
      }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter sales accounts by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; the account lookup returns a single page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Accounts Dictionary
   * @description Provides a searchable list of sales accounts (companies) for selecting the account a contact or deal belongs to. The option value is the sales account ID.
   * @route POST /get-accounts-dictionary
   * @paramDef {"type":"getAccountsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Inc","value":"16000200001","note":"https://acme.com"}],"cursor":null}
   */
  async getAccountsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getAccountsDictionary]'

    // The search endpoint is the reliable way to look up accounts by name without a view ID.
    const response = await this.#apiRequest({
      logTag,
      path: '/search',
      method: 'get',
      query: {
        q: search || '*',
        include: 'sales_account',
      },
    })

    const accounts = Array.isArray(response) ? response : (response?.sales_accounts || [])

    const items = accounts
      .filter(account => account && (account.type === 'sales_account' || account.name))
      .map(account => ({
        label: account.name || account.display_name || String(account.id),
        value: String(account.id),
        note: account.website || undefined,
      }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getContactViewsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter contact views by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; views are returned in a single call)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contact Views Dictionary
   * @description Provides a searchable list of contact views (filters) such as "All Contacts" or "My Contacts" for use with List Contacts. The option value is the view ID.
   * @route POST /get-contact-views-dictionary
   * @paramDef {"type":"getContactViewsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"All Contacts","value":"16000001001","note":null}],"cursor":null}
   */
  async getContactViewsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getContactViewsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      path: '/contacts/filters',
      method: 'get',
    })

    const searchText = (search || '').toLowerCase()
    const filters = response?.filters || []

    const items = filters
      .filter(filter => !searchText || (filter.name || '').toLowerCase().includes(searchText))
      .map(filter => ({
        label: filter.name,
        value: String(filter.id),
        note: filter.model_class_name || undefined,
      }))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(FreshworksCrmService, [
  {
    name: 'domain',
    displayName: 'Domain',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Freshsales domain. For yourcompany.myfreshworks.com enter "yourcompany" (or your full bundle alias).',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Freshsales API key. Find it in Freshsales under Profile Settings → API Settings → Your API Key.',
  },
])
