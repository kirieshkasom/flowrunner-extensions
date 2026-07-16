const logger = {
  info: (...args) => console.log('[PostHog] info:', ...args),
  debug: (...args) => console.log('[PostHog] debug:', ...args),
  error: (...args) => console.log('[PostHog] error:', ...args),
  warn: (...args) => console.log('[PostHog] warn:', ...args),
}

const DEFAULT_HOST = 'https://us.i.posthog.com'
const DEFAULT_LIMIT = 100

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
 * @integrationName PostHog
 * @integrationIcon /icon.svg
 */
class PostHogService {
  constructor(config) {
    this.personalApiKey = config.personalApiKey
    this.projectApiKey = config.projectApiKey
    this.projectId = config.projectId
    this.host = (config.host || DEFAULT_HOST).replace(/\/+$/, '')
  }

  // Base URL for the project-scoped management/query REST API.
  get #projectBase() {
    return `${ this.host }/api/projects/${ this.projectId }`
  }

  // Management/query API — authenticates with the personal API key (Bearer).
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.personalApiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const body = error.body || {}
      const message = body.detail || body.message || body.type || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`PostHog API error: ${ message }`)
    }
  }

  // Ingestion/capture API — authenticates with the project API key inside the body.
  async #captureRequest({ event, distinctId, properties, timestamp, logTag }) {
    if (!this.projectApiKey) {
      throw new Error('PostHog API error: Project API Key (phc_...) is required for event ingestion. Add it in the service configuration.')
    }

    if (!distinctId) {
      throw new Error('PostHog API error: Distinct ID is required to capture an event.')
    }

    const payload = clean({
      api_key: this.projectApiKey,
      event,
      distinct_id: distinctId,
      properties,
      timestamp,
    })

    try {
      logger.debug(`${ logTag } - [POST::${ this.host }/i/v0/e/] event=${ event }`)

      return await Flowrunner.Request.post(`${ this.host }/i/v0/e/`)
        .set({ 'Content-Type': 'application/json' })
        .send(payload)
    } catch (error) {
      const body = error.body || {}
      const message = body.detail || body.message || body.type || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`PostHog API error: ${ message }`)
    }
  }

  /* ============================ Ingestion ============================ */

  /**
   * @operationName Capture Event
   * @category Ingestion
   * @description Sends a custom analytics event to PostHog for a user. Requires the Project API Key (phc_...) to be configured. Provide an event name, a distinct ID identifying the user, optional custom properties, and an optional ISO 8601 timestamp (defaults to now). Returns a status indicator confirming the event was queued for ingestion.
   * @route POST /capture-event
   * @paramDef {"type":"String","label":"Event Name","name":"event","required":true,"description":"Name of the event to record, e.g. 'user signed up' or 'button clicked'."}
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"Unique identifier of the user or entity the event belongs to, e.g. a user ID or email."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":false,"description":"Optional key/value properties attached to the event, e.g. {\"plan\":\"pro\",\"source\":\"web\"}."}
   * @paramDef {"type":"String","label":"Timestamp","name":"timestamp","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO 8601 timestamp of when the event occurred. Defaults to the current time."}
   * @returns {Object}
   * @sampleResult {"status":1}
   */
  async captureEvent(event, distinctId, properties, timestamp) {
    return await this.#captureRequest({
      logTag: '[captureEvent]',
      event,
      distinctId,
      properties,
      timestamp,
    })
  }

  /**
   * @operationName Identify User
   * @category Ingestion
   * @description Associates a set of person properties with a user by sending a $identify event. Requires the Project API Key (phc_...). The provided properties are stored on the person profile via $set so future events for this distinct ID inherit them. Returns a status indicator confirming ingestion.
   * @route POST /identify-user
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"Unique identifier of the user to identify and attach properties to."}
   * @paramDef {"type":"Object","label":"Person Properties","name":"properties","required":true,"description":"Key/value properties to set on the person profile, e.g. {\"email\":\"a@b.com\",\"name\":\"Ada\"}."}
   * @returns {Object}
   * @sampleResult {"status":1}
   */
  async identifyUser(distinctId, properties) {
    return await this.#captureRequest({
      logTag: '[identifyUser]',
      event: '$identify',
      distinctId,
      properties: { $set: properties || {} },
    })
  }

  /**
   * @operationName Create Alias
   * @category Ingestion
   * @description Merges two identities by sending a $create_alias event, linking an alias distinct ID to a primary distinct ID so their events are attributed to the same person. Requires the Project API Key (phc_...). Useful for connecting an anonymous ID to a known user after sign-up. Returns a status indicator confirming ingestion.
   * @route POST /create-alias
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"The primary distinct ID the alias should be merged into."}
   * @paramDef {"type":"String","label":"Alias","name":"alias","required":true,"description":"The alternate distinct ID to alias onto the primary distinct ID, e.g. a prior anonymous ID."}
   * @returns {Object}
   * @sampleResult {"status":1}
   */
  async createAlias(distinctId, alias) {
    return await this.#captureRequest({
      logTag: '[createAlias]',
      event: '$create_alias',
      distinctId,
      properties: { alias },
    })
  }

  /* ============================ Persons ============================ */

  /**
   * @operationName List Persons
   * @category Persons
   * @description Lists persons (identified users) in the project. Supports free-text search across distinct IDs and person properties and filtering by email. Returns a paginated list with each person's UUID, distinct IDs, properties, and creation date.
   * @route GET /list-persons
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional free-text search across distinct IDs and person properties."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"description":"Optional email address to filter persons by their email property."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of persons to return (default 100)."}
   * @returns {Object}
   * @sampleResult {"count":1,"next":null,"previous":null,"results":[{"id":42,"uuid":"018f-...","name":"ada@example.com","distinct_ids":["ada@example.com"],"properties":{"email":"ada@example.com","plan":"pro"},"created_at":"2026-01-10T12:00:00Z"}]}
   */
  async listPersons(search, email, limit) {
    return await this.#apiRequest({
      logTag: '[listPersons]',
      url: `${ this.#projectBase }/persons/`,
      method: 'get',
      query: {
        search,
        email,
        limit: limit || DEFAULT_LIMIT,
      },
    })
  }

  /**
   * @operationName Get Person
   * @category Persons
   * @description Retrieves a single person by their UUID, returning distinct IDs, all person properties, and creation date.
   * @route GET /get-person
   * @paramDef {"type":"String","label":"Person UUID","name":"personUuid","required":true,"description":"The UUID of the person to retrieve (from List Persons)."}
   * @returns {Object}
   * @sampleResult {"id":42,"uuid":"018f-...","name":"ada@example.com","distinct_ids":["ada@example.com"],"properties":{"email":"ada@example.com","plan":"pro"},"created_at":"2026-01-10T12:00:00Z"}
   */
  async getPerson(personUuid) {
    return await this.#apiRequest({
      logTag: '[getPerson]',
      url: `${ this.#projectBase }/persons/${ personUuid }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Person Properties
   * @category Persons
   * @description Updates the properties stored on a person profile. The supplied properties object is merged into the person's existing properties (existing keys are overwritten, others are preserved). Returns the updated person record.
   * @route PATCH /update-person-properties
   * @paramDef {"type":"String","label":"Person UUID","name":"personUuid","required":true,"description":"The UUID of the person to update (from List Persons)."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"Key/value properties to set on the person, e.g. {\"plan\":\"enterprise\",\"vip\":true}."}
   * @returns {Object}
   * @sampleResult {"id":42,"uuid":"018f-...","name":"ada@example.com","distinct_ids":["ada@example.com"],"properties":{"email":"ada@example.com","plan":"enterprise"},"created_at":"2026-01-10T12:00:00Z"}
   */
  async updatePersonProperties(personUuid, properties) {
    return await this.#apiRequest({
      logTag: '[updatePersonProperties]',
      url: `${ this.#projectBase }/persons/${ personUuid }/`,
      method: 'patch',
      body: { properties: properties || {} },
    })
  }

  /**
   * @operationName Delete Person
   * @category Persons
   * @description Permanently deletes a person and their profile from the project by UUID. This does not delete the underlying events unless configured server-side. Returns a confirmation object.
   * @route DELETE /delete-person
   * @paramDef {"type":"String","label":"Person UUID","name":"personUuid","required":true,"description":"The UUID of the person to delete (from List Persons)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"uuid":"018f-..."}
   */
  async deletePerson(personUuid) {
    await this.#apiRequest({
      logTag: '[deletePerson]',
      url: `${ this.#projectBase }/persons/${ personUuid }/`,
      method: 'delete',
    })

    return { deleted: true, uuid: personUuid }
  }

  /* ============================ Events ============================ */

  /**
   * @operationName List Events
   * @category Events
   * @description Queries ingested events for the project. Supports filtering by event name and by a time window (after/before ISO 8601 timestamps), and limiting the number of results. Returns matching events with their properties, distinct IDs, and timestamps.
   * @route GET /list-events
   * @paramDef {"type":"String","label":"Event Name","name":"event","required":false,"description":"Optional event name to filter by, e.g. 'user signed up'."}
   * @paramDef {"type":"String","label":"After","name":"after","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO 8601 timestamp; only return events at or after this time."}
   * @paramDef {"type":"String","label":"Before","name":"before","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO 8601 timestamp; only return events at or before this time."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of events to return (default 100)."}
   * @returns {Object}
   * @sampleResult {"next":null,"results":[{"id":"018f-...","distinct_id":"ada@example.com","event":"user signed up","properties":{"plan":"pro"},"timestamp":"2026-01-11T09:00:00Z"}]}
   */
  async listEvents(event, after, before, limit) {
    return await this.#apiRequest({
      logTag: '[listEvents]',
      url: `${ this.#projectBase }/events/`,
      method: 'get',
      query: {
        event,
        after,
        before,
        limit: limit || DEFAULT_LIMIT,
      },
    })
  }

  /**
   * @operationName Get Event
   * @category Events
   * @description Retrieves a single ingested event by its ID, returning the full event including its properties, distinct ID, and timestamp.
   * @route GET /get-event
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"description":"The ID of the event to retrieve (from List Events)."}
   * @returns {Object}
   * @sampleResult {"id":"018f-...","distinct_id":"ada@example.com","event":"user signed up","properties":{"plan":"pro"},"timestamp":"2026-01-11T09:00:00Z"}
   */
  async getEvent(eventId) {
    return await this.#apiRequest({
      logTag: '[getEvent]',
      url: `${ this.#projectBase }/events/${ eventId }/`,
      method: 'get',
    })
  }

  /* ============================ Insights / Query ============================ */

  /**
   * @operationName Run Query
   * @category Insights
   * @description Runs an analytics query against the project using PostHog's query API. Most commonly used for HogQL — pass a query object such as {"kind":"HogQLQuery","query":"SELECT event, count() FROM events GROUP BY event"}. HogQL is PostHog's SQL dialect over the events, persons, and related tables. Returns the query results (rows) along with the column definitions.
   * @route POST /run-query
   * @paramDef {"type":"Object","label":"Query","name":"query","required":true,"description":"A PostHog query object. For SQL use {\"kind\":\"HogQLQuery\",\"query\":\"SELECT ...\"}. Other kinds like TrendsQuery are also accepted and passed through unchanged."}
   * @returns {Object}
   * @sampleResult {"results":[["$pageview",1250],["user signed up",42]],"columns":["event","count()"],"types":["String","UInt64"],"hogql":"SELECT event, count() FROM events GROUP BY event"}
   */
  async runQuery(query) {
    return await this.#apiRequest({
      logTag: '[runQuery]',
      url: `${ this.#projectBase }/query/`,
      method: 'post',
      body: { query },
    })
  }

  /**
   * @operationName List Insights
   * @category Insights
   * @description Lists saved insights (charts and reports) in the project. Returns each insight's ID, short ID, name, description, and filters. Supports limiting the number of results.
   * @route GET /list-insights
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of insights to return (default 100)."}
   * @returns {Object}
   * @sampleResult {"count":1,"next":null,"results":[{"id":101,"short_id":"aB3xYz","name":"Weekly signups","description":"","filters":{"insight":"TRENDS"}}]}
   */
  async listInsights(limit) {
    return await this.#apiRequest({
      logTag: '[listInsights]',
      url: `${ this.#projectBase }/insights/`,
      method: 'get',
      query: { limit: limit || DEFAULT_LIMIT },
    })
  }

  /* ============================ Feature Flags ============================ */

  /**
   * @operationName List Feature Flags
   * @category Feature Flags
   * @description Lists feature flags in the project, returning each flag's ID, key, name, active state, and targeting filters. Supports limiting the number of results.
   * @route GET /list-feature-flags
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of feature flags to return (default 100)."}
   * @returns {Object}
   * @sampleResult {"count":1,"next":null,"results":[{"id":7,"key":"new-checkout","name":"New checkout flow","active":true,"filters":{"groups":[{"rollout_percentage":50}]}}]}
   */
  async listFeatureFlags(limit) {
    return await this.#apiRequest({
      logTag: '[listFeatureFlags]',
      url: `${ this.#projectBase }/feature_flags/`,
      method: 'get',
      query: { limit: limit || DEFAULT_LIMIT },
    })
  }

  /**
   * @operationName Create Feature Flag
   * @category Feature Flags
   * @description Creates a new feature flag in the project. Provide a unique key (used in code to evaluate the flag), a display name, whether it starts active, and an optional filters object defining release/targeting conditions (e.g. rollout percentage and property groups). Returns the created feature flag.
   * @route POST /create-feature-flag
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"Unique flag key referenced in code, e.g. 'new-checkout'."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Human-readable name/description of the feature flag."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Whether the flag is enabled on creation. Defaults to true."}
   * @paramDef {"type":"Object","label":"Filters","name":"filters","required":false,"description":"Optional targeting filters, e.g. {\"groups\":[{\"properties\":[],\"rollout_percentage\":50}]}."}
   * @returns {Object}
   * @sampleResult {"id":7,"key":"new-checkout","name":"New checkout flow","active":true,"filters":{"groups":[{"rollout_percentage":50}]}}
   */
  async createFeatureFlag(key, name, active, filters) {
    return await this.#apiRequest({
      logTag: '[createFeatureFlag]',
      url: `${ this.#projectBase }/feature_flags/`,
      method: 'post',
      body: clean({
        key,
        name,
        active: active === undefined ? true : active,
        filters,
      }),
    })
  }

  /**
   * @operationName Get Feature Flag
   * @category Feature Flags
   * @description Retrieves a single feature flag by its numeric ID, returning its key, name, active state, and targeting filters.
   * @route GET /get-feature-flag
   * @paramDef {"type":"String","label":"Feature Flag ID","name":"flagId","required":true,"description":"The numeric ID of the feature flag (from List Feature Flags)."}
   * @returns {Object}
   * @sampleResult {"id":7,"key":"new-checkout","name":"New checkout flow","active":true,"filters":{"groups":[{"rollout_percentage":50}]}}
   */
  async getFeatureFlag(flagId) {
    return await this.#apiRequest({
      logTag: '[getFeatureFlag]',
      url: `${ this.#projectBase }/feature_flags/${ flagId }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Feature Flag
   * @category Feature Flags
   * @description Updates a feature flag by ID. Commonly used to toggle a flag on or off via the active field, or to rename it or replace its targeting filters. Only the provided fields are changed. Returns the updated feature flag.
   * @route PATCH /update-feature-flag
   * @paramDef {"type":"String","label":"Feature Flag ID","name":"flagId","required":true,"description":"The numeric ID of the feature flag to update (from List Feature Flags)."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Set to enable or disable the flag. Leave empty to keep unchanged."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"description":"Optional new name for the flag. Leave empty to keep unchanged."}
   * @paramDef {"type":"Object","label":"Filters","name":"filters","required":false,"description":"Optional replacement targeting filters object. Leave empty to keep unchanged."}
   * @returns {Object}
   * @sampleResult {"id":7,"key":"new-checkout","name":"New checkout flow","active":false,"filters":{"groups":[{"rollout_percentage":50}]}}
   */
  async updateFeatureFlag(flagId, active, name, filters) {
    return await this.#apiRequest({
      logTag: '[updateFeatureFlag]',
      url: `${ this.#projectBase }/feature_flags/${ flagId }/`,
      method: 'patch',
      body: clean({ active, name, filters }),
    })
  }

  /**
   * @operationName Delete Feature Flag
   * @category Feature Flags
   * @description Soft-deletes a feature flag by setting it as deleted. The flag stops evaluating and is removed from the active list. Returns a confirmation object.
   * @route DELETE /delete-feature-flag
   * @paramDef {"type":"String","label":"Feature Flag ID","name":"flagId","required":true,"description":"The numeric ID of the feature flag to delete (from List Feature Flags)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"7"}
   */
  async deleteFeatureFlag(flagId) {
    await this.#apiRequest({
      logTag: '[deleteFeatureFlag]',
      url: `${ this.#projectBase }/feature_flags/${ flagId }/`,
      method: 'patch',
      body: { deleted: true },
    })

    return { deleted: true, id: flagId }
  }

  /* ============================ Cohorts ============================ */

  /**
   * @operationName List Cohorts
   * @category Cohorts
   * @description Lists cohorts (saved groups of persons matching defined criteria) in the project. Returns each cohort's ID, name, description, member count, and filter definition. Supports limiting the number of results.
   * @route GET /list-cohorts
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of cohorts to return (default 100)."}
   * @returns {Object}
   * @sampleResult {"count":1,"next":null,"results":[{"id":3,"name":"Power users","description":"","count":1200,"is_static":false}]}
   */
  async listCohorts(limit) {
    return await this.#apiRequest({
      logTag: '[listCohorts]',
      url: `${ this.#projectBase }/cohorts/`,
      method: 'get',
      query: { limit: limit || DEFAULT_LIMIT },
    })
  }

  /**
   * @operationName Get Cohort
   * @category Cohorts
   * @description Retrieves a single cohort by its numeric ID, returning its name, description, member count, and filter/group definition.
   * @route GET /get-cohort
   * @paramDef {"type":"String","label":"Cohort ID","name":"cohortId","required":true,"description":"The numeric ID of the cohort (from List Cohorts)."}
   * @returns {Object}
   * @sampleResult {"id":3,"name":"Power users","description":"","count":1200,"is_static":false,"filters":{"properties":{"type":"OR","values":[]}}}
   */
  async getCohort(cohortId) {
    return await this.#apiRequest({
      logTag: '[getCohort]',
      url: `${ this.#projectBase }/cohorts/${ cohortId }/`,
      method: 'get',
    })
  }

  /* ============================ Annotations ============================ */

  /**
   * @operationName Create Annotation
   * @category Annotations
   * @description Creates an annotation in the project. Annotations mark notable moments (releases, incidents, campaigns) on PostHog charts at a given date. Provide the annotation content and an ISO 8601 date marker for when it should appear. Returns the created annotation.
   * @route POST /create-annotation
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The annotation text, e.g. 'Deployed v2.0 checkout'."}
   * @paramDef {"type":"String","label":"Date Marker","name":"dateMarker","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 timestamp where the annotation appears on charts, e.g. '2026-01-15T00:00:00Z'."}
   * @returns {Object}
   * @sampleResult {"id":15,"content":"Deployed v2.0 checkout","date_marker":"2026-01-15T00:00:00Z","created_at":"2026-01-15T10:00:00Z","scope":"project"}
   */
  async createAnnotation(content, dateMarker) {
    return await this.#apiRequest({
      logTag: '[createAnnotation]',
      url: `${ this.#projectBase }/annotations/`,
      method: 'post',
      body: clean({
        content,
        date_marker: dateMarker,
      }),
    })
  }

  /**
   * @operationName List Annotations
   * @category Annotations
   * @description Lists annotations in the project, returning each annotation's ID, content, date marker, scope, and creation date. Supports limiting the number of results.
   * @route GET /list-annotations
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of annotations to return (default 100)."}
   * @returns {Object}
   * @sampleResult {"count":1,"next":null,"results":[{"id":15,"content":"Deployed v2.0 checkout","date_marker":"2026-01-15T00:00:00Z","scope":"project"}]}
   */
  async listAnnotations(limit) {
    return await this.#apiRequest({
      logTag: '[listAnnotations]',
      url: `${ this.#projectBase }/annotations/`,
      method: 'get',
      query: { limit: limit || DEFAULT_LIMIT },
    })
  }

  /* ============================ Dictionaries ============================ */

  /**
   * @typedef {Object} getFeatureFlagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter feature flags by key or name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (full next-page URL returned by PostHog)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Feature Flags Dictionary
   * @description Provides a selectable list of feature flags for parameters such as Feature Flag ID. Each option's value is the flag's numeric ID.
   * @route POST /get-feature-flags-dictionary
   * @paramDef {"type":"getFeatureFlagsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing feature flags."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"New checkout flow","value":"7","note":"key: new-checkout - active"}],"cursor":null}
   */
  async getFeatureFlagsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = cursor
      ? await this.#apiRequest({ logTag: '[getFeatureFlagsDictionary]', url: cursor, method: 'get' })
      : await this.#apiRequest({
        logTag: '[getFeatureFlagsDictionary]',
        url: `${ this.#projectBase }/feature_flags/`,
        method: 'get',
        query: { search, limit: 50 },
      })

    const results = response.results || []

    return {
      items: results.map(flag => ({
        label: flag.name || flag.key,
        value: String(flag.id),
        note: `key: ${ flag.key } - ${ flag.active ? 'active' : 'inactive' }`,
      })),
      cursor: response.next || null,
    }
  }

  /**
   * @typedef {Object} getInsightsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter insights by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (full next-page URL returned by PostHog)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Insights Dictionary
   * @description Provides a selectable list of saved insights. Each option's value is the insight's numeric ID.
   * @route POST /get-insights-dictionary
   * @paramDef {"type":"getInsightsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing insights."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Weekly signups","value":"101","note":"short id: aB3xYz"}],"cursor":null}
   */
  async getInsightsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = cursor
      ? await this.#apiRequest({ logTag: '[getInsightsDictionary]', url: cursor, method: 'get' })
      : await this.#apiRequest({
        logTag: '[getInsightsDictionary]',
        url: `${ this.#projectBase }/insights/`,
        method: 'get',
        query: { search, limit: 50 },
      })

    const results = response.results || []

    return {
      items: results.map(insight => ({
        label: insight.name || insight.derived_name || `Insight ${ insight.id }`,
        value: String(insight.id),
        note: insight.short_id ? `short id: ${ insight.short_id }` : undefined,
      })),
      cursor: response.next || null,
    }
  }
}

Flowrunner.ServerCode.addService(PostHogService, [
  {
    name: 'personalApiKey',
    displayName: 'Personal API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Personal API key for reading data and management operations. Create one in PostHog under Settings → Personal API Keys.',
  },
  {
    name: 'projectApiKey',
    displayName: 'Project API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Project API Key (phc_...) used for the Capture Event / ingestion operations. Find it under Project Settings → Project API Key.',
  },
  {
    name: 'projectId',
    displayName: 'Project ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The numeric project ID used in management API calls. Find it in PostHog under Settings.',
  },
  {
    name: 'host',
    displayName: 'Host',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: 'https://us.i.posthog.com',
    hint: 'Your PostHog host. US Cloud: https://us.i.posthog.com (default). EU Cloud: https://eu.i.posthog.com. Self-hosted: your own URL.',
  },
])
