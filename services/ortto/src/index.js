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
 * Ortto identifies every person/activity field by a typed field id of the form
 * `type::name` (for example `str::email`, `str::first`, `str::last`,
 * `phn::phone`). This map covers the standard built-in fields so callers can pass
 * plain values (email/first/last/phone) without knowing the field-id convention.
 * Custom fields are addressed by their own ids (discoverable via Get Custom
 * Fields) and can be supplied through the raw `fields` passthrough.
 */
const STANDARD_FIELD_IDS = {
  email: 'str::email',
  first: 'str::first',
  last: 'str::last',
  phone: 'phn::phone',
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
      [STANDARD_FIELD_IDS.phone]: phone,
    })

    if (rawFields && typeof rawFields === 'object') {
      Object.assign(fields, rawFields)
    }

    return fields
  }

  /**
   * @operationName Merge or Create Person
   * @category People
   * @description Creates a new person (contact) in Ortto or merges data into an existing one, matched by email. Ortto addresses every field by a typed field id of the form `type::name` (e.g. `str::email`, `str::first`, `str::last`, `phn::phone`). Provide the common values via Email/First Name/Last Name/Phone and/or supply a Raw Fields object keyed by field ids for custom fields; raw values override the convenience ones. By default the merge is queued asynchronously and Ortto returns a status/queue acknowledgement rather than the finished person. Use Get Custom Fields to discover custom field ids.
   * @route POST /person/merge
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Person's email address. Used as the match key and mapped to the str::email field."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Person's first name (mapped to str::first)."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Person's last name (mapped to str::last)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Person's phone number in E.164 format, e.g. +14155552671 (mapped to phn::phone)."}
   * @paramDef {"type":"Object","label":"Raw Fields","name":"rawFields","description":"Optional object of additional Ortto fields keyed by field id, e.g. {\"str::company\":\"Acme\",\"bol::subscribed\":true}. Merged on top of the convenience values. Discover custom field ids via Get Custom Fields."}
   * @paramDef {"type":"Boolean","label":"Run Asynchronously","name":"async","uiComponent":{"type":"TOGGLE"},"description":"When true (default), Ortto queues the merge and returns immediately. Set false to process inline and return the affected person id."}
   * @returns {Object}
   * @sampleResult {"people":[{"person_id":"00000000-0000-0000-0000-000000000000","status":"merged"}]}
   */
  async mergeOrCreatePerson(email, firstName, lastName, phone, rawFields, async) {
    const logTag = '[mergeOrCreatePerson]'

    const fields = this.#buildPersonFields({ email, firstName, lastName, phone, rawFields })

    return await this.#apiRequest({
      logTag,
      path: '/person/merge',
      method: 'post',
      body: {
        async: async !== false,
        merge_by: [STANDARD_FIELD_IDS.email],
        people: [{ fields }],
      },
    })
  }

  /**
   * @operationName Get People
   * @category People
   * @description Retrieves a page of people (contacts) from Ortto. Specify which field ids to return (e.g. `str::email`, `str::first`, `str::last`), an optional Ortto filter object to narrow the results, and pagination via Limit/Offset. Field ids follow Ortto's `type::name` convention; use Get Custom Fields to discover them.
   * @route POST /person/get
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Field ids to return for each person, e.g. [\"str::email\",\"str::first\",\"str::last\"]. Defaults to email, first and last name when omitted."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Optional Ortto filter object to narrow which people are returned. Omit to return all people (paged). See Ortto's filtering docs for the structure."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum people to return per page (default 50, max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of people to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"contacts":[{"id":"00000000-0000-0000-0000-000000000000","fields":{"str::email":"jane@example.com","str::first":"Jane","str::last":"Doe"}}],"offset":0,"has_more":false}
   */
  async getPeople(fields, filter, limit, offset) {
    const logTag = '[getPeople]'

    const body = clean({
      fields: Array.isArray(fields) && fields.length ? fields : ['str::email', 'str::first', 'str::last'],
      filter,
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
          $str: {
            field_id: STANDARD_FIELD_IDS.email,
            op: 'equal',
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
   * @description Records one or more custom activity events in Ortto against people. Each activity references a registered custom activity id and carries a `fields` object (keyed by Ortto field ids) and an `attributes` object that identifies the person (typically by str::email). Custom activities power journeys and reporting in Ortto.
   * @route POST /activities/create
   * @paramDef {"type":"String","label":"Activity ID","name":"activityId","required":true,"description":"The registered custom activity id (from Ortto's Activities settings), e.g. act:cm:my-activity."}
   * @paramDef {"type":"Object","label":"Attributes","name":"attributes","required":true,"description":"Object identifying the person and merge behavior, keyed by field ids, e.g. {\"str::email\":\"jane@example.com\"}."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","description":"Optional activity payload keyed by activity field ids, e.g. {\"str::order-id\":\"12345\",\"cur::amount\":49.99}."}
   * @returns {Object}
   * @sampleResult {"activities":[{"status":"created"}]}
   */
  async createCustomActivity(activityId, attributes, fields) {
    const logTag = '[createCustomActivity]'

    return await this.#apiRequest({
      logTag,
      path: '/activities/create',
      method: 'post',
      body: {
        activities: [
          clean({
            activity_id: activityId,
            attributes: attributes || {},
            fields: fields || {},
          }),
        ],
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
