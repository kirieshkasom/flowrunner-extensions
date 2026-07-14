// ============================================================================
//  SPEC: Affinity (relationship intelligence CRM)   auth: api-key (HTTP Basic)
//  Authentication: HTTP Basic with EMPTY username and the API key as the
//  password → base64(':' + apiKey).
//  RESOURCES:
//    - List         GET /lists, GET /lists/{id} (with fields), list-entries paging
//    - ListEntry    create (entity_id), delete
//    - Person       list/search (term), get (with_interaction_dates), create/update/delete
//    - Organization list/search (term/domain), get, create/update/delete
//    - Opportunity  list, get, create (name/list_id), update, delete
//    - Field        list (list_id filter) + dictionary
//    - FieldValue   list (by entity), create, update, delete
//    - Note         list, create
//    - Interaction  list (optional)
//    - WhoAmI       GET /auth/whoami (connection check + tier/limits)
//  TRIGGERS: REALTIME (SINGLE_APP) — onAffinityEvent (webhook subscription).
//    Affinity v1 webhooks: POST /webhook/subscribe {webhook_url, subscriptions[]},
//    DELETE /webhook/{id}. Max 3 subscriptions/instance. No documented request
//    signing secret, so no signature-verification step is performed (matches the
//    documented Affinity v1 webhook behavior). Payload shape: {type, sent_at, body}.
// ============================================================================

// ============================================================================
//  CONSTANTS
// ============================================================================
const API_BASE_URL = 'https://api.affinity.co'

// Maps the friendly "Entity Type" dropdown label to the Affinity numeric code
// (used when filtering GET /fields — see the Affinity entity_type enum).
const ENTITY_TYPE_LABEL_TO_VALUE = {
  Person: 0,
  Organization: 1,
  Opportunity: 8,
}

// Maps friendly list-type codes back to labels for dictionary notes.
const LIST_TYPE_VALUE_TO_LABEL = {
  0: 'Person',
  1: 'Organization',
  8: 'Opportunity',
}

// Maps the friendly "Value Type" dropdown label to the Affinity numeric code
// (used only when filtering GET /fields — see the Affinity value_type enum).
const VALUE_TYPE_LABEL_TO_VALUE = {
  'Person': 0,
  'Organization': 1,
  'Text or Dropdown': 2,
  'Number': 3,
  'Date': 4,
  'Location': 5,
  'Text (long)': 6,
  'Ranked Dropdown': 7,
}

// The trigger's Event dropdown offers Affinity webhook subscription event strings
// (e.g. person.created, list_entry.deleted). Affinity emits each as the payload
// "type"; label === value so no mapping table is needed — the raw event string is
// both shown in the dropdown and submitted to /webhook/subscribe.

const CALL_TYPES = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Affinity] info:', ...args),
  debug: (...args) => console.log('[Affinity] debug:', ...args),
  error: (...args) => console.log('[Affinity] error:', ...args),
  warn: (...args) => console.log('[Affinity] warn:', ...args),
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
 * @typedef {Object} getFieldsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"List","name":"listId","description":"The list whose fields populate the dropdown. Leave blank for global (list-independent) fields."}
 */

/**
 * @typedef {Object} getFieldsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter fields by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getFieldsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The list whose fields to list."}
 */

/**
 * @integrationName Affinity
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class AffinityService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Affinity uses HTTP Basic with an EMPTY username and the API key as the
  // password, i.e. the header value is base64(':' + apiKey).
  #authHeader() {
    const token = Buffer.from(`:${ this.apiKey }`).toString('base64')

    return `Basic ${ token }`
  }

  // Single private request helper — every external call goes through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': this.#authHeader(), 'Content-Type': 'application/json' })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.message || error.message
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`Affinity API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  // Maps a friendly dropdown label to its API value, passing through unknowns.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Splits a comma-or-newline separated string, or passes an array through,
  // into a clean array of trimmed non-empty tokens (used for id/email lists).
  #toArray(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    if (Array.isArray(value)) {
      return value.map(v => String(v).trim()).filter(Boolean)
    }

    return String(value).split(/[\s,]+/).map(v => v.trim()).filter(Boolean)
  }

  // ==========================================================================
  //  SYSTEM / CONNECTION
  // ==========================================================================
  /**
   * @operationName Get Current User
   * @category Account
   * @description Returns the authenticated user and tenant behind the API key by calling Affinity's whoami endpoint. Use this to validate the API key connection and to read the account's plan tier and API rate-limit allowances. Returns the user (id, email, name), the tenant, and the granted API scopes.
   * @route GET /whoami
   * @returns {Object}
   * @sampleResult {"tenant":{"id":123,"name":"Acme Capital","subdomain":"acme"},"user":{"id":456,"firstName":"Jane","lastName":"Doe","emailAddress":"jane@acme.com"},"grant":{"type":"api-key","scopes":["api"]}}
   */
  async getCurrentUser() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/auth/whoami`,
      logTag: 'getCurrentUser',
    })
  }

  // ==========================================================================
  //  LISTS
  // ==========================================================================
  /**
   * @operationName Get Lists
   * @category Lists
   * @description Retrieves all Lists visible to the API key's user, including saved views for people, organizations, and opportunities. Each list includes its id, name, type, public flag, and size. Use this to discover which lists exist before reading or writing their entries.
   * @route GET /lists
   * @returns {Array<Object>}
   * @sampleResult [{"id":123,"type":8,"name":"Deal Flow","public":true,"owner_id":456,"list_size":42}]
   */
  async getLists() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/lists`,
      logTag: 'getLists',
    })
  }

  /**
   * @operationName Get List
   * @category Lists
   * @description Retrieves a single List by id, including the full definition of its fields (columns). The fields array describes each custom field's id, name, value_type, and whether it allows multiple values — essential for reading and writing field values on that list's entries.
   * @route GET /lists/{listId}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":123,"type":8,"name":"Deal Flow","public":true,"owner_id":456,"list_size":42,"fields":[{"id":789,"name":"Status","value_type":7,"allows_multiple":false,"list_id":123}]}
   */
  async getList(listId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/lists/${ listId }`,
      logTag: 'getList',
    })
  }

  /**
   * @operationName Get List Entries
   * @category Lists
   * @description Retrieves the entries (rows) of a List, one per person, organization, or opportunity on it. Results are paginated: pass a page size and, to continue, the page_token returned by the previous call. Each entry includes its id, the entity id and type, and the underlying entity object.
   * @route GET /lists/{listId}/list-entries
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list whose entries to retrieve."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of entries to return per page (Affinity default when omitted)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's next_page_token; omit for the first page."}
   * @returns {Object}
   * @sampleResult {"list_entries":[{"id":1001,"list_id":123,"creator_id":456,"entity_id":2002,"entity_type":0,"created_at":"2024-01-15T09:30:00.000Z","entity":{"id":2002,"first_name":"Jane","last_name":"Doe","primary_email":"jane@acme.com"}}],"next_page_token":"eyJvIjoxfQ"}
   */
  async getListEntries(listId, pageSize, pageToken) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/lists/${ listId }/list-entries`,
      query: { page_size: pageSize, page_token: pageToken },
      logTag: 'getListEntries',
    })
  }

  /**
   * @operationName Create List Entry
   * @category Lists
   * @description Adds an existing person, organization, or opportunity to a List by its entity id, creating a new list entry (row). The list's type must match the entity being added. Optionally attribute the addition to a specific creator. Returns the created list entry.
   * @route POST /lists/{listId}/list-entries
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list to add the entity to."}
   * @paramDef {"type":"String","label":"Entity ID","name":"entityId","required":true,"description":"The id of the person, organization, or opportunity to add to the list."}
   * @paramDef {"type":"String","label":"Creator ID","name":"creatorId","description":"Optional Affinity user id to attribute this addition to; defaults to the API key's user."}
   * @returns {Object}
   * @sampleResult {"id":1001,"list_id":123,"creator_id":456,"entity_id":2002,"entity_type":0,"created_at":"2024-01-15T09:30:00.000Z"}
   */
  async createListEntry(listId, entityId, creatorId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/lists/${ listId }/list-entries`,
      method: 'post',
      body: { entity_id: Number(entityId), creator_id: creatorId ? Number(creatorId) : undefined },
      logTag: 'createListEntry',
    })
  }

  /**
   * @operationName Delete List Entry
   * @category Lists
   * @description Removes an entry (row) from a List by the list id and list entry id. This detaches the person, organization, or opportunity from the list; it does not delete the underlying entity. Returns a success flag.
   * @route DELETE /lists/{listId}/list-entries/{listEntryId}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list the entry belongs to."}
   * @paramDef {"type":"String","label":"List Entry ID","name":"listEntryId","required":true,"description":"The id of the list entry (row) to remove."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteListEntry(listId, listEntryId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/lists/${ listId }/list-entries/${ listEntryId }`,
      method: 'delete',
      logTag: 'deleteListEntry',
    })
  }

  // ==========================================================================
  //  PERSONS
  // ==========================================================================
  /**
   * @operationName Get Persons
   * @category Persons
   * @description Retrieves people from Affinity, optionally filtered by a free-text search term matching name or email. Results are paginated via page size and page token, and can optionally include each person's first/last interaction dates and opportunity ids. Returns the person list plus the next page token.
   * @route GET /persons
   * @paramDef {"type":"String","label":"Search Term","name":"term","description":"Optional text to match against person names and email addresses."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of people to return per page."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's next_page_token; omit for the first page."}
   * @paramDef {"type":"Boolean","label":"With Interaction Dates","name":"withInteractionDates","uiComponent":{"type":"TOGGLE"},"description":"When true, include first/last email and meeting interaction dates for each person."}
   * @returns {Object}
   * @sampleResult {"persons":[{"id":2002,"type":0,"first_name":"Jane","last_name":"Doe","primary_email":"jane@acme.com","emails":["jane@acme.com"],"organization_ids":[3003]}],"next_page_token":"eyJvIjoxfQ"}
   */
  async getPersons(term, pageSize, pageToken, withInteractionDates) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/persons`,
      query: {
        term,
        page_size: pageSize,
        page_token: pageToken,
        with_interaction_dates: withInteractionDates ? true : undefined,
      },
      logTag: 'getPersons',
    })
  }

  /**
   * @operationName Search Persons
   * @category Persons
   * @description Searches Affinity people by a free-text term matching name or email address and returns matching person records. This is a focused wrapper over the persons endpoint for lookups; use Get Persons when you also need pagination controls or interaction dates.
   * @route GET /persons/search
   * @paramDef {"type":"String","label":"Search Term","name":"term","required":true,"description":"Text to match against person names and email addresses."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of people to return per page."}
   * @returns {Object}
   * @sampleResult {"persons":[{"id":2002,"type":0,"first_name":"Jane","last_name":"Doe","primary_email":"jane@acme.com","emails":["jane@acme.com"]}],"next_page_token":null}
   */
  async searchPersons(term, pageSize) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/persons`,
      query: { term, page_size: pageSize },
      logTag: 'searchPersons',
    })
  }

  /**
   * @operationName Get Person
   * @category Persons
   * @description Retrieves a single person by id, including their emails, associated organization ids, and list entries. Optionally include interaction dates (first/last email and meeting) and the person's opportunity ids. Returns the full person record.
   * @route GET /persons/{personId}
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The id of the person to retrieve."}
   * @paramDef {"type":"Boolean","label":"With Interaction Dates","name":"withInteractionDates","uiComponent":{"type":"TOGGLE"},"description":"When true, include first/last email and meeting interaction dates."}
   * @returns {Object}
   * @sampleResult {"id":2002,"type":0,"first_name":"Jane","last_name":"Doe","primary_email":"jane@acme.com","emails":["jane@acme.com"],"organization_ids":[3003],"list_entries":[{"id":1001,"list_id":123}]}
   */
  async getPerson(personId, withInteractionDates) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ personId }`,
      query: { with_interaction_dates: withInteractionDates ? true : undefined },
      logTag: 'getPerson',
    })
  }

  /**
   * @operationName Create Person
   * @category Persons
   * @description Creates a new person in Affinity with a first name, last name, and one or more email addresses, optionally linking them to existing organizations. Emails may be provided as a comma/newline separated list or an array. Returns the created person record including its new id.
   * @route POST /persons
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"The person's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"The person's last name."}
   * @paramDef {"type":"Array<String>","label":"Emails","name":"emails","required":true,"description":"One or more email addresses for the person."}
   * @paramDef {"type":"Array<String>","label":"Organization IDs","name":"organizationIds","description":"Optional ids of existing organizations to associate the person with."}
   * @returns {Object}
   * @sampleResult {"id":2002,"type":0,"first_name":"Jane","last_name":"Doe","primary_email":"jane@acme.com","emails":["jane@acme.com"],"organization_ids":[3003]}
   */
  async createPerson(firstName, lastName, emails, organizationIds) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/persons`,
      method: 'post',
      body: {
        first_name: firstName,
        last_name: lastName,
        emails: this.#toArray(emails),
        organization_ids: this.#toArray(organizationIds)?.map(Number),
      },
      logTag: 'createPerson',
    })
  }

  /**
   * @operationName Update Person
   * @category Persons
   * @description Updates an existing person by id. Any provided field (first name, last name, emails, or organization associations) replaces the current value; omitted fields are left unchanged. Note that Affinity replaces the full emails and organization_ids arrays when supplied. Returns the updated person record.
   * @route PUT /persons/{personId}
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The id of the person to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name for the person."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name for the person."}
   * @paramDef {"type":"Array<String>","label":"Emails","name":"emails","description":"Replacement list of email addresses for the person."}
   * @paramDef {"type":"Array<String>","label":"Organization IDs","name":"organizationIds","description":"Replacement list of associated organization ids."}
   * @returns {Object}
   * @sampleResult {"id":2002,"type":0,"first_name":"Jane","last_name":"Smith","primary_email":"jane@acme.com","emails":["jane@acme.com"],"organization_ids":[3003]}
   */
  async updatePerson(personId, firstName, lastName, emails, organizationIds) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ personId }`,
      method: 'put',
      body: {
        first_name: firstName,
        last_name: lastName,
        emails: this.#toArray(emails),
        organization_ids: this.#toArray(organizationIds)?.map(Number),
      },
      logTag: 'updatePerson',
    })
  }

  /**
   * @operationName Delete Person
   * @category Persons
   * @description Permanently deletes a person from Affinity by id. This removes the person and their list entries; it cannot be undone. Returns a success flag.
   * @route DELETE /persons/{personId}
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The id of the person to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deletePerson(personId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ personId }`,
      method: 'delete',
      logTag: 'deletePerson',
    })
  }

  // ==========================================================================
  //  ORGANIZATIONS
  // ==========================================================================
  /**
   * @operationName Get Organizations
   * @category Organizations
   * @description Retrieves organizations (companies) from Affinity, optionally filtered by a free-text term matching name or domain. Results are paginated via page size and page token. Optionally include each organization's first/last interaction dates. Returns the organization list plus the next page token.
   * @route GET /organizations
   * @paramDef {"type":"String","label":"Search Term","name":"term","description":"Optional text to match against organization names and domains."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of organizations to return per page."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's next_page_token; omit for the first page."}
   * @paramDef {"type":"Boolean","label":"With Interaction Dates","name":"withInteractionDates","uiComponent":{"type":"TOGGLE"},"description":"When true, include first/last interaction dates for each organization."}
   * @returns {Object}
   * @sampleResult {"organizations":[{"id":3003,"name":"Acme Inc","domain":"acme.com","domains":["acme.com"],"person_ids":[2002],"global":false}],"next_page_token":"eyJvIjoxfQ"}
   */
  async getOrganizations(term, pageSize, pageToken, withInteractionDates) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/organizations`,
      query: {
        term,
        page_size: pageSize,
        page_token: pageToken,
        with_interaction_dates: withInteractionDates ? true : undefined,
      },
      logTag: 'getOrganizations',
    })
  }

  /**
   * @operationName Search Organizations
   * @category Organizations
   * @description Searches Affinity organizations by a free-text term matching name or domain and returns matching company records. A focused wrapper over the organizations endpoint for lookups; use Get Organizations when you also need pagination or interaction dates.
   * @route GET /organizations/search
   * @paramDef {"type":"String","label":"Search Term","name":"term","required":true,"description":"Text to match against organization names and domains."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of organizations to return per page."}
   * @returns {Object}
   * @sampleResult {"organizations":[{"id":3003,"name":"Acme Inc","domain":"acme.com","domains":["acme.com"],"person_ids":[2002]}],"next_page_token":null}
   */
  async searchOrganizations(term, pageSize) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/organizations`,
      query: { term, page_size: pageSize },
      logTag: 'searchOrganizations',
    })
  }

  /**
   * @operationName Get Organization
   * @category Organizations
   * @description Retrieves a single organization (company) by id, including its domains, associated person ids, opportunity ids, and list entries. Optionally include interaction dates. Returns the full organization record.
   * @route GET /organizations/{organizationId}
   * @paramDef {"type":"String","label":"Organization ID","name":"organizationId","required":true,"description":"The id of the organization to retrieve."}
   * @paramDef {"type":"Boolean","label":"With Interaction Dates","name":"withInteractionDates","uiComponent":{"type":"TOGGLE"},"description":"When true, include first/last interaction dates."}
   * @returns {Object}
   * @sampleResult {"id":3003,"name":"Acme Inc","domain":"acme.com","domains":["acme.com"],"person_ids":[2002],"opportunity_ids":[4004],"list_entries":[{"id":1001,"list_id":123}]}
   */
  async getOrganization(organizationId, withInteractionDates) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ organizationId }`,
      query: { with_interaction_dates: withInteractionDates ? true : undefined },
      logTag: 'getOrganization',
    })
  }

  /**
   * @operationName Create Organization
   * @category Organizations
   * @description Creates a new organization (company) in Affinity with a name and primary domain, optionally associating existing people. Person ids may be provided as a comma/newline separated list or an array. Returns the created organization record including its new id.
   * @route POST /organizations
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The organization's name."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"The organization's primary web domain (e.g. acme.com)."}
   * @paramDef {"type":"Array<String>","label":"Person IDs","name":"personIds","description":"Optional ids of existing people to associate with the organization."}
   * @returns {Object}
   * @sampleResult {"id":3003,"name":"Acme Inc","domain":"acme.com","domains":["acme.com"],"person_ids":[2002]}
   */
  async createOrganization(name, domain, personIds) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/organizations`,
      method: 'post',
      body: { name, domain, person_ids: this.#toArray(personIds)?.map(Number) },
      logTag: 'createOrganization',
    })
  }

  /**
   * @operationName Update Organization
   * @category Organizations
   * @description Updates an existing organization by id. Any provided field (name, domain, or person associations) replaces the current value; omitted fields are left unchanged. Affinity replaces the full person_ids array when supplied. Returns the updated organization record.
   * @route PUT /organizations/{organizationId}
   * @paramDef {"type":"String","label":"Organization ID","name":"organizationId","required":true,"description":"The id of the organization to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the organization."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"New primary web domain for the organization."}
   * @paramDef {"type":"Array<String>","label":"Person IDs","name":"personIds","description":"Replacement list of associated person ids."}
   * @returns {Object}
   * @sampleResult {"id":3003,"name":"Acme Corporation","domain":"acme.com","domains":["acme.com"],"person_ids":[2002]}
   */
  async updateOrganization(organizationId, name, domain, personIds) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ organizationId }`,
      method: 'put',
      body: { name, domain, person_ids: this.#toArray(personIds)?.map(Number) },
      logTag: 'updateOrganization',
    })
  }

  /**
   * @operationName Delete Organization
   * @category Organizations
   * @description Permanently deletes an organization from Affinity by id. This removes the organization and its list entries; it cannot be undone. Returns a success flag.
   * @route DELETE /organizations/{organizationId}
   * @paramDef {"type":"String","label":"Organization ID","name":"organizationId","required":true,"description":"The id of the organization to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteOrganization(organizationId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ organizationId }`,
      method: 'delete',
      logTag: 'deleteOrganization',
    })
  }

  // ==========================================================================
  //  OPPORTUNITIES
  // ==========================================================================
  /**
   * @operationName Get Opportunities
   * @category Opportunities
   * @description Retrieves opportunities (deals) from Affinity, optionally filtered by a free-text term. Results are paginated via page size and page token. Each opportunity includes its id, name, the list it belongs to, and associated person and organization ids. Returns the opportunity list plus the next page token.
   * @route GET /opportunities
   * @paramDef {"type":"String","label":"Search Term","name":"term","description":"Optional text to match against opportunity names."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of opportunities to return per page."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's next_page_token; omit for the first page."}
   * @returns {Object}
   * @sampleResult {"opportunities":[{"id":4004,"name":"Acme Series A","list_id":123,"person_ids":[2002],"organization_ids":[3003]}],"next_page_token":"eyJvIjoxfQ"}
   */
  async getOpportunities(term, pageSize, pageToken) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/opportunities`,
      query: { term, page_size: pageSize, page_token: pageToken },
      logTag: 'getOpportunities',
    })
  }

  /**
   * @operationName Get Opportunity
   * @category Opportunities
   * @description Retrieves a single opportunity (deal) by id, including its name, the list it belongs to, and its associated person and organization ids. Returns the full opportunity record.
   * @route GET /opportunities/{opportunityId}
   * @paramDef {"type":"String","label":"Opportunity ID","name":"opportunityId","required":true,"description":"The id of the opportunity to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":4004,"name":"Acme Series A","list_id":123,"person_ids":[2002],"organization_ids":[3003],"list_entries":[{"id":1001,"list_id":123}]}
   */
  async getOpportunity(opportunityId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/opportunities/${ opportunityId }`,
      logTag: 'getOpportunity',
    })
  }

  /**
   * @operationName Create Opportunity
   * @category Opportunities
   * @description Creates a new opportunity (deal) in Affinity on a specified opportunity-type list, linking it to existing people and organizations by their ids. Person and organization ids may be provided as comma/newline separated lists or arrays. Returns the created opportunity record including its new id.
   * @route POST /opportunities
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The opportunity's name (e.g. the deal title)."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The opportunity-type list to create the opportunity on."}
   * @paramDef {"type":"Array<String>","label":"Person IDs","name":"personIds","description":"Ids of existing people to associate with the opportunity."}
   * @paramDef {"type":"Array<String>","label":"Organization IDs","name":"organizationIds","description":"Ids of existing organizations to associate with the opportunity."}
   * @returns {Object}
   * @sampleResult {"id":4004,"name":"Acme Series A","list_id":123,"person_ids":[2002],"organization_ids":[3003]}
   */
  async createOpportunity(name, listId, personIds, organizationIds) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/opportunities`,
      method: 'post',
      body: {
        name,
        list_id: Number(listId),
        person_ids: this.#toArray(personIds)?.map(Number),
        organization_ids: this.#toArray(organizationIds)?.map(Number),
      },
      logTag: 'createOpportunity',
    })
  }

  /**
   * @operationName Update Opportunity
   * @category Opportunities
   * @description Updates an existing opportunity (deal) by id. Any provided field (name, person associations, or organization associations) replaces the current value; omitted fields are left unchanged. Affinity replaces the full person_ids and organization_ids arrays when supplied. Returns the updated opportunity record.
   * @route PUT /opportunities/{opportunityId}
   * @paramDef {"type":"String","label":"Opportunity ID","name":"opportunityId","required":true,"description":"The id of the opportunity to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the opportunity."}
   * @paramDef {"type":"Array<String>","label":"Person IDs","name":"personIds","description":"Replacement list of associated person ids."}
   * @paramDef {"type":"Array<String>","label":"Organization IDs","name":"organizationIds","description":"Replacement list of associated organization ids."}
   * @returns {Object}
   * @sampleResult {"id":4004,"name":"Acme Series B","list_id":123,"person_ids":[2002],"organization_ids":[3003]}
   */
  async updateOpportunity(opportunityId, name, personIds, organizationIds) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/opportunities/${ opportunityId }`,
      method: 'put',
      body: {
        name,
        person_ids: this.#toArray(personIds)?.map(Number),
        organization_ids: this.#toArray(organizationIds)?.map(Number),
      },
      logTag: 'updateOpportunity',
    })
  }

  /**
   * @operationName Delete Opportunity
   * @category Opportunities
   * @description Permanently deletes an opportunity (deal) from Affinity by id. This cannot be undone. Returns a success flag.
   * @route DELETE /opportunities/{opportunityId}
   * @paramDef {"type":"String","label":"Opportunity ID","name":"opportunityId","required":true,"description":"The id of the opportunity to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteOpportunity(opportunityId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/opportunities/${ opportunityId }`,
      method: 'delete',
      logTag: 'deleteOpportunity',
    })
  }

  // ==========================================================================
  //  FIELDS & FIELD VALUES
  // ==========================================================================
  /**
   * @operationName Get Fields
   * @category Fields
   * @description Retrieves the definitions of custom fields (columns) in Affinity, optionally scoped to a single list. Each field includes its id, name, entity type, value type, and whether it allows multiple values. Optionally filter by entity type or value type. Field ids returned here are used when reading or writing field values.
   * @route GET /fields
   * @paramDef {"type":"String","label":"List","name":"listId","dictionary":"getListsDictionary","description":"Optional list to scope fields to; omit for global (list-independent) fields."}
   * @paramDef {"type":"String","label":"Entity Type","name":"entityType","uiComponent":{"type":"DROPDOWN","options":{"values":["Person","Organization","Opportunity"]}},"description":"Optional entity type to filter fields by."}
   * @paramDef {"type":"String","label":"Value Type","name":"valueType","uiComponent":{"type":"DROPDOWN","options":{"values":["Person","Organization","Text or Dropdown","Number","Date","Location","Text (long)","Ranked Dropdown"]}},"description":"Optional field value type to filter by."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":789,"name":"Status","list_id":123,"value_type":7,"entity_type":8,"allows_multiple":false,"dropdown_options":[{"id":1,"text":"Lead","rank":0}]}]
   */
  async getFields(listId, entityType, valueType) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/fields`,
      query: {
        list_id: listId,
        entity_type: this.#resolveChoice(entityType, ENTITY_TYPE_LABEL_TO_VALUE),
        value_type: this.#resolveChoice(valueType, VALUE_TYPE_LABEL_TO_VALUE),
      },
      logTag: 'getFields',
    })
  }

  /**
   * @operationName Get Field Values
   * @category Fields
   * @description Retrieves the values stored in custom fields for a single entity. Provide exactly one of a person id, organization id, opportunity id, or list entry id. Each returned value includes its id, the field id, the entity, and the stored value (which varies by field value type). Use these ids to update or delete specific values.
   * @route GET /field-values
   * @paramDef {"type":"String","label":"Person ID","name":"personId","description":"Retrieve field values for this person. Provide only one entity id."}
   * @paramDef {"type":"String","label":"Organization ID","name":"organizationId","description":"Retrieve field values for this organization. Provide only one entity id."}
   * @paramDef {"type":"String","label":"Opportunity ID","name":"opportunityId","description":"Retrieve field values for this opportunity. Provide only one entity id."}
   * @paramDef {"type":"String","label":"List Entry ID","name":"listEntryId","description":"Retrieve field values scoped to this list entry. Provide only one entity id."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":5005,"field_id":789,"list_entry_id":1001,"entity_type":0,"value":"Lead","entity_id":2002}]
   */
  async getFieldValues(personId, organizationId, opportunityId, listEntryId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/field-values`,
      query: {
        person_id: personId,
        organization_id: organizationId,
        opportunity_id: opportunityId,
        list_entry_id: listEntryId,
      },
      logTag: 'getFieldValues',
    })
  }

  /**
   * @operationName Create Field Value
   * @category Fields
   * @description Sets a custom field value on an entity by supplying the field id, the target entity id, and the value. The value's shape depends on the field's value type (e.g. text/number, a dropdown option id, an ISO date, or a person/organization id). Optionally scope the value to a specific list entry. Returns the created field value.
   * @route POST /field-values
   * @paramDef {"type":"String","label":"Field","name":"fieldId","required":true,"dictionary":"getFieldsDictionary","description":"The custom field to set a value for."}
   * @paramDef {"type":"String","label":"Entity ID","name":"entityId","required":true,"description":"The id of the person, organization, or opportunity to set the value on."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The value to store. Its type depends on the field: text/number, a dropdown option id, an ISO 8601 date, or a person/organization id."}
   * @paramDef {"type":"String","label":"List Entry ID","name":"listEntryId","description":"Optional list entry id to scope the value to when the field belongs to a list."}
   * @returns {Object}
   * @sampleResult {"id":5005,"field_id":789,"list_entry_id":1001,"entity_type":0,"value":"Lead","entity_id":2002}
   */
  async createFieldValue(fieldId, entityId, value, listEntryId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/field-values`,
      method: 'post',
      body: {
        field_id: Number(fieldId),
        entity_id: Number(entityId),
        value: this.#coerceFieldValue(value),
        list_entry_id: listEntryId ? Number(listEntryId) : undefined,
      },
      logTag: 'createFieldValue',
    })
  }

  /**
   * @operationName Update Field Value
   * @category Fields
   * @description Updates an existing custom field value by its field value id, replacing the stored value. The value's shape must match the field's value type. Returns the updated field value.
   * @route PUT /field-values/{fieldValueId}
   * @paramDef {"type":"String","label":"Field Value ID","name":"fieldValueId","required":true,"description":"The id of the field value to update (from Get Field Values)."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The new value. Its type depends on the field: text/number, a dropdown option id, an ISO 8601 date, or a person/organization id."}
   * @returns {Object}
   * @sampleResult {"id":5005,"field_id":789,"list_entry_id":1001,"entity_type":0,"value":"Qualified","entity_id":2002}
   */
  async updateFieldValue(fieldValueId, value) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/field-values/${ fieldValueId }`,
      method: 'put',
      body: { value: this.#coerceFieldValue(value) },
      logTag: 'updateFieldValue',
    })
  }

  /**
   * @operationName Delete Field Value
   * @category Fields
   * @description Deletes a custom field value by its field value id, clearing that value from the entity. Returns a success flag.
   * @route DELETE /field-values/{fieldValueId}
   * @paramDef {"type":"String","label":"Field Value ID","name":"fieldValueId","required":true,"description":"The id of the field value to delete (from Get Field Values)."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteFieldValue(fieldValueId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/field-values/${ fieldValueId }`,
      method: 'delete',
      logTag: 'deleteFieldValue',
    })
  }

  // Coerces a string field value to a number when it is purely numeric so that
  // number/dropdown-id/entity-id fields receive the correct JSON type; other
  // values (text, ISO dates) pass through unchanged.
  #coerceFieldValue(value) {
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value)
    }

    return value
  }

  // ==========================================================================
  //  NOTES
  // ==========================================================================
  /**
   * @operationName Get Notes
   * @category Notes
   * @description Retrieves notes from Affinity, optionally filtered to those associated with a specific person, organization, or opportunity. Results are paginated via page size and page token. Each note includes its content, author, associations, and timestamps. Returns the note list plus the next page token.
   * @route GET /notes
   * @paramDef {"type":"String","label":"Person ID","name":"personId","description":"Optional person id to filter notes to."}
   * @paramDef {"type":"String","label":"Organization ID","name":"organizationId","description":"Optional organization id to filter notes to."}
   * @paramDef {"type":"String","label":"Opportunity ID","name":"opportunityId","description":"Optional opportunity id to filter notes to."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of notes to return per page."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's next_page_token; omit for the first page."}
   * @returns {Object}
   * @sampleResult {"notes":[{"id":6006,"creator_id":456,"person_ids":[2002],"organization_ids":[],"opportunity_ids":[],"content":"Great intro call.","created_at":"2024-01-15T09:30:00.000Z"}],"next_page_token":null}
   */
  async getNotes(personId, organizationId, opportunityId, pageSize, pageToken) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/notes`,
      query: {
        person_id: personId,
        organization_id: organizationId,
        opportunity_id: opportunityId,
        page_size: pageSize,
        page_token: pageToken,
      },
      logTag: 'getNotes',
    })
  }

  /**
   * @operationName Create Note
   * @category Notes
   * @description Creates a note in Affinity with text content, associating it with any combination of people, organizations, and opportunities by their ids. Association ids may be provided as comma/newline separated lists or arrays. Returns the created note including its new id.
   * @route POST /notes
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the note."}
   * @paramDef {"type":"Array<String>","label":"Person IDs","name":"personIds","description":"Ids of people to associate the note with."}
   * @paramDef {"type":"Array<String>","label":"Organization IDs","name":"organizationIds","description":"Ids of organizations to associate the note with."}
   * @paramDef {"type":"Array<String>","label":"Opportunity IDs","name":"opportunityIds","description":"Ids of opportunities to associate the note with."}
   * @returns {Object}
   * @sampleResult {"id":6006,"creator_id":456,"person_ids":[2002],"organization_ids":[],"opportunity_ids":[],"content":"Great intro call.","created_at":"2024-01-15T09:30:00.000Z"}
   */
  async createNote(content, personIds, organizationIds, opportunityIds) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/notes`,
      method: 'post',
      body: {
        content,
        person_ids: this.#toArray(personIds)?.map(Number),
        organization_ids: this.#toArray(organizationIds)?.map(Number),
        opportunity_ids: this.#toArray(opportunityIds)?.map(Number),
      },
      logTag: 'createNote',
    })
  }

  // ==========================================================================
  //  INTERACTIONS
  // ==========================================================================
  /**
   * @operationName Get Interactions
   * @category Interactions
   * @description Retrieves interactions (emails and meetings) recorded in Affinity for a given date range and entity. Specify the interaction type and a start/end date window, plus one of a person, organization, or opportunity id. Returns the matching interactions with their participants and timestamps.
   * @route GET /interactions
   * @paramDef {"type":"String","label":"Interaction Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Meeting","Call","Chat Message","Email"]}},"description":"The kind of interaction to retrieve."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the date range (ISO 8601). Interactions on or after this time are returned."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the date range (ISO 8601). Interactions on or before this time are returned."}
   * @paramDef {"type":"String","label":"Person ID","name":"personId","description":"Optional person id to scope interactions to."}
   * @paramDef {"type":"String","label":"Organization ID","name":"organizationId","description":"Optional organization id to scope interactions to."}
   * @paramDef {"type":"String","label":"Opportunity ID","name":"opportunityId","description":"Optional opportunity id to scope interactions to."}
   * @returns {Object}
   * @sampleResult {"emails":[{"id":7007,"date":"2024-01-15T09:30:00.000Z","subject":"Intro","person_ids":[2002]}],"meetings":[]}
   */
  async getInteractions(type, startDate, endDate, personId, organizationId, opportunityId) {
    const INTERACTION_TYPE = { Meeting: 0, Call: 1, 'Chat Message': 2, Email: 3 }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/interactions`,
      query: {
        type: this.#resolveChoice(type, INTERACTION_TYPE),
        start_time: startDate,
        end_time: endDate,
        person_id: personId,
        organization_id: organizationId,
        opportunity_id: opportunityId,
      },
      logTag: 'getInteractions',
    })
  }

  // ==========================================================================
  //  REALTIME TRIGGER (SINGLE_APP — one webhook subscription per application)
  // ==========================================================================
  /**
   * @operationName On Affinity Event
   * @category Triggers
   * @description Fires when a selected Affinity event occurs, such as a person, organization, opportunity, list entry, field value, or note being created, updated, or deleted. Affinity registers a webhook subscription for the chosen event and runs your flow each time a matching event is delivered. Note: Affinity allows at most three webhook subscriptions per instance.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-affinity-event
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["list.created","list.updated","list.deleted","list_entry.created","list_entry.deleted","field.created","field.updated","field.deleted","field_value.created","field_value.updated","field_value.deleted","person.created","person.updated","person.deleted","organization.created","organization.updated","organization.deleted","opportunity.created","opportunity.updated","opportunity.deleted","note.created","note.updated","note.deleted"]}},"description":"Which Affinity event fires this trigger."}
   * @returns {Object}
   * @sampleResult {"type":"person.created","sentAt":"2024-01-15T09:30:00.000Z","body":{"id":2002,"first_name":"Jane","last_name":"Doe","primary_email":"jane@acme.com","type":0}}
   */
  onAffinityEvent(callType, payload) {
    if (callType === CALL_TYPES.SHAPE_EVENT) {
      return [{ name: 'onAffinityEvent', data: this.#shapeAffinityEvent(payload) }]
    }

    if (callType === CALL_TYPES.FILTER_TRIGGER) {
      return {
        ids: this.#matchTriggers(payload, (trigger, event) => trigger.data.event === event.type),
      }
    }
  }

  // Normalizes an inbound Affinity webhook delivery ({type, sent_at, body}) into
  // the shape surfaced to the flow.
  #shapeAffinityEvent(body) {
    return {
      type: body.type,
      sentAt: body.sent_at,
      body: body.body,
    }
  }

  // The FILTER_TRIGGER payload carries the shaped eventData (under .data) and the
  // registered triggers; keep only the triggers whose predicate matches.
  #matchTriggers(payload, predicate) {
    const eventData = payload.eventData || payload.data || {}
    const event = { type: eventData.type }

    return (payload.triggers || [])
      .filter(trigger => predicate(trigger, event))
      .map(trigger => trigger.id)
  }

  // ── SYSTEM trigger handlers (SINGLE_APP) ───────────────────────────────
  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerUpsertWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook.invocation: ${ JSON.stringify(invocation) }`)

    const address = `${ invocation.callbackUrl }${ invocation.callbackUrl.includes('?') ? '&' : '?' }connectionId=${ invocation.connectionId }`
    const webhooks = []

    for (const event of invocation.events || []) {
      const data = event.triggerData || {}

      const created = await this.#apiRequest({
        url: `${ API_BASE_URL }/webhook/subscribe`,
        method: 'post',
        body: { webhook_url: address, subscriptions: [data.event] },
        logTag: 'subscribeWebhook',
      })

      webhooks.push({ triggerId: event.id, webhookId: created?.id, event: data.event })
    }

    return { webhookData: { webhooks }, connectionId: invocation.connectionId }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerResolveEvents
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug('handleTriggerResolveEvents invoked')

    // Affinity's webhook setup performs no handshake; guard the empty-body case.
    if (!invocation || !invocation.body) {
      return { handshake: true, responseToExternalService: invocation?.body || {} }
    }

    const events = this.onAffinityEvent(CALL_TYPES.SHAPE_EVENT, invocation.body)

    return { connectionId: invocation.queryParams?.connectionId, events }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerSelectMatched
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }`)

    return this[invocation.eventName](CALL_TYPES.FILTER_TRIGGER, invocation)
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerDeleteWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug('handleTriggerDeleteWebhook invoked')

    const webhooks = invocation.webhookData?.webhooks || []

    for (const webhook of webhooks) {
      if (!webhook.webhookId) {
        continue
      }

      try {
        await this.#apiRequest({
          url: `${ API_BASE_URL }/webhook/${ webhook.webhookId }`,
          method: 'delete',
          logTag: 'deleteWebhook',
        })
      } catch (error) {
        logger.warn(`handleTriggerDeleteWebhook: failed to delete webhook ${ webhook.webhookId }: ${ error?.message }`)
      }
    }

    return { webhookData: {} }
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Lists Dictionary
   * @description Provides a searchable list of Affinity lists for dropdown selection in other actions.
   * @route POST /get-lists-dictionary
   * @paramDef {"type":"getListsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Deal Flow","value":"123","note":"Opportunity list"}],"cursor":null}
   */
  async getListsDictionary(payload) {
    const { search } = payload || {}
    const lists = await this.getLists()
    const term = (search || '').toLowerCase()

    const items = (Array.isArray(lists) ? lists : [])
      .filter(list => !term || String(list.name || '').toLowerCase().includes(term))
      .map(list => ({
        label: list.name,
        value: String(list.id),
        note: `${ LIST_TYPE_VALUE_TO_LABEL[list.type] || 'List' } list`,
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Fields Dictionary
   * @description Provides a searchable list of Affinity custom fields for dropdown selection, optionally scoped to the list chosen in the dependent parameter.
   * @route POST /get-fields-dictionary
   * @paramDef {"type":"getFieldsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the list criteria whose fields to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Status","value":"789","note":"Ranked Dropdown"}],"cursor":null}
   */
  async getFieldsDictionary(payload) {
    const { search, criteria } = payload || {}
    const listId = criteria?.listId
    const fields = await this.getFields(listId || undefined)
    const term = (search || '').toLowerCase()

    const items = (Array.isArray(fields) ? fields : [])
      .filter(field => !term || String(field.name || '').toLowerCase().includes(term))
      .map(field => ({
        label: field.name,
        value: String(field.id),
        note: VALUE_TYPE_VALUE_TO_LABEL[field.value_type] || 'Field',
      }))

    return { items, cursor: null }
  }
}

// Maps the Affinity value_type code back to a friendly label for dictionary notes.
const VALUE_TYPE_VALUE_TO_LABEL = {
  0: 'Person',
  1: 'Organization',
  2: 'Text or Dropdown',
  3: 'Number',
  4: 'Date',
  5: 'Location',
  6: 'Text (long)',
  7: 'Ranked Dropdown',
}

Flowrunner.ServerCode.addService(AffinityService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Affinity → Settings → API → generate an API key.',
  },
])
