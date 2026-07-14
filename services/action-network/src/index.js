const logger = {
  info: (...args) => console.log('[Action Network] info:', ...args),
  debug: (...args) => console.log('[Action Network] debug:', ...args),
  error: (...args) => console.log('[Action Network] error:', ...args),
  warn: (...args) => console.log('[Action Network] warn:', ...args),
}

const API_BASE_URL = 'https://actionnetwork.org/api/v2'

/**
 * Removes undefined, null, and empty-string values from an object so they are
 * not sent to the Action Network API.
 */
function clean(obj) {
  if (!obj || typeof obj !== 'object') {
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
 * Parses a comma or newline separated string into an array of trimmed,
 * non-empty strings. Passes arrays through untouched.
 */
function toList(value) {
  if (Array.isArray(value)) {
    return value.filter(item => item !== undefined && item !== null && item !== '')
  }

  if (typeof value === 'string' && value.trim() !== '') {
    return value.split(/[\n,]/).map(item => item.trim()).filter(Boolean)
  }

  return []
}

/**
 * @integrationName Action Network
 * @integrationIcon /icon.png
 */
class ActionNetworkService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  /**
   * Single entry point for every Action Network API call. Sets the
   * OSDI-API-Token header and surfaces the OSDI error body on failure.
   */
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'OSDI-API-Token': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/hal+json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message =
        error.body?.error ||
        error.body?.message ||
        error.body?.request_status ||
        error.message ||
        'Unknown error'

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`Action Network API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  // ---------------------------------------------------------------------------
  // People
  // ---------------------------------------------------------------------------

  /**
   * @operationName List People
   * @category People
   * @description Lists activists (people) in your Action Network group, newest first. Results are returned under `_embedded['osdi:people']` following the HAL hypermedia format, with pagination `_links` (next/previous). Use `page` to page through results (25 per page) and an optional OData `filter` expression (e.g. `email_address eq 'user@example.com'` or `modified_date gt '2023-01-01'`) to narrow the list.
   * @route GET /people
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 results per page). Defaults to 1."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional OData filter expression, e.g. email_address eq 'user@example.com' or modified_date gt '2023-01-01T00:00:00Z'."}
   * @returns {Object}
   * @sampleResult {"total_pages":10,"per_page":25,"page":1,"total_records":250,"_links":{"self":{"href":"https://actionnetwork.org/api/v2/people?page=1"},"next":{"href":"https://actionnetwork.org/api/v2/people?page=2"},"osdi:people":[{"href":"https://actionnetwork.org/api/v2/people/699bd3b9"}]},"_embedded":{"osdi:people":[{"identifiers":["action_network:699bd3b9"],"given_name":"John","family_name":"Smith","email_addresses":[{"primary":true,"address":"jsmith@example.com","status":"subscribed"}],"created_date":"2023-01-15T20:11:00Z"}]}}
   */
  async listPeople(page, filter) {
    return this.#apiRequest({
      logTag: '[listPeople]',
      url: `${ API_BASE_URL }/people`,
      method: 'get',
      query: { page, filter },
    })
  }

  /**
   * @operationName Get Person
   * @category People
   * @description Retrieves a single person by their Action Network UUID. Returns the full person record including names, email addresses, phone numbers, postal addresses, custom fields, and HAL `_links` to related collections (taggings, submissions, donations, attendances, signatures).
   * @route GET /people/{personId}
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The Action Network UUID of the person (e.g. 699bd3b9-...)."}
   * @returns {Object}
   * @sampleResult {"identifiers":["action_network:699bd3b9"],"created_date":"2023-01-15T20:11:00Z","modified_date":"2023-02-01T14:00:00Z","given_name":"John","family_name":"Smith","email_addresses":[{"primary":true,"address":"jsmith@example.com","status":"subscribed"}],"phone_numbers":[{"primary":true,"number":"12025551234","status":"subscribed"}],"postal_addresses":[{"primary":true,"postal_code":"20009","country":"US"}],"custom_fields":{},"_links":{"self":{"href":"https://actionnetwork.org/api/v2/people/699bd3b9"},"osdi:taggings":{"href":"https://actionnetwork.org/api/v2/people/699bd3b9/taggings"}}}
   */
  async getPerson(personId) {
    return this.#apiRequest({
      logTag: '[getPerson]',
      url: `${ API_BASE_URL }/people/${ encodeURIComponent(personId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Add or Upsert Person
   * @category People
   * @description Adds a new activist or updates an existing one using Action Network's person_signup_helper (POST /people). Matching is by email address: if the email already exists, the record is merged/updated rather than duplicated; otherwise a new person is created. Either an email address or a phone number is required. Tags in Add Tags are applied and tags in Remove Tags are removed, matched to existing group tags by name (unknown tag names are ignored). Postal Addresses, Phone Numbers, and Custom Fields accept JSON matching the OSDI schema.
   * @route POST /people
   * @paramDef {"type":"String","label":"Email Address","name":"email","description":"Primary email address. Required unless a phone number is supplied. Used as the merge key for upsert."}
   * @paramDef {"type":"String","label":"Given Name","name":"givenName","description":"First name of the person."}
   * @paramDef {"type":"String","label":"Family Name","name":"familyName","description":"Last name of the person."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"Primary phone number (digits, e.g. 12025551234). Required unless an email address is supplied."}
   * @paramDef {"type":"Array<Object>","label":"Postal Addresses","name":"postalAddresses","description":"Optional array of OSDI postal address objects, e.g. [{\"postal_code\":\"20009\",\"country\":\"US\"}]."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Optional key/value object of custom fields defined in your group, e.g. {\"occupation\":\"teacher\"}."}
   * @paramDef {"type":"Array<String>","label":"Add Tags","name":"addTags","description":"Tag names to add to the person. Comma or newline separated, or an array. Matched to existing group tags by name."}
   * @paramDef {"type":"Array<String>","label":"Remove Tags","name":"removeTags","description":"Tag names to remove from the person. Comma or newline separated, or an array."}
   * @returns {Object}
   * @sampleResult {"identifiers":["action_network:699bd3b9"],"created_date":"2023-01-15T20:11:00Z","modified_date":"2023-02-01T14:00:00Z","given_name":"John","family_name":"Smith","email_addresses":[{"primary":true,"address":"jsmith@example.com","status":"subscribed"}],"_links":{"self":{"href":"https://actionnetwork.org/api/v2/people/699bd3b9"}}}
   */
  async upsertPerson(email, givenName, familyName, phoneNumber, postalAddresses, customFields, addTags, removeTags) {
    const person = clean({
      given_name: givenName,
      family_name: familyName,
      custom_fields: customFields || undefined,
    })

    if (email) {
      person.email_addresses = [{ address: email }]
    }

    if (phoneNumber) {
      person.phone_numbers = [{ number: phoneNumber }]
    }

    if (Array.isArray(postalAddresses) && postalAddresses.length > 0) {
      person.postal_addresses = postalAddresses
    }

    const body = { person }

    const add = toList(addTags)
    const remove = toList(removeTags)

    if (add.length > 0) {
      body.add_tags = add
    }

    if (remove.length > 0) {
      body.remove_tags = remove
    }

    return this.#apiRequest({
      logTag: '[upsertPerson]',
      url: `${ API_BASE_URL }/people`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Person
   * @category People
   * @description Updates an existing person by UUID (PUT /people/{id}). Only include the fields you want to change; supply a JSON object matching the OSDI person schema (e.g. given_name, family_name, email_addresses, phone_numbers, postal_addresses, custom_fields). Note that to add or remove tags you should use Add or Upsert Person or Add Tagging instead.
   * @route PUT /people/{personId}
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The Action Network UUID of the person to update."}
   * @paramDef {"type":"Object","label":"Person Fields","name":"personFields","required":true,"description":"OSDI person fields to update, e.g. {\"given_name\":\"Jane\",\"custom_fields\":{\"occupation\":\"nurse\"}}."}
   * @returns {Object}
   * @sampleResult {"identifiers":["action_network:699bd3b9"],"given_name":"Jane","family_name":"Smith","modified_date":"2023-03-01T10:00:00Z","_links":{"self":{"href":"https://actionnetwork.org/api/v2/people/699bd3b9"}}}
   */
  async updatePerson(personId, personFields) {
    return this.#apiRequest({
      logTag: '[updatePerson]',
      url: `${ API_BASE_URL }/people/${ encodeURIComponent(personId) }`,
      method: 'put',
      body: personFields || {},
    })
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Events
   * @category Events
   * @description Lists events in your Action Network group. Results are returned under `_embedded['osdi:events']` in HAL format with pagination `_links`. Use `page` to page through results (25 per page) and an optional OData `filter` expression to narrow the list.
   * @route GET /events
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 results per page). Defaults to 1."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional OData filter expression, e.g. modified_date gt '2023-01-01T00:00:00Z'."}
   * @returns {Object}
   * @sampleResult {"total_pages":2,"per_page":25,"page":1,"total_records":30,"_links":{"self":{"href":"https://actionnetwork.org/api/v2/events?page=1"}},"_embedded":{"osdi:events":[{"identifiers":["action_network:0c3c8e40"],"title":"Community Meeting","start_date":"2023-06-01T18:00:00Z","browser_url":"https://actionnetwork.org/events/community-meeting"}]}}
   */
  async listEvents(page, filter) {
    return this.#apiRequest({
      logTag: '[listEvents]',
      url: `${ API_BASE_URL }/events`,
      method: 'get',
      query: { page, filter },
    })
  }

  /**
   * @operationName Get Event
   * @category Events
   * @description Retrieves a single event by its Action Network UUID, including title, description, start date, location, browser URL, and HAL `_links` to related collections such as attendances.
   * @route GET /events/{eventId}
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"description":"The Action Network UUID of the event."}
   * @returns {Object}
   * @sampleResult {"identifiers":["action_network:0c3c8e40"],"title":"Community Meeting","description":"<p>Join us.</p>","start_date":"2023-06-01T18:00:00Z","location":{"venue":"Town Hall","address_lines":["123 Main St"],"locality":"Washington","region":"DC","postal_code":"20009","country":"US"},"browser_url":"https://actionnetwork.org/events/community-meeting","_links":{"self":{"href":"https://actionnetwork.org/api/v2/events/0c3c8e40"}}}
   */
  async getEvent(eventId) {
    return this.#apiRequest({
      logTag: '[getEvent]',
      url: `${ API_BASE_URL }/events/${ encodeURIComponent(eventId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Event
   * @category Events
   * @description Creates a new event in your Action Network group (POST /events). Provide a title and optionally a description, start date, and location. The location is an OSDI address object (venue, address_lines, locality, region, postal_code, country). Returns the created event with its UUID and browser URL.
   * @route POST /events
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The event title."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Event start date/time in ISO 8601, e.g. 2023-06-01T18:00:00Z."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional event description. May contain HTML."}
   * @paramDef {"type":"Object","label":"Location","name":"location","description":"Optional OSDI location object, e.g. {\"venue\":\"Town Hall\",\"address_lines\":[\"123 Main St\"],\"locality\":\"Washington\",\"region\":\"DC\",\"postal_code\":\"20009\",\"country\":\"US\"}."}
   * @returns {Object}
   * @sampleResult {"identifiers":["action_network:0c3c8e40"],"title":"Community Meeting","start_date":"2023-06-01T18:00:00Z","browser_url":"https://actionnetwork.org/events/community-meeting","_links":{"self":{"href":"https://actionnetwork.org/api/v2/events/0c3c8e40"}}}
   */
  async createEvent(title, startDate, description, location) {
    const body = clean({
      title,
      start_date: startDate,
      description,
      location: location || undefined,
    })

    return this.#apiRequest({
      logTag: '[createEvent]',
      url: `${ API_BASE_URL }/events`,
      method: 'post',
      body,
    })
  }

  // ---------------------------------------------------------------------------
  // Forms / Petitions / Fundraising / Advocacy
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Forms
   * @category Action Pages
   * @description Lists forms in your Action Network group. Results are returned under `_embedded['osdi:forms']` in HAL format with pagination `_links`. Use `page` to page through results (25 per page).
   * @route GET /forms
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 results per page). Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"total_pages":1,"per_page":25,"page":1,"total_records":3,"_embedded":{"osdi:forms":[{"identifiers":["action_network:adb951cb"],"title":"Volunteer Sign-up","total_submissions":42,"browser_url":"https://actionnetwork.org/forms/volunteer-sign-up"}]}}
   */
  async listForms(page) {
    return this.#apiRequest({
      logTag: '[listForms]',
      url: `${ API_BASE_URL }/forms`,
      method: 'get',
      query: { page },
    })
  }

  /**
   * @operationName List Petitions
   * @category Action Pages
   * @description Lists petitions in your Action Network group. Results are returned under `_embedded['osdi:petitions']` in HAL format with pagination `_links`. Use `page` to page through results (25 per page).
   * @route GET /petitions
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 results per page). Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"total_pages":1,"per_page":25,"page":1,"total_records":2,"_embedded":{"osdi:petitions":[{"identifiers":["action_network:5a0c3f9d"],"title":"Save the Park","total_signatures":320,"browser_url":"https://actionnetwork.org/petitions/save-the-park"}]}}
   */
  async listPetitions(page) {
    return this.#apiRequest({
      logTag: '[listPetitions]',
      url: `${ API_BASE_URL }/petitions`,
      method: 'get',
      query: { page },
    })
  }

  /**
   * @operationName List Fundraising Pages
   * @category Action Pages
   * @description Lists fundraising pages in your Action Network group. Results are returned under `_embedded['osdi:fundraising_pages']` in HAL format with pagination `_links`. Use `page` to page through results (25 per page).
   * @route GET /fundraising_pages
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 results per page). Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"total_pages":1,"per_page":25,"page":1,"total_records":1,"_embedded":{"osdi:fundraising_pages":[{"identifiers":["action_network:1efb3a20"],"title":"Emergency Fund","currency":"USD","total_donations":58,"browser_url":"https://actionnetwork.org/fundraising/emergency-fund"}]}}
   */
  async listFundraisingPages(page) {
    return this.#apiRequest({
      logTag: '[listFundraisingPages]',
      url: `${ API_BASE_URL }/fundraising_pages`,
      method: 'get',
      query: { page },
    })
  }

  /**
   * @operationName List Advocacy Campaigns
   * @category Action Pages
   * @description Lists advocacy campaigns (letter/email-to-target campaigns) in your Action Network group. Results are returned under `_embedded['osdi:advocacy_campaigns']` in HAL format with pagination `_links`. Use `page` to page through results (25 per page).
   * @route GET /advocacy_campaigns
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 results per page). Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"total_pages":1,"per_page":25,"page":1,"total_records":1,"_embedded":{"osdi:advocacy_campaigns":[{"identifiers":["action_network:7c9a1b2d"],"title":"Tell Congress to Act","targets":"Congress","total_outreaches":91,"browser_url":"https://actionnetwork.org/letters/tell-congress-to-act"}]}}
   */
  async listAdvocacyCampaigns(page) {
    return this.#apiRequest({
      logTag: '[listAdvocacyCampaigns]',
      url: `${ API_BASE_URL }/advocacy_campaigns`,
      method: 'get',
      query: { page },
    })
  }

  // ---------------------------------------------------------------------------
  // Tags & Taggings
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists all tags in your Action Network group. Results are returned under `_embedded['osdi:tags']` in HAL format with pagination `_links`. Tags are used to categorize people; use Add Tagging to apply a tag to a person.
   * @route GET /tags
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 results per page). Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"total_pages":1,"per_page":25,"page":1,"total_records":2,"_embedded":{"osdi:tags":[{"identifiers":["action_network:71f8feef"],"name":"Volunteers","created_date":"2023-01-01T00:00:00Z","_links":{"self":{"href":"https://actionnetwork.org/api/v2/tags/71f8feef"}}}]}}
   */
  async listTags(page) {
    return this.#apiRequest({
      logTag: '[listTags]',
      url: `${ API_BASE_URL }/tags`,
      method: 'get',
      query: { page },
    })
  }

  /**
   * @operationName Get Tag
   * @category Tags
   * @description Retrieves a single tag by its Action Network UUID, including its name and HAL `_links` to its taggings collection.
   * @route GET /tags/{tagId}
   * @paramDef {"type":"String","label":"Tag ID","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The Action Network UUID of the tag. Search and select a tag or paste an ID."}
   * @returns {Object}
   * @sampleResult {"identifiers":["action_network:71f8feef"],"name":"Volunteers","created_date":"2023-01-01T00:00:00Z","modified_date":"2023-01-01T00:00:00Z","_links":{"self":{"href":"https://actionnetwork.org/api/v2/tags/71f8feef"},"osdi:taggings":{"href":"https://actionnetwork.org/api/v2/tags/71f8feef/taggings"}}}
   */
  async getTag(tagId) {
    return this.#apiRequest({
      logTag: '[getTag]',
      url: `${ API_BASE_URL }/tags/${ encodeURIComponent(tagId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Add Tagging
   * @category Tags
   * @description Applies a tag to a person by creating a tagging (POST /tags/{tagId}/taggings). Provide the tag UUID and the person UUID; the person is linked via the OSDI `_links['osdi:person']` reference. Returns the created tagging record.
   * @route POST /tags/{tagId}/taggings
   * @paramDef {"type":"String","label":"Tag ID","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The Action Network UUID of the tag to apply. Search and select a tag or paste an ID."}
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The Action Network UUID of the person to tag."}
   * @returns {Object}
   * @sampleResult {"identifiers":["action_network:82e909f9"],"created_date":"2023-03-18T22:25:31Z","modified_date":"2023-03-18T22:25:38Z","item_type":"osdi:person","_links":{"self":{"href":"https://actionnetwork.org/api/v2/tags/71f8feef/taggings/82e909f9"},"osdi:tag":{"href":"https://actionnetwork.org/api/v2/tags/71f8feef"},"osdi:person":{"href":"https://actionnetwork.org/api/v2/people/82e909f9"}}}
   */
  async addTagging(tagId, personId) {
    const body = {
      _links: {
        'osdi:person': {
          href: `${ API_BASE_URL }/people/${ personId }`,
        },
      },
    }

    return this.#apiRequest({
      logTag: '[addTagging]',
      url: `${ API_BASE_URL }/tags/${ encodeURIComponent(tagId) }/taggings`,
      method: 'post',
      body,
    })
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Messages
   * @category Messages
   * @description Lists email messages in your Action Network group. Results are returned under `_embedded['osdi:messages']` in HAL format with pagination `_links`. Includes subject, status, and (for sent messages) statistics such as total_targeted, sent, opened, and clicked.
   * @route GET /messages
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 results per page). Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"total_pages":1,"per_page":25,"page":1,"total_records":1,"_embedded":{"osdi:messages":[{"identifiers":["action_network:6f2e9a1b"],"subject":"Newsletter","status":"sent","total_targeted":1000,"statistics":{"sent":1000,"opened":420,"clicked":88}}]}}
   */
  async listMessages(page) {
    return this.#apiRequest({
      logTag: '[listMessages]',
      url: `${ API_BASE_URL }/messages`,
      method: 'get',
      query: { page },
    })
  }

  /**
   * @operationName Get Message
   * @category Messages
   * @description Retrieves a single email message by its Action Network UUID, including subject, body, status, targets, and delivery statistics.
   * @route GET /messages/{messageId}
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The Action Network UUID of the message."}
   * @returns {Object}
   * @sampleResult {"identifiers":["action_network:6f2e9a1b"],"subject":"Newsletter","body":"<p>Hello</p>","status":"sent","total_targeted":1000,"statistics":{"sent":1000,"opened":420,"clicked":88},"_links":{"self":{"href":"https://actionnetwork.org/api/v2/messages/6f2e9a1b"}}}
   */
  async getMessage(messageId) {
    return this.#apiRequest({
      logTag: '[getMessage]',
      url: `${ API_BASE_URL }/messages/${ encodeURIComponent(messageId) }`,
      method: 'get',
    })
  }

  // ---------------------------------------------------------------------------
  // Submissions & Signatures
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Form Submissions
   * @category Responses
   * @description Lists submissions for a given form (GET /forms/{formId}/submissions). Results are returned under `_embedded['osdi:submissions']` in HAL format with pagination `_links`. Each submission links to the person who submitted via `_links['osdi:person']`.
   * @route GET /forms/{formId}/submissions
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"description":"The Action Network UUID of the form."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 results per page). Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"total_pages":2,"per_page":25,"page":1,"total_records":42,"_embedded":{"osdi:submissions":[{"identifiers":["action_network:9f1c2d3e"],"created_date":"2023-02-01T12:00:00Z","_links":{"osdi:person":{"href":"https://actionnetwork.org/api/v2/people/699bd3b9"}}}]}}
   */
  async listFormSubmissions(formId, page) {
    return this.#apiRequest({
      logTag: '[listFormSubmissions]',
      url: `${ API_BASE_URL }/forms/${ encodeURIComponent(formId) }/submissions`,
      method: 'get',
      query: { page },
    })
  }

  /**
   * @operationName List Petition Signatures
   * @category Responses
   * @description Lists signatures for a given petition (GET /petitions/{petitionId}/signatures). Results are returned under `_embedded['osdi:signatures']` in HAL format with pagination `_links`. Each signature links to the signer via `_links['osdi:person']` and may include a comment.
   * @route GET /petitions/{petitionId}/signatures
   * @paramDef {"type":"String","label":"Petition ID","name":"petitionId","required":true,"description":"The Action Network UUID of the petition."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 results per page). Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"total_pages":13,"per_page":25,"page":1,"total_records":320,"_embedded":{"osdi:signatures":[{"identifiers":["action_network:3c4d5e6f"],"comments":"I support this.","created_date":"2023-02-10T09:00:00Z","_links":{"osdi:person":{"href":"https://actionnetwork.org/api/v2/people/699bd3b9"}}}]}}
   */
  async listPetitionSignatures(petitionId, page) {
    return this.#apiRequest({
      logTag: '[listPetitionSignatures]',
      url: `${ API_BASE_URL }/petitions/${ encodeURIComponent(petitionId) }/signatures`,
      method: 'get',
      query: { page },
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tags by name (case-insensitive, applied client-side to the current page)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Pass the cursor returned by a previous call to load the next page of tags."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Provides a selectable list of tags from your Action Network group for tag parameters. The option value is the tag UUID; the label is the tag name. Reads names and IDs from `_embedded['osdi:tags']`.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input for listing tags."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Volunteers","value":"71f8feef","note":"action_network:71f8feef"}],"cursor":"2"}
   */
  async getTagsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? Number(cursor) : 1

    const response = await this.#apiRequest({
      logTag: '[getTagsDictionary]',
      url: `${ API_BASE_URL }/tags`,
      method: 'get',
      query: { page },
    })

    const tags = response?._embedded?.['osdi:tags'] || []
    const term = (search || '').trim().toLowerCase()

    const items = tags
      .filter(tag => !term || (tag.name || '').toLowerCase().includes(term))
      .map(tag => {
        const identifier = Array.isArray(tag.identifiers) ? tag.identifiers[0] : undefined
        const id = this.#extractId(tag) || identifier

        return {
          label: tag.name || id,
          value: id,
          note: identifier || undefined,
        }
      })
      .filter(item => item.value)

    const hasNext = Boolean(response?._links?.next?.href)

    return {
      items,
      cursor: hasNext ? String(page + 1) : undefined,
    }
  }

  /**
   * Derives an Action Network UUID from a resource's self link or its
   * action_network:{uuid} identifier.
   */
  #extractId(resource) {
    const selfHref = resource?._links?.self?.href

    if (selfHref) {
      const parts = selfHref.split('/')
      const last = parts[parts.length - 1]

      if (last) {
        return last
      }
    }

    const identifier = Array.isArray(resource?.identifiers)
      ? resource.identifiers.find(id => typeof id === 'string' && id.startsWith('action_network:'))
      : undefined

    return identifier ? identifier.split(':')[1] : undefined
  }
}

Flowrunner.ServerCode.addService(ActionNetworkService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Action Network API key, sent as the OSDI-API-Token header. Find it in Action Network under your group → Start Organizing → Details → API & Sync → API Key.',
  },
])
