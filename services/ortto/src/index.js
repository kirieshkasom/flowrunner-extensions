const logger = {
  info: (...args) => console.log('[Ortto] info:', ...args),
  debug: (...args) => console.log('[Ortto] debug:', ...args),
  error: (...args) => console.log('[Ortto] error:', ...args),
  warn: (...args) => console.log('[Ortto] warn:', ...args),
}

/**
 * Ortto's API is served from region-specific hosts. The default is the primary
 * host; customers whose instance region is Australia or Europe must point at the
 * matching host. This is exposed to the user as a config item (Region) so the
 * service targets the correct endpoint.
 */
const REGION_HOSTS = {
  'Global (Default)': 'https://api.ap3api.com',
  Australia: 'https://api.au.ap3api.com',
  Europe: 'https://api.eu.ap3api.com',
}

const DEFAULT_HOST = REGION_HOSTS['Global (Default)']

const API_VERSION = 'v1'

const DEFAULT_LIMIT = 50

/**
 * Ortto identifies every person/activity field by a strongly-typed, namespace
 * -specific field id of the form `type::name` (for example `str::email`,
 * `str::first`, `str::last`). String fields (`str::`) and booleans (`bol::`)
 * take plain values, but phone (`phn::`), geo (`geo::`) and date (`dtz::`)
 * fields take objects — e.g. `phn::phone` is `{ "c": "61", "n": "401234567" }`
 * or `{ "phone": "61401234567", "parse_with_country_code": true }`, and
 * `geo::city` is `{ "name": "Melbourne" }`. Custom fields use the `type:cm:name`
 * form (e.g. `str:cm:job-title`) and are discoverable via Get Custom Fields.
 *
 * This map covers the standard built-in string fields so callers can pass plain
 * values (email/first/last) without knowing the convention. Phone is handled
 * separately because it requires an object value.
 */
const STANDARD_FIELD_IDS = {
  email: 'str::email',
  first: 'str::first',
  last: 'str::last',
  phone: 'phn::phone',
}

/**
 * Ortto `merge_strategy` values control how existing person records are updated.
 * The API expects an integer; these friendly labels map to the documented ints.
 */
const MERGE_STRATEGIES = {
  'Overwrite existing (default)': 2,
  'Append only (keep existing values)': 1,
  'Ignore (create only, never update)': 3,
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
 * @integrationName Ortto
 * @integrationIcon /icon.png
 */
class OrttoService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.baseUrl = `${ REGION_HOSTS[config.region] || DEFAULT_HOST }/${ API_VERSION }`
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ path, method = 'post', body, logTag }) {
    try {
      const url = `${ this.baseUrl }${ path }`

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url).set({
        'X-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      })

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error || error.body?.message || error.message
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`Ortto API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * Builds an Ortto person `fields` object from the convenience arguments plus an
   * optional raw passthrough. Convenience values are mapped to their standard
   * field ids; the raw object (keyed by Ortto field ids) is merged on top so it
   * can add custom fields or override the convenience values.
   */
  #buildPersonFields({ email, firstName, lastName, phone, rawFields }) {
    const fields = clean({
      [STANDARD_FIELD_IDS.email]: email,
      [STANDARD_FIELD_IDS.first]: firstName,
      [STANDARD_FIELD_IDS.last]: lastName,
    })

    // Ortto phone fields (phn::) require an object, not a plain string. Pass the
    // full number and let Ortto parse the country code from it.
    if (phone !== undefined && phone !== null && phone !== '') {
      fields[STANDARD_FIELD_IDS.phone] = { phone: `${ phone }`, parse_with_country_code: true }
    }

    if (rawFields && typeof rawFields === 'object') {
      Object.assign(fields, rawFields)
    }

    return fields
  }

  /**
   * @operationName Merge or Create Person
   * @category People
   * @description Creates a new person (contact) in Ortto or merges data into an existing one, matched by email. Ortto addresses every field by a strongly-typed field id of the form `type::name` (e.g. `str::email`, `str::first`, `str::last`). String and boolean fields take plain values; phone (`phn::`), geo (`geo::`) and date (`dtz::`) fields take objects — supply those via Raw Fields. Provide common values via Email/First Name/Last Name/Phone and/or a Raw Fields object keyed by field ids for custom fields (raw values override the convenience ones). Merge Strategy controls how existing values are updated. By default the merge is queued asynchronously and Ortto returns a per-person status acknowledgement rather than the finished person. Use Get Custom Fields to discover custom field ids.
   * @route POST /person/merge
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Person's email address. Used as the match key and mapped to the str::email field."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Person's first name (mapped to str::first)."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Person's last name (mapped to str::last)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Person's phone number including country code, e.g. +14155552671. Sent to the phn::phone object field with automatic country-code parsing."}
   * @paramDef {"type":"Object","label":"Raw Fields","name":"rawFields","description":"Optional object of additional Ortto fields keyed by field id, e.g. {\"str:cm:company\":\"Acme\",\"bol::gdpr\":true,\"geo::city\":{\"name\":\"Melbourne\"}}. Merged on top of the convenience values. Discover custom field ids via Get Custom Fields."}
   * @paramDef {"type":"String","label":"Merge Strategy","name":"mergeStrategy","uiComponent":{"type":"DROPDOWN","options":{"values":["Overwrite existing (default)","Append only (keep existing values)","Ignore (create only, never update)"]}},"description":"How to treat existing values on a matched person. Overwrite updates all provided fields; Append only fills empty fields without changing existing ones; Ignore never updates an existing person but still creates a new one if none matches."}
   * @paramDef {"type":"Boolean","label":"Run Asynchronously","name":"async","uiComponent":{"type":"TOGGLE"},"description":"When true (default), Ortto queues the merge and returns immediately. Set false to process inline before returning."}
   * @returns {Object}
   * @sampleResult {"people":[{"person_id":"0063f2c474449cd58a4c5600","status":"merged"}]}
   */
  async mergeOrCreatePerson(email, firstName, lastName, phone, rawFields, mergeStrategy, async) {
    const logTag = '[mergeOrCreatePerson]'

    const fields = this.#buildPersonFields({ email, firstName, lastName, phone, rawFields })

    return await this.#apiRequest({
      logTag,
      path: '/person/merge',
      method: 'post',
      body: clean({
        async: async !== false,
        merge_by: [STANDARD_FIELD_IDS.email],
        merge_strategy: this.#resolveChoice(mergeStrategy, MERGE_STRATEGIES) ?? MERGE_STRATEGIES['Overwrite existing (default)'],
        people: [{ fields }],
      }),
    })
  }

  /**
   * @operationName Get People
   * @category People
   * @description Retrieves a page of people (contacts) from Ortto. Specify which field ids to return (e.g. `str::email`, `str::first`, `str::last`), an optional Ortto filter object to narrow the results, sorting, and pagination via Limit/Offset. The response includes a `contacts` array plus `has_more`, `next_offset` and `cursor_id` for paging. Field ids follow Ortto's `type::name` convention; use Get Custom Fields to discover them.
   * @route POST /person/get
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Field ids to return for each person, e.g. [\"str::email\",\"str::first\",\"str::last\"]. Defaults to email, first and last name when omitted."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Optional Ortto filter object to narrow which people are returned, e.g. {\"$str::is\":{\"field_id\":\"str::email\",\"value\":\"jane@example.com\"}}. Omit to return all people (paged)."}
   * @paramDef {"type":"String","label":"Sort By Field","name":"sortByFieldId","dictionary":"getFieldsDictionary","description":"Optional field id to sort by, e.g. str::last."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction when Sort By Field is set. Defaults to Ascending."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum people to return per page (default 50, max 500)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of people to skip for pagination (default 0). Use next_offset from the previous response to page."}
   * @returns {Object}
   * @sampleResult {"contacts":[{"id":"0063f2c474449cd58a4c5600","fields":{"str::email":"jane@example.com","str::first":"Jane","str::last":"Doe"}}],"meta":{"total_contacts":1},"offset":0,"next_offset":1,"has_more":false}
   */
  async getPeople(fields, filter, sortByFieldId, sortOrder, limit, offset) {
    const logTag = '[getPeople]'

    const body = clean({
      fields: Array.isArray(fields) && fields.length ? fields : ['str::email', 'str::first', 'str::last'],
      filter,
      sort_by_field_id: sortByFieldId,
      sort_order: this.#resolveChoice(sortOrder, { Ascending: 'asc', Descending: 'desc' }),
      limit: limit || DEFAULT_LIMIT,
      offset: offset || 0,
    })

    return await this.#apiRequest({
      logTag,
      path: '/person/get',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Person by Email
   * @category People
   * @description Looks up a single person by their email address and returns the requested field ids. Convenience wrapper over Get People with an email-equals filter; returns the first matching person, or null when no match is found. Field ids follow Ortto's `type::name` convention.
   * @route POST /person/get-by-email
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the person to look up (matched against str::email)."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Field ids to return, e.g. [\"str::email\",\"str::first\",\"str::last\"]. Defaults to email, first and last name."}
   * @returns {Object}
   * @sampleResult {"contact":{"id":"00000000-0000-0000-0000-000000000000","fields":{"str::email":"jane@example.com","str::first":"Jane","str::last":"Doe"}}}
   */
  async getPersonByEmail(email, fields) {
    const logTag = '[getPersonByEmail]'

    const response = await this.#apiRequest({
      logTag,
      path: '/person/get',
      method: 'post',
      body: {
        fields: Array.isArray(fields) && fields.length ? fields : ['str::email', 'str::first', 'str::last'],
        filter: {
          '$str::is': {
            field_id: STANDARD_FIELD_IDS.email,
            value: email,
          },
        },
        limit: 1,
        offset: 0,
      },
    })

    const contacts = response.contacts || response.people || []

    return { contact: contacts[0] || null }
  }

  /**
   * @operationName Create Custom Activity
   * @category Activities
   * @description Records a custom activity event in Ortto against a person. References a registered custom activity id and identifies the target person via the Person Fields object (usually str::email) combined with Merge By. The Attributes object carries the activity's own payload keyed by that activity's field ids (e.g. str:cm:destination, int::v). If the person does not yet exist they are created. Custom activities power journeys and reporting in Ortto; up to 50 events per activity per contact per 24h are accepted.
   * @route POST /activities/create
   * @paramDef {"type":"String","label":"Activity ID","name":"activityId","required":true,"description":"The registered custom activity id (from Ortto's Activities settings), e.g. act:cm:flight-booked."}
   * @paramDef {"type":"Object","label":"Person Fields","name":"personFields","required":true,"description":"Person field ids that identify (and optionally set data on) the person, e.g. {\"str::email\":\"jane@example.com\"}."}
   * @paramDef {"type":"Object","label":"Attributes","name":"attributes","description":"Optional activity payload keyed by the activity's field ids, e.g. {\"str:cm:destination\":\"London\",\"int::v\":15300}."}
   * @paramDef {"type":"Array<String>","label":"Merge By","name":"mergeBy","description":"Person field ids used to match an existing person, e.g. [\"str::email\"]. Defaults to [\"str::email\"]."}
   * @returns {Object}
   * @sampleResult {"activities":[{"person_id":"0063f2c474449cd58a4c5600","status":"ingested","person_status":"created","activity_id":"0063f2c474bc15d72affcdcc"}]}
   */
  async createCustomActivity(activityId, personFields, attributes, mergeBy) {
    const logTag = '[createCustomActivity]'

    return await this.#apiRequest({
      logTag,
      path: '/activities/create',
      method: 'post',
      body: {
        activities: [
          clean({
            activity_id: activityId,
            fields: personFields || {},
            attributes: attributes || {},
          }),
        ],
        merge_by: Array.isArray(mergeBy) && mergeBy.length ? mergeBy : [STANDARD_FIELD_IDS.email],
      },
    })
  }

  /**
   * @operationName Get Custom Fields
   * @category Fields
   * @description Lists the custom person fields defined in the Ortto account, including each field's id (in Ortto's `type::name` convention), display name, and data type. Use these ids with Merge or Create Person (Raw Fields), Get People, and Create Custom Activity.
   * @route POST /person/custom-field/get
   * @returns {Object}
   * @sampleResult {"fields":[{"field":{"id":"str::company","name":"Company","type":"text"}},{"field":{"id":"bol::subscribed","name":"Subscribed","type":"boolean"}}]}
   */
  async getCustomFields() {
    const logTag = '[getCustomFields]'

    return await this.#apiRequest({
      logTag,
      path: '/person/custom-field/get',
      method: 'post',
      body: {},
    })
  }

  /**
   * @typedef {Object} getFieldsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter fields by name or id."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Ortto returns fields in a single call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Fields Dictionary
   * @description Provides a selectable list of Ortto person fields (built-in and custom) for choosing field ids in other operations. Each option's value is the Ortto field id (e.g. str::email).
   * @route POST /get-fields-dictionary
   * @paramDef {"type":"getFieldsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string used to filter the returned fields."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Email (str::email)","value":"str::email","note":"text"},{"label":"Company (str::company)","value":"str::company","note":"text"}],"cursor":null}
   */
  async getFieldsDictionary(payload) {
    const logTag = '[getFieldsDictionary]'
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag,
      path: '/person/custom-field/get',
      method: 'post',
      body: {},
    })

    const rawFields = response.fields || []

    let items = rawFields
      .map(entry => {
        const field = entry.field || entry
        const id = field.id || field.field_id
        const name = field.name || id

        if (!id) {
          return null
        }

        return {
          label: `${ name } (${ id })`,
          value: id,
          note: field.type || undefined,
        }
      })
      .filter(Boolean)

    if (search) {
      const needle = search.toLowerCase()

      items = items.filter(item => item.label.toLowerCase().includes(needle) || item.value.toLowerCase().includes(needle))
    }

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(OrttoService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Ortto → Settings → API keys → create a custom API key with the needed permissions. Sent as the X-Api-Key header.',
  },
  {
    name: 'region',
    displayName: 'Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['Global (Default)', 'Australia', 'Europe'],
    defaultValue: 'Global (Default)',
    required: false,
    shared: false,
    hint: 'Your Ortto instance region. Australia and Europe instances use region-specific API hosts (api.au.ap3api.com / api.eu.ap3api.com).',
  },
])
