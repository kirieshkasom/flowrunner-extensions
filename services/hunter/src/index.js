const logger = {
  info: (...args) => console.log('[Hunter.io] info:', ...args),
  debug: (...args) => console.log('[Hunter.io] debug:', ...args),
  error: (...args) => console.log('[Hunter.io] error:', ...args),
  warn: (...args) => console.log('[Hunter.io] warn:', ...args),
}

const API_BASE_URL = 'https://api.hunter.io/v2'

const DEFAULT_DICTIONARY_LIMIT = 100

const DEPARTMENT_MAP = {
  Executive: 'executive',
  IT: 'it',
  Finance: 'finance',
  Management: 'management',
  Sales: 'sales',
  Legal: 'legal',
  Support: 'support',
  HR: 'hr',
  Marketing: 'marketing',
  Communication: 'communication',
  Education: 'education',
  Design: 'design',
  Health: 'health',
  Operations: 'operations',
}

const SENIORITY_MAP = {
  Junior: 'junior',
  Senior: 'senior',
  Executive: 'executive',
}

const EMAIL_TYPE_MAP = {
  Personal: 'personal',
  Generic: 'generic',
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
 * @integrationName Hunter.io
 * @integrationIcon /icon.png
 */
class HunterService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Maps a friendly dropdown label to its API value; passes through unknown values unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper. Appends the api_key query parameter to every call
  // (Hunter uses query-parameter authentication, not an Authorization header).
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean({ ...(query || {}), api_key: this.apiKey })

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Content-Type': 'application/json' })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(clean(body)) : await request
    } catch (error) {
      const apiError = error.body?.errors?.[0]
      const message = apiError?.details || apiError?.code || error.body?.message || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Hunter.io API error: ${ message }`)
    }
  }

  /**
   * @operationName Domain Search
   * @category Email Discovery
   * @description Finds every email address publicly associated with a domain or company. Returns the detected email pattern (e.g. {first}.{last}@domain), the organization name, and a list of emails, each with a confidence score, type (personal/generic), owner name, position, seniority, department, and the web sources where it was found. Use the type, seniority, and department filters to narrow results, and limit/offset to paginate. Provide either a domain or a company name.
   * @route GET /domain-search
   * @appearanceColor #FF7139 #FFA173
   *
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"Domain to search, e.g. stripe.com. Provide either Domain or Company."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Company name to search, e.g. Stripe. Used when Domain is not provided."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of emails to return (1-100). Defaults to 10."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of emails to skip for pagination. Defaults to 0."}
   * @paramDef {"type":"String","label":"Email Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Personal","Generic"]}},"description":"Filter by email type. Personal emails belong to a person; Generic emails are role addresses like contact@ or support@."}
   * @paramDef {"type":"String","label":"Seniority","name":"seniority","uiComponent":{"type":"DROPDOWN","options":{"values":["Junior","Senior","Executive"]}},"description":"Filter results by the seniority level of the email owner."}
   * @paramDef {"type":"String","label":"Department","name":"department","uiComponent":{"type":"DROPDOWN","options":{"values":["Executive","IT","Finance","Management","Sales","Legal","Support","HR","Marketing","Communication","Education","Design","Health","Operations"]}},"description":"Filter results by the department of the email owner."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"domain":"stripe.com","organization":"Stripe","pattern":"{first}","emails":[{"value":"patrick@stripe.com","type":"personal","confidence":94,"first_name":"Patrick","last_name":"Collison","position":"CEO","seniority":"executive","department":"executive","sources":[{"domain":"stripe.com","uri":"https://stripe.com/about","last_seen_on":"2023-05-01"}],"verification":{"date":null,"status":null}}]},"meta":{"results":1,"limit":10,"offset":0,"params":{"domain":"stripe.com"}}}
   */
  async domainSearch(domain, company, limit, offset, type, seniority, department) {
    const logTag = '[domainSearch]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/domain-search`,
      method: 'get',
      query: {
        domain,
        company,
        limit,
        offset,
        type: this.#resolveChoice(type, EMAIL_TYPE_MAP),
        seniority: this.#resolveChoice(seniority, SENIORITY_MAP),
        department: this.#resolveChoice(department, DEPARTMENT_MAP),
      },
    })
  }

  /**
   * @operationName Email Finder
   * @category Email Discovery
   * @description Finds the most likely email address for a specific person at a company. Provide the person's first and last name plus a domain or company name; Hunter returns the single best-guess email with a confidence score, the person's position, and the web sources supporting the guess. Ideal for locating one known individual's address rather than listing a whole domain.
   * @route GET /email-finder
   * @appearanceColor #FF7139 #FFA173
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"First name of the person, e.g. Patrick."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Last name of the person, e.g. Collison."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"Company domain, e.g. stripe.com. Provide either Domain or Company."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Company name, e.g. Stripe. Used when Domain is not provided."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"first_name":"Patrick","last_name":"Collison","email":"patrick@stripe.com","score":97,"domain":"stripe.com","company":"Stripe","position":"CEO","sources":[{"domain":"stripe.com","uri":"https://stripe.com/about","last_seen_on":"2023-05-01"}],"verification":{"date":null,"status":null}},"meta":{"params":{"first_name":"Patrick","last_name":"Collison","domain":"stripe.com"}}}
   */
  async emailFinder(firstName, lastName, domain, company) {
    const logTag = '[emailFinder]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/email-finder`,
      method: 'get',
      query: {
        first_name: firstName,
        last_name: lastName,
        domain,
        company,
      },
    })
  }

  /**
   * @operationName Email Verifier
   * @category Email Verification
   * @description Verifies the deliverability of a single email address. Returns an overall status (valid, invalid, accept_all, webmail, disposable, or unknown), a numeric confidence score, and the individual checks performed: format/regexp validity, gibberish detection, disposable and webmail flags, MX record presence, SMTP server reachability, SMTP mailbox check, and accept-all/block indicators. Use before sending to reduce bounces.
   * @route GET /email-verifier
   * @appearanceColor #FF7139 #FFA173
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address to verify, e.g. patrick@stripe.com."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"status":"valid","result":"deliverable","score":95,"email":"patrick@stripe.com","regexp":true,"gibberish":false,"disposable":false,"webmail":false,"mx_records":true,"smtp_server":true,"smtp_check":true,"accept_all":false,"block":false,"sources":[]},"meta":{"params":{"email":"patrick@stripe.com"}}}
   */
  async emailVerifier(email) {
    const logTag = '[emailVerifier]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/email-verifier`,
      method: 'get',
      query: { email },
    })
  }

  /**
   * @operationName Email Count
   * @category Email Discovery
   * @description Returns how many email addresses Hunter knows for a given domain or company without consuming search credits. Provides the total count, the split between personal and generic emails, and breakdowns by department and seniority. Useful as a lightweight check of how much coverage a domain has before running a full Domain Search.
   * @route GET /email-count
   * @appearanceColor #FF7139 #FFA173
   *
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"Domain to count emails for, e.g. stripe.com. Provide either Domain or Company."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Company name to count emails for. Used when Domain is not provided."}
   * @paramDef {"type":"String","label":"Email Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Personal","Generic"]}},"description":"Restrict the count to a single email type. Leave empty to count all emails."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"total":351,"personal_emails":328,"generic_emails":23,"department":{"executive":12,"it":45,"finance":8,"management":20,"sales":30,"legal":3,"support":15,"hr":6,"marketing":18,"communication":5,"education":1,"design":10,"health":0,"operations":9},"seniority":{"junior":120,"senior":150,"executive":81}},"meta":{"params":{"domain":"stripe.com"}}}
   */
  async emailCount(domain, company, type) {
    const logTag = '[emailCount]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/email-count`,
      method: 'get',
      query: {
        domain,
        company,
        type: this.#resolveChoice(type, EMAIL_TYPE_MAP),
      },
    })
  }

  /**
   * @operationName Combined Enrichment
   * @category Enrichment
   * @description Enriches an email address with both person and company data in a single call. Returns a person profile (full name, location, employment title and seniority, social handles) alongside the company profile of their employer (name, domain, industry/sector, location, founded year, employee count). Combines Hunter's Person and Company enrichment for a complete picture of a contact.
   * @route GET /combined/find
   * @appearanceColor #FF7139 #FFA173
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address to enrich, e.g. patrick@stripe.com."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"person":{"id":"abc123","name":{"fullName":"Patrick Collison","givenName":"Patrick","familyName":"Collison"},"email":"patrick@stripe.com","location":"San Francisco, CA","employment":{"domain":"stripe.com","name":"Stripe","title":"CEO","seniority":"executive"},"twitter":{"handle":"patrickc"},"linkedin":{"handle":"patrickcollison"}},"company":{"id":"xyz789","name":"Stripe","domain":"stripe.com","category":{"sector":"Information Technology","industry":"Software"},"location":"San Francisco, CA","foundedYear":2010,"metrics":{"employees":"5000+"}}},"meta":{"email":"patrick@stripe.com"}}
   */
  async combinedEnrichment(email) {
    const logTag = '[combinedEnrichment]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/combined/find`,
      method: 'get',
      query: { email },
    })
  }

  /**
   * @operationName Get Account
   * @category Account
   * @description Returns details about the authenticated Hunter account, including the owner name, plan, team information, and API usage. Use it as a connection check and to monitor how many search, verification, and enrichment requests have been used versus what remains for the current billing period.
   * @route GET /account
   * @appearanceColor #FF7139 #FFA173
   *
   * @returns {Object}
   * @sampleResult {"data":{"first_name":"Jane","last_name":"Doe","email":"jane@example.com","plan_name":"Starter","plan_level":1,"reset_date":"2026-08-01","team_id":123,"calls":{"used":420,"available":5000}}}
   */
  async getAccount() {
    const logTag = '[getAccount]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/account`,
      method: 'get',
    })
  }

  /**
   * @operationName List Leads
   * @category Leads
   * @description Lists leads saved in the Hunter account, most recent first. Supports pagination via limit and offset, filtering to a specific leads list, and filtering by lead fields such as email, first name, last name, and company. Returns each lead's id, contact details, position, company, website, and source, along with pagination metadata.
   * @route GET /leads
   * @appearanceColor #FF7139 #FFA173
   *
   * @paramDef {"type":"String","label":"Leads List","name":"leadListId","dictionary":"getLeadsListsDictionary","description":"Restrict results to a single leads list. Select a list or leave empty for all leads."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of leads to return (1-1000). Defaults to 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of leads to skip for pagination. Defaults to 0."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Filter leads by exact email address."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Filter leads by first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Filter leads by last name."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Filter leads by company name."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"leads":[{"id":1,"email":"patrick@stripe.com","first_name":"Patrick","last_name":"Collison","position":"CEO","company":"Stripe","website":"stripe.com","country_code":"US","source":"api","linkedin_url":null,"phone_number":null}]},"meta":{"count":1,"total":1,"params":{"limit":20,"offset":0}}}
   */
  async listLeads(leadListId, limit, offset, email, firstName, lastName, company) {
    const logTag = '[listLeads]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/leads`,
      method: 'get',
      query: {
        lead_list_id: leadListId,
        limit,
        offset,
        email,
        first_name: firstName,
        last_name: lastName,
        company,
      },
    })
  }

  /**
   * @operationName Create Lead
   * @category Leads
   * @description Creates a new lead in the Hunter account. Only the email is strictly required, but you can attach the person's name, position, company, website, phone number, social profiles, a source label, free-form notes, and assign the lead to a specific leads list. Returns the created lead including its generated id.
   * @route POST /leads
   * @appearanceColor #FF7139 #FFA173
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the lead, e.g. patrick@stripe.com."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"First name of the lead."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Last name of the lead."}
   * @paramDef {"type":"String","label":"Position","name":"position","description":"Job title or position of the lead."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Company the lead works for."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"Company website or domain for the lead."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"Phone number of the lead."}
   * @paramDef {"type":"String","label":"LinkedIn URL","name":"linkedinUrl","description":"URL of the lead's LinkedIn profile."}
   * @paramDef {"type":"String","label":"Twitter","name":"twitter","description":"Twitter/X handle of the lead."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"A label describing where this lead came from, e.g. Website or Conference."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form notes to attach to the lead."}
   * @paramDef {"type":"String","label":"Leads List","name":"leadListId","dictionary":"getLeadsListsDictionary","description":"Leads list to add this lead to. Select a list or leave empty to use the default list."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":42,"email":"patrick@stripe.com","first_name":"Patrick","last_name":"Collison","position":"CEO","company":"Stripe","website":"stripe.com","source":"Website","leads_list_id":7}}
   */
  async createLead(email, firstName, lastName, position, company, website, phoneNumber, linkedinUrl, twitter, source, notes, leadListId) {
    const logTag = '[createLead]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/leads`,
      method: 'post',
      body: {
        email,
        first_name: firstName,
        last_name: lastName,
        position,
        company,
        website,
        phone_number: phoneNumber,
        linkedin_url: linkedinUrl,
        twitter,
        source,
        notes,
        lead_list_id: leadListId,
      },
    })
  }

  /**
   * @operationName Get Lead
   * @category Leads
   * @description Retrieves a single lead by its numeric id, returning the full lead record including contact details, position, company, website, social profiles, source, notes, and the leads list it belongs to.
   * @route GET /leads/get
   * @appearanceColor #FF7139 #FFA173
   *
   * @paramDef {"type":"Number","label":"Lead ID","name":"leadId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the lead to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":42,"email":"patrick@stripe.com","first_name":"Patrick","last_name":"Collison","position":"CEO","company":"Stripe","website":"stripe.com","source":"Website","notes":"Met at conference","leads_list_id":7}}
   */
  async getLead(leadId) {
    const logTag = '[getLead]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/leads/${ leadId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Lead
   * @category Leads
   * @description Updates an existing lead identified by its numeric id. Only the fields you provide are changed; leave a field empty to keep its current value. Editable fields include name, position, company, website, phone number, social profiles, source, and notes.
   * @route PUT /leads/update
   * @appearanceColor #FF7139 #FFA173
   *
   * @paramDef {"type":"Number","label":"Lead ID","name":"leadId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the lead to update."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address for the lead."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name for the lead."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name for the lead."}
   * @paramDef {"type":"String","label":"Position","name":"position","description":"New job title or position for the lead."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"New company for the lead."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"New company website or domain for the lead."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"New phone number for the lead."}
   * @paramDef {"type":"String","label":"LinkedIn URL","name":"linkedinUrl","description":"New LinkedIn profile URL for the lead."}
   * @paramDef {"type":"String","label":"Twitter","name":"twitter","description":"New Twitter/X handle for the lead."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"New source label for the lead."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New free-form notes for the lead."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":42,"email":"patrick@stripe.com","first_name":"Patrick","last_name":"Collison","position":"Co-founder","company":"Stripe"}}
   */
  async updateLead(leadId, email, firstName, lastName, position, company, website, phoneNumber, linkedinUrl, twitter, source, notes) {
    const logTag = '[updateLead]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/leads/${ leadId }`,
      method: 'put',
      body: {
        email,
        first_name: firstName,
        last_name: lastName,
        position,
        company,
        website,
        phone_number: phoneNumber,
        linkedin_url: linkedinUrl,
        twitter,
        source,
        notes,
      },
    })
  }

  /**
   * @operationName Delete Lead
   * @category Leads
   * @description Permanently deletes a lead from the Hunter account by its numeric id. This action cannot be undone. Returns a simple confirmation object on success.
   * @route DELETE /leads/delete
   * @appearanceColor #FF7139 #FFA173
   *
   * @paramDef {"type":"Number","label":"Lead ID","name":"leadId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the lead to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"leadId":42}
   */
  async deleteLead(leadId) {
    const logTag = '[deleteLead]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/leads/${ leadId }`,
      method: 'delete',
    })

    return { deleted: true, leadId }
  }

  /**
   * @operationName List Leads Lists
   * @category Leads
   * @description Lists all leads lists in the Hunter account. Each leads list groups related leads together; the response includes each list's id, name, and the number of leads it contains, plus pagination metadata.
   * @route GET /leads_lists
   * @appearanceColor #FF7139 #FFA173
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of leads lists to return. Defaults to 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of leads lists to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"leads_lists":[{"id":7,"name":"Prospects","leads_count":42}]},"meta":{"count":1,"total":1,"params":{"limit":20,"offset":0}}}
   */
  async listLeadsLists(limit, offset) {
    const logTag = '[listLeadsLists]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/leads_lists`,
      method: 'get',
      query: { limit, offset },
    })
  }

  /**
   * @operationName Create Leads List
   * @category Leads
   * @description Creates a new leads list in the Hunter account to group related leads. Provide a name; the response returns the new list's id and name. Use the returned id when creating leads to assign them to this list.
   * @route POST /leads_lists
   * @appearanceColor #FF7139 #FFA173
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name for the new leads list, e.g. Q3 Prospects."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":8,"name":"Q3 Prospects","leads_count":0}}
   */
  async createLeadsList(name) {
    const logTag = '[createLeadsList]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/leads_lists`,
      method: 'post',
      body: { name },
    })
  }

  /**
   * @typedef {Object} getLeadsListsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter leads lists by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Leads Lists Dictionary
   * @description Provides a selectable list of the account's leads lists for parameters that target a specific list, such as when creating or filtering leads. Each option's value is the numeric leads list id. Supports name filtering and offset-based pagination.
   * @route POST /leads-lists-dictionary
   * @paramDef {"type":"getLeadsListsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing leads lists."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Prospects","value":"7","note":"42 leads"}],"cursor":null}
   */
  async getLeadsListsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getLeadsListsDictionary]'

    const offset = cursor ? parseInt(cursor, 10) || 0 : 0

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/leads_lists`,
      method: 'get',
      query: {
        limit: DEFAULT_DICTIONARY_LIMIT,
        offset,
      },
    })

    const lists = response.data?.leads_lists || []

    const search_lower = (search || '').toLowerCase()

    const filtered = search_lower
      ? lists.filter(list => (list.name || '').toLowerCase().includes(search_lower))
      : lists

    const nextOffset = offset + DEFAULT_DICTIONARY_LIMIT
    const hasMore = lists.length === DEFAULT_DICTIONARY_LIMIT

    return {
      items: filtered.map(list => ({
        label: list.name,
        value: String(list.id),
        note: list.leads_count !== undefined ? `${ list.leads_count } leads` : undefined,
      })),
      cursor: hasMore ? String(nextOffset) : null,
    }
  }
}

Flowrunner.ServerCode.addService(HunterService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Hunter API key. Find it in Hunter → Dashboard → API → your API key.',
  },
])
