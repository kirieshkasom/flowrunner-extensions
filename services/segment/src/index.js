// Segment Public API integration - Sources, Destinations, Tracking Plans, Warehouses,
// Functions, Engage/Unify (Audiences, Computed Traits, Profiles Sync), Reverse ETL,
// Transformations, Regulations, IAM, and audit events. Authenticates with a Public API
// Token sent as `Authorization: Bearer`.

// ============================================================================
//  CONSTANTS
// ============================================================================
const API_BASE_URL = 'https://api.segmentapis.com'
// Tracking API (data plane) - a different host and auth (source Write Key over HTTP Basic)
// than the Public API above, which uses a workspace-scoped Bearer token.
const TRACKING_API_BASE_URL = 'https://api.segment.io/v1'

const ERROR_HINTS = {
  401: 'Authentication failed — check the API Token config item.',
  403: 'Permission denied — this token cannot perform this action, or the workspace feature is not enabled.',
  404: 'Not found — the ID may be wrong; use the matching List/Get action to pick a valid one.',
  429: 'Rate limit hit — retry in a moment (see the Retry-After header).',
}

// Friendly DROPDOWN labels the UI shows, mapped to the API values Segment expects.
const TRACKING_PLAN_TYPE_MAP = {
  'Live': 'LIVE',
  'Engage': 'ENGAGE',
  'Property Library': 'PROPERTY_LIBRARY',
  'Rule Library': 'RULE_LIBRARY',
  'Template': 'TEMPLATE',
}
const FUNCTION_TYPE_MAP = {
  'Destination': 'DESTINATION',
  'Insert Destination': 'INSERT_DESTINATION',
  'Insert Source': 'INSERT_SOURCE',
  'Insert Transformation': 'INSERT_TRANSFORMATION',
  'Source': 'SOURCE',
}
const INCLUDE_SCHEDULES_MAP = {
  'Schedules': 'schedules',
}
const AUDIENCE_TYPE_MAP = {
  'Users': 'USERS',
  'Accounts': 'ACCOUNTS',
  'Linked': 'LINKED',
}
const AUDIENCE_STRATEGY_MAP = {
  'Periodic': 'PERIODIC',
  'Specific Days': 'SPECIFIC_DAYS',
}
const CANCEL_SYNC_REASON_MAP = {
  'Incorrect Model': '0',
  'Incorrect Destination': '1',
  'Incorrect Keys': '2',
  'Incorrect Mapping': '3',
  'Other': '4',
}
// Regulation type enum for user-subject regulations (create/list) — no archive-delete option.
const REGULATION_TYPE_MAP = {
  'Delete Only': 'DELETE_ONLY',
  'Delete Internal': 'DELETE_INTERNAL',
  'Suppress Only': 'SUPPRESS_ONLY',
  'Suppress With Delete': 'SUPPRESS_WITH_DELETE',
  'Suppress With Delete Internal': 'SUPPRESS_WITH_DELETE_INTERNAL',
  'Unsuppress': 'UNSUPPRESS',
}
// Regulation type enum for anonymous-id-subject regulations — adds Delete Archive Only.
const REGULATION_TYPE_WITH_ARCHIVE_MAP = {
  'Delete Only': 'DELETE_ONLY',
  'Delete Archive Only': 'DELETE_ARCHIVE_ONLY',
  'Delete Internal': 'DELETE_INTERNAL',
  'Suppress Only': 'SUPPRESS_ONLY',
  'Suppress With Delete': 'SUPPRESS_WITH_DELETE',
  'Suppress With Delete Internal': 'SUPPRESS_WITH_DELETE_INTERNAL',
  'Unsuppress': 'UNSUPPRESS',
}
const SUBJECT_TYPE_USER_OBJECT_MAP = {
  'User ID': 'USER_ID',
  'Object ID': 'OBJECT_ID',
}
const SUBJECT_TYPE_USER_ANONYMOUS_MAP = {
  'User ID': 'USER_ID',
  'Anonymous ID': 'ANONYMOUS_ID',
}
const SUBJECT_TYPE_OBJECT_ONLY_MAP = {
  'Object ID': 'OBJECT_ID',
}
const REGULATION_STATUS_MAP = {
  'Finished': 'FINISHED',
  'Running': 'RUNNING',
  'Initialized': 'INITIALIZED',
  'Failed': 'FAILED',
  'Invalid': 'INVALID',
  'Not Supported': 'NOT_SUPPORTED',
  'Partial Success': 'PARTIAL_SUCCESS',
}
const GRANULARITY_MAP = {
  'Day': 'DAY',
  'Hour': 'HOUR',
  'Minute': 'MINUTE',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Segment] info:', ...args),
  debug: (...args) => console.log('[Segment] debug:', ...args),
  error: (...args) => console.log('[Segment] error:', ...args),
  warn: (...args) => console.log('[Segment] warn:', ...args),
}

// ============================================================================
//  TYPEDEFS - typed-array element schemas (AI-tool clarity)
// ============================================================================
/**
 * @typedef {Object} FilterAction
 * @property {String} type - The kind of filtering to apply: DROP, SAMPLE, ALLOW_PROPERTIES, or DROP_PROPERTIES.
 * @property {Number} percent - For SAMPLE actions, the percentage (0-100) of matching events to keep.
 * @property {Object} fields - For ALLOW_PROPERTIES / DROP_PROPERTIES actions, the event fields to allow or drop.
 */

/**
 * @typedef {Object} FunctionSetting
 * @property {String} name - The setting key.
 * @property {String} label - The UI label shown to users of the Function.
 * @property {String} type - The setting value type (e.g. STRING, BOOLEAN, ARRAY).
 * @property {String} description - Help text describing the setting.
 * @property {Boolean} required - Whether the setting must be provided.
 * @property {Boolean} sensitive - Whether the value is secret and should be masked.
 */

/**
 * @typedef {Object} PermissionResource
 * @property {String} id - The resource ID the role applies to (e.g. the workspace, source, or space id).
 * @property {String} type - The resource type. One of WORKSPACE, SOURCE, SPACE, FUNCTION, WAREHOUSE.
 */

/**
 * @typedef {Object} Permission
 * @property {String} roleId - The Role to grant (pick a role id from Get Roles Dictionary).
 * @property {Array.<PermissionResource>} resources - The resources the role applies to.
 */

/**
 * @typedef {Object} Invite
 * @property {String} email - The email address to invite to the workspace.
 * @property {Array.<Permission>} permissions - The role + resource assignments to grant the invited user.
 */

/**
 * @typedef {Object} IdSyncConfig
 * @property {String} id - The destination ID-sync slot identifier.
 * @property {String} externalId - The external identifier to map into the destination.
 */

/**
 * @typedef {Object} ProfilesSyncOverride
 * @property {Boolean} enabled - Whether to sync this collection/property.
 * @property {String} collection - The collection the override applies to (e.g. tracks).
 * @property {String} property - The property within the collection to override.
 */

/**
 * @typedef {Object} WarehouseSyncOverride
 * @property {String} sourceId - The Source the override applies to.
 * @property {Boolean} enabled - Whether to sync this collection/property.
 * @property {String} collection - The collection the override applies to (e.g. checkout_started).
 * @property {String} property - The property within the collection to override.
 */

/**
 * @typedef {Object} PropertyRename
 * @property {String} oldName - The existing property/trait name to rename.
 * @property {String} newName - The new name to apply.
 */

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getSourcesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Sources by name or slug."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getDestinationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Destinations by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getTrackingPlansDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Tracking Plans by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getWarehousesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Warehouses by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getFunctionsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Functions by display name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getDestinationFiltersDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Destination","name":"destinationId","required":true,"description":"The Destination whose filters to list."}
 */

/**
 * @typedef {Object} getDestinationFiltersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter filters by title."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getDestinationFiltersDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent Destination whose filters to list."}
 */

/**
 * @typedef {Object} getSourceCatalogDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Source types by name or slug."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getDestinationCatalogDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Destination types by name or slug."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getWarehouseCatalogDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Warehouse types by name or slug."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getSpacesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Spaces by name or slug."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getAudiencesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Space","name":"spaceId","required":true,"description":"The Engage Space whose audiences to list."}
 */

/**
 * @typedef {Object} getAudiencesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Audiences by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getAudiencesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent Space whose audiences to list."}
 */

/**
 * @typedef {Object} getComputedTraitsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Space","name":"spaceId","required":true,"description":"The Engage Space whose computed traits to list."}
 */

/**
 * @typedef {Object} getComputedTraitsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Computed Traits by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getComputedTraitsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent Space whose computed traits to list."}
 */

/**
 * @typedef {Object} getSpaceFiltersDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Space","name":"integrationId","required":true,"description":"The Engage Space (integrationId) whose filters to list."}
 */

/**
 * @typedef {Object} getSpaceFiltersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Space Filters by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getSpaceFiltersDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent Space whose filters to list."}
 */

/**
 * @typedef {Object} getAudienceSchedulesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Space","name":"spaceId","required":true,"description":"The Engage Space the audience belongs to."}
 * @paramDef {"type":"String","label":"Audience","name":"audienceId","required":true,"description":"The Audience whose schedules to list."}
 */

/**
 * @typedef {Object} getAudienceSchedulesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter schedules by strategy."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getAudienceSchedulesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent Space and Audience whose schedules to list."}
 */

/**
 * @typedef {Object} getAudienceDestinationsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Space","name":"spaceId","required":true,"description":"The Engage Space the audience belongs to."}
 * @paramDef {"type":"String","label":"Audience","name":"audienceId","required":true,"description":"The Audience whose destination connections to list."}
 */

/**
 * @typedef {Object} getAudienceDestinationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter connections by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getAudienceDestinationsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent Space and Audience whose connections to list."}
 */

/**
 * @typedef {Object} getSupportedActionsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Space","name":"spaceId","required":true,"description":"The Engage Space to list supported destination actions for."}
 * @paramDef {"type":"String","label":"Audience Type","name":"audienceType","required":true,"description":"The audience type (USERS, ACCOUNTS, or LINKED)."}
 * @paramDef {"type":"String","label":"Destination Slug","name":"slug","description":"Optional destination slug to narrow the actions to one destination."}
 */

/**
 * @typedef {Object} getSupportedActionsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter actions by name."}
 * @paramDef {"type":"getSupportedActionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the Space, audience type, and optional destination slug whose actions to list."}
 */

/**
 * @typedef {Object} getReverseEtlModelsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Reverse ETL Models by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getTransformationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Transformations by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getUsersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Users by name or email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getUserGroupsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter User Groups by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getRolesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Roles by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getProfilesWarehousesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Space","name":"spaceId","required":true,"description":"The Engage Space whose profiles warehouses to list."}
 */

/**
 * @typedef {Object} getProfilesWarehousesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter Profiles Warehouses by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getProfilesWarehousesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent Space whose profiles warehouses to list."}
 */

/**
 * @typedef {Object} getRegulationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter regulations by id, status, or type."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @integrationName Segment
 * @integrationIcon /icon.svg
 * @integrationTriggersScope SINGLE_APP
 */
class Segment {
  constructor(config) {
    this.config = config || {}
    this.apiToken = this.config.apiToken
    this.writeKey = this.config.writeKey
  }

  // ==========================================================================
  //  CORE - every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set(this.#headers())
        .query(query || {})

      if (body !== undefined && body !== null) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #headers() {
    return {
      Authorization: `Bearer ${ this.apiToken }`,
      'Content-Type': 'application/json',
    }
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.code || error?.body?.status
    const apiMessage = error?.body?.error?.message || error?.body?.message || error?.message || 'Request failed'
    const hint = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  // Translate a friendly DROPDOWN label into the API value; pass through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Builds the Segment pagination query (pagination.count, pagination.cursor) from the
  // shared count/cursor action params. The Segment Public API documents DOT notation
  // (e.g. /warehouses?pagination.count=3&pagination.cursor=Mw==) - bracket-named params are
  // silently ignored by the gateway, so paging never advances. Empty values are omitted so the
  // API uses its default. docs: https://docs.segmentapis.com/tag/Pagination/
  #paginationQuery(count, cursor) {
    const query = {}

    if (count !== undefined && count !== null && count !== '') {
      query['pagination.count'] = count
    }

    if (cursor) {
      query['pagination.cursor'] = cursor
    }

    return query
  }

  // Throws a remediating error when a required path id / body field is missing or blank, so a
  // blank dropdown never flows into the URL as `/undefined` and returns an opaque provider 404.
  #requireParam(value, message) {
    const empty = value === undefined || value === null || value === '' ||
      (Array.isArray(value) && value.length === 0)

    if (empty) {
      throw new Error(message)
    }
  }

  // ==========================================================================
  //  TRACKING - data plane calls, separate host + auth from #apiRequest above
  // ==========================================================================
  // The Tracking API authenticates with a per-source Write Key over HTTP Basic
  // (username = write key, password blank), not the workspace API Token.
  async #trackingRequest(path, body) {
    const logTag = `tracking:${ path }`

    if (!this.writeKey) {
      throw new Error('Source Write Key is required to send events — set the Write Key config item (Connections > Sources > Settings > API Keys).')
    }

    try {
      const url = `${ TRACKING_API_BASE_URL }/${ path }`

      logger.debug(`${ logTag } POST ${ url }`)

      return await Flowrunner.Request.post(url)
        .set({
          Authorization: `Basic ${ Buffer.from(`${ this.writeKey }:`).toString('base64') }`,
          'Content-Type': 'application/json',
        })
        .send(this.#clean(body))
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  // Strips undefined/null properties so optional Tracking API fields are omitted rather than
  // sent as explicit nulls.
  #clean(body) {
    return Object.fromEntries(Object.entries(body).filter(([ , value ]) => value !== undefined && value !== null))
  }

  // Every Tracking API call (except Alias) requires at least one identifier for who the event
  // is about.
  #requireIdentity(userId, anonymousId) {
    if (!userId && !anonymousId) {
      throw new Error('Either User ID or Anonymous ID is required to identify who this event is for.')
    }
  }

  /**
   * @operationName Track Event
   * @category Tracking
   * @description Records an action a user or group performed, e.g. "Order Completed", along with any properties describing it. Sent to the Segment Tracking API (data plane) using the source Write Key config item, not the workspace API Token. Requires a User ID, an Anonymous ID, or both, to identify who performed the event.
   * @route POST /track
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"The identified user's unique ID. Provide this, Anonymous ID, or both."}
   * @paramDef {"type":"String","label":"Anonymous ID","name":"anonymousId","description":"A pseudo-unique ID for a not-yet-identified user, e.g. a device or cookie ID. Provide this, User ID, or both."}
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"description":"The name of the action the user performed, e.g. \"Order Completed\"."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","freeform":true,"description":"Free-form properties describing the event as a JSON object, e.g. {\"revenue\":19.99,\"currency\":\"USD\"}. Keys depend on the event and are not enumerable ahead of time."}
   * @paramDef {"type":"Object","label":"Context","name":"context","freeform":true,"description":"Free-form context about the circumstance of the event as a JSON object, e.g. {\"ip\":\"8.8.8.8\",\"userAgent\":\"...\"}. See Segment's Context field documentation."}
   * @paramDef {"type":"String","label":"Timestamp","name":"timestamp","description":"ISO-8601 timestamp of when the event actually took place, used for backdating historical events. Defaults to now if omitted."}
   * @paramDef {"type":"Object","label":"Integrations","name":"integrations","freeform":true,"description":"Controls which enabled Destinations receive this event as a JSON object, e.g. {\"All\":false,\"Salesforce\":true}."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  // API: https://segment.com/docs/connections/spec/track/
  async track(userId, anonymousId, event, properties, context, timestamp, integrations) {
    this.#requireParam(event, 'Event is required — enter the name of the action the user performed.')
    this.#requireIdentity(userId, anonymousId)

    return await this.#trackingRequest('track', { userId, anonymousId, event, properties, context, timestamp, integrations })
  }

  /**
   * @operationName Identify User
   * @category Tracking
   * @description Ties a user to their actions and records traits about them, e.g. name, email, or plan. Sent to the Segment Tracking API (data plane) using the source Write Key config item. Requires a User ID, an Anonymous ID, or both.
   * @route POST /identify
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"The identified user's unique ID. Provide this, Anonymous ID, or both."}
   * @paramDef {"type":"String","label":"Anonymous ID","name":"anonymousId","description":"A pseudo-unique ID for a not-yet-identified user, e.g. a device or cookie ID. Provide this, User ID, or both."}
   * @paramDef {"type":"Object","label":"Traits","name":"traits","freeform":true,"description":"Free-form information about the user as a JSON object, e.g. {\"name\":\"Ada Lovelace\",\"email\":\"ada@example.com\",\"plan\":\"enterprise\"}."}
   * @paramDef {"type":"Object","label":"Context","name":"context","freeform":true,"description":"Free-form context about the circumstance of the call as a JSON object, e.g. {\"ip\":\"8.8.8.8\"}. See Segment's Context field documentation."}
   * @paramDef {"type":"String","label":"Timestamp","name":"timestamp","description":"ISO-8601 timestamp of when the identify actually took place, used for backdating. Defaults to now if omitted."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  // API: https://segment.com/docs/connections/spec/identify/
  async identify(userId, anonymousId, traits, context, timestamp) {
    this.#requireIdentity(userId, anonymousId)

    return await this.#trackingRequest('identify', { userId, anonymousId, traits, context, timestamp })
  }

  /**
   * @operationName Group User
   * @category Tracking
   * @description Associates an identified or anonymous user with a group, e.g. a company, organization, or account, and records traits about that group. Sent to the Segment Tracking API (data plane) using the source Write Key config item.
   * @route POST /group
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"The identified user's unique ID. Provide this, Anonymous ID, or both."}
   * @paramDef {"type":"String","label":"Anonymous ID","name":"anonymousId","description":"A pseudo-unique ID for a not-yet-identified user, e.g. a device or cookie ID. Provide this, User ID, or both."}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"description":"The unique ID of the group, e.g. a company or organization ID, to associate the user with."}
   * @paramDef {"type":"Object","label":"Traits","name":"traits","freeform":true,"description":"Free-form information about the group as a JSON object, e.g. {\"name\":\"Initech\",\"industry\":\"Technology\",\"employees\":329}."}
   * @paramDef {"type":"Object","label":"Context","name":"context","freeform":true,"description":"Free-form context about the circumstance of the call as a JSON object, e.g. {\"ip\":\"8.8.8.8\"}. See Segment's Context field documentation."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  // API: https://segment.com/docs/connections/spec/group/
  async group(userId, anonymousId, groupId, traits, context) {
    this.#requireIdentity(userId, anonymousId)
    this.#requireParam(groupId, 'Group ID is required — enter the ID of the group to associate the user with.')

    return await this.#trackingRequest('group', { userId, anonymousId, groupId, traits, context })
  }

  /**
   * @operationName Track Page View
   * @category Tracking
   * @description Records a website page view, along with optional properties about the page. Sent to the Segment Tracking API (data plane) using the source Write Key config item. Requires a User ID, an Anonymous ID, or both.
   * @route POST /page
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"The identified user's unique ID. Provide this, Anonymous ID, or both."}
   * @paramDef {"type":"String","label":"Anonymous ID","name":"anonymousId","description":"A pseudo-unique ID for a not-yet-identified user, e.g. a device or cookie ID. Provide this, User ID, or both."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the page, e.g. \"Pricing\"."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"The category of the page, e.g. \"Docs\". Often used together with Name to namespace pages."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","freeform":true,"description":"Free-form properties of the page as a JSON object, e.g. {\"url\":\"https://example.com/pricing\",\"title\":\"Pricing\",\"referrer\":\"https://google.com\"}."}
   * @paramDef {"type":"Object","label":"Context","name":"context","freeform":true,"description":"Free-form context about the circumstance of the call as a JSON object, e.g. {\"ip\":\"8.8.8.8\"}. See Segment's Context field documentation."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  // API: https://segment.com/docs/connections/spec/page/
  async page(userId, anonymousId, name, category, properties, context) {
    this.#requireIdentity(userId, anonymousId)

    return await this.#trackingRequest('page', { userId, anonymousId, name, category, properties, context })
  }

  /**
   * @operationName Track Screen View
   * @category Tracking
   * @description Records a mobile app screen view, along with optional properties about the screen. Sent to the Segment Tracking API (data plane) using the source Write Key config item. Requires a User ID, an Anonymous ID, or both.
   * @route POST /screen
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"The identified user's unique ID. Provide this, Anonymous ID, or both."}
   * @paramDef {"type":"String","label":"Anonymous ID","name":"anonymousId","description":"A pseudo-unique ID for a not-yet-identified user, e.g. a device or cookie ID. Provide this, User ID, or both."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the screen, e.g. \"Home\"."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","freeform":true,"description":"Free-form properties of the screen as a JSON object, e.g. {\"variant\":\"A\"}."}
   * @paramDef {"type":"Object","label":"Context","name":"context","freeform":true,"description":"Free-form context about the circumstance of the call as a JSON object, e.g. {\"ip\":\"8.8.8.8\"}. See Segment's Context field documentation."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  // API: https://segment.com/docs/connections/spec/screen/
  async screen(userId, anonymousId, name, properties, context) {
    this.#requireIdentity(userId, anonymousId)

    return await this.#trackingRequest('screen', { userId, anonymousId, name, properties, context })
  }

  /**
   * @operationName Alias User
   * @category Tracking
   * @description Merges a previous, typically anonymous, identity with a new, typically known, User ID for the same user. Sent to the Segment Tracking API (data plane) using the source Write Key config item. Use this when a previously-anonymous user becomes identified (e.g. signs up or logs in).
   * @route POST /alias
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The new (current) identified User ID to alias to."}
   * @paramDef {"type":"String","label":"Previous ID","name":"previousId","required":true,"description":"The previous User ID or Anonymous ID being merged into the User ID."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  // API: https://segment.com/docs/connections/spec/alias/
  async alias(userId, previousId) {
    this.#requireParam(userId, 'User ID is required — enter the new/current identified User ID.')
    this.#requireParam(previousId, 'Previous ID is required — enter the previous User ID or Anonymous ID being merged.')

    return await this.#trackingRequest('alias', { userId, previousId })
  }

  /**
   * @operationName Send Batch Events
   * @category Tracking
   * @description Sends up to 500 Track/Identify/Group/Page/Screen/Alias calls in a single request (max ~500KB total, 32KB per call). Sent to the Segment Tracking API (data plane) using the source Write Key config item. Use this to reduce round-trips when sending many events at once.
   * @route POST /batch
   * @paramDef {"type":"Array<Object>","label":"Batch","name":"batch","required":true,"description":"The events to send, each a JSON call object with a \"type\" field (track, identify, group, page, screen, or alias) plus that call's fields, e.g. [{\"type\":\"track\",\"userId\":\"u1\",\"event\":\"Signed Up\"}]."}
   * @paramDef {"type":"Object","label":"Context","name":"context","freeform":true,"description":"Free-form context shared across all calls in the batch as a JSON object, e.g. {\"ip\":\"8.8.8.8\"}."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  // API: https://segment.com/docs/connections/spec/batch/
  async batch(batch, context) {
    this.#requireParam(batch, 'Batch is required — provide an array of track/identify/group/page/screen/alias call objects.')

    return await this.#trackingRequest('batch', { batch, context })
  }

  // ==========================================================================
  //  WORKSPACE
  // ==========================================================================
  /**
   * @operationName Get Workspace
   * @category Workspace
   * @description Returns the Segment workspace the API token belongs to, including its id, name, and slug. Use this to confirm which workspace your token targets before managing Sources, Destinations, or other resources.
   * @route POST /get-workspace
   * @returns {Object}
   * @sampleResult {"data":{"workspace":{"id":"9aQ1Lj62S4bomZKLF4DPqW","name":"papi e2e","slug":"papi-e2e"}}}
   */
  // API: https://docs.segmentapis.com/tag/Workspaces/
  async getWorkspace() {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/`,
      logTag: 'getWorkspace',
    })
  }

  // ==========================================================================
  //  SOURCES
  // ==========================================================================
  /**
   * @operationName List Sources
   * @category Sources
   * @description Returns a page of Sources in the workspace. Use this to browse your data Sources or find a Source ID before getting, updating, or deleting one.
   * @route POST /list-sources
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many Sources to return per page (Segment pagination.count). Leave blank for the API default."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response's pagination.next, to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":{"sources":[{"id":"qQEHquLrjRDN9j1ByrChyn","slug":"swift","name":"","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","enabled":true,"writeKeys":["bEj5MzDqCkHYRqreZgbPuH"],"metadata":{},"settings":{},"labels":[]}],"pagination":{"current":"MA==","totalEntries":2}}}
   */
  // API: https://docs.segmentapis.com/tag/Sources/
  async listSources(count, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/sources`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listSources',
    })
  }

  /**
   * @operationName Get Source
   * @category Sources
   * @description Retrieves a single Source by its ID, including its write keys, settings, and metadata. The Source field is a dropdown backed by a dictionary so you can pick instead of pasting an ID.
   * @route POST /get-source
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source to retrieve. Pick from the dropdown or paste a Source ID."}
   * @returns {Object}
   * @sampleResult {"data":{"source":{"id":"9btKuCR4Wq674VajpuLDNV","slug":"swift","name":"My Source","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","enabled":true,"writeKeys":["bEj5MzDqCkHYRqreZgbPuH"],"metadata":{},"settings":{},"labels":[]}}}
   */
  // API: https://docs.segmentapis.com/tag/Sources/
  async getSource(sourceId) {
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/sources/${ sourceId }`,
      logTag: 'getSource',
    })
  }

  /**
   * @operationName Create Source
   * @category Sources
   * @description Creates a new data Source in the workspace from a Source type (metadata id) picked from the catalog. Use this to connect a new website, app, or server that will send data into Segment.
   * @route POST /create-source
   * @paramDef {"type":"String","label":"Slug","name":"slug","required":true,"description":"The slug that identifies this Source in the Segment app (e.g. \"my-website-prod\")."}
   * @paramDef {"type":"String","label":"Source Type","name":"metadataId","dictionary":"getSourceCatalogDictionary","required":true,"description":"The Source type (metadata id) this instance derives from, e.g. JavaScript, HTTP API. Pick from the dropdown."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Enable to allow this Source to send data. Defaults to true."}
   * @paramDef {"type":"Object","label":"Settings","name":"settings","freeform":true,"description":"Instance-specific configuration for this Source as a JSON object. Keys depend on the Source type and are not enumerable ahead of time."}
   * @returns {Object}
   * @sampleResult {"data":{"source":{"id":"9btKuCR4Wq674VajpuLDNV","slug":"my-test-source-2gwoon","name":"my-test-source-2gwoon","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","enabled":true,"writeKeys":["3qvaDYqXPZjAcVM0nAPlfQrREHEFTcVz"],"metadata":{},"settings":{},"labels":[]}}}
   */
  // API: https://docs.segmentapis.com/tag/Sources/
  async createSource(slug, metadataId, enabled, settings) {
    this.#requireParam(slug, 'Slug is required — enter a slug for the Source.')
    this.#requireParam(metadataId, 'Source Type is required — pick one from the Source Type dropdown.')

    const body = {
      slug,
      metadataId,
      enabled: enabled === undefined ? true : enabled,
    }

    if (settings !== undefined && settings !== null) {
      body.settings = settings
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/sources`,
      method: 'post',
      body,
      logTag: 'createSource',
    })
  }

  /**
   * @operationName Update Source
   * @category Sources
   * @description Updates an existing Source's name, slug, enabled state, or settings. Use this to rename a Source or pause/resume its data flow without recreating it.
   * @route POST /update-source
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source to update. Pick from the dropdown or paste a Source ID."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"A human-readable name for the Source."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Enable to allow the Source to send data; disable to pause it."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"The slug that identifies the Source."}
   * @paramDef {"type":"Object","label":"Settings","name":"settings","freeform":true,"description":"Instance-specific settings as a JSON object. Keys depend on the Source type and are not enumerable ahead of time."}
   * @returns {Object}
   * @sampleResult {"data":{"source":{"id":"9btKuCR4Wq674VajpuLDNV","slug":"swift","name":"My updated source","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","enabled":false,"writeKeys":["bEj5MzDqCkHYRqreZgbPuH"],"metadata":{},"settings":{},"labels":[]}}}
   */
  // API: https://docs.segmentapis.com/tag/Sources/
  async updateSource(sourceId, name, enabled, slug, settings) {
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')

    const body = {}

    if (name !== undefined && name !== null) body.name = name
    if (enabled !== undefined && enabled !== null) body.enabled = enabled
    if (slug !== undefined && slug !== null) body.slug = slug
    if (settings !== undefined && settings !== null) body.settings = settings

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/sources/${ sourceId }`,
      method: 'patch',
      body,
      logTag: 'updateSource',
    })
  }

  /**
   * @operationName Delete Source
   * @category Sources
   * @description Permanently deletes a Source and stops it from sending data. This cannot be undone, so use Get Source first to confirm the right Source.
   * @route POST /delete-source
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source to permanently delete. Pick from the dropdown or paste a Source ID."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Sources/
  async deleteSource(sourceId) {
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/sources/${ sourceId }`,
      method: 'delete',
      logTag: 'deleteSource',
    })
  }

  // ==========================================================================
  //  DESTINATIONS
  // ==========================================================================
  /**
   * @operationName List Destinations
   * @category Destinations
   * @description Returns a page of Destinations in the workspace. Use this to browse where your data is sent or find a Destination ID before getting, updating, or deleting one.
   * @route POST /list-destinations
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many Destinations to return per page. Leave blank for the API default."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response's pagination.next."}
   * @returns {Object}
   * @sampleResult {"data":{"destinations":[{"id":"5GFhvtz8fha42Cm4B9E6L8","enabled":true,"name":"example-destination","settings":{},"metadata":{},"sourceId":"rh5BDZp6QDHvXFCkibm1pR"}],"pagination":{"current":"MA==","next":"MQ==","totalEntries":2}}}
   */
  // API: https://docs.segmentapis.com/tag/Destinations/
  async listDestinations(count, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/destinations`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listDestinations',
    })
  }

  /**
   * @operationName Get Destination
   * @category Destinations
   * @description Retrieves a single Destination by its ID, including its settings, metadata, and the Source it receives data from. The Destination field is a dropdown backed by a dictionary.
   * @route POST /get-destination
   * @paramDef {"type":"String","label":"Destination","name":"destinationId","dictionary":"getDestinationsDictionary","required":true,"description":"The Destination to retrieve. Pick from the dropdown or paste a Destination ID."}
   * @returns {Object}
   * @sampleResult {"data":{"destination":{"id":"66be7aeca665bd11f8908630","enabled":true,"name":"my destination v1","settings":{},"metadata":{"id":"54521fd525e721e32a72ee91","name":"Amplitude","slug":"amplitude"},"sourceId":"rh5BDZp6QDHvXFCkibm1pR"}}}
   */
  // API: https://docs.segmentapis.com/tag/Destinations/
  async getDestination(destinationId) {
    this.#requireParam(destinationId, 'Destination is required — pick one from the Destination dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/destinations/${ destinationId }`,
      logTag: 'getDestination',
    })
  }

  /**
   * @operationName Create Destination
   * @category Destinations
   * @description Connects a new Destination to a Source so Segment forwards that Source's data to a tool such as Amplitude or Mixpanel. Pick the Source and the Destination type, then supply the tool's configuration as Settings.
   * @route POST /create-destination
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source this Destination receives data from. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Destination Type","name":"metadataId","dictionary":"getDestinationCatalogDictionary","required":true,"description":"The Destination type (metadata id), e.g. Amplitude, Mixpanel. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"A display name for this Destination connection."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Enable to allow this Destination to receive data. Defaults to true."}
   * @paramDef {"type":"Object","label":"Settings","name":"settings","freeform":true,"required":true,"description":"Destination configuration as a JSON object (e.g. {\"apiKey\":\"...\"}). Keys depend on the Destination type and are not enumerable ahead of time."}
   * @returns {Object}
   * @sampleResult {"data":{"destination":{"id":"66be7aeca665bd11f8908630","enabled":true,"name":"my destination v1","settings":{"apiKey":"••••••••••dada","retarget":true},"metadata":{"id":"54521fd525e721e32a72ee91","name":"Amplitude","slug":"amplitude"},"sourceId":"rh5BDZp6QDHvXFCkibm1pR"}}}
   */
  // API: https://docs.segmentapis.com/tag/Destinations/
  async createDestination(sourceId, metadataId, name, enabled, settings) {
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')
    this.#requireParam(metadataId, 'Destination Type is required — pick one from the Destination Type dropdown.')

    const body = {
      sourceId,
      metadataId,
      settings: settings === undefined || settings === null ? {} : settings,
    }

    if (name !== undefined && name !== null) body.name = name
    if (enabled !== undefined && enabled !== null) body.enabled = enabled

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/destinations`,
      method: 'post',
      body,
      logTag: 'createDestination',
    })
  }

  /**
   * @operationName Update Destination
   * @category Destinations
   * @description Updates an existing Destination's name, enabled state, or settings. Use this to rotate an API key, pause data flow, or rename a Destination without recreating it.
   * @route POST /update-destination
   * @paramDef {"type":"String","label":"Destination","name":"destinationId","dictionary":"getDestinationsDictionary","required":true,"description":"The Destination to update. Pick from the dropdown or paste a Destination ID."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"A new display name for the Destination."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable the Destination."}
   * @paramDef {"type":"Object","label":"Settings","name":"settings","freeform":true,"description":"Destination configuration as a JSON object. Keys depend on the Destination type and are not enumerable ahead of time."}
   * @returns {Object}
   * @sampleResult {"data":{"destination":{"id":"66be7aeca665bd11f8908630","enabled":false,"name":"updated destination name","settings":{"apiKey":"••••••••••alue"},"metadata":{"id":"54521fd525e721e32a72ee91","name":"Amplitude","slug":"amplitude"},"sourceId":"rh5BDZp6QDHvXFCkibm1pR"}}}
   */
  // API: https://docs.segmentapis.com/tag/Destinations/
  async updateDestination(destinationId, name, enabled, settings) {
    this.#requireParam(destinationId, 'Destination is required — pick one from the Destination dropdown.')

    const body = {}

    if (name !== undefined && name !== null) body.name = name
    if (enabled !== undefined && enabled !== null) body.enabled = enabled
    if (settings !== undefined && settings !== null) body.settings = settings

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/destinations/${ destinationId }`,
      method: 'patch',
      body,
      logTag: 'updateDestination',
    })
  }

  /**
   * @operationName Delete Destination
   * @category Destinations
   * @description Permanently deletes a Destination and stops Segment from forwarding data to it. This cannot be undone, so use Get Destination first to confirm the right one.
   * @route POST /delete-destination
   * @paramDef {"type":"String","label":"Destination","name":"destinationId","dictionary":"getDestinationsDictionary","required":true,"description":"The Destination to permanently delete. Pick from the dropdown or paste a Destination ID."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Destinations/
  async deleteDestination(destinationId) {
    this.#requireParam(destinationId, 'Destination is required — pick one from the Destination dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/destinations/${ destinationId }`,
      method: 'delete',
      logTag: 'deleteDestination',
    })
  }

  // ==========================================================================
  //  DESTINATION FILTERS
  // ==========================================================================
  /**
   * @operationName List Destination Filters
   * @category Destination Filters
   * @description Returns the filters configured on a Destination. Filters drop or sample events before they reach the Destination. Use this to review a Destination's filters or find a filter ID.
   * @route POST /list-destination-filters
   * @paramDef {"type":"String","label":"Destination","name":"destinationId","dictionary":"getDestinationsDictionary","required":true,"description":"The Destination whose filters to list. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"filters":[{"id":"2c0vbh2htbJmSvPJSeDypz3CjVg","sourceId":"rh5BDZp6QDHvXFCkibm1pR","destinationId":"fP7qoQw2HTWt9WdMr718gn","if":"type = \"identify\"","actions":[{"type":"DROP"}],"title":"Filter Identify events","description":"","enabled":true,"createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}],"pagination":{"current":"MA=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Destination-Filters/
  async listDestinationFilters(destinationId) {
    this.#requireParam(destinationId, 'Destination is required — pick one from the Destination dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/destination/${ destinationId }/filters`,
      logTag: 'listDestinationFilters',
    })
  }

  /**
   * @operationName Get Destination Filter
   * @category Destination Filters
   * @description Retrieves a single Destination filter by its ID, including its FQL condition and actions. Use List Destination Filters to find the filter ID.
   * @route POST /get-destination-filter
   * @paramDef {"type":"String","label":"Destination","name":"destinationId","dictionary":"getDestinationsDictionary","required":true,"description":"The Destination the filter belongs to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Filter","name":"filterId","dictionary":"getDestinationFiltersDictionary","dependsOn":["destinationId"],"required":true,"description":"The filter to retrieve. Pick from the dropdown (after choosing a Destination) or paste a filter ID."}
   * @returns {Object}
   * @sampleResult {"data":{"filter":{"id":"2c0vbh2htbJmSvPJSeDypz3CjVg","sourceId":"rh5BDZp6QDHvXFCkibm1pR","destinationId":"fP7qoQw2HTWt9WdMr718gn","if":"type = \"identify\"","actions":[{"type":"DROP"}],"title":"Filter Identify events","description":"Drop Identify tracking from this destination","enabled":true,"createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Destination-Filters/
  async getDestinationFilter(destinationId, filterId) {
    this.#requireParam(destinationId, 'Destination is required — pick one from the Destination dropdown.')
    this.#requireParam(filterId, 'Filter is required — pick one from the Filter dropdown or run List Destination Filters.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/destination/${ destinationId }/filters/${ filterId }`,
      logTag: 'getDestinationFilter',
    })
  }

  /**
   * @operationName Create Destination Filter
   * @category Destination Filters
   * @description Adds a filter to a Destination that drops, samples, or trims event properties based on an FQL condition. Use this to keep specific events or fields out of a downstream tool.
   * @route POST /create-destination-filter
   * @paramDef {"type":"String","label":"Destination","name":"destinationId","dictionary":"getDestinationsDictionary","required":true,"description":"The Destination to add this filter to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source the filter applies to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"A human-readable title for the filter (e.g. \"Filter Identify events\")."}
   * @paramDef {"type":"String","label":"Condition (FQL)","name":"if","required":true,"description":"The filter condition in Segment FQL, e.g. type = \"identify\". Determines which events the actions apply to."}
   * @paramDef {"type":"Array<FilterAction>","label":"Actions","name":"actions","required":true,"description":"What to do with matching events. Each action has a type (Drop / Sample / Allow Properties / Drop Properties) and optional properties."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Enable the filter immediately. Defaults to true."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"An optional human-readable description of what this filter does."}
   * @returns {Object}
   * @sampleResult {"data":{"filter":{"id":"2c0vbh2htbJmSvPJSeDypz3CjVg","sourceId":"rh5BDZp6QDHvXFCkibm1pR","destinationId":"fP7qoQw2HTWt9WdMr718gn","if":"type = \"identify\"","actions":[{"type":"DROP"}],"title":"Filter Identify events","description":"Drop Identify tracking from this destination","enabled":true,"createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Destination-Filters/
  async createDestinationFilter(destinationId, sourceId, title, ifCondition, actions, enabled, description) {
    this.#requireParam(destinationId, 'Destination is required — pick one from the Destination dropdown.')
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')
    this.#requireParam(title, 'Title is required — enter a title for the filter.')
    this.#requireParam(ifCondition, 'Condition (FQL) is required — enter an FQL condition, e.g. type = "identify".')
    this.#requireParam(actions, 'Actions is required — provide at least one action, e.g. [{"type":"DROP"}].')

    const body = {
      sourceId,
      title,
      if: ifCondition,
      actions: actions || [],
      enabled: enabled === undefined ? true : enabled,
    }

    if (description !== undefined && description !== null) body.description = description

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/destination/${ destinationId }/filters`,
      method: 'post',
      body,
      logTag: 'createDestinationFilter',
    })
  }

  /**
   * @operationName Update Destination Filter
   * @category Destination Filters
   * @description Updates an existing Destination filter's condition, actions, title, description, or enabled state. Use this to adjust which events a Destination receives without recreating the filter.
   * @route POST /update-destination-filter
   * @paramDef {"type":"String","label":"Destination","name":"destinationId","dictionary":"getDestinationsDictionary","required":true,"description":"The Destination the filter belongs to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Filter","name":"filterId","dictionary":"getDestinationFiltersDictionary","dependsOn":["destinationId"],"required":true,"description":"The filter to update. Pick from the dropdown (after choosing a Destination) or paste a filter ID."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"A new title for the filter."}
   * @paramDef {"type":"String","label":"Condition (FQL)","name":"if","description":"A new FQL condition, e.g. type = \"identify\"."}
   * @paramDef {"type":"Array<FilterAction>","label":"Actions","name":"actions","description":"Replacement actions for matching events. Same shape as Create."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable the filter."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A new description for the filter."}
   * @returns {Object}
   * @sampleResult {"data":{"filter":{"id":"2c0vbh2htbJmSvPJSeDypz3CjVg","sourceId":"rh5BDZp6QDHvXFCkibm1pR","destinationId":"fP7qoQw2HTWt9WdMr718gn","if":"type = \"track\"","actions":[{"type":"DROP"}],"title":"Updated filter","description":"","enabled":false,"createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Destination-Filters/
  async updateDestinationFilter(destinationId, filterId, title, ifCondition, actions, enabled, description) {
    this.#requireParam(destinationId, 'Destination is required — pick one from the Destination dropdown.')
    this.#requireParam(filterId, 'Filter is required — pick one from the Filter dropdown or run List Destination Filters.')

    const body = {}

    if (title !== undefined && title !== null) body.title = title
    if (ifCondition !== undefined && ifCondition !== null) body.if = ifCondition
    if (actions !== undefined && actions !== null) body.actions = actions
    if (enabled !== undefined && enabled !== null) body.enabled = enabled
    if (description !== undefined && description !== null) body.description = description

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/destination/${ destinationId }/filters/${ filterId }`,
      method: 'patch',
      body,
      logTag: 'updateDestinationFilter',
    })
  }

  /**
   * @operationName Delete Destination Filter
   * @category Destination Filters
   * @description Permanently removes a filter from a Destination, so the events it was dropping or sampling flow through again. This cannot be undone.
   * @route POST /delete-destination-filter
   * @paramDef {"type":"String","label":"Destination","name":"destinationId","dictionary":"getDestinationsDictionary","required":true,"description":"The Destination the filter belongs to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Filter","name":"filterId","dictionary":"getDestinationFiltersDictionary","dependsOn":["destinationId"],"required":true,"description":"The filter to permanently remove. Pick from the dropdown (after choosing a Destination) or paste a filter ID."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Destination-Filters/
  async deleteDestinationFilter(destinationId, filterId) {
    this.#requireParam(destinationId, 'Destination is required — pick one from the Destination dropdown.')
    this.#requireParam(filterId, 'Filter is required — pick one from the Filter dropdown or run List Destination Filters.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/destination/${ destinationId }/filters/${ filterId }`,
      method: 'delete',
      logTag: 'deleteDestinationFilter',
    })
  }

  // ==========================================================================
  //  TRACKING PLANS
  // ==========================================================================
  /**
   * @operationName List Tracking Plans
   * @category Tracking Plans
   * @description Returns a page of Tracking Plans, optionally filtered by type. Tracking Plans define and validate the events and properties your Sources are allowed to send. Requires the Protocols feature.
   * @route POST /list-tracking-plans
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Live","Engage","Property Library","Rule Library","Template"]}},"description":"Filter to a single Tracking Plan type. Leave blank for all."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many Tracking Plans to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"trackingPlans":[{"id":"tp_sprout_rVGCC6WdrNxjCf6JpCHP","name":"New TP","type":"LIVE","createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}],"pagination":{"current":"MA=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Tracking-Plans/
  async listTrackingPlans(type, count, cursor) {
    const query = this.#paginationQuery(count, cursor)

    if (type) query.type = this.#resolveChoice(type, TRACKING_PLAN_TYPE_MAP)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/tracking-plans`,
      query,
      logTag: 'listTrackingPlans',
    })
  }

  /**
   * @operationName Get Tracking Plan
   * @category Tracking Plans
   * @description Retrieves a single Tracking Plan by its ID, including its type and resource schema id. The Tracking Plan field is a dropdown backed by a dictionary.
   * @route POST /get-tracking-plan
   * @paramDef {"type":"String","label":"Tracking Plan","name":"trackingPlanId","dictionary":"getTrackingPlansDictionary","required":true,"description":"The Tracking Plan to retrieve. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"trackingPlan":{"id":"tp_sprout_rVGCC6WdrNxjCf6JpCHP","name":"New TP","resourceSchemaId":"rs_1yVwS3zy60dONy9UhCyDqMmVvAE","slug":"","description":"","type":"LIVE","updatedAt":"2006-01-02T15:04:05.000Z","createdAt":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Tracking-Plans/
  async getTrackingPlan(trackingPlanId) {
    this.#requireParam(trackingPlanId, 'Tracking Plan is required — pick one from the Tracking Plan dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/tracking-plans/${ trackingPlanId }`,
      logTag: 'getTrackingPlan',
    })
  }

  /**
   * @operationName Create Tracking Plan
   * @category Tracking Plans
   * @description Creates a new Tracking Plan to govern which events and properties your Sources may send. Requires the Protocols feature enabled on the workspace. Use Live for a standard event-validation plan.
   * @route POST /create-tracking-plan
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The Tracking Plan's name."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Live","Engage","Property Library","Rule Library","Template"]}},"description":"The kind of Tracking Plan. Use Live for a standard event-validation plan."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"An optional description of the Tracking Plan."}
   * @returns {Object}
   * @sampleResult {"data":{"trackingPlan":{"id":"tp_sprout_rVGCC6WdrNxjCf6JpCHP","name":"New TP","resourceSchemaId":"rs_1yVwS3zy60dONy9UhCyDqMmVvAE","slug":"","description":"","type":"LIVE","updatedAt":"2006-01-02T15:04:05.000Z","createdAt":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Tracking-Plans/
  async createTrackingPlan(name, type, description) {
    this.#requireParam(name, 'Name is required — enter a name for the Tracking Plan.')
    this.#requireParam(type, 'Type is required — pick a Tracking Plan type from the dropdown.')

    const body = { name, type: this.#resolveChoice(type, TRACKING_PLAN_TYPE_MAP) }

    if (description !== undefined && description !== null) body.description = description

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/tracking-plans`,
      method: 'post',
      body,
      logTag: 'createTrackingPlan',
    })
  }

  /**
   * @operationName Update Tracking Plan
   * @category Tracking Plans
   * @description Updates an existing Tracking Plan's name or description. Use this to rename a plan or refine its description without recreating it.
   * @route POST /update-tracking-plan
   * @paramDef {"type":"String","label":"Tracking Plan","name":"trackingPlanId","dictionary":"getTrackingPlansDictionary","required":true,"description":"The Tracking Plan to update. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"A new name for the Tracking Plan."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A new description for the Tracking Plan."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Tracking-Plans/
  async updateTrackingPlan(trackingPlanId, name, description) {
    this.#requireParam(trackingPlanId, 'Tracking Plan is required — pick one from the Tracking Plan dropdown.')

    const body = {}

    if (name !== undefined && name !== null) body.name = name
    if (description !== undefined && description !== null) body.description = description

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/tracking-plans/${ trackingPlanId }`,
      method: 'patch',
      body,
      logTag: 'updateTrackingPlan',
    })
  }

  /**
   * @operationName Delete Tracking Plan
   * @category Tracking Plans
   * @description Permanently deletes a Tracking Plan, removing its event/property validation rules. This cannot be undone, so use Get Tracking Plan first to confirm the right one.
   * @route POST /delete-tracking-plan
   * @paramDef {"type":"String","label":"Tracking Plan","name":"trackingPlanId","dictionary":"getTrackingPlansDictionary","required":true,"description":"The Tracking Plan to permanently delete. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Tracking-Plans/
  async deleteTrackingPlan(trackingPlanId) {
    this.#requireParam(trackingPlanId, 'Tracking Plan is required — pick one from the Tracking Plan dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/tracking-plans/${ trackingPlanId }`,
      method: 'delete',
      logTag: 'deleteTrackingPlan',
    })
  }

  // ==========================================================================
  //  WAREHOUSES
  // ==========================================================================
  /**
   * @operationName List Warehouses
   * @category Warehouses
   * @description Returns a page of Warehouses (data destinations such as Snowflake or BigQuery) connected to the workspace. Use this to browse Warehouses or find a Warehouse ID.
   * @route POST /list-warehouses
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many Warehouses to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"warehouses":[{"id":"wh_123","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","enabled":true,"metadata":{},"settings":{}}],"pagination":{"current":"MA==","totalEntries":1}}}
   */
  // API: https://docs.segmentapis.com/tag/Warehouses/
  async listWarehouses(count, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listWarehouses',
    })
  }

  /**
   * @operationName Get Warehouse
   * @category Warehouses
   * @description Retrieves a single Warehouse by its ID, including its connector metadata and (non-secret) settings. The Warehouse field is a dropdown backed by a dictionary.
   * @route POST /get-warehouse
   * @paramDef {"type":"String","label":"Warehouse","name":"warehouseId","dictionary":"getWarehousesDictionary","required":true,"description":"The Warehouse to retrieve. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"warehouse":{"id":"wh_123","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","enabled":true,"metadata":{"id":"meta_1","slug":"snowflake","name":"Snowflake","description":"","logos":{},"options":[]},"settings":{}}}}
   */
  // API: https://docs.segmentapis.com/tag/Warehouses/
  async getWarehouse(warehouseId) {
    this.#requireParam(warehouseId, 'Warehouse is required — pick one from the Warehouse dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses/${ warehouseId }`,
      logTag: 'getWarehouse',
    })
  }

  /**
   * @operationName Create Warehouse
   * @category Warehouses
   * @description Connects a new data Warehouse (e.g. Snowflake, BigQuery, Redshift) to the workspace so Segment can sync data into it. Provide the Warehouse type and its connection details as Settings. (Settings keys and values are connector-specific - verify against a live workspace.)
   * @route POST /create-warehouse
   * @paramDef {"type":"String","label":"Warehouse Type","name":"metadataId","dictionary":"getWarehouseCatalogDictionary","required":true,"description":"The Warehouse type (metadata id), e.g. Snowflake, BigQuery, Redshift. Pick from the dropdown."}
   * @paramDef {"type":"Object","label":"Settings","name":"settings","freeform":true,"required":true,"description":"Warehouse connection configuration as a JSON object (host, credentials, etc). Keys depend on the Warehouse type and are not enumerable ahead of time."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"A display name for this Warehouse connection."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Enable to allow data to sync to this Warehouse. Defaults to true."}
   * @returns {Object}
   * @sampleResult {"data":{"warehouse":{"id":"wh_123","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","enabled":true,"metadata":{"id":"meta_1","slug":"snowflake","name":"Snowflake","description":"","logos":{},"options":[]},"settings":{}}}}
   */
  // API: https://docs.segmentapis.com/tag/Warehouses/
  async createWarehouse(metadataId, settings, name, enabled) {
    this.#requireParam(metadataId, 'Warehouse Type is required — pick one from the Warehouse Type dropdown.')
    this.#requireParam(settings, 'Settings is required — provide the connector connection configuration as a JSON object.')

    const body = {
      metadataId,
      settings: settings === undefined || settings === null ? {} : settings,
    }

    if (name !== undefined && name !== null) body.name = name
    if (enabled !== undefined && enabled !== null) body.enabled = enabled

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses`,
      method: 'post',
      body,
      logTag: 'createWarehouse',
    })
  }

  /**
   * @operationName Update Warehouse
   * @category Warehouses
   * @description Updates an existing Warehouse's connection settings, name, or enabled state. The Segment API requires the full Settings object on update. (Settings keys and values are connector-specific - verify against a live workspace.)
   * @route POST /update-warehouse
   * @paramDef {"type":"String","label":"Warehouse","name":"warehouseId","dictionary":"getWarehousesDictionary","required":true,"description":"The Warehouse to update. Pick from the dropdown."}
   * @paramDef {"type":"Object","label":"Settings","name":"settings","freeform":true,"required":true,"description":"Updated Warehouse connection configuration as a JSON object. Required by the API on update. Keys depend on the Warehouse type and are not enumerable ahead of time."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"A new display name for the Warehouse."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable the Warehouse."}
   * @returns {Object}
   * @sampleResult {"data":{"warehouse":{"id":"wh_123","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","enabled":false,"metadata":{},"settings":{}}}}
   */
  // API: https://docs.segmentapis.com/tag/Warehouses/
  async updateWarehouse(warehouseId, settings, name, enabled) {
    this.#requireParam(warehouseId, 'Warehouse is required — pick one from the Warehouse dropdown.')
    this.#requireParam(settings, 'Settings is required — the Segment API requires the full connection configuration on update.')

    const body = {
      settings: settings === undefined || settings === null ? {} : settings,
    }

    if (name !== undefined && name !== null) body.name = name
    if (enabled !== undefined && enabled !== null) body.enabled = enabled

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses/${ warehouseId }`,
      method: 'patch',
      body,
      logTag: 'updateWarehouse',
    })
  }

  /**
   * @operationName Delete Warehouse
   * @category Warehouses
   * @description Permanently deletes a Warehouse connection and stops Segment from syncing data into it. This cannot be undone, so use Get Warehouse first to confirm the right one.
   * @route POST /delete-warehouse
   * @paramDef {"type":"String","label":"Warehouse","name":"warehouseId","dictionary":"getWarehousesDictionary","required":true,"description":"The Warehouse to permanently delete. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Warehouses/
  async deleteWarehouse(warehouseId) {
    this.#requireParam(warehouseId, 'Warehouse is required — pick one from the Warehouse dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses/${ warehouseId }`,
      method: 'delete',
      logTag: 'deleteWarehouse',
    })
  }

  // ==========================================================================
  //  FUNCTIONS
  // ==========================================================================
  /**
   * @operationName List Functions
   * @category Functions
   * @description Returns a page of Functions, optionally filtered by type. Functions are custom JavaScript that ingest, transform, or send data in Segment. Requires the Functions feature.
   * @route POST /list-functions
   * @paramDef {"type":"String","label":"Function Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Destination","Insert Destination","Insert Source","Insert Transformation","Source"]}},"description":"Filter to a single Function type. Leave blank for all."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many Functions to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"functions":[{"id":"sfnc_wXzcDGFR3KmjLDrtSawNHf","displayName":"PAPI Source Function","description":"My source function","logoUrl":"https://placekitten.com/200/139","resourceType":"SOURCE","createdAt":"2006-01-02T15:04:05.000Z","createdBy":"sgJDWk3K21k6LE3tLU9nRK"}],"pagination":{"current":"MA=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Functions/
  async listFunctions(resourceType, count, cursor) {
    const query = this.#paginationQuery(count, cursor)

    if (resourceType) query.resourceType = this.#resolveChoice(resourceType, FUNCTION_TYPE_MAP)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/functions`,
      query,
      logTag: 'listFunctions',
    })
  }

  /**
   * @operationName Get Function
   * @category Functions
   * @description Retrieves a single Function by its ID, including its source code and resource type. The Function field is a dropdown backed by a dictionary.
   * @route POST /get-function
   * @paramDef {"type":"String","label":"Function","name":"functionId","dictionary":"getFunctionsDictionary","required":true,"description":"The Function to retrieve. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"function":{"id":"sfnc_wXzcDGFR3KmjLDrtSawNHf","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","displayName":"PAPI Source Function","description":"My source function","logoUrl":"https://placekitten.com/200/139","code":"// source function code","createdAt":"2006-01-02T15:04:05.000Z","createdBy":"sgJDWk3K21k6LE3tLU9nRK","resourceType":"SOURCE"}}}
   */
  // API: https://docs.segmentapis.com/tag/Functions/
  async getFunction(functionId) {
    this.#requireParam(functionId, 'Function is required — pick one from the Function dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/functions/${ functionId }`,
      logTag: 'getFunction',
    })
  }

  /**
   * @operationName Create Function
   * @category Functions
   * @description Creates a new custom Function from JavaScript source code. Source/Destination functions ingest or send data; Insert functions transform events in the pipeline. Requires the Functions feature. (Code and Settings are user-authored - verify against a live workspace.)
   * @route POST /create-function
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"The Function's display name."}
   * @paramDef {"type":"String","label":"Function Type","name":"resourceType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Destination","Insert Destination","Insert Source","Insert Transformation","Source"]}},"description":"What this Function does. Source/Destination functions ingest or send data; Insert functions transform in the pipeline."}
   * @paramDef {"type":"String","label":"Code","name":"code","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The Function's JavaScript source code."}
   * @paramDef {"type":"Array<FunctionSetting>","label":"Settings","name":"settings","description":"Configurable settings exposed to users of this Function (name, label, type, etc)."}
   * @paramDef {"type":"String","label":"Logo URL","name":"logoUrl","description":"An optional URL to a logo image for the Function."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"An optional description of what the Function does."}
   * @returns {Object}
   * @sampleResult {"data":{"function":{"id":"sfnc_wXzcDGFR3KmjLDrtSawNHf","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","displayName":"PAPI Source Function","description":"My source function","logoUrl":"https://placekitten.com/200/139","code":"// Learn more about source functions API...","createdAt":"2006-01-02T15:04:05.000Z","createdBy":"sgJDWk3K21k6LE3tLU9nRK","resourceType":"SOURCE"}}}
   */
  // API: https://docs.segmentapis.com/tag/Functions/
  async createFunction(displayName, resourceType, code, settings, logoUrl, description) {
    this.#requireParam(displayName, 'Display Name is required — enter a name for the Function.')
    this.#requireParam(resourceType, 'Function Type is required — pick one from the Function Type dropdown.')
    this.#requireParam(code, 'Code is required — provide the Function JavaScript source code.')

    const body = { code, displayName, resourceType: this.#resolveChoice(resourceType, FUNCTION_TYPE_MAP) }

    if (settings !== undefined && settings !== null) body.settings = settings
    if (logoUrl !== undefined && logoUrl !== null) body.logoUrl = logoUrl
    if (description !== undefined && description !== null) body.description = description

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/functions`,
      method: 'post',
      body,
      logTag: 'createFunction',
    })
  }

  /**
   * @operationName Update Function
   * @category Functions
   * @description Updates an existing Function's code, settings, display name, logo, or description. Use this to ship a new version of a Function's logic without recreating it. (Code and Settings are user-authored - verify against a live workspace.)
   * @route POST /update-function
   * @paramDef {"type":"String","label":"Function","name":"functionId","dictionary":"getFunctionsDictionary","required":true,"description":"The Function to update. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"A new display name."}
   * @paramDef {"type":"String","label":"Code","name":"code","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated Function JavaScript source code."}
   * @paramDef {"type":"Array<FunctionSetting>","label":"Settings","name":"settings","description":"Replacement settings for the Function. Same shape as Create."}
   * @paramDef {"type":"String","label":"Logo URL","name":"logoUrl","description":"A new logo URL."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A new description."}
   * @returns {Object}
   * @sampleResult {"data":{"function":{"id":"sfnc_wXzcDGFR3KmjLDrtSawNHf","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","displayName":"Updated Function","description":"","logoUrl":"","code":"// updated code","createdAt":"2006-01-02T15:04:05.000Z","createdBy":"sgJDWk3K21k6LE3tLU9nRK","resourceType":"SOURCE"}}}
   */
  // API: https://docs.segmentapis.com/tag/Functions/
  async updateFunction(functionId, displayName, code, settings, logoUrl, description) {
    this.#requireParam(functionId, 'Function is required — pick one from the Function dropdown.')

    const body = {}

    if (displayName !== undefined && displayName !== null) body.displayName = displayName
    if (code !== undefined && code !== null) body.code = code
    if (settings !== undefined && settings !== null) body.settings = settings
    if (logoUrl !== undefined && logoUrl !== null) body.logoUrl = logoUrl
    if (description !== undefined && description !== null) body.description = description

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/functions/${ functionId }`,
      method: 'patch',
      body,
      logTag: 'updateFunction',
    })
  }

  /**
   * @operationName Delete Function
   * @category Functions
   * @description Permanently deletes a Function. Any Sources or Destinations built on it stop working, so confirm with Get Function first. This cannot be undone.
   * @route POST /delete-function
   * @paramDef {"type":"String","label":"Function","name":"functionId","dictionary":"getFunctionsDictionary","required":true,"description":"The Function to permanently delete. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Functions/
  async deleteFunction(functionId) {
    this.#requireParam(functionId, 'Function is required — pick one from the Function dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/functions/${ functionId }`,
      method: 'delete',
      logTag: 'deleteFunction',
    })
  }

  // ==========================================================================
  //  SPACES (Engage root scope)
  // ==========================================================================
  /**
   * @operationName List Spaces
   * @category Spaces
   * @description Returns the Engage Spaces in the workspace. A Space is the root scope for Audiences, Computed Traits, and other Engage/Unify resources. Use this to find a Space ID.
   * @route POST /list-spaces
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many Spaces to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response's pagination.current/next."}
   * @returns {Object}
   * @sampleResult {"data":{"spaces":[{"id":"spa_123","name":"Production","slug":"production"}],"pagination":{"current":"MA==","totalEntries":1}}}
   */
  // API: https://docs.segmentapis.com/tag/Spaces/
  async listSpaces(count, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listSpaces',
    })
  }

  /**
   * @operationName Get Space
   * @category Spaces
   * @description Retrieves a single Engage Space by its ID, including its name and slug. The Space field is a dropdown backed by a dictionary.
   * @route POST /get-space
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space to retrieve. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"space":{"id":"spa_123","name":"Production","slug":"production"}}}
   */
  // API: https://docs.segmentapis.com/tag/Spaces/
  async getSpace(spaceId) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }`,
      logTag: 'getSpace',
    })
  }

  // ==========================================================================
  //  AUDIENCES (Engage; space-scoped)
  // ==========================================================================
  /**
   * @operationName List Audiences
   * @category Audiences
   * @description Returns a page of Audiences in an Engage Space. Use this to browse Audiences or find an Audience ID before getting, updating, or deleting one. Requires the Engage entitlement.
   * @route POST /list-audiences
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space whose audiences to list. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Schedules"]}},"description":"Optionally include related data (schedules)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many Audiences to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"audiences":[{"id":"aud_1","name":"Profiles Audience V1","audienceType":"USERS","enabled":true,"status":"COMPUTING"}],"pagination":{"current":"MA==","totalEntries":1}}}
   */
  // API: https://docs.segmentapis.com/tag/Audiences/
  async listAudiences(spaceId, include, count, cursor) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')

    const query = this.#paginationQuery(count, cursor)

    if (include) query.include = this.#resolveChoice(include, INCLUDE_SCHEDULES_MAP)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences`,
      query,
      logTag: 'listAudiences',
    })
  }

  /**
   * @operationName Get Audience
   * @category Audiences
   * @description Retrieves a single Audience by its ID, including its definition query, type, and status. The Audience field is a dropdown backed by a dictionary that depends on the chosen Space.
   * @route POST /get-audience
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"id","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience to retrieve. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Schedules"]}},"description":"Optionally include schedules."}
   * @returns {Object}
   * @sampleResult {"data":{"audience":{"id":"aud_1","spaceId":"spa_123","name":"Profiles Audience V1","description":"","enabled":true,"audienceType":"USERS","definition":{"query":"event('Purchased').count() >= 1"},"status":"COMPUTING","createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Audiences/
  async getAudience(spaceId, id, include) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(id, 'Audience is required — pick one from the Audience dropdown.')

    const query = {}

    if (include) query.include = this.#resolveChoice(include, INCLUDE_SCHEDULES_MAP)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ id }`,
      query,
      logTag: 'getAudience',
    })
  }

  /**
   * @operationName Create Audience
   * @category Audiences
   * @description Creates a new Audience in an Engage Space from a definition query. The query is written in Segment's audience query language (FQL) and is user-authored. Requires the Engage entitlement.
   * @route POST /create-audience
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space to create the audience in. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The audience's name."}
   * @paramDef {"type":"String","label":"Audience Type","name":"audienceType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Users","Accounts","Linked"]}},"description":"Whether the audience is over users, accounts, or a linked entity."}
   * @paramDef {"type":"Object","label":"Definition","name":"definition","required":true,"freeform":true,"description":"The audience query as a JSON object, e.g. {\"query\":\"event('Purchased').count() >= 1\"}. The query is user-authored FQL and cannot be enumerated ahead of time."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Enable the audience on creation. Defaults to true."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"An optional description."}
   * @paramDef {"type":"Object","label":"Options","name":"options","freeform":true,"description":"Optional compute options as JSON, e.g. {\"includeHistoricalData\":true}. Open option map varying by audience type."}
   * @returns {Object}
   * @sampleResult {"data":{"audience":{"id":"aud_1","spaceId":"spa_123","name":"Profiles Audience V1","description":"Test profiles audience v1 example","enabled":true,"audienceType":"USERS","definition":{"query":"event('Purchased').count() >= 1"},"status":"CREATING","createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Audiences/
  async createAudience(spaceId, name, audienceType, definition, enabled, description, options) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(name, 'Name is required — enter a name for the Audience.')
    this.#requireParam(audienceType, 'Audience Type is required — pick one from the Audience Type dropdown.')
    this.#requireParam(definition, 'Definition is required — provide the audience query JSON, e.g. {"query":"event(\'Purchased\').count() >= 1"}.')

    const body = {
      name,
      audienceType: this.#resolveChoice(audienceType, AUDIENCE_TYPE_MAP),
      definition,
      enabled: enabled === undefined ? true : enabled,
    }

    if (description !== undefined && description !== null) body.description = description
    if (options !== undefined && options !== null) body.options = options

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences`,
      method: 'post',
      body,
      logTag: 'createAudience',
    })
  }

  /**
   * @operationName Update Audience
   * @category Audiences
   * @description Updates an existing Audience's name, description, enabled state, definition, or options. The definition query is user-authored FQL. Use this to refine an audience without recreating it.
   * @route POST /update-audience
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"id","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience to update. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A new name for the Audience."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable the Audience."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A new description."}
   * @paramDef {"type":"Object","label":"Definition","name":"definition","freeform":true,"description":"A new audience query as JSON, e.g. {\"query\":\"event('Purchased').count() >= 3\"}. User-authored FQL."}
   * @paramDef {"type":"Object","label":"Options","name":"options","freeform":true,"description":"Replacement compute options as JSON. Open option map."}
   * @returns {Object}
   * @sampleResult {"data":{"audience":{"id":"aud_1","spaceId":"spa_123","name":"Profiles Audience V1 Updated","enabled":true,"audienceType":"USERS","definition":{"query":"event('Purchased').count() >= 3"},"status":"COMPUTING","createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Audiences/
  async updateAudience(spaceId, id, name, enabled, description, definition, options) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(id, 'Audience is required — pick one from the Audience dropdown.')

    const body = {}

    if (name !== undefined && name !== null) body.name = name
    if (enabled !== undefined && enabled !== null) body.enabled = enabled
    if (description !== undefined && description !== null) body.description = description
    if (definition !== undefined && definition !== null) body.definition = definition
    if (options !== undefined && options !== null) body.options = options

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ id }`,
      method: 'patch',
      body,
      logTag: 'updateAudience',
    })
  }

  /**
   * @operationName Delete Audience
   * @category Audiences
   * @description Permanently removes an Audience from a Space. This cannot be undone, so use Get Audience first to confirm the right one.
   * @route POST /delete-audience
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"id","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience to permanently delete. Pick from the dropdown (after choosing a Space)."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Audiences/
  async deleteAudience(spaceId, id) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(id, 'Audience is required — pick one from the Audience dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ id }`,
      method: 'delete',
      logTag: 'deleteAudience',
    })
  }

  /**
   * @operationName Execute Audience Run
   * @category Audiences
   * @description Forces an Audience to recompute now, outside its normal schedule. Takes no request body. Use this to refresh audience membership immediately after a definition change.
   * @route POST /execute-audience-run
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience to recompute now. Pick from the dropdown (after choosing a Space)."}
   * @returns {Object}
   * @sampleResult {"data":{"run":{"id":"run_1"}}}
   */
  // API: https://docs.segmentapis.com/tag/Audiences/
  async executeAudienceRun(spaceId, audienceId) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(audienceId, 'Audience is required — pick one from the Audience dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ audienceId }/runs`,
      method: 'post',
      logTag: 'executeAudienceRun',
    })
  }

  // ==========================================================================
  //  AUDIENCE SCHEDULES (sub-resource of Audience)
  // ==========================================================================
  /**
   * @operationName List Audience Schedules
   * @category Audience Schedules
   * @description Returns the compute schedules configured on an Audience. Use this to review when an audience recomputes or find a schedule ID.
   * @route POST /list-audience-schedules
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"id","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience whose schedules to list. Pick from the dropdown (after choosing a Space)."}
   * @returns {Object}
   * @sampleResult {"data":{"audienceSchedules":[{"id":"sch_1","strategy":"PERIODIC","config":{},"nextExecution":"2006-01-02T15:04:05.000Z"}]}}
   */
  // API: https://docs.segmentapis.com/tag/Audiences/
  async listAudienceSchedules(spaceId, id) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(id, 'Audience is required — pick one from the Audience dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ id }/schedules`,
      logTag: 'listAudienceSchedules',
    })
  }

  /**
   * @operationName Get Audience Schedule
   * @category Audience Schedules
   * @description Retrieves a single Audience schedule by its ID, including its strategy and config. Use List Audience Schedules to find the schedule ID.
   * @route POST /get-audience-schedule
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"id","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Schedule","name":"scheduleId","dictionary":"getAudienceSchedulesDictionary","dependsOn":["spaceId","id"],"required":true,"description":"The schedule to retrieve. Pick from the dropdown (after choosing a Space and Audience)."}
   * @returns {Object}
   * @sampleResult {"data":{"audienceSchedule":{"id":"sch_1","strategy":"SPECIFIC_DAYS","config":{"days":[1,3,4],"hours":[9,16],"timezone":"America/New_York"},"nextExecution":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Audiences/
  async getAudienceSchedule(spaceId, id, scheduleId) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(id, 'Audience is required — pick one from the Audience dropdown.')
    this.#requireParam(scheduleId, 'Schedule ID is required — run List Audience Schedules to find it.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ id }/schedules/${ scheduleId }`,
      logTag: 'getAudienceSchedule',
    })
  }

  /**
   * @operationName Add Audience Schedule
   * @category Audience Schedules
   * @description Adds a compute schedule to an Audience. The config shape depends on the chosen strategy (Periodic vs Specific Days) and is user-authored.
   * @route POST /add-audience-schedule
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"id","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience to schedule. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Strategy","name":"strategy","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Periodic","Specific Days"]}},"description":"How often the audience recomputes."}
   * @paramDef {"type":"Object","label":"Config","name":"config","required":true,"freeform":true,"description":"Schedule configuration JSON. For Specific Days: {\"days\":[1,3,4],\"hours\":[9,16],\"timezone\":\"America/New_York\"}; for Periodic: a period config. Shape depends on the chosen strategy."}
   * @returns {Object}
   * @sampleResult {"data":{"audienceSchedule":{"id":"sch_1","strategy":"SPECIFIC_DAYS","config":{"days":[1,3,4],"hours":[9,16],"timezone":"America/New_York"},"nextExecution":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Audiences/
  async addAudienceSchedule(spaceId, id, strategy, config) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(id, 'Audience is required — pick one from the Audience dropdown.')
    this.#requireParam(strategy, 'Strategy is required — pick one from the Strategy dropdown.')
    this.#requireParam(config, 'Config is required — provide the schedule configuration JSON.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ id }/schedules`,
      method: 'post',
      body: { strategy: this.#resolveChoice(strategy, AUDIENCE_STRATEGY_MAP), config },
      logTag: 'addAudienceSchedule',
    })
  }

  /**
   * @operationName Update Audience Schedule
   * @category Audience Schedules
   * @description Updates an existing Audience schedule's strategy and config. Use this to change when an audience recomputes without recreating the schedule.
   * @route POST /update-audience-schedule
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"id","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Schedule","name":"scheduleId","dictionary":"getAudienceSchedulesDictionary","dependsOn":["spaceId","id"],"required":true,"description":"The schedule to update. Pick from the dropdown (after choosing a Space and Audience)."}
   * @paramDef {"type":"String","label":"Strategy","name":"strategy","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Periodic","Specific Days"]}},"description":"How often the audience recomputes."}
   * @paramDef {"type":"Object","label":"Config","name":"config","required":true,"freeform":true,"description":"Schedule configuration JSON. For Specific Days: {\"days\":[1,3,4],\"hours\":[9,16],\"timezone\":\"America/New_York\"}. Shape depends on the chosen strategy."}
   * @returns {Object}
   * @sampleResult {"data":{"audienceSchedule":{"id":"sch_1","strategy":"SPECIFIC_DAYS","config":{"days":[1,3,4],"hours":[9,16],"timezone":"America/New_York"},"nextExecution":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Audiences/
  async updateAudienceSchedule(spaceId, id, scheduleId, strategy, config) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(id, 'Audience is required — pick one from the Audience dropdown.')
    this.#requireParam(scheduleId, 'Schedule ID is required — run List Audience Schedules to find it.')
    this.#requireParam(strategy, 'Strategy is required — pick one from the Strategy dropdown.')
    this.#requireParam(config, 'Config is required — provide the schedule configuration JSON.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ id }/schedules/${ scheduleId }`,
      method: 'patch',
      body: { strategy: this.#resolveChoice(strategy, AUDIENCE_STRATEGY_MAP), config },
      logTag: 'updateAudienceSchedule',
    })
  }

  /**
   * @operationName Delete Audience Schedule
   * @category Audience Schedules
   * @description Permanently removes a compute schedule from an Audience. The audience stops recomputing on that schedule. This cannot be undone.
   * @route POST /delete-audience-schedule
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"id","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Schedule","name":"scheduleId","dictionary":"getAudienceSchedulesDictionary","dependsOn":["spaceId","id"],"required":true,"description":"The schedule to permanently remove. Pick from the dropdown (after choosing a Space and Audience)."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Audiences/
  async deleteAudienceSchedule(spaceId, id, scheduleId) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(id, 'Audience is required — pick one from the Audience dropdown.')
    this.#requireParam(scheduleId, 'Schedule ID is required — run List Audience Schedules to find it.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ id }/schedules/${ scheduleId }`,
      method: 'delete',
      logTag: 'deleteAudienceSchedule',
    })
  }

  // ==========================================================================
  //  AUDIENCE PREVIEWS (ephemeral)
  // ==========================================================================
  /**
   * @operationName Create Audience Preview
   * @category Audience Previews
   * @description Starts an ephemeral preview computation for an audience query without creating an audience. Returns a preview ID to poll with Get Audience Preview. The query is user-authored FQL.
   * @route POST /create-audience-preview
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"Object","label":"Definition","name":"definition","required":true,"freeform":true,"description":"The query to preview as JSON, e.g. {\"query\":\"event('Shoes Bought').count() >= 1\"}. User-authored FQL."}
   * @paramDef {"type":"String","label":"Audience Type","name":"audienceType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Users","Accounts","Linked"]}},"description":"Whether the preview is over users, accounts, or a linked entity."}
   * @paramDef {"type":"Object","label":"Options","name":"options","freeform":true,"description":"Optional preview options as JSON, e.g. {\"filterByExternalIds\":[\"email\"],\"backfillEventDataDays\":7}."}
   * @returns {Object}
   * @sampleResult {"data":{"previewId":"prev_1"}}
   */
  // API: https://docs.segmentapis.com/tag/Audiences/
  async createAudiencePreview(spaceId, definition, audienceType, options) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(definition, 'Definition is required — provide the preview query JSON, e.g. {"query":"event(\'Shoes Bought\').count() >= 1"}.')
    this.#requireParam(audienceType, 'Audience Type is required — pick one from the Audience Type dropdown.')

    const body = { definition, audienceType: this.#resolveChoice(audienceType, AUDIENCE_TYPE_MAP) }

    if (options !== undefined && options !== null) body.options = options

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/previews`,
      method: 'post',
      body,
      logTag: 'createAudiencePreview',
    })
  }

  /**
   * @operationName Get Audience Preview
   * @category Audience Previews
   * @description Retrieves the status and results of a previously-started audience preview. Poll this with the preview ID from Create Audience Preview until status is complete.
   * @route POST /get-audience-preview
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Preview ID","name":"id","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The preview ID returned by Create Audience Preview."}
   * @returns {Object}
   * @sampleResult {"data":{"audiencePreview":{"status":"COMPLETED","results":[],"size":1234}}}
   */
  // API: https://docs.segmentapis.com/tag/Audiences/
  async getAudiencePreview(spaceId, id) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(id, 'Preview ID is required — use the ID returned by Create Audience Preview.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/previews/${ id }`,
      logTag: 'getAudiencePreview',
    })
  }

  // ==========================================================================
  //  AUDIENCE DESTINATION CONNECTIONS & ACTIVATIONS (Engage)
  // ==========================================================================
  /**
   * @operationName Add Destination to Audience
   * @category Audience Activations
   * @description Connects a destination to an Audience so its membership can be activated to that tool. The destination and connection settings are connector-specific and user-authored.
   * @route POST /add-destination-to-audience
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience to connect the destination to. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"Object","label":"Destination","name":"destination","required":true,"freeform":true,"description":"The destination to connect as JSON {\"id\":\"<destinationMetadataId>\",\"type\":\"<type>\"}. The id is a catalog metadata id (Get Destination Catalog Dictionary); type is connector-defined."}
   * @paramDef {"type":"Array<IdSyncConfig>","label":"ID Sync Configuration","name":"idSyncConfiguration","description":"Optional identity-sync rules (max 5)."}
   * @paramDef {"type":"Object","label":"Connection Settings","name":"connectionSettings","freeform":true,"description":"Optional per-connector connection settings as a JSON object. Keys depend on the destination type."}
   * @returns {Object}
   * @sampleResult {"data":{"connection":{"id":"conn_1","idSyncConfiguration":[]}}}
   */
  // API: https://docs.segmentapis.com/tag/Activations/
  async addDestinationToAudience(spaceId, audienceId, destination, idSyncConfiguration, connectionSettings) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(audienceId, 'Audience is required — pick one from the Audience dropdown.')
    this.#requireParam(destination, 'Destination is required — provide {"id":"<destinationMetadataId>","type":"<type>"}.')

    const body = { destination }

    if (idSyncConfiguration !== undefined && idSyncConfiguration !== null) body.idSyncConfiguration = idSyncConfiguration
    if (connectionSettings !== undefined && connectionSettings !== null) body.connectionSettings = connectionSettings

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ audienceId }/destination-connections`,
      method: 'post',
      body,
      logTag: 'addDestinationToAudience',
    })
  }

  /**
   * @operationName List Audience Destinations
   * @category Audience Activations
   * @description Returns the destination connections attached to an Audience. Use this to review where an audience activates or find a connection ID before adding an activation.
   * @route POST /list-audience-destinations
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many connections to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"connections":[{"id":"conn_1","name":"Amplitude","enabled":true,"destinationId":"dst_1","metadata":{},"idSyncConfiguration":[],"sourceId":"src_1","settings":{},"createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}],"pagination":{"current":"MA=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Activations/
  async listAudienceDestinations(spaceId, audienceId, count, cursor) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(audienceId, 'Audience is required — pick one from the Audience dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ audienceId }/destination-connections`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listAudienceDestinations',
    })
  }

  /**
   * @operationName Update Audience Destination
   * @category Audience Activations
   * @description Updates a destination connection on an Audience - its ID-sync rules or connection settings. Both are connector-specific and user-authored.
   * @route POST /update-audience-destination
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Destination Connection","name":"destinationId","dictionary":"getAudienceDestinationsDictionary","dependsOn":["spaceId","audienceId"],"required":true,"description":"The connection to update. Pick from the dropdown (after choosing a Space and Audience)."}
   * @paramDef {"type":"Array<IdSyncConfig>","label":"ID Sync Configuration","name":"idSyncConfiguration","description":"Replacement identity-sync rules (max 5)."}
   * @paramDef {"type":"Object","label":"Connection Settings","name":"connectionSettings","freeform":true,"description":"Replacement per-connector connection settings as a JSON object."}
   * @returns {Object}
   * @sampleResult {"data":{"destination":{"id":"conn_1","idSyncConfiguration":[]}}}
   */
  // API: https://docs.segmentapis.com/tag/Activations/
  async updateAudienceDestination(spaceId, audienceId, destinationId, idSyncConfiguration, connectionSettings) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(audienceId, 'Audience is required — pick one from the Audience dropdown.')
    this.#requireParam(destinationId, 'Destination Connection ID is required — run List Audience Destinations to find it.')

    const body = {}

    if (idSyncConfiguration !== undefined && idSyncConfiguration !== null) body.idSyncConfiguration = idSyncConfiguration
    if (connectionSettings !== undefined && connectionSettings !== null) body.connectionSettings = connectionSettings

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ audienceId }/destination-connections/${ destinationId }`,
      method: 'patch',
      body,
      logTag: 'updateAudienceDestination',
    })
  }

  /**
   * @operationName Remove Audience Destination
   * @category Audience Activations
   * @description Permanently removes a destination connection from an Audience. The audience stops activating to that destination. This cannot be undone.
   * @route POST /remove-audience-destination
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Destination Connection","name":"destinationId","dictionary":"getAudienceDestinationsDictionary","dependsOn":["spaceId","audienceId"],"required":true,"description":"The connection to permanently remove. Pick from the dropdown (after choosing a Space and Audience)."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Activations/
  async removeAudienceDestination(spaceId, audienceId, destinationId) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(audienceId, 'Audience is required — pick one from the Audience dropdown.')
    this.#requireParam(destinationId, 'Destination Connection ID is required — run List Audience Destinations to find it.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ audienceId }/destination-connections/${ destinationId }`,
      method: 'delete',
      logTag: 'removeAudienceDestination',
    })
  }

  /**
   * @operationName Add Activation
   * @category Audience Activations
   * @description Adds an activation to a destination connection so audience membership changes are sent to the destination. Personalization and destination mapping are user-authored objects.
   * @route POST /add-activation
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Destination Connection","name":"connectionId","dictionary":"getAudienceDestinationsDictionary","dependsOn":["spaceId","audienceId"],"required":true,"description":"The destination connection to activate on. Pick from the dropdown (after choosing a Space and Audience)."}
   * @paramDef {"type":"String","label":"Activation Type","name":"activationType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Audience Entered","Audience Exited","Audience Membership Changed"]}},"description":"Which membership event triggers the activation."}
   * @paramDef {"type":"String","label":"Activation Name","name":"activationName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A name for the activation."}
   * @paramDef {"type":"Boolean","label":"Perform Resync","name":"performResync","required":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether to resync existing audience members."}
   * @paramDef {"type":"Object","label":"Personalization","name":"personalization","required":true,"freeform":true,"description":"The personalization mapping as a JSON object. User-authored; varies per destination."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Enable the activation immediately."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"An optional display name."}
   * @paramDef {"type":"Object","label":"Destination Mapping","name":"destinationMapping","freeform":true,"description":"The per-destination field map as a JSON object. User-authored."}
   * @returns {Object}
   * @sampleResult {"data":{"activation":{"id":"act_1","enabled":true,"workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","spaceId":"spa_123","audienceId":"aud_1","connectionId":"conn_1","activationType":"Audience Entered","activationName":"Send to Amplitude","personalization":{},"destinationMapping":{},"performResync":false}}}
   */
  // API: https://docs.segmentapis.com/tag/Activations/
  async addActivation(spaceId, audienceId, connectionId, activationType, activationName, performResync, personalization, enabled, displayName, destinationMapping) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(audienceId, 'Audience is required — pick one from the Audience dropdown.')
    this.#requireParam(connectionId, 'Destination Connection is required — run List Audience Destinations to find the connection ID.')
    this.#requireParam(activationType, 'Activation Type is required — pick one from the Activation Type dropdown.')
    this.#requireParam(activationName, 'Activation Name is required — enter a name for the activation.')
    this.#requireParam(personalization, 'Personalization is required — provide the personalization mapping JSON.')

    const body = { activationType, activationName, performResync, personalization }

    if (enabled !== undefined && enabled !== null) body.enabled = enabled
    if (displayName !== undefined && displayName !== null) body.displayName = displayName
    if (destinationMapping !== undefined && destinationMapping !== null) body.destinationMapping = destinationMapping

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ audienceId }/destination-connections/${ connectionId }/activations`,
      method: 'post',
      body,
      logTag: 'addActivation',
    })
  }

  /**
   * @operationName List Activations
   * @category Audience Activations
   * @description Returns the activations configured on an Audience. Use this to review or find an activation ID before getting, updating, or removing one.
   * @route POST /list-activations
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many activations to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"activations":[{"id":"act_1","activationType":"Audience Entered","activationName":"Send to Amplitude","enabled":true}]}}
   */
  // API: https://docs.segmentapis.com/tag/Activations/
  async listActivations(spaceId, audienceId, count, cursor) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(audienceId, 'Audience is required — pick one from the Audience dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ audienceId }/activations`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listActivations',
    })
  }

  /**
   * @operationName Get Activation
   * @category Audience Activations
   * @description Retrieves a single activation by its ID, including its type, personalization, and destination mapping. Use List Activations to find the activation ID.
   * @route POST /get-activation
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Activation ID","name":"id","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The activation to retrieve. Use List Activations to find the ID."}
   * @returns {Object}
   * @sampleResult {"data":{"activation":{"id":"act_1","enabled":true,"spaceId":"spa_123","audienceId":"aud_1","connectionId":"conn_1","activationType":"Audience Entered","activationName":"Send to Amplitude","personalization":{},"destinationMapping":{},"performResync":false}}}
   */
  // API: https://docs.segmentapis.com/tag/Activations/
  async getActivation(spaceId, audienceId, id) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(audienceId, 'Audience is required — pick one from the Audience dropdown.')
    this.#requireParam(id, 'Activation ID is required — run List Activations to find it.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ audienceId }/activations/${ id }`,
      logTag: 'getActivation',
    })
  }

  /**
   * @operationName Update Activation
   * @category Audience Activations
   * @description Updates an activation's name, enabled state, resync flag, personalization, or destination mapping. Personalization and destination mapping are user-authored objects.
   * @route POST /update-activation
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Activation ID","name":"id","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The activation to update. Use List Activations to find the ID."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable the activation."}
   * @paramDef {"type":"String","label":"Activation Name","name":"activationName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A new name for the activation."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A new display name."}
   * @paramDef {"type":"Boolean","label":"Perform Resync","name":"performResync","uiComponent":{"type":"TOGGLE"},"description":"Whether to resync existing audience members."}
   * @paramDef {"type":"Object","label":"Personalization","name":"personalization","freeform":true,"description":"Replacement personalization mapping as a JSON object. User-authored."}
   * @paramDef {"type":"Object","label":"Destination Mapping","name":"destinationMapping","freeform":true,"description":"Replacement per-destination field map as a JSON object. User-authored."}
   * @returns {Object}
   * @sampleResult {"data":{"activation":{"id":"act_1","enabled":false,"activationName":"Send to Amplitude","performResync":true}}}
   */
  // API: https://docs.segmentapis.com/tag/Activations/
  async updateActivation(spaceId, audienceId, id, enabled, activationName, displayName, performResync, personalization, destinationMapping) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(audienceId, 'Audience is required — pick one from the Audience dropdown.')
    this.#requireParam(id, 'Activation ID is required — run List Activations to find it.')

    const body = {}

    if (enabled !== undefined && enabled !== null) body.enabled = enabled
    if (activationName !== undefined && activationName !== null) body.activationName = activationName
    if (displayName !== undefined && displayName !== null) body.displayName = displayName
    if (performResync !== undefined && performResync !== null) body.performResync = performResync
    if (personalization !== undefined && personalization !== null) body.personalization = personalization
    if (destinationMapping !== undefined && destinationMapping !== null) body.destinationMapping = destinationMapping

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ audienceId }/activations/${ id }`,
      method: 'patch',
      body,
      logTag: 'updateActivation',
    })
  }

  /**
   * @operationName Remove Activation
   * @category Audience Activations
   * @description Permanently removes an activation from an Audience. The destination stops receiving that audience's membership events. This cannot be undone.
   * @route POST /remove-activation
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","dictionary":"getAudiencesDictionary","dependsOn":["spaceId"],"required":true,"description":"The Audience. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Activation ID","name":"id","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The activation to permanently remove. Use List Activations to find the ID."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Activations/
  async removeActivation(spaceId, audienceId, id) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(audienceId, 'Audience is required — pick one from the Audience dropdown.')
    this.#requireParam(id, 'Activation ID is required — run List Activations to find it.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audiences/${ audienceId }/activations/${ id }`,
      method: 'delete',
      logTag: 'removeActivation',
    })
  }

  /**
   * @operationName List Supported Destinations
   * @category Audience Activations
   * @description Returns the destinations (and their actions) that support activation for a given audience type in a Space. Use this to discover which destination to connect and its available actions.
   * @route POST /list-supported-destinations
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Audience Type","name":"audienceType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Users","Accounts","Linked"]}},"description":"The audience type to list supported destinations for."}
   * @paramDef {"type":"String","label":"Destination Slug","name":"slug","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optionally filter to one destination slug."}
   * @paramDef {"type":"String","label":"Action","name":"actionId","dictionary":"getSupportedActionsDictionary","dependsOn":["spaceId","audienceType","slug"],"description":"Optionally filter to one action. Pick from the dropdown (after choosing a Space, Audience Type, and optional Destination Slug)."}
   * @returns {Object}
   * @sampleResult {"data":{"destinations":{"amplitude":{"name":"Amplitude","slug":"amplitude","actions":[{"actionId":"act_track","actionName":"Track Event","settings":[]}]}}}}
   */
  // API: https://docs.segmentapis.com/tag/Activations/
  async listSupportedDestinations(spaceId, audienceType, slug, actionId) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(audienceType, 'Audience Type is required — pick one from the Audience Type dropdown.')

    const resolvedAudienceType = this.#resolveChoice(audienceType, AUDIENCE_TYPE_MAP)
    const query = {}

    if (slug) query.slug = slug
    if (actionId) query.actionId = actionId

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/audienceType/${ resolvedAudienceType }/supported-destinations`,
      query,
      logTag: 'listSupportedDestinations',
    })
  }

  // ==========================================================================
  //  COMPUTED TRAITS (Unify; space-scoped)
  // ==========================================================================
  /**
   * @operationName List Computed Traits
   * @category Computed Traits
   * @description Returns a page of Computed Traits in an Engage Space. Use this to browse traits or find a trait ID. Requires the Unify entitlement.
   * @route POST /list-computed-traits
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space whose computed traits to list. Pick from the dropdown."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many traits to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"computedTraits":[{"id":"ct_1","spaceId":"spa_123","name":"High Value","key":"high_value","status":"ACTIVE","enabled":true}],"pagination":{"current":"MA==","totalEntries":1}}}
   */
  // API: https://docs.segmentapis.com/tag/Computed-Traits/ (rate limit 25/min)
  async listComputedTraits(spaceId, count, cursor) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/computed-traits`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listComputedTraits',
    })
  }

  /**
   * @operationName Get Computed Trait
   * @category Computed Traits
   * @description Retrieves a single Computed Trait by its ID, including its definition query and type. The trait field is a dropdown backed by a dictionary that depends on the chosen Space.
   * @route POST /get-computed-trait
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Computed Trait","name":"id","dictionary":"getComputedTraitsDictionary","dependsOn":["spaceId"],"required":true,"description":"The Computed Trait to retrieve. Pick from the dropdown (after choosing a Space)."}
   * @returns {Object}
   * @sampleResult {"data":{"computedTrait":{"id":"ct_1","spaceId":"spa_123","name":"High Value","description":"","key":"high_value","definition":{"query":"event('Purchased').count() >= 5","type":"USERS"},"status":"ACTIVE","enabled":true,"createdBy":"u1","updatedBy":"u1","createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Computed-Traits/ (rate limit 100/min)
  async getComputedTrait(spaceId, id) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(id, 'Computed Trait is required — pick one from the Computed Trait dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/computed-traits/${ id }`,
      logTag: 'getComputedTrait',
    })
  }

  /**
   * @operationName Create Computed Trait
   * @category Computed Traits
   * @description Creates a new Computed Trait in an Engage Space from a definition query and type. The query is user-authored FQL. Requires the Unify entitlement.
   * @route POST /create-computed-trait
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space to create the trait in. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The computed trait's name."}
   * @paramDef {"type":"Object","label":"Definition","name":"definition","required":true,"freeform":true,"description":"The computed-trait definition JSON, e.g. {\"query\":\"event('Purchased').count() >= 5\",\"type\":\"USERS\"}. The query is user-authored FQL."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Enable the trait on creation. Defaults to true."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"An optional description."}
   * @paramDef {"type":"Object","label":"Options","name":"options","freeform":true,"description":"Optional compute options as JSON, e.g. {\"includeHistoricalData\":true,\"backfillDurationDays\":30}."}
   * @returns {Object}
   * @sampleResult {"data":{"computedTrait":{"id":"ct_1","spaceId":"spa_123","name":"High Value","description":"","key":"high_value","definition":{"query":"event('Purchased').count() >= 5","type":"USERS"},"status":"CREATING","enabled":true,"createdBy":"u1","updatedBy":"u1","createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Computed-Traits/ (rate limit 10/min)
  async createComputedTrait(spaceId, name, definition, enabled, description, options) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(name, 'Name is required — enter a name for the Computed Trait.')
    this.#requireParam(definition, 'Definition is required — provide {"query":"...","type":"USERS"}.')

    const body = {
      name,
      definition,
      enabled: enabled === undefined ? true : enabled,
    }

    if (description !== undefined && description !== null) body.description = description
    if (options !== undefined && options !== null) body.options = options

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/computed-traits`,
      method: 'post',
      body,
      logTag: 'createComputedTrait',
    })
  }

  /**
   * @operationName Update Computed Trait
   * @category Computed Traits
   * @description Updates an existing Computed Trait's name, description, enabled state, or definition. The definition query is user-authored FQL.
   * @route POST /update-computed-trait
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Computed Trait","name":"id","dictionary":"getComputedTraitsDictionary","dependsOn":["spaceId"],"required":true,"description":"The Computed Trait to update. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A new name."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable the trait."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A new description."}
   * @paramDef {"type":"Object","label":"Definition","name":"definition","freeform":true,"description":"A new definition JSON, e.g. {\"query\":\"event('Purchased').count() >= 10\",\"type\":\"USERS\"}. User-authored FQL."}
   * @returns {Object}
   * @sampleResult {"data":{"computedTrait":{"id":"ct_1","spaceId":"spa_123","name":"High Value v2","key":"high_value","definition":{"query":"event('Purchased').count() >= 10","type":"USERS"},"status":"COMPUTING","enabled":true}}}
   */
  // API: https://docs.segmentapis.com/tag/Computed-Traits/ (rate limit 10/min)
  async updateComputedTrait(spaceId, id, name, enabled, description, definition) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(id, 'Computed Trait is required — pick one from the Computed Trait dropdown.')

    const body = {}

    if (name !== undefined && name !== null) body.name = name
    if (enabled !== undefined && enabled !== null) body.enabled = enabled
    if (description !== undefined && description !== null) body.description = description
    if (definition !== undefined && definition !== null) body.definition = definition

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/computed-traits/${ id }`,
      method: 'patch',
      body,
      logTag: 'updateComputedTrait',
    })
  }

  /**
   * @operationName Delete Computed Trait
   * @category Computed Traits
   * @description Permanently removes a Computed Trait from a Space. This cannot be undone, so use Get Computed Trait first to confirm the right one.
   * @route POST /delete-computed-trait
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Computed Trait","name":"id","dictionary":"getComputedTraitsDictionary","dependsOn":["spaceId"],"required":true,"description":"The Computed Trait to permanently delete. Pick from the dropdown (after choosing a Space)."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Computed-Traits/ (rate limit 20/min)
  async deleteComputedTrait(spaceId, id) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(id, 'Computed Trait is required — pick one from the Computed Trait dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/computed-traits/${ id }`,
      method: 'delete',
      logTag: 'deleteComputedTrait',
    })
  }

  // ==========================================================================
  //  SPACE FILTERS (Unify; /filters keyed by integrationId = space id)
  // ==========================================================================
  /**
   * @operationName List Space Filters
   * @category Space Filters
   * @description Returns the profile/event filters configured on an Engage Space. Use this to review a Space's filters or find a filter ID.
   * @route POST /list-space-filters
   * @paramDef {"type":"String","label":"Space","name":"integrationId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space whose filters to list (sent as the integrationId query param). Pick from the dropdown."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many filters to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"filters":[{"id":"flt_1","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","integrationId":"spa_123","name":"Block test events","if":"type = \"track\"","createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}]}}
   */
  // API: https://docs.segmentapis.com/tag/Space-Filters/
  async listSpaceFilters(integrationId, count, cursor) {
    this.#requireParam(integrationId, 'Space is required — pick one from the Space dropdown.')

    const query = this.#paginationQuery(count, cursor)

    query.integrationId = integrationId

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/filters`,
      query,
      logTag: 'listSpaceFilters',
    })
  }

  /**
   * @operationName Get Space Filter
   * @category Space Filters
   * @description Retrieves a single Space Filter by its ID, including its FQL condition. Pick a Space to populate the filter dropdown, then choose the filter.
   * @route POST /get-space-filter
   * @paramDef {"type":"String","label":"Space","name":"integrationId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space whose filters to choose from. Pick from the dropdown. (Used only to populate the filter list; not sent to the API.)"}
   * @paramDef {"type":"String","label":"Space Filter","name":"id","dictionary":"getSpaceFiltersDictionary","dependsOn":["integrationId"],"required":true,"description":"The Space Filter to retrieve. Pick from the dropdown (after choosing a Space)."}
   * @returns {Object}
   * @sampleResult {"data":{"filter":{"id":"flt_1","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","integrationId":"spa_123","name":"Block test events","if":"type = \"track\"","createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Space-Filters/ (integrationId is a UI-only picker scope; the API call is GET /filters/{id})
  async getSpaceFilter(integrationId, id) {
    this.#requireParam(id, 'Space Filter is required — pick one from the Space Filter dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/filters/${ id }`,
      logTag: 'getSpaceFilter',
    })
  }

  /**
   * @operationName Create Space Filter
   * @category Space Filters
   * @description Creates a profile/event filter on an Engage Space based on an FQL condition. Use this to block or drop events from a Space's profiles.
   * @route POST /create-space-filter
   * @paramDef {"type":"String","label":"Space","name":"integrationId","dictionary":"getSpacesDictionary","required":true,"description":"The Space to filter on. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A name for the filter."}
   * @paramDef {"type":"String","label":"Condition (FQL)","name":"if","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"FQL statement selecting events, e.g. type = \"track\"."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Enable the filter immediately. Defaults to true."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"An optional description."}
   * @paramDef {"type":"Boolean","label":"Drop","name":"drop","uiComponent":{"type":"TOGGLE"},"description":"Drop the event when the condition matches."}
   * @returns {Object}
   * @sampleResult {"data":{"filter":{"id":"flt_1","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","integrationId":"spa_123","name":"Block test events","if":"type = \"track\"","createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Space-Filters/
  async createSpaceFilter(integrationId, name, ifCondition, enabled, description, drop) {
    this.#requireParam(integrationId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(name, 'Name is required — enter a name for the filter.')
    this.#requireParam(ifCondition, 'Condition (FQL) is required — enter an FQL condition, e.g. type = "track".')

    const body = {
      integrationId,
      name,
      if: ifCondition,
    }

    if (enabled !== undefined && enabled !== null) body.enabled = enabled
    if (description !== undefined && description !== null) body.description = description
    if (drop !== undefined && drop !== null) body.drop = drop

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/filters`,
      method: 'post',
      body,
      logTag: 'createSpaceFilter',
    })
  }

  /**
   * @operationName Update Space Filter
   * @category Space Filters
   * @description Updates an existing Space Filter's name, condition, enabled state, or drop behavior. Pick the Space to populate the filter dropdown. Provide at least one field to change.
   * @route POST /update-space-filter
   * @paramDef {"type":"String","label":"Space","name":"integrationId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space whose filters to choose from (also sets the filter's Space, so picking a different Space moves the filter). Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Space Filter","name":"id","dictionary":"getSpaceFiltersDictionary","dependsOn":["integrationId"],"required":true,"description":"The Space Filter to update. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A new name for the filter."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A new description."}
   * @paramDef {"type":"String","label":"Condition (FQL)","name":"if","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A new FQL condition, e.g. type = \"identify\"."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable the filter."}
   * @paramDef {"type":"Boolean","label":"Drop","name":"drop","uiComponent":{"type":"TOGGLE"},"description":"Drop the event when the condition matches."}
   * @returns {Object}
   * @sampleResult {"data":{"filter":{"id":"flt_1","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","integrationId":"spa_123","name":"Block test events v2","if":"type = \"identify\"","createdAt":"2006-01-02T15:04:05.000Z","updatedAt":"2006-01-02T15:04:05.000Z"}}}
   */
  // API: https://docs.segmentapis.com/tag/Space-Filters/
  async updateSpaceFilter(integrationId, id, name, description, ifCondition, enabled, drop) {
    this.#requireParam(integrationId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(id, 'Space Filter is required — pick one from the Space Filter dropdown.')

    const body = {}

    if (integrationId !== undefined && integrationId !== null) body.integrationId = integrationId
    if (name !== undefined && name !== null) body.name = name
    if (description !== undefined && description !== null) body.description = description
    if (ifCondition !== undefined && ifCondition !== null) body.if = ifCondition
    if (enabled !== undefined && enabled !== null) body.enabled = enabled
    if (drop !== undefined && drop !== null) body.drop = drop

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/filters/${ id }`,
      method: 'patch',
      body,
      logTag: 'updateSpaceFilter',
    })
  }

  /**
   * @operationName Delete Space Filter
   * @category Space Filters
   * @description Permanently removes a Space Filter. The events it was blocking flow through again. Pick a Space to populate the filter dropdown. This cannot be undone.
   * @route POST /delete-space-filter
   * @paramDef {"type":"String","label":"Space","name":"integrationId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space whose filters to choose from. Pick from the dropdown. (Used only to populate the filter list; not sent to the API.)"}
   * @paramDef {"type":"String","label":"Space Filter","name":"id","dictionary":"getSpaceFiltersDictionary","dependsOn":["integrationId"],"required":true,"description":"The Space Filter to permanently delete. Pick from the dropdown (after choosing a Space)."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Space-Filters/ (integrationId is a UI-only picker scope; the API call is DELETE /filters/{id})
  async deleteSpaceFilter(integrationId, id) {
    this.#requireParam(id, 'Space Filter is required — pick one from the Space Filter dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/filters/${ id }`,
      method: 'delete',
      logTag: 'deleteSpaceFilter',
    })
  }

  // ==========================================================================
  //  REVERSE ETL - MODELS
  // ==========================================================================
  /**
   * @operationName List Reverse ETL Models
   * @category Reverse ETL
   * @description Returns a page of Reverse ETL Models in the workspace. Each model is a SQL query that extracts rows from a connected warehouse Source. Use this to browse models or find a model ID. Requires a Reverse-ETL-capable Source.
   * @route POST /list-reverse-etl-models
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many models to return per page. Leave blank for the API default."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response's pagination.next."}
   * @returns {Object}
   * @sampleResult {"data":{"models":[{"id":"mdl_1","sourceId":"src_1","name":"Daily customers","description":"","enabled":true,"query":"SELECT * FROM customers","queryIdentifierColumn":"id"}],"pagination":{"current":"MA==","totalEntries":1}}}
   */
  // API: https://docs.segmentapis.com/tag/Reverse-ETL/
  async listReverseEtlModels(count, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/reverse-etl-models`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listReverseEtlModels',
    })
  }

  /**
   * @operationName Get Reverse ETL Model
   * @category Reverse ETL
   * @description Retrieves a single Reverse ETL Model by its ID, including its SQL query and identifier column. The Model field is a dropdown backed by a dictionary.
   * @route POST /get-reverse-etl-model
   * @paramDef {"type":"String","label":"Model","name":"modelId","dictionary":"getReverseEtlModelsDictionary","required":true,"description":"The Reverse ETL Model to retrieve. Pick from the dropdown or paste a model ID."}
   * @returns {Object}
   * @sampleResult {"data":{"model":{"id":"mdl_1","sourceId":"src_1","name":"Daily customers","description":"","enabled":true,"query":"SELECT * FROM customers","queryIdentifierColumn":"id"}}}
   */
  // API: https://docs.segmentapis.com/tag/Reverse-ETL/
  async getReverseEtlModel(modelId) {
    this.#requireParam(modelId, 'Model is required — pick one from the Model dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/reverse-etl-models/${ modelId }`,
      logTag: 'getReverseEtlModel',
    })
  }

  /**
   * @operationName Create Reverse ETL Model
   * @category Reverse ETL
   * @description Creates a Reverse ETL Model: a SQL query that extracts rows from a connected warehouse Source so they can be synced out to destinations. The query is user-authored SQL.
   * @route POST /create-reverse-etl-model
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Reverse-ETL-capable Source (warehouse) the model reads from. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A name for the model."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of what the model extracts."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","required":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the model is enabled to run."}
   * @paramDef {"type":"String","label":"SQL Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SQL query that extracts rows from the source warehouse. User-authored SQL."}
   * @paramDef {"type":"String","label":"Identifier Column","name":"queryIdentifierColumn","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The column that uniquely identifies each extracted row."}
   * @returns {Object}
   * @sampleResult {"data":{"model":{"id":"mdl_1","sourceId":"src_1","name":"Daily customers","description":"All customers","enabled":true,"query":"SELECT * FROM customers","queryIdentifierColumn":"id"}}}
   */
  // API: https://docs.segmentapis.com/tag/Reverse-ETL/
  async createReverseEtlModel(sourceId, name, description, enabled, query, queryIdentifierColumn) {
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')
    this.#requireParam(name, 'Name is required — enter a name for the model.')
    this.#requireParam(description, 'Description is required — enter a description for the model.')
    this.#requireParam(enabled, 'Enabled is required — choose whether the model is enabled.')
    this.#requireParam(query, 'SQL Query is required — enter the extraction SQL.')
    this.#requireParam(queryIdentifierColumn, 'Identifier Column is required — name the column that uniquely identifies each row.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/reverse-etl-models`,
      method: 'post',
      body: { sourceId, name, description, enabled, query, queryIdentifierColumn },
      logTag: 'createReverseEtlModel',
    })
  }

  /**
   * @operationName Update Reverse ETL Model
   * @category Reverse ETL
   * @description Updates an existing Reverse ETL Model's name, description, enabled state, SQL query, or identifier column. Use this to refine a model without recreating it.
   * @route POST /update-reverse-etl-model
   * @paramDef {"type":"String","label":"Model","name":"modelId","dictionary":"getReverseEtlModelsDictionary","required":true,"description":"The Reverse ETL Model to update. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A new name for the model."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A new description."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable the model."}
   * @paramDef {"type":"String","label":"SQL Query","name":"query","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A new extraction SQL query. User-authored SQL."}
   * @paramDef {"type":"String","label":"Identifier Column","name":"queryIdentifierColumn","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A new unique identifier column."}
   * @returns {Object}
   * @sampleResult {"data":{"model":{"id":"mdl_1","sourceId":"src_1","name":"Daily customers v2","enabled":false,"query":"SELECT * FROM customers WHERE active","queryIdentifierColumn":"id"}}}
   */
  // API: https://docs.segmentapis.com/tag/Reverse-ETL/ (all body fields are optional)
  async updateReverseEtlModel(modelId, name, description, enabled, query, queryIdentifierColumn) {
    this.#requireParam(modelId, 'Model is required — pick one from the Model dropdown.')

    const body = {}

    if (name !== undefined && name !== null) body.name = name
    if (description !== undefined && description !== null) body.description = description
    if (enabled !== undefined && enabled !== null) body.enabled = enabled
    if (query !== undefined && query !== null) body.query = query
    if (queryIdentifierColumn !== undefined && queryIdentifierColumn !== null) body.queryIdentifierColumn = queryIdentifierColumn

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/reverse-etl-models/${ modelId }`,
      method: 'patch',
      body,
      logTag: 'updateReverseEtlModel',
    })
  }

  /**
   * @operationName Delete Reverse ETL Model
   * @category Reverse ETL
   * @description Permanently deletes a Reverse ETL Model. This cannot be undone, so use Get Reverse ETL Model first to confirm the right one.
   * @route POST /delete-reverse-etl-model
   * @paramDef {"type":"String","label":"Model","name":"modelId","dictionary":"getReverseEtlModelsDictionary","required":true,"description":"The Reverse ETL Model to permanently delete. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Reverse-ETL/
  async deleteReverseEtlModel(modelId) {
    this.#requireParam(modelId, 'Model is required — pick one from the Model dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/reverse-etl-models/${ modelId }`,
      method: 'delete',
      logTag: 'deleteReverseEtlModel',
    })
  }

  // ==========================================================================
  //  REVERSE ETL - SYNCS (mappings)
  // ==========================================================================
  /**
   * @operationName Create Reverse ETL Manual Sync
   * @category Reverse ETL
   * @description Triggers a manual Reverse ETL sync for a model + mapping (subscription). Use this to run a sync now outside its normal schedule. Rate limit 20/min.
   * @route POST /create-reverse-etl-sync
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source the model belongs to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Model","name":"modelId","dictionary":"getReverseEtlModelsDictionary","required":true,"description":"The Reverse ETL Model to sync. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Subscription (Mapping) ID","name":"subscription","required":true,"description":"The mapping/subscription that ties the model to a destination (sent as subscriptionId). Find it in the Segment app's Reverse ETL mappings."}
   * @returns {Object}
   * @sampleResult {"data":{"syncId":"sync_1","startedAt":"2006-01-02T15:04:05.000Z"}}
   */
  // API: https://docs.segmentapis.com/tag/Reverse-ETL/
  async createReverseEtlSync(sourceId, modelId, subscription) {
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')
    this.#requireParam(modelId, 'Model is required — pick one from the Model dropdown.')
    this.#requireParam(subscription, 'Subscription (Mapping) ID is required — enter the mapping/subscription id.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/reverse-etl-syncs`,
      method: 'post',
      body: { sourceId, modelId, subscriptionId: subscription },
      logTag: 'createReverseEtlSync',
    })
  }

  /**
   * @operationName Get Reverse ETL Sync Status
   * @category Reverse ETL
   * @description Retrieves the status of one Reverse ETL sync run, including its extract and load phase counts. Use the Sync ID returned by Create Reverse ETL Manual Sync.
   * @route POST /get-reverse-etl-sync-status
   * @paramDef {"type":"String","label":"Model","name":"modelId","dictionary":"getReverseEtlModelsDictionary","required":true,"description":"The Reverse ETL Model the sync belongs to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Sync ID","name":"sync","required":true,"description":"The sync run ID returned by Create Reverse ETL Manual Sync (as syncId)."}
   * @returns {Object}
   * @sampleResult {"data":{"syncStatus":"SUCCESS","duration":1200,"error":"","errorCode":"","startedAt":"2006-01-02T15:04:05.000Z","finishedAt":"2006-01-02T15:05:05.000Z","extractPhase":{"added":10,"updated":2,"deleted":0,"extract":12},"loadPhase":{"deliverySuccess":12,"deliveryFailure":0}}}
   */
  // API: https://docs.segmentapis.com/tag/Reverse-ETL/
  async getReverseEtlSyncStatus(modelId, sync) {
    this.#requireParam(modelId, 'Model is required — pick one from the Model dropdown.')
    this.#requireParam(sync, 'Sync ID is required — use the ID returned by Create Reverse ETL Manual Sync.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/reverse-etl-models/${ modelId }/syncs/${ sync }`,
      logTag: 'getReverseEtlSyncStatus',
    })
  }

  /**
   * @operationName List Reverse ETL Sync Statuses
   * @category Reverse ETL
   * @description Returns a page of sync statuses for a model + mapping (subscription). Use this to review recent syncs. This endpoint uses plain count/cursor query params (not Segment's dotted pagination).
   * @route POST /list-reverse-etl-sync-statuses
   * @paramDef {"type":"String","label":"Model","name":"modelId","dictionary":"getReverseEtlModelsDictionary","required":true,"description":"The Reverse ETL Model. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Subscription (Mapping) ID","name":"subscription","required":true,"description":"The mapping/subscription whose sync statuses to list (the subscriptionId path segment)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many statuses to return per page (1-100, default 10)."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"syncs":[{"syncStatus":"SUCCESS","startedAt":"2006-01-02T15:04:05.000Z","finishedAt":"2006-01-02T15:05:05.000Z"}],"pagination":{"current":"MA==","next":"MQ=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Reverse-ETL/ (this endpoint uses plain count/cursor pagination, unlike the dotted pagination elsewhere)
  async listReverseEtlSyncStatuses(modelId, subscription, count, cursor) {
    this.#requireParam(modelId, 'Model is required — pick one from the Model dropdown.')
    this.#requireParam(subscription, 'Subscription (Mapping) ID is required — enter the mapping/subscription id.')

    const query = {}

    if (count !== undefined && count !== null && count !== '') query.count = count
    if (cursor) query.cursor = cursor

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/reverse-etl-models/${ modelId }/subscriptionId/${ subscription }/syncs`,
      query,
      logTag: 'listReverseEtlSyncStatuses',
    })
  }

  /**
   * @operationName Cancel Reverse ETL Sync
   * @category Reverse ETL
   * @description Cancels an in-progress Reverse ETL sync, recording a reason. Use the Sync ID returned by Create Reverse ETL Manual Sync.
   * @route POST /cancel-reverse-etl-sync
   * @paramDef {"type":"String","label":"Model","name":"modelId","dictionary":"getReverseEtlModelsDictionary","required":true,"description":"The Reverse ETL Model the sync belongs to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Sync ID","name":"sync","required":true,"description":"The sync run ID to cancel (returned by Create Reverse ETL Manual Sync as syncId)."}
   * @paramDef {"type":"String","label":"Reason","name":"reasonForCanceling","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Incorrect Model","Incorrect Destination","Incorrect Keys","Incorrect Mapping","Other"]}},"description":"Why the sync is being canceled."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"CANCELLING"}}
   */
  // API: https://docs.segmentapis.com/tag/Reverse-ETL/
  // The cancel reason is a numeric enum; the dropdown value is the code as a string and is sent as a Number.
  async cancelReverseEtlSync(modelId, sync, reasonForCanceling) {
    this.#requireParam(modelId, 'Model is required — pick one from the Model dropdown.')
    this.#requireParam(sync, 'Sync ID is required — use the ID returned by Create Reverse ETL Manual Sync.')
    this.#requireParam(reasonForCanceling, 'Reason is required — pick a cancellation reason from the dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/reverse-etl-models/${ modelId }/syncs/${ sync }/cancel`,
      method: 'post',
      body: { reasonForCanceling: Number(this.#resolveChoice(reasonForCanceling, CANCEL_SYNC_REASON_MAP)) },
      logTag: 'cancelReverseEtlSync',
    })
  }

  // ==========================================================================
  //  PROFILES SYNC (space-scoped profiles warehouses)
  // ==========================================================================
  /**
   * @operationName List Profiles Warehouses
   * @category Profiles Sync
   * @description Returns the Profiles Sync warehouses configured on an Engage Space. Use this to review where profile data is synced or find a profiles-warehouse ID. Requires a Profiles-Sync-enabled Space.
   * @route POST /list-profiles-warehouses
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space whose profiles warehouses to list. Pick from the dropdown."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many warehouses to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"profilesWarehouses":[{"id":"pwh_1","spaceId":"spa_123","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","enabled":true,"metadata":{},"settings":{}}],"pagination":{"current":"MA=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Profiles-Sync/
  async listProfilesWarehouses(spaceId, count, cursor) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/profiles-warehouses`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listProfilesWarehouses',
    })
  }

  /**
   * @operationName Create Profiles Warehouse
   * @category Profiles Sync
   * @description Connects a warehouse to an Engage Space so Segment syncs profile data into it. Pick the warehouse type and supply the connection Settings, which are connector-specific.
   * @route POST /create-profiles-warehouse
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space to add the profiles warehouse to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Warehouse Type","name":"metadataId","dictionary":"getWarehouseCatalogDictionary","required":true,"description":"The warehouse type (metadata id), e.g. Snowflake, BigQuery. Pick from the dropdown."}
   * @paramDef {"type":"Object","label":"Settings","name":"settings","required":true,"freeform":true,"description":"Connection settings as a JSON object. Keys depend on the warehouse type and are not enumerable ahead of time."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A display name for this profiles warehouse."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Enable the warehouse on creation. Defaults to true."}
   * @paramDef {"type":"String","label":"Schema Name","name":"schemaName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Custom schema name on the warehouse side."}
   * @returns {Object}
   * @sampleResult {"data":{"profilesWarehouse":{"id":"pwh_1","spaceId":"spa_123","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","enabled":true,"metadata":{},"settings":{}}}}
   */
  // API: https://docs.segmentapis.com/tag/Profiles-Sync/
  async createProfilesWarehouse(spaceId, metadataId, settings, name, enabled, schemaName) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(metadataId, 'Warehouse Type is required — pick one from the Warehouse Type dropdown.')
    this.#requireParam(settings, 'Settings is required — provide the connector-specific connection settings JSON.')

    const body = { metadataId, settings }

    if (name !== undefined && name !== null) body.name = name
    if (enabled !== undefined && enabled !== null) body.enabled = enabled
    if (schemaName !== undefined && schemaName !== null) body.schemaName = schemaName

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/profiles-warehouses`,
      method: 'post',
      body,
      logTag: 'createProfilesWarehouse',
    })
  }

  /**
   * @operationName Update Profiles Warehouse
   * @category Profiles Sync
   * @description Updates a Profiles Sync warehouse's settings, name, enabled state, or schema name. Use List Profiles Warehouses to find the warehouse ID.
   * @route POST /update-profiles-warehouse
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space the warehouse belongs to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Profiles Warehouse","name":"warehouseId","dictionary":"getProfilesWarehousesDictionary","dependsOn":["spaceId"],"required":true,"description":"The profiles-warehouse to update. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"Object","label":"Settings","name":"settings","required":true,"freeform":true,"description":"Replacement connection settings as JSON. Keys depend on the warehouse type."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A new display name."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable the warehouse."}
   * @paramDef {"type":"String","label":"Schema Name","name":"schemaName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A new custom schema name."}
   * @returns {Object}
   * @sampleResult {"data":{"profilesWarehouse":{"id":"pwh_1","spaceId":"spa_123","enabled":false,"metadata":{},"settings":{}}}}
   */
  // API: https://docs.segmentapis.com/tag/Profiles-Sync/ (settings keys are per-connector and not verified against the docs)
  async updateProfilesWarehouse(spaceId, warehouseId, settings, name, enabled, schemaName) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(warehouseId, 'Profiles Warehouse ID is required — use List Profiles Warehouses to find it.')
    this.#requireParam(settings, 'Settings is required — provide the connector-specific connection settings JSON.')

    const body = { settings }

    if (name !== undefined && name !== null) body.name = name
    if (enabled !== undefined && enabled !== null) body.enabled = enabled
    if (schemaName !== undefined && schemaName !== null) body.schemaName = schemaName

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/profiles-warehouses/${ warehouseId }`,
      method: 'patch',
      body,
      logTag: 'updateProfilesWarehouse',
    })
  }

  /**
   * @operationName Delete Profiles Warehouse
   * @category Profiles Sync
   * @description Permanently removes a Profiles Sync warehouse from a Space. This cannot be undone.
   * @route POST /delete-profiles-warehouse
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space the warehouse belongs to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Profiles Warehouse","name":"warehouseId","dictionary":"getProfilesWarehousesDictionary","dependsOn":["spaceId"],"required":true,"description":"The profiles-warehouse to permanently delete. Pick from the dropdown (after choosing a Space)."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Profiles-Sync/
  async deleteProfilesWarehouse(spaceId, warehouseId) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(warehouseId, 'Profiles Warehouse ID is required — use List Profiles Warehouses to find it.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/profiles-warehouses/${ warehouseId }`,
      method: 'delete',
      logTag: 'deleteProfilesWarehouse',
    })
  }

  /**
   * @operationName List Profiles Selective Syncs
   * @category Profiles Sync
   * @description Returns the selective-sync collection settings for a Profiles Sync warehouse, showing which collections and properties sync. Use List Profiles Warehouses to find the warehouse ID.
   * @route POST /list-profiles-selective-syncs
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space the warehouse belongs to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Profiles Warehouse","name":"warehouseId","dictionary":"getProfilesWarehousesDictionary","dependsOn":["spaceId"],"required":true,"description":"The profiles-warehouse whose selective syncs to list. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many items to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"enableEventTables":true,"items":[{"collection":"tracks","enabled":true,"properties":{}}],"pagination":{"current":"MA=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Profiles-Sync/
  async listProfilesSelectiveSyncs(spaceId, warehouseId, count, cursor) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(warehouseId, 'Profiles Warehouse ID is required — use List Profiles Warehouses to find it.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/profiles-warehouses/${ warehouseId }/selective-syncs`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listProfilesSelectiveSyncs',
    })
  }

  /**
   * @operationName Update Profiles Selective Sync
   * @category Profiles Sync
   * @description Updates which collections and properties a Profiles Sync warehouse syncs, via per-connector settings and optional sync overrides.
   * @route POST /update-profiles-selective-sync
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","required":true,"description":"The Engage Space the warehouse belongs to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Profiles Warehouse","name":"warehouseId","dictionary":"getProfilesWarehousesDictionary","dependsOn":["spaceId"],"required":true,"description":"The profiles-warehouse whose selective sync to update. Pick from the dropdown (after choosing a Space)."}
   * @paramDef {"type":"Object","label":"Settings","name":"settings","required":true,"freeform":true,"description":"Per-connector selective-sync settings as JSON. Keys depend on the warehouse type."}
   * @paramDef {"type":"Array<ProfilesSyncOverride>","label":"Sync Overrides","name":"syncOverrides","description":"Per-collection/property overrides controlling what syncs."}
   * @paramDef {"type":"Boolean","label":"Enable Event Tables","name":"enableEventTables","uiComponent":{"type":"TOGGLE"},"description":"Whether to sync event tables."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"UPDATED"}}
   */
  // API: https://docs.segmentapis.com/tag/Profiles-Sync/ (settings/syncOverrides keys are per-connector and not verified against the docs)
  async updateProfilesSelectiveSync(spaceId, warehouseId, settings, syncOverrides, enableEventTables) {
    this.#requireParam(spaceId, 'Space is required — pick one from the Space dropdown.')
    this.#requireParam(warehouseId, 'Profiles Warehouse ID is required — use List Profiles Warehouses to find it.')
    this.#requireParam(settings, 'Settings is required — provide the connector-specific selective-sync settings JSON.')

    const body = { settings }

    if (syncOverrides !== undefined && syncOverrides !== null) body.syncOverrides = syncOverrides
    if (enableEventTables !== undefined && enableEventTables !== null) body.enableEventTables = enableEventTables

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/spaces/${ spaceId }/profiles-warehouses/${ warehouseId }/selective-syncs`,
      method: 'patch',
      body,
      logTag: 'updateProfilesSelectiveSync',
    })
  }

  // ==========================================================================
  //  SELECTIVE SYNC (warehouse connection-level)
  // ==========================================================================
  /**
   * @operationName Get Advanced Sync Schedule
   * @category Selective Sync
   * @description Returns the advanced sync schedule for a Warehouse, listing the hours of day it syncs and its timezone. Rate limit 2/min.
   * @route POST /get-advanced-sync-schedule
   * @paramDef {"type":"String","label":"Warehouse","name":"warehouseId","dictionary":"getWarehousesDictionary","required":true,"description":"The Warehouse whose schedule to retrieve. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"enabled":true,"schedule":{"times":[{"hourOfDay":5,"enabled":false}],"timezone":"America/Vancouver"}}}
   */
  // API: https://docs.segmentapis.com/tag/Selective-Sync/
  async getAdvancedSyncSchedule(warehouseId) {
    this.#requireParam(warehouseId, 'Warehouse is required — pick one from the Warehouse dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses/${ warehouseId }/advanced-sync-schedule`,
      logTag: 'getAdvancedSyncSchedule',
    })
  }

  /**
   * @operationName Replace Advanced Sync Schedule
   * @category Selective Sync
   * @description Replaces the advanced sync schedule for a Warehouse with a new set of sync hours and timezone. Rate limit 2/min.
   * @route POST /replace-advanced-sync-schedule
   * @paramDef {"type":"String","label":"Warehouse","name":"warehouseId","dictionary":"getWarehousesDictionary","required":true,"description":"The Warehouse whose schedule to replace. Pick from the dropdown."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","required":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the advanced sync schedule is enabled."}
   * @paramDef {"type":"Object","label":"Schedule","name":"schedule","required":true,"freeform":true,"description":"The schedule as JSON, e.g. {\"times\":[{\"hourOfDay\":5,\"enabled\":true}],\"timezone\":\"America/Vancouver\"}. The hours list is user-authored."}
   * @returns {Object}
   * @sampleResult {"data":{"enabled":true,"schedule":{"times":[{"hourOfDay":5,"enabled":true}],"timezone":"America/Vancouver"}}}
   */
  // API: https://docs.segmentapis.com/tag/Selective-Sync/
  async replaceAdvancedSyncSchedule(warehouseId, enabled, schedule) {
    this.#requireParam(warehouseId, 'Warehouse is required — pick one from the Warehouse dropdown.')
    this.#requireParam(enabled, 'Enabled is required — choose whether the schedule is enabled.')
    this.#requireParam(schedule, 'Schedule is required — provide the schedule JSON with times and timezone.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses/${ warehouseId }/advanced-sync-schedule`,
      method: 'put',
      body: { enabled, schedule },
      logTag: 'replaceAdvancedSyncSchedule',
    })
  }

  /**
   * @operationName List Warehouse Selective Syncs
   * @category Selective Sync
   * @description Returns the selective-sync property settings for a Source connected to a Warehouse, showing which collections and properties sync. Rate limit 2/min.
   * @route POST /list-warehouse-selective-syncs
   * @paramDef {"type":"String","label":"Warehouse","name":"warehouseId","dictionary":"getWarehousesDictionary","required":true,"description":"The Warehouse. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The connected Source. Pick from the dropdown."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many items to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"items":[{"sourceId":"rh5BDZp6QDHvXFCkibm1pR","collection":"tracks","warehouseId":"6WzNjtobBv3GjubD8wUnA6","properties":{"amount":{"enabled":true,"type":"integer","lastSeenAt":"2006-01-02T15:04:05.000Z","createdAt":"2006-01-02T15:04:05.000Z"}}}],"pagination":{"current":"MA==","next":"MTAw","totalEntries":10}}}
   */
  // API: https://docs.segmentapis.com/tag/Selective-Sync/
  async listWarehouseSelectiveSyncs(warehouseId, sourceId, count, cursor) {
    this.#requireParam(warehouseId, 'Warehouse is required — pick one from the Warehouse dropdown.')
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses/${ warehouseId }/connected-sources/${ sourceId }/selective-syncs`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listWarehouseSelectiveSyncs',
    })
  }

  /**
   * @operationName List Warehouse Syncs
   * @category Selective Sync
   * @description Returns the recent sync reports for a Warehouse across all its connected Sources. Rate limit 2/min.
   * @route POST /list-warehouse-syncs
   * @paramDef {"type":"String","label":"Warehouse","name":"warehouseId","dictionary":"getWarehousesDictionary","required":true,"description":"The Warehouse whose syncs to list. Pick from the dropdown."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many reports to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"reports":[],"pagination":{"next":null,"current":""}}}
   */
  // API: https://docs.segmentapis.com/tag/Selective-Sync/
  async listWarehouseSyncs(warehouseId, count, cursor) {
    this.#requireParam(warehouseId, 'Warehouse is required — pick one from the Warehouse dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses/${ warehouseId }/syncs`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listWarehouseSyncs',
    })
  }

  /**
   * @operationName List Warehouse Source Syncs
   * @category Selective Sync
   * @description Returns the recent sync reports for one Source connected to a Warehouse. Rate limit 2/min.
   * @route POST /list-warehouse-source-syncs
   * @paramDef {"type":"String","label":"Warehouse","name":"warehouseId","dictionary":"getWarehousesDictionary","required":true,"description":"The Warehouse. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The connected Source. Pick from the dropdown."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many reports to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"reports":[],"pagination":{"next":null,"current":""}}}
   */
  // API: https://docs.segmentapis.com/tag/Selective-Sync/
  async listWarehouseSourceSyncs(warehouseId, sourceId, count, cursor) {
    this.#requireParam(warehouseId, 'Warehouse is required — pick one from the Warehouse dropdown.')
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses/${ warehouseId }/connected-sources/${ sourceId }/syncs`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listWarehouseSourceSyncs',
    })
  }

  /**
   * @operationName Update Warehouse Selective Sync
   * @category Selective Sync
   * @description Applies per-property selective-sync overrides for a Warehouse, controlling which Source collections and properties sync. Rate limit 2/min.
   * @route POST /update-warehouse-selective-sync
   * @paramDef {"type":"String","label":"Warehouse","name":"warehouseId","dictionary":"getWarehousesDictionary","required":true,"description":"The Warehouse to update. Pick from the dropdown."}
   * @paramDef {"type":"Array<WarehouseSyncOverride>","label":"Sync Overrides","name":"syncOverrides","required":true,"description":"The per-property sync overrides to apply."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"UPDATED","warnings":[]}}
   */
  // API: https://docs.segmentapis.com/tag/Selective-Sync/
  async updateWarehouseSelectiveSync(warehouseId, syncOverrides) {
    this.#requireParam(warehouseId, 'Warehouse is required — pick one from the Warehouse dropdown.')
    this.#requireParam(syncOverrides, 'Sync Overrides is required — provide at least one override.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses/${ warehouseId }/selective-sync`,
      method: 'patch',
      body: { syncOverrides },
      logTag: 'updateWarehouseSelectiveSync',
    })
  }

  // ==========================================================================
  //  LIVE PLUGINS (per source)
  // ==========================================================================
  /**
   * @operationName Create Live Plugin
   * @category Live Plugins
   * @description Uploads (creates or replaces) the Live Plugin JavaScript code for a Source. Requires Live Plugins enabled on the Source. The code is user-authored.
   * @route POST /create-live-plugin
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source to attach the Live Plugin to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Code","name":"code","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The Live Plugin JavaScript code to upload. Creates or replaces the source's Live Plugin."}
   * @returns {Object}
   * @sampleResult {"data":{"livePlugin":{"id":"lp_1","sourceId":"src_1","downloadURL":"https://...","createdBy":"u1","createdAt":"2006-01-02T15:04:05.000Z","version":1,"code":"// plugin code"}}}
   */
  // API: https://docs.segmentapis.com/tag/Live-Plugins/
  async createLivePlugin(sourceId, code) {
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')
    this.#requireParam(code, 'Code is required — provide the Live Plugin JavaScript code.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/sources/${ sourceId }/live-plugins/create`,
      method: 'post',
      body: { code },
      logTag: 'createLivePlugin',
    })
  }

  /**
   * @operationName Get Latest Live Plugin
   * @category Live Plugins
   * @description Retrieves the latest Live Plugin for a Source, including its version and download URL.
   * @route POST /get-latest-live-plugin
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source whose latest Live Plugin to retrieve. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"livePlugin":{"id":"lp_1","sourceId":"src_1","downloadURL":"https://...","createdBy":"u1","createdAt":"2006-01-02T15:04:05.000Z","version":1,"code":"// plugin code"}}}
   */
  // API: https://docs.segmentapis.com/tag/Live-Plugins/
  async getLatestLivePlugin(sourceId) {
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/sources/${ sourceId }/live-plugins/latest`,
      logTag: 'getLatestLivePlugin',
    })
  }

  /**
   * @operationName Delete Live Plugin Code
   * @category Live Plugins
   * @description Permanently deletes the Live Plugin code for a Source. This cannot be undone.
   * @route POST /delete-live-plugin-code
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source whose Live Plugin code to permanently delete. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Live-Plugins/
  async deleteLivePluginCode(sourceId) {
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/sources/${ sourceId }/live-plugins/delete-code`,
      method: 'delete',
      logTag: 'deleteLivePluginCode',
    })
  }

  // ==========================================================================
  //  DBT
  // ==========================================================================
  /**
   * @operationName Create dbt Model Sync
   * @category dbt
   * @description Triggers a dbt model sync for a Source. The exact path and request body for this endpoint could not be confirmed from the docs (the dbt tag is JS-rendered), so confirm it against a live workspace before relying on it. Rate limit 10/min.
   * @route POST /create-dbt-model-sync
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source whose dbt model to sync. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"dbt Model ID","name":"dbtModel","required":true,"description":"The dbt model identifier to sync. Confirm how this endpoint is keyed against the live docs before relying on it."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/DBT/
  // The exact path and body for this endpoint could not be confirmed from the docs (the dbt tag is JS-rendered).
  // Assumed path POST /dbt-models/{dbtModel}/sync with sourceId in the body; confirm against a live workspace before relying on it.
  async createDbtModelSync(sourceId, dbtModel) {
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')
    this.#requireParam(dbtModel, 'dbt Model ID is required — enter the dbt model identifier.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/dbt-models/${ dbtModel }/sync`,
      method: 'post',
      body: { sourceId },
      logTag: 'createDbtModelSync',
    })
  }

  // ==========================================================================
  //  TRANSFORMATIONS
  // ==========================================================================
  /**
   * @operationName List Transformations
   * @category Transformations
   * @description Returns a page of Transformations in the workspace. Transformations rename, drop, or rewrite events from a Source before they reach destinations. Use this to browse or find a transformation ID.
   * @route POST /list-transformations
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many transformations to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"transformations":[{"id":"tf_1","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","name":"Rename event","sourceId":"src_1","if":"type = \"track\"","enabled":true}],"pagination":{"current":"MA==","totalEntries":1}}}
   */
  // API: https://docs.segmentapis.com/tag/Transformations/
  async listTransformations(count, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/transformations`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listTransformations',
    })
  }

  /**
   * @operationName Get Transformation
   * @category Transformations
   * @description Retrieves a single Transformation by its ID, including its FQL condition and transform rules. The Transformation field is a dropdown backed by a dictionary.
   * @route POST /get-transformation
   * @paramDef {"type":"String","label":"Transformation","name":"transformationId","dictionary":"getTransformationsDictionary","required":true,"description":"The Transformation to retrieve. Pick from the dropdown or paste a transformation ID."}
   * @returns {Object}
   * @sampleResult {"data":{"transformation":{"id":"tf_1","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","name":"Rename event","sourceId":"src_1","if":"type = \"track\"","enabled":true,"newEventName":"Purchase"}}}
   */
  // API: https://docs.segmentapis.com/tag/Transformations/
  async getTransformation(transformationId) {
    this.#requireParam(transformationId, 'Transformation is required — pick one from the Transformation dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/transformations/${ transformationId }`,
      logTag: 'getTransformation',
    })
  }

  /**
   * @operationName Create Transformation
   * @category Transformations
   * @description Creates a Transformation that rewrites a Source's events (rename event, rename properties, drop, hash, etc.) based on an FQL condition before they reach destinations. The condition and transform rules are user-authored.
   * @route POST /create-transformation
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A name for the transformation."}
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source whose events to transform. Pick from the dropdown."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","required":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the transformation is enabled."}
   * @paramDef {"type":"String","label":"Condition (FQL)","name":"if","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"FQL matching the events to transform, e.g. type = \"track\". User-authored."}
   * @paramDef {"type":"String","label":"Destination Type","name":"destinationMetadataId","dictionary":"getDestinationCatalogDictionary","description":"Optionally scope the transformation to one destination type. Pick from the dropdown."}
   * @paramDef {"type":"Boolean","label":"Drop","name":"drop","uiComponent":{"type":"TOGGLE"},"description":"Drop matching events entirely."}
   * @paramDef {"type":"String","label":"New Event Name","name":"newEventName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Rename matching events to this name."}
   * @paramDef {"type":"Array<PropertyRename>","label":"Property Renames","name":"propertyRenames","description":"Property/trait renames to apply."}
   * @paramDef {"type":"Array<Object>","label":"Property Value Transformations","name":"propertyValueTransformations","description":"Per-property value transform specs (max 10). User-authored JSON objects."}
   * @paramDef {"type":"Array<Object>","label":"FQL Defined Properties","name":"fqlDefinedProperties","description":"Properties defined by FQL (max 1). User-authored JSON objects."}
   * @paramDef {"type":"Array<String>","label":"Allow Properties","name":"allowProperties","description":"Property names to allowlist."}
   * @paramDef {"type":"Object","label":"Hash Properties Configuration","name":"hashPropertiesConfiguration","freeform":true,"description":"Hashing configuration as JSON. User-authored map."}
   * @returns {Object}
   * @sampleResult {"data":{"transformation":{"id":"tf_1","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","name":"Rename event","sourceId":"src_1","if":"type = \"track\"","enabled":true,"newEventName":"Purchase","propertyRenames":[]}}}
   */
  // API: https://docs.segmentapis.com/tag/Transformations/
  async createTransformation(name, sourceId, enabled, ifCondition, destinationMetadataId, drop, newEventName, propertyRenames, propertyValueTransformations, fqlDefinedProperties, allowProperties, hashPropertiesConfiguration) {
    this.#requireParam(name, 'Name is required — enter a name for the transformation.')
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')
    this.#requireParam(enabled, 'Enabled is required — choose whether the transformation is enabled.')
    this.#requireParam(ifCondition, 'Condition (FQL) is required — enter an FQL condition, e.g. type = "track".')

    const body = { name, sourceId, enabled, if: ifCondition }

    if (destinationMetadataId !== undefined && destinationMetadataId !== null) body.destinationMetadataId = destinationMetadataId
    if (drop !== undefined && drop !== null) body.drop = drop
    if (newEventName !== undefined && newEventName !== null) body.newEventName = newEventName
    if (propertyRenames !== undefined && propertyRenames !== null) body.propertyRenames = propertyRenames
    if (propertyValueTransformations !== undefined && propertyValueTransformations !== null) body.propertyValueTransformations = propertyValueTransformations
    if (fqlDefinedProperties !== undefined && fqlDefinedProperties !== null) body.fqlDefinedProperties = fqlDefinedProperties
    if (allowProperties !== undefined && allowProperties !== null) body.allowProperties = allowProperties
    if (hashPropertiesConfiguration !== undefined && hashPropertiesConfiguration !== null) body.hashPropertiesConfiguration = hashPropertiesConfiguration

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/transformations`,
      method: 'post',
      body,
      logTag: 'createTransformation',
    })
  }

  /**
   * @operationName Update Transformation
   * @category Transformations
   * @description Updates an existing Transformation's name, source, condition, or transform rules. Use this to refine a transformation without recreating it.
   * @route POST /update-transformation
   * @paramDef {"type":"String","label":"Transformation","name":"transformationId","dictionary":"getTransformationsDictionary","required":true,"description":"The Transformation to update. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A new name."}
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","description":"A new Source to transform. Pick from the dropdown."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable the transformation."}
   * @paramDef {"type":"String","label":"Condition (FQL)","name":"if","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A new FQL condition. User-authored."}
   * @paramDef {"type":"String","label":"Destination Type","name":"destinationMetadataId","dictionary":"getDestinationCatalogDictionary","description":"A new destination-type scope. Pick from the dropdown."}
   * @paramDef {"type":"Boolean","label":"Drop","name":"drop","uiComponent":{"type":"TOGGLE"},"description":"Drop matching events entirely."}
   * @paramDef {"type":"String","label":"New Event Name","name":"newEventName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Rename matching events to this name."}
   * @paramDef {"type":"Array<PropertyRename>","label":"Property Renames","name":"propertyRenames","description":"Property/trait renames to apply."}
   * @paramDef {"type":"Array<Object>","label":"Property Value Transformations","name":"propertyValueTransformations","description":"Per-property value transform specs. User-authored JSON objects."}
   * @paramDef {"type":"Array<Object>","label":"FQL Defined Properties","name":"fqlDefinedProperties","description":"Properties defined by FQL. User-authored JSON objects."}
   * @paramDef {"type":"Array<String>","label":"Allow Properties","name":"allowProperties","description":"Property names to allowlist."}
   * @paramDef {"type":"Object","label":"Hash Properties Configuration","name":"hashPropertiesConfiguration","freeform":true,"description":"Hashing configuration as JSON. User-authored map."}
   * @returns {Object}
   * @sampleResult {"data":{"transformation":{"id":"tf_1","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","name":"Rename event v2","sourceId":"src_1","if":"type = \"track\"","enabled":false}}}
   */
  // API: https://docs.segmentapis.com/tag/Transformations/ (all create fields are optional here)
  async updateTransformation(transformationId, name, sourceId, enabled, ifCondition, destinationMetadataId, drop, newEventName, propertyRenames, propertyValueTransformations, fqlDefinedProperties, allowProperties, hashPropertiesConfiguration) {
    this.#requireParam(transformationId, 'Transformation is required — pick one from the Transformation dropdown.')

    const body = {}

    if (name !== undefined && name !== null) body.name = name
    if (sourceId !== undefined && sourceId !== null) body.sourceId = sourceId
    if (enabled !== undefined && enabled !== null) body.enabled = enabled
    if (ifCondition !== undefined && ifCondition !== null) body.if = ifCondition
    if (destinationMetadataId !== undefined && destinationMetadataId !== null) body.destinationMetadataId = destinationMetadataId
    if (drop !== undefined && drop !== null) body.drop = drop
    if (newEventName !== undefined && newEventName !== null) body.newEventName = newEventName
    if (propertyRenames !== undefined && propertyRenames !== null) body.propertyRenames = propertyRenames
    if (propertyValueTransformations !== undefined && propertyValueTransformations !== null) body.propertyValueTransformations = propertyValueTransformations
    if (fqlDefinedProperties !== undefined && fqlDefinedProperties !== null) body.fqlDefinedProperties = fqlDefinedProperties
    if (allowProperties !== undefined && allowProperties !== null) body.allowProperties = allowProperties
    if (hashPropertiesConfiguration !== undefined && hashPropertiesConfiguration !== null) body.hashPropertiesConfiguration = hashPropertiesConfiguration

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/transformations/${ transformationId }`,
      method: 'patch',
      body,
      logTag: 'updateTransformation',
    })
  }

  /**
   * @operationName Delete Transformation
   * @category Transformations
   * @description Permanently deletes a Transformation. This cannot be undone, so use Get Transformation first to confirm the right one.
   * @route POST /delete-transformation
   * @paramDef {"type":"String","label":"Transformation","name":"transformationId","dictionary":"getTransformationsDictionary","required":true,"description":"The Transformation to permanently delete. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Transformations/
  async deleteTransformation(transformationId) {
    this.#requireParam(transformationId, 'Transformation is required — pick one from the Transformation dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/transformations/${ transformationId }`,
      method: 'delete',
      logTag: 'deleteTransformation',
    })
  }

  // ==========================================================================
  //  DELETION & SUPPRESSION (Regulations) - DESTRUCTIVE creates
  // ==========================================================================
  /**
   * @operationName Create Workspace Regulation
   * @category Deletion and Suppression
   * @description Creates a data deletion/suppression regulation across the whole workspace for the given subjects. DESTRUCTIVE - permanently deletes or suppresses user data. Use with care.
   * @route POST /create-workspace-regulation
   * @paramDef {"type":"String","label":"Regulation Type","name":"regulationType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Delete Only","Delete Internal","Suppress Only","Suppress With Delete","Suppress With Delete Internal","Unsuppress"]}},"description":"The deletion/suppression action to apply."}
   * @paramDef {"type":"String","label":"Subject Type","name":"subjectType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["User ID","Object ID"]}},"description":"Whether the subject IDs are user IDs or object IDs."}
   * @paramDef {"type":"Array<String>","label":"Subject IDs","name":"subjectIds","required":true,"description":"The user/object IDs to delete or suppress."}
   * @returns {Object}
   * @sampleResult {"data":{"regulateId":"1qJkfE1tpwvQcklImGksLN629wn"}}
   */
  // API: https://docs.segmentapis.com/tag/Deletion-and-Suppression/
  async createWorkspaceRegulation(regulationType, subjectType, subjectIds) {
    this.#requireParam(regulationType, 'Regulation Type is required — pick one from the dropdown.')
    this.#requireParam(subjectType, 'Subject Type is required — pick one from the dropdown.')
    this.#requireParam(subjectIds, 'Subject IDs is required — provide at least one subject ID.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/regulations`,
      method: 'post',
      body: {
        regulationType: this.#resolveChoice(regulationType, REGULATION_TYPE_MAP),
        subjectType: this.#resolveChoice(subjectType, SUBJECT_TYPE_USER_OBJECT_MAP),
        subjectIds,
      },
      logTag: 'createWorkspaceRegulation',
    })
  }

  /**
   * @operationName Create Source Regulation
   * @category Deletion and Suppression
   * @description Creates a data deletion/suppression regulation scoped to one Source. DESTRUCTIVE - permanently deletes or suppresses user data from that Source.
   * @route POST /create-source-regulation
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source to scope the regulation to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Regulation Type","name":"regulationType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Delete Only","Delete Archive Only","Delete Internal","Suppress Only","Suppress With Delete","Suppress With Delete Internal","Unsuppress"]}},"description":"The deletion/suppression action to apply."}
   * @paramDef {"type":"String","label":"Subject Type","name":"subjectType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["User ID","Anonymous ID"]}},"description":"Whether the subject IDs are user IDs or anonymous IDs."}
   * @paramDef {"type":"Array<String>","label":"Subject IDs","name":"subjectIds","required":true,"description":"The user/anonymous IDs to delete or suppress."}
   * @returns {Object}
   * @sampleResult {"data":{"regulateId":"1qJkfE1tpwvQcklImGksLN629wn"}}
   */
  // API: https://docs.segmentapis.com/tag/Deletion-and-Suppression/
  async createSourceRegulation(sourceId, regulationType, subjectType, subjectIds) {
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')
    this.#requireParam(regulationType, 'Regulation Type is required — pick one from the dropdown.')
    this.#requireParam(subjectType, 'Subject Type is required — pick one from the dropdown.')
    this.#requireParam(subjectIds, 'Subject IDs is required — provide at least one subject ID.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/regulations/sources/${ sourceId }`,
      method: 'post',
      body: {
        regulationType: this.#resolveChoice(regulationType, REGULATION_TYPE_WITH_ARCHIVE_MAP),
        subjectType: this.#resolveChoice(subjectType, SUBJECT_TYPE_USER_ANONYMOUS_MAP),
        subjectIds,
      },
      logTag: 'createSourceRegulation',
    })
  }

  /**
   * @operationName Create Cloud Source Regulation
   * @category Deletion and Suppression
   * @description Creates a data deletion/suppression regulation for a cloud Source collection. DESTRUCTIVE - permanently deletes or suppresses object data from that collection.
   * @route POST /create-cloud-source-regulation
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The cloud Source to scope the regulation to. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Regulation Type","name":"regulationType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Delete Only","Delete Internal","Suppress Only","Suppress With Delete","Suppress With Delete Internal","Unsuppress"]}},"description":"The deletion/suppression action to apply."}
   * @paramDef {"type":"String","label":"Subject Type","name":"subjectType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Object ID"]}},"description":"The subject ID type (object IDs for cloud sources)."}
   * @paramDef {"type":"Array<String>","label":"Subject IDs","name":"subjectIds","required":true,"description":"The object IDs to delete or suppress."}
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The cloud-source collection name."}
   * @returns {Object}
   * @sampleResult {"data":{"regulateId":"1qJkfE1tpwvQcklImGksLN629wn"}}
   */
  // API: https://docs.segmentapis.com/tag/Deletion-and-Suppression/
  async createCloudSourceRegulation(sourceId, regulationType, subjectType, subjectIds, collection) {
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')
    this.#requireParam(regulationType, 'Regulation Type is required — pick one from the dropdown.')
    this.#requireParam(subjectType, 'Subject Type is required — pick one from the dropdown.')
    this.#requireParam(subjectIds, 'Subject IDs is required — provide at least one subject ID.')
    this.#requireParam(collection, 'Collection is required — enter the cloud-source collection name.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/regulations/cloudsources/${ sourceId }`,
      method: 'post',
      body: {
        regulationType: this.#resolveChoice(regulationType, REGULATION_TYPE_MAP),
        subjectType: this.#resolveChoice(subjectType, SUBJECT_TYPE_OBJECT_ONLY_MAP),
        subjectIds,
        collection,
      },
      logTag: 'createCloudSourceRegulation',
    })
  }

  /**
   * @operationName List Workspace Regulations
   * @category Deletion and Suppression
   * @description Returns a page of deletion/suppression regulations in the workspace, optionally filtered by status or type. Use this to track regulation progress or find a regulate ID.
   * @route POST /list-workspace-regulations
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Finished","Running","Initialized","Failed","Invalid","Not Supported","Partial Success"]}},"description":"Filter to regulations in this status."}
   * @paramDef {"type":"Array<String>","label":"Regulation Types","name":"regulationTypes","description":"Filter to specific regulation types."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many regulations to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"regulations":[{"createdAt":"2022-03-08T00:39:36.546951Z","id":"1qJkfE1tpwvQcklImGksLN629wn","subjects":["test_user_id_1"],"subjectType":"OBJECT_ID","status":"FINISHED","regulationType":"SUPPRESS_ONLY"}],"pagination":{"current":"MQ=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Deletion-and-Suppression/
  async listWorkspaceRegulations(status, regulationTypes, count, cursor) {
    const query = this.#paginationQuery(count, cursor)

    if (status) query.status = this.#resolveChoice(status, REGULATION_STATUS_MAP)
    if (regulationTypes !== undefined && regulationTypes !== null) query.regulationTypes = regulationTypes

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/regulations`,
      query,
      logTag: 'listWorkspaceRegulations',
    })
  }

  /**
   * @operationName List Source Regulations
   * @category Deletion and Suppression
   * @description Returns a page of deletion/suppression regulations scoped to one Source, optionally filtered by status or type.
   * @route POST /list-source-regulations
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source whose regulations to list. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Finished","Running","Initialized","Failed","Invalid","Not Supported","Partial Success"]}},"description":"Filter to regulations in this status."}
   * @paramDef {"type":"Array<String>","label":"Regulation Types","name":"regulationTypes","description":"Filter to specific regulation types."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many regulations to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"regulations":[{"id":"1qJkfE1tpwvQcklImGksLN629wn","subjectType":"OBJECT_ID","subjects":["test_user_id_1"],"regulationType":"SUPPRESS_ONLY","status":"FINISHED","createdAt":"2022-03-08T00:39:36.546951Z"}],"pagination":{"current":"MQ=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Deletion-and-Suppression/
  async listSourceRegulations(sourceId, status, regulationTypes, count, cursor) {
    this.#requireParam(sourceId, 'Source is required — pick one from the Source dropdown.')

    const query = this.#paginationQuery(count, cursor)

    if (status) query.status = this.#resolveChoice(status, REGULATION_STATUS_MAP)
    if (regulationTypes !== undefined && regulationTypes !== null) query.regulationTypes = regulationTypes

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/regulations/sources/${ sourceId }`,
      query,
      logTag: 'listSourceRegulations',
    })
  }

  /**
   * @operationName Get Regulation
   * @category Deletion and Suppression
   * @description Retrieves the status of a single regulation by its regulate ID, including overall status and per-stream status. Use the regulate ID returned by a Create Regulation action.
   * @route POST /get-regulation
   * @paramDef {"type":"String","label":"Regulation","name":"regulateId","dictionary":"getRegulationsDictionary","required":true,"description":"The regulation to retrieve. Pick from the dropdown or paste the regulate ID returned by a Create Regulation action."}
   * @returns {Object}
   * @sampleResult {"data":{"regulation":{"id":"1qJkfE1tpwvQcklImGksLN629wn","workspaceId":"9aQ1Lj62S4bomZKLF4DPqW","overallStatus":"FINISHED","finishedAt":"2022-03-08T00:39:36.546951Z","createdAt":"2022-03-08T00:39:36.546951Z","streamStatus":[]}}}
   */
  // API: https://docs.segmentapis.com/tag/Deletion-and-Suppression/
  async getRegulation(regulateId) {
    this.#requireParam(regulateId, 'Regulate ID is required — use the ID returned by a Create Regulation action.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/regulations/${ regulateId }`,
      logTag: 'getRegulation',
    })
  }

  /**
   * @operationName List Suppressions
   * @category Deletion and Suppression
   * @description Returns a page of the workspace's current suppressions (subjects whose data is suppressed).
   * @route POST /list-suppressions
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many suppressions to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"suppressed":[{"subjectType":"userId","subjectIds":["1"]}],"pagination":{"current":"MQ==","next":"cmVnLTY1MDgtMDA5ODE="}}}
   */
  // API: https://docs.segmentapis.com/tag/Deletion-and-Suppression/
  async listSuppressions(count, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/suppressions`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listSuppressions',
    })
  }

  // ==========================================================================
  //  DELIVERY OVERVIEW (analytics queries - read-only)
  // ==========================================================================
  /**
   * @operationName Get Egress Success Metrics
   * @category Delivery Overview
   * @description Returns successful-delivery (egress) metrics for a Source->Destination pair over a time window. MINUTE granularity allows max 4h within the last 48h; HOUR max 14d within the last 30d; DAY max 30d within the last 30d.
   * @route POST /get-egress-success-metrics
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Destination","name":"destinationConfigId","dictionary":"getDestinationsDictionary","required":true,"description":"The Destination. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Start Time (ISO8601)","name":"startTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The window start in ISO8601."}
   * @paramDef {"type":"String","label":"End Time (ISO8601)","name":"endTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The window end in ISO8601."}
   * @paramDef {"type":"String","label":"Granularity","name":"granularity","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Hour","Minute"]}},"description":"Time bucket size. MINUTE max 4h/last 48h; HOUR max 14d/last 30d; DAY max 30d/last 30d."}
   * @paramDef {"type":"Array<String>","label":"Group By","name":"groupBy","description":"Dimensions to group by (eventName, eventType, discardReason, appVersion, etc)."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","freeform":true,"description":"Optional filter map as JSON. User-authored."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many rows to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"total":1234,"dataset":[{"eventName":"Order Completed","total":1234,"series":[]}],"pagination":{"current":"MA=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Delivery-Overview/
  async getEgressSuccessMetrics(sourceId, destinationConfigId, startTime, endTime, granularity, groupBy, filter, count, cursor) {
    return await this.#deliveryOverviewMetric('successful-delivery', 'getEgressSuccessMetrics', { sourceId, destinationConfigId, startTime, endTime, granularity, groupBy, filter, count, cursor, requireDestination: true })
  }

  /**
   * @operationName Get Egress Failed Metrics
   * @category Delivery Overview
   * @description Returns failed-delivery (egress) metrics for a Source->Destination pair over a time window. MINUTE max 4h/last 48h; HOUR max 14d/last 30d; DAY max 30d/last 30d.
   * @route POST /get-egress-failed-metrics
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Destination","name":"destinationConfigId","dictionary":"getDestinationsDictionary","required":true,"description":"The Destination. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Start Time (ISO8601)","name":"startTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The window start in ISO8601."}
   * @paramDef {"type":"String","label":"End Time (ISO8601)","name":"endTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The window end in ISO8601."}
   * @paramDef {"type":"String","label":"Granularity","name":"granularity","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Hour","Minute"]}},"description":"Time bucket size. MINUTE max 4h/last 48h; HOUR max 14d/last 30d; DAY max 30d/last 30d."}
   * @paramDef {"type":"Array<String>","label":"Group By","name":"groupBy","description":"Dimensions to group by (eventName, eventType, discardReason, etc)."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","freeform":true,"description":"Optional filter map as JSON. User-authored."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many rows to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"total":1234,"dataset":[{"eventName":"Order Completed","total":1234,"series":[]}],"pagination":{"current":"MA=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Delivery-Overview/
  async getEgressFailedMetrics(sourceId, destinationConfigId, startTime, endTime, granularity, groupBy, filter, count, cursor) {
    return await this.#deliveryOverviewMetric('failed-delivery', 'getEgressFailedMetrics', { sourceId, destinationConfigId, startTime, endTime, granularity, groupBy, filter, count, cursor, requireDestination: true })
  }

  /**
   * @operationName Get Filtered At Destination Metrics
   * @category Delivery Overview
   * @description Returns metrics for events filtered at the Destination for a Source->Destination pair over a time window. MINUTE max 4h/last 48h; HOUR max 14d/last 30d; DAY max 30d/last 30d.
   * @route POST /get-filtered-at-destination-metrics
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Destination","name":"destinationConfigId","dictionary":"getDestinationsDictionary","required":true,"description":"The Destination. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Start Time (ISO8601)","name":"startTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The window start in ISO8601."}
   * @paramDef {"type":"String","label":"End Time (ISO8601)","name":"endTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The window end in ISO8601."}
   * @paramDef {"type":"String","label":"Granularity","name":"granularity","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Hour","Minute"]}},"description":"Time bucket size. MINUTE max 4h/last 48h; HOUR max 14d/last 30d; DAY max 30d/last 30d."}
   * @paramDef {"type":"Array<String>","label":"Group By","name":"groupBy","description":"Dimensions to group by (eventName, discardReason, etc)."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","freeform":true,"description":"Optional filter map as JSON. User-authored."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many rows to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"total":1234,"dataset":[{"eventName":"Order Completed","total":1234,"series":[]}],"pagination":{"current":"MA=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Delivery-Overview/
  async getFilteredAtDestination(sourceId, destinationConfigId, startTime, endTime, granularity, groupBy, filter, count, cursor) {
    return await this.#deliveryOverviewMetric('filtered-at-destination', 'getFilteredAtDestination', { sourceId, destinationConfigId, startTime, endTime, granularity, groupBy, filter, count, cursor, requireDestination: true })
  }

  /**
   * @operationName Get Filtered At Source Metrics
   * @category Delivery Overview
   * @description Returns metrics for events filtered at the Source over a time window. MINUTE max 4h/last 48h; HOUR max 14d/last 30d; DAY max 30d/last 30d.
   * @route POST /get-filtered-at-source-metrics
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Start Time (ISO8601)","name":"startTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The window start in ISO8601."}
   * @paramDef {"type":"String","label":"End Time (ISO8601)","name":"endTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The window end in ISO8601."}
   * @paramDef {"type":"String","label":"Granularity","name":"granularity","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Hour","Minute"]}},"description":"Time bucket size. MINUTE max 4h/last 48h; HOUR max 14d/last 30d; DAY max 30d/last 30d."}
   * @paramDef {"type":"Array<String>","label":"Group By","name":"groupBy","description":"Dimensions to group by (eventName, discardReason, etc)."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","freeform":true,"description":"Optional filter map as JSON. User-authored."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many rows to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"total":1234,"dataset":[{"eventName":"Order Completed","total":1234,"series":[]}],"pagination":{"current":"MA=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Delivery-Overview/ (no destinationConfigId param on this query)
  async getFilteredAtSource(sourceId, startTime, endTime, granularity, groupBy, filter, count, cursor) {
    return await this.#deliveryOverviewMetric('filtered-at-source', 'getFilteredAtSource', { sourceId, startTime, endTime, granularity, groupBy, filter, count, cursor, requireDestination: false })
  }

  /**
   * @operationName Get Ingress Failed Metrics
   * @category Delivery Overview
   * @description Returns failed-on-ingest (ingress) metrics for a Source over a time window. MINUTE max 4h/last 48h; HOUR max 14d/last 30d; DAY max 30d/last 30d.
   * @route POST /get-ingress-failed-metrics
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Start Time (ISO8601)","name":"startTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The window start in ISO8601."}
   * @paramDef {"type":"String","label":"End Time (ISO8601)","name":"endTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The window end in ISO8601."}
   * @paramDef {"type":"String","label":"Granularity","name":"granularity","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Hour","Minute"]}},"description":"Time bucket size. MINUTE max 4h/last 48h; HOUR max 14d/last 30d; DAY max 30d/last 30d."}
   * @paramDef {"type":"Array<String>","label":"Group By","name":"groupBy","description":"Dimensions to group by (eventType, discardReason, etc)."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","freeform":true,"description":"Optional filter map as JSON. User-authored."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many rows to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"total":1234,"dataset":[{"eventName":"Order Completed","total":1234,"series":[]}],"pagination":{"current":"MA=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Delivery-Overview/ (no destinationConfigId param on this query)
  async getIngressFailedMetrics(sourceId, startTime, endTime, granularity, groupBy, filter, count, cursor) {
    return await this.#deliveryOverviewMetric('failed-on-ingest', 'getIngressFailedMetrics', { sourceId, startTime, endTime, granularity, groupBy, filter, count, cursor, requireDestination: false })
  }

  /**
   * @operationName Get Ingress Success Metrics
   * @category Delivery Overview
   * @description Returns successfully-received (ingress) metrics for a Source over a time window. MINUTE max 4h/last 48h; HOUR max 14d/last 30d; DAY max 30d/last 30d.
   * @route POST /get-ingress-success-metrics
   * @paramDef {"type":"String","label":"Source","name":"sourceId","dictionary":"getSourcesDictionary","required":true,"description":"The Source. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Start Time (ISO8601)","name":"startTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The window start in ISO8601."}
   * @paramDef {"type":"String","label":"End Time (ISO8601)","name":"endTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The window end in ISO8601."}
   * @paramDef {"type":"String","label":"Granularity","name":"granularity","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Hour","Minute"]}},"description":"Time bucket size. MINUTE max 4h/last 48h; HOUR max 14d/last 30d; DAY max 30d/last 30d."}
   * @paramDef {"type":"Array<String>","label":"Group By","name":"groupBy","description":"Dimensions to group by (eventName, eventType, etc)."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","freeform":true,"description":"Optional filter map as JSON. User-authored."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many rows to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"total":1234,"dataset":[{"eventName":"Order Completed","total":1234,"series":[]}],"pagination":{"current":"MA=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Delivery-Overview/ (no destinationConfigId param on this query)
  async getIngressSuccessMetrics(sourceId, startTime, endTime, granularity, groupBy, filter, count, cursor) {
    return await this.#deliveryOverviewMetric('successfully-received', 'getIngressSuccessMetrics', { sourceId, startTime, endTime, granularity, groupBy, filter, count, cursor, requireDestination: false })
  }

  // Shared helper for the six Delivery Overview metric reads - they share param shape; the three
  // source-side metrics omit destinationConfigId.
  async #deliveryOverviewMetric(path, logTag, p) {
    this.#requireParam(p.sourceId, 'Source is required — pick one from the Source dropdown.')

    if (p.requireDestination) {
      this.#requireParam(p.destinationConfigId, 'Destination is required — pick one from the Destination dropdown.')
    }

    this.#requireParam(p.startTime, 'Start Time is required — pick a start time.')
    this.#requireParam(p.endTime, 'End Time is required — pick an end time.')
    this.#requireParam(p.granularity, 'Granularity is required — pick Day, Hour, or Minute.')

    const query = this.#paginationQuery(p.count, p.cursor)

    query.sourceId = p.sourceId

    if (p.requireDestination) query.destinationConfigId = p.destinationConfigId

    query.startTime = p.startTime
    query.endTime = p.endTime
    query.granularity = this.#resolveChoice(p.granularity, GRANULARITY_MAP)

    if (p.groupBy !== undefined && p.groupBy !== null) query.groupBy = p.groupBy
    if (p.filter !== undefined && p.filter !== null) query.filter = p.filter

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/delivery-overview/${ path }`,
      query,
      logTag,
    })
  }

  // ==========================================================================
  //  IAM - USERS
  // ==========================================================================
  /**
   * @operationName List Users
   * @category IAM Users
   * @description Returns a page of workspace Users. Use this to browse members or find a user ID. Rate limit 60/min.
   * @route POST /list-users
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many users to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"users":[{"id":"usr_1","name":"Ada Lovelace","email":"ada@example.com"}],"pagination":{"current":"MA==","totalEntries":2}}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Users/
  async listUsers(count, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/users`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listUsers',
    })
  }

  /**
   * @operationName Get User
   * @category IAM Users
   * @description Retrieves a single workspace User by ID, including their assigned roles and resource permissions. The User field is a dropdown backed by a dictionary. Rate limit 60/min.
   * @route POST /get-user
   * @paramDef {"type":"String","label":"User","name":"userId","dictionary":"getUsersDictionary","required":true,"description":"The User to retrieve. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"user":{"id":"usr_1","name":"Ada Lovelace","email":"ada@example.com","permissions":[{"roleId":"rol_1","roleName":"Workspace Owner","resources":[{"id":"9aQ1Lj62S4bomZKLF4DPqW","type":"WORKSPACE","labels":[]}]}]}}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Users/
  async getUser(userId) {
    this.#requireParam(userId, 'User is required — pick one from the User dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ userId }`,
      logTag: 'getUser',
    })
  }

  /**
   * @operationName Delete Users
   * @category IAM Users
   * @description Removes one or more Users from the workspace. DESTRUCTIVE - the users lose access. Rate limit 60/min.
   * @route POST /delete-users
   * @paramDef {"type":"Array<String>","label":"User IDs","name":"userIds","required":true,"description":"User IDs to remove from the workspace."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Users/ (userIds are sent as a query param)
  async deleteUsers(userIds) {
    this.#requireParam(userIds, 'User IDs is required — provide at least one user ID to remove.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/users`,
      method: 'delete',
      query: { userIds },
      logTag: 'deleteUsers',
    })
  }

  /**
   * @operationName List User Groups from User
   * @category IAM Users
   * @description Returns the User Groups a given User belongs to. Rate limit 60/min.
   * @route POST /list-user-groups-from-user
   * @paramDef {"type":"String","label":"User","name":"userId","dictionary":"getUsersDictionary","required":true,"description":"The User whose groups to list. Pick from the dropdown."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many groups to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"groups":[{"id":"grp_1","name":"Engineers"}],"pagination":{"current":"MA==","totalEntries":1}}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Users/
  async listUserGroupsFromUser(userId, count, cursor) {
    this.#requireParam(userId, 'User is required — pick one from the User dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ userId }/groups`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listUserGroupsFromUser',
    })
  }

  /**
   * @operationName Add User Permissions
   * @category IAM Users
   * @description Adds role + resource permissions to a User. Use Get Roles Dictionary to pick role IDs. Rate limit 60/min.
   * @route POST /add-user-permissions
   * @paramDef {"type":"String","label":"User","name":"userId","dictionary":"getUsersDictionary","required":true,"description":"The User to grant permissions to. Pick from the dropdown."}
   * @paramDef {"type":"Array<Permission>","label":"Permissions","name":"permissions","required":true,"description":"Role + resource assignments to ADD to the user."}
   * @returns {Object}
   * @sampleResult {"data":{"permissions":[{"policyId":"pol_1","roleName":"Workspace Owner","roleId":"rol_1","subjectId":"usr_1","subjectType":"user","resources":[{"id":"9aQ1Lj62S4bomZKLF4DPqW","type":"WORKSPACE","labels":[]}]}]}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Users/
  async addUserPermissions(userId, permissions) {
    this.#requireParam(userId, 'User is required — pick one from the User dropdown.')
    this.#requireParam(permissions, 'Permissions is required — provide at least one role + resource assignment.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ userId }/permissions`,
      method: 'post',
      body: { permissions },
      logTag: 'addUserPermissions',
    })
  }

  /**
   * @operationName Replace User Permissions
   * @category IAM Users
   * @description Replaces ALL of a User's permissions with the provided set. Use Get Roles Dictionary to pick role IDs. Rate limit 60/min.
   * @route POST /replace-user-permissions
   * @paramDef {"type":"String","label":"User","name":"userId","dictionary":"getUsersDictionary","required":true,"description":"The User whose permissions to replace. Pick from the dropdown."}
   * @paramDef {"type":"Array<Permission>","label":"Permissions","name":"permissions","required":true,"description":"The complete set of role + resource assignments (replaces all existing)."}
   * @returns {Object}
   * @sampleResult {"data":{"permissions":[{"policyId":"pol_1","roleName":"Workspace Owner","roleId":"rol_1","subjectId":"usr_1","subjectType":"user","resources":[{"id":"9aQ1Lj62S4bomZKLF4DPqW","type":"WORKSPACE","labels":[]}]}]}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Users/
  async replaceUserPermissions(userId, permissions) {
    this.#requireParam(userId, 'User is required — pick one from the User dropdown.')
    this.#requireParam(permissions, 'Permissions is required — provide the complete set of assignments.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ userId }/permissions`,
      method: 'put',
      body: { permissions },
      logTag: 'replaceUserPermissions',
    })
  }

  // ==========================================================================
  //  IAM - INVITES
  // ==========================================================================
  /**
   * @operationName Create Invites
   * @category IAM Invites
   * @description Invites one or more people to the workspace with their permissions. Use Get Roles Dictionary to pick role IDs.
   * @route POST /create-invites
   * @paramDef {"type":"Array<Invite>","label":"Invites","name":"invites","required":true,"description":"People to invite to the workspace with their permissions."}
   * @returns {Object}
   * @sampleResult {"data":{"emails":["foo@example.com"]}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Users/
  async createInvites(invites) {
    this.#requireParam(invites, 'Invites is required — provide at least one invite (email + permissions).')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/invites`,
      method: 'post',
      body: { invites },
      logTag: 'createInvites',
    })
  }

  /**
   * @operationName List Invites
   * @category IAM Invites
   * @description Returns a page of pending workspace invites (email addresses).
   * @route POST /list-invites
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many invites to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"pagination":{"current":"MA==","totalEntries":1},"invites":["foo@example.com"]}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Users/
  async listInvites(count, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/invites`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listInvites',
    })
  }

  /**
   * @operationName Delete Invites
   * @category IAM Invites
   * @description Revokes pending workspace invites by email. DESTRUCTIVE - the invited people can no longer accept.
   * @route POST /delete-invites
   * @paramDef {"type":"Array<String>","label":"Emails","name":"emails","required":true,"description":"Email addresses whose invites to revoke."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Users/
  async deleteInvites(emails) {
    this.#requireParam(emails, 'Emails is required — provide at least one email to revoke.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/invites`,
      method: 'delete',
      query: { emails },
      logTag: 'deleteInvites',
    })
  }

  // ==========================================================================
  //  IAM - USER GROUPS
  // ==========================================================================
  /**
   * @operationName List User Groups
   * @category IAM Groups
   * @description Returns a page of workspace User Groups. Use this to browse groups or find a group ID.
   * @route POST /list-user-groups
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many groups to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"userGroups":[{"id":"grp_1","name":"Engineers","memberCount":4,"permissions":[]}],"pagination":{"current":"MA==","totalEntries":1}}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Groups/
  async listUserGroups(count, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/groups`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listUserGroups',
    })
  }

  /**
   * @operationName Get User Group
   * @category IAM Groups
   * @description Retrieves a single User Group by ID, including its member count and permissions. The Group field is a dropdown backed by a dictionary.
   * @route POST /get-user-group
   * @paramDef {"type":"String","label":"User Group","name":"userGroupId","dictionary":"getUserGroupsDictionary","required":true,"description":"The User Group to retrieve. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"userGroup":{"id":"grp_1","name":"Engineers","memberCount":4,"permissions":[]}}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Groups/
  async getUserGroup(userGroupId) {
    this.#requireParam(userGroupId, 'User Group is required — pick one from the User Group dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ userGroupId }`,
      logTag: 'getUserGroup',
    })
  }

  /**
   * @operationName Create User Group
   * @category IAM Groups
   * @description Creates a new User Group in the workspace. Add members and permissions afterward with the related actions.
   * @route POST /create-user-group
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user group's name."}
   * @returns {Object}
   * @sampleResult {"data":{"userGroup":{"id":"grp_1","name":"Engineers","memberCount":0}}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Groups/
  async createUserGroup(name) {
    this.#requireParam(name, 'Name is required — enter a name for the user group.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/groups`,
      method: 'post',
      body: { name },
      logTag: 'createUserGroup',
    })
  }

  /**
   * @operationName Update User Group
   * @category IAM Groups
   * @description Renames a User Group.
   * @route POST /update-user-group
   * @paramDef {"type":"String","label":"User Group","name":"userGroupId","dictionary":"getUserGroupsDictionary","required":true,"description":"The User Group to update. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A new name for the group."}
   * @returns {Object}
   * @sampleResult {"data":{"userGroup":{"id":"grp_1","name":"Platform Engineers","memberCount":4}}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Groups/
  async updateUserGroup(userGroupId, name) {
    this.#requireParam(userGroupId, 'User Group is required — pick one from the User Group dropdown.')
    this.#requireParam(name, 'Name is required — enter a new name for the group.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ userGroupId }`,
      method: 'patch',
      body: { name },
      logTag: 'updateUserGroup',
    })
  }

  /**
   * @operationName Delete User Group
   * @category IAM Groups
   * @description Permanently deletes a User Group. This cannot be undone.
   * @route POST /delete-user-group
   * @paramDef {"type":"String","label":"User Group","name":"userGroupId","dictionary":"getUserGroupsDictionary","required":true,"description":"The User Group to permanently delete. Pick from the dropdown."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Groups/
  async deleteUserGroup(userGroupId) {
    this.#requireParam(userGroupId, 'User Group is required — pick one from the User Group dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ userGroupId }`,
      method: 'delete',
      logTag: 'deleteUserGroup',
    })
  }

  /**
   * @operationName Add Users to User Group
   * @category IAM Groups
   * @description Adds users (by email) to a User Group.
   * @route POST /add-users-to-user-group
   * @paramDef {"type":"String","label":"User Group","name":"userGroupId","dictionary":"getUserGroupsDictionary","required":true,"description":"The User Group to add members to. Pick from the dropdown."}
   * @paramDef {"type":"Array<String>","label":"Emails","name":"emails","required":true,"description":"Emails of users to add."}
   * @returns {Object}
   * @sampleResult {"data":{"userGroup":{"id":"grp_1","name":"Engineers","memberCount":5}}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Groups/
  async addUsersToUserGroup(userGroupId, emails) {
    this.#requireParam(userGroupId, 'User Group is required — pick one from the User Group dropdown.')
    this.#requireParam(emails, 'Emails is required — provide at least one email to add.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ userGroupId }/users`,
      method: 'post',
      body: { emails },
      logTag: 'addUsersToUserGroup',
    })
  }

  /**
   * @operationName List Users from User Group
   * @category IAM Groups
   * @description Returns the users that belong to a User Group.
   * @route POST /list-users-from-user-group
   * @paramDef {"type":"String","label":"User Group","name":"userGroupId","dictionary":"getUserGroupsDictionary","required":true,"description":"The User Group whose members to list. Pick from the dropdown."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many users to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"users":[{"id":"usr_1","name":"Ada Lovelace","email":"ada@example.com"}],"pagination":{"current":"MA==","totalEntries":1}}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Groups/
  async listUsersFromUserGroup(userGroupId, count, cursor) {
    this.#requireParam(userGroupId, 'User Group is required — pick one from the User Group dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ userGroupId }/users`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listUsersFromUserGroup',
    })
  }

  /**
   * @operationName Replace Users in User Group
   * @category IAM Groups
   * @description Replaces ALL members of a User Group with the provided emails.
   * @route POST /replace-users-in-user-group
   * @paramDef {"type":"String","label":"User Group","name":"userGroupId","dictionary":"getUserGroupsDictionary","required":true,"description":"The User Group whose members to replace. Pick from the dropdown."}
   * @paramDef {"type":"Array<String>","label":"Emails","name":"emails","required":true,"description":"The complete set of member emails (replaces all existing)."}
   * @returns {Object}
   * @sampleResult {"data":{"userGroup":{"id":"grp_1","name":"Engineers","memberCount":3}}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Groups/ (the docs path is singular /group/{userGroupId}/users)
  async replaceUsersInUserGroup(userGroupId, emails) {
    this.#requireParam(userGroupId, 'User Group is required — pick one from the User Group dropdown.')
    this.#requireParam(emails, 'Emails is required — provide the complete set of member emails.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/group/${ userGroupId }/users`,
      method: 'put',
      body: { emails },
      logTag: 'replaceUsersInUserGroup',
    })
  }

  /**
   * @operationName Remove Users from User Group
   * @category IAM Groups
   * @description Removes users (by email) from a User Group. DESTRUCTIVE - those users lose the group's permissions.
   * @route POST /remove-users-from-user-group
   * @paramDef {"type":"String","label":"User Group","name":"userGroupId","dictionary":"getUserGroupsDictionary","required":true,"description":"The User Group to remove members from. Pick from the dropdown."}
   * @paramDef {"type":"Array<String>","label":"Emails","name":"emails","required":true,"description":"Emails of users to remove."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Groups/ (the docs path is singular /group/{userGroupId}/users; emails are sent as a query param)
  async removeUsersFromUserGroup(userGroupId, emails) {
    this.#requireParam(userGroupId, 'User Group is required — pick one from the User Group dropdown.')
    this.#requireParam(emails, 'Emails is required — provide at least one email to remove.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/group/${ userGroupId }/users`,
      method: 'delete',
      query: { emails },
      logTag: 'removeUsersFromUserGroup',
    })
  }

  /**
   * @operationName List Invites from User Group
   * @category IAM Groups
   * @description Returns the pending invites attached to a User Group.
   * @route POST /list-invites-from-user-group
   * @paramDef {"type":"String","label":"User Group","name":"userGroupId","dictionary":"getUserGroupsDictionary","required":true,"description":"The User Group whose invites to list. Pick from the dropdown."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many invites to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"emails":["foo@example.com"],"pagination":{"current":"MA==","totalEntries":1}}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Groups/
  async listInvitesFromUserGroup(userGroupId, count, cursor) {
    this.#requireParam(userGroupId, 'User Group is required — pick one from the User Group dropdown.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ userGroupId }/invites`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listInvitesFromUserGroup',
    })
  }

  /**
   * @operationName Add User Group Permissions
   * @category IAM Groups
   * @description Adds role + resource permissions to a User Group. Use Get Roles Dictionary to pick role IDs.
   * @route POST /add-user-group-permissions
   * @paramDef {"type":"String","label":"User Group","name":"userGroupId","dictionary":"getUserGroupsDictionary","required":true,"description":"The User Group to grant permissions to. Pick from the dropdown."}
   * @paramDef {"type":"Array<Permission>","label":"Permissions","name":"permissions","required":true,"description":"Role + resource assignments to ADD to the group."}
   * @returns {Object}
   * @sampleResult {"data":{"permissions":[{"policyId":"pol_1","roleName":"Source Admin","roleId":"rol_2","subjectId":"grp_1","subjectType":"group","resources":[{"id":"src_1","type":"SOURCE","labels":[]}]}]}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Groups/
  async addUserGroupPermissions(userGroupId, permissions) {
    this.#requireParam(userGroupId, 'User Group is required — pick one from the User Group dropdown.')
    this.#requireParam(permissions, 'Permissions is required — provide at least one role + resource assignment.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ userGroupId }/permissions`,
      method: 'post',
      body: { permissions },
      logTag: 'addUserGroupPermissions',
    })
  }

  /**
   * @operationName Replace User Group Permissions
   * @category IAM Groups
   * @description Replaces ALL of a User Group's permissions with the provided set. Use Get Roles Dictionary to pick role IDs.
   * @route POST /replace-user-group-permissions
   * @paramDef {"type":"String","label":"User Group","name":"userGroupId","dictionary":"getUserGroupsDictionary","required":true,"description":"The User Group whose permissions to replace. Pick from the dropdown."}
   * @paramDef {"type":"Array<Permission>","label":"Permissions","name":"permissions","required":true,"description":"The complete set of role + resource assignments (replaces all existing)."}
   * @returns {Object}
   * @sampleResult {"data":{"permissions":[{"policyId":"pol_1","roleName":"Source Admin","roleId":"rol_2","subjectId":"grp_1","subjectType":"group","resources":[{"id":"src_1","type":"SOURCE","labels":[]}]}]}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Groups/
  async replaceUserGroupPermissions(userGroupId, permissions) {
    this.#requireParam(userGroupId, 'User Group is required — pick one from the User Group dropdown.')
    this.#requireParam(permissions, 'Permissions is required — provide the complete set of assignments.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ userGroupId }/permissions`,
      method: 'put',
      body: { permissions },
      logTag: 'replaceUserGroupPermissions',
    })
  }

  // ==========================================================================
  //  IAM - ROLES (read-only)
  // ==========================================================================
  /**
   * @operationName List Roles
   * @category IAM Roles
   * @description Lists the Roles available to assign in permissions (used to pick a roleId).
   * @route POST /list-roles
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many roles to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"roles":[{"id":"rol_1","name":"Workspace Owner","description":"Full access to the workspace"}],"pagination":{"current":"MA==","next":"MQ=="}}}
   */
  // API: https://docs.segmentapis.com/tag/IAM-Roles/
  async listRoles(count, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/roles`,
      query: this.#paginationQuery(count, cursor),
      logTag: 'listRoles',
    })
  }

  // ==========================================================================
  //  LABELS
  // ==========================================================================
  /**
   * @operationName List Labels
   * @category Labels
   * @description Returns all labels defined in the workspace. Labels are key/value tags applied to resources for organization and access control.
   * @route POST /list-labels
   * @returns {Object}
   * @sampleResult {"data":{"labels":[{"key":"environment","value":"dev","description":""},{"key":"type","value":"web","description":"labels source as web"}]}}
   */
  // API: https://docs.segmentapis.com/tag/Labels/ (no pagination on this endpoint)
  async listLabels() {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/labels`,
      logTag: 'listLabels',
    })
  }

  /**
   * @operationName Create Label
   * @category Labels
   * @description Creates a label (key/value tag) in the workspace. Rate limit 60/min.
   * @route POST /create-label
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The label key (1-255 chars), e.g. \"environment\"."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The label value (1-255 chars), e.g. \"production\"."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"An optional description of the label."}
   * @returns {Object}
   * @sampleResult {"data":{"label":{"key":"environment","value":"production","description":"production environment"}}}
   */
  // API: https://docs.segmentapis.com/tag/Labels/
  async createLabel(key, value, description) {
    this.#requireParam(key, 'Key is required — enter the label key.')
    this.#requireParam(value, 'Value is required — enter the label value.')

    const label = { key, value }

    if (description !== undefined && description !== null) label.description = description

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/labels`,
      method: 'post',
      body: { label },
      logTag: 'createLabel',
    })
  }

  /**
   * @operationName Delete Label
   * @category Labels
   * @description Permanently deletes a label by its key and value. This cannot be undone. Rate limit 60/min.
   * @route POST /delete-label
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The label key to delete."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The label value to delete."}
   * @returns {Object}
   * @sampleResult {"data":{"status":"SUCCESS"}}
   */
  // API: https://docs.segmentapis.com/tag/Labels/
  async deleteLabel(key, value) {
    this.#requireParam(key, 'Key is required — enter the label key to delete.')
    this.#requireParam(value, 'Value is required — enter the label value to delete.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/labels/${ key }/${ value }`,
      method: 'delete',
      logTag: 'deleteLabel',
    })
  }

  // ==========================================================================
  //  AUDIT TRAIL (also backs the polling trigger)
  // ==========================================================================
  /**
   * @operationName List Audit Events
   * @category Audit Trail
   * @description Returns a page of workspace audit-trail events (resource created/updated/deleted, member changes, etc.), optionally filtered by time window or resource.
   * @route POST /list-audit-events
   * @paramDef {"type":"String","label":"Start Time (ISO8601)","name":"startTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only events after this time."}
   * @paramDef {"type":"String","label":"End Time (ISO8601)","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only events before this time."}
   * @paramDef {"type":"String","label":"Resource ID","name":"resource","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter to events affecting one resource (sent as resourceId)."}
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter by resource type, e.g. Sources, Warehouses."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many events to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"events":[{"id":"evt_1","timestamp":"2006-01-02T15:04:05.000Z","type":"source.created","actor":"ada@example.com","resourceId":"src_1","resourceType":"SOURCE","resourceName":"My Source"}],"pagination":{"current":"MA==","next":"MQ=="}}}
   */
  // API: https://docs.segmentapis.com/tag/Audit-Trail/
  async listAuditEvents(startTime, endTime, resource, resourceType, count, cursor) {
    const query = this.#paginationQuery(count, cursor)

    if (startTime) query.startTime = startTime
    if (endTime) query.endTime = endTime
    if (resource) query.resourceId = resource
    if (resourceType) query.resourceType = resourceType

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/audit-events`,
      query,
      logTag: 'listAuditEvents',
    })
  }

  // ==========================================================================
  //  USAGE & MONITORING (read-only)
  // ==========================================================================
  /**
   * @operationName Get Daily Workspace API Calls
   * @category Usage and Monitoring
   * @description Returns the daily API-call usage for the whole workspace in a given month.
   * @route POST /get-daily-workspace-api-calls
   * @paramDef {"type":"String","label":"Period (Month Start)","name":"period","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Month start in ISO8601, e.g. \"2021-02-01\"."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many days to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"dailyWorkspaceAPICallsUsage":[{"apiCalls":"12345","timestamp":"2006-01-02T15:04:05.000Z"}],"pagination":{"current":"MA==","next":"MQ==","totalEntries":28}}}
   */
  // API: https://docs.segmentapis.com/tag/API-Calls/
  async getDailyWorkspaceApiCalls(period, count, cursor) {
    this.#requireParam(period, 'Period is required — enter a month start in ISO8601, e.g. "2021-02-01".')

    const query = this.#paginationQuery(count, cursor)

    query.period = period

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/usage/api-calls/daily`,
      query,
      logTag: 'getDailyWorkspaceApiCalls',
    })
  }

  /**
   * @operationName Get Daily Per Source API Calls
   * @category Usage and Monitoring
   * @description Returns the daily per-Source API-call usage for the workspace in a given month.
   * @route POST /get-daily-per-source-api-calls
   * @paramDef {"type":"String","label":"Period (Month Start)","name":"period","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Month start in ISO8601, e.g. \"2021-02-01\"."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many rows to return per page."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"dailyPerSourceAPICallsUsage":[{"sourceId":"src_1","apiCalls":"5432","timestamp":"2006-01-02T15:04:05.000Z"}],"pagination":{"current":"MA==","next":"MQ==","totalEntries":28}}}
   */
  // API: https://docs.segmentapis.com/tag/API-Calls/
  async getDailyPerSourceApiCalls(period, count, cursor) {
    this.#requireParam(period, 'Period is required — enter a month start in ISO8601, e.g. "2021-02-01".')

    const query = this.#paginationQuery(count, cursor)

    query.period = period

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/usage/api-calls/sources/daily`,
      query,
      logTag: 'getDailyPerSourceApiCalls',
    })
  }

  // ==========================================================================
  //  CUSTOMER INSIGHTS
  // ==========================================================================
  /**
   * @operationName Create Customer Insights Download
   * @category Customer Insights
   * @description Generates presigned download URLs for Customer Insights data for a collection and hour bucket. Data is hourly with one-month retention. Rate limit 120 requests/day per workspace.
   * @route POST /create-customer-insights-download
   * @paramDef {"type":"String","label":"Collection ID","name":"collection","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The Customer Insights collection identifier (sent as collectionId)."}
   * @paramDef {"type":"String","label":"Hour (ISO8601)","name":"hour","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The hour bucket to download (ISO8601). Data is hourly with one month retention."}
   * @returns {Object}
   * @sampleResult {"data":{"download":{"urls":["https://s3.amazonaws.com/...signed..."]}}}
   */
  // API: https://docs.segmentapis.com/tag/customer-insights/
  async createCustomerInsightsDownload(collection, hour) {
    this.#requireParam(collection, 'Collection ID is required — enter the Customer Insights collection identifier.')
    this.#requireParam(hour, 'Hour is required — pick the hour bucket to download.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/customer-insights/download`,
      method: 'post',
      body: { collectionId: collection, hour },
      logTag: 'createCustomerInsightsDownload',
    })
  }

  // ==========================================================================
  //  TRIGGER - New Audit Event (POLLING)
  // ==========================================================================
  /**
   * @operationName New Audit Event
   * @category Audit Trail
   * @description Fires when a new audit-trail event occurs in the workspace (resource created/updated/deleted, member changes, etc). Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-audit-event
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","description":"Only fire for this resource type (e.g. Sources). Leave blank for all."}
   * @paramDef {"type":"String","label":"Resource ID","name":"resourceId","description":"Only fire for events on this resource. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"id":"evt_1","timestamp":"2006-01-02T15:04:05.000Z","type":"source.created","actor":"ada@example.com","resourceId":"src_1","resourceType":"SOURCE","resourceName":"My Source"}
   */
  async onNewAuditEvent(invocation) {
    const { resourceType, resourceId } = invocation.triggerData || {}
    const lastSeen = invocation.state?.lastSeen
    const seenIds = new Set(invocation.state?.seenIds || [])
    const lastSeenMs = lastSeen ? Date.parse(lastSeen) : undefined

    const MAX_PAGES = 20
    const MAX_SEEN_IDS = 1000

    // Page through every result this cycle instead of inspecting only the first page -
    // the audit-events endpoint can return more than one page of activity between polls.
    const events = []
    let cursor
    let pagesFetched = 0

    do {
      const result = await this.listAuditEvents(lastSeen, undefined, resourceId, resourceType, undefined, cursor)
      events.push(...(result?.data?.events || []))
      cursor = result?.data?.pagination?.next || undefined
      pagesFetched += 1
    } while (cursor && pagesFetched < MAX_PAGES)

    if (cursor) {
      logger.warn(`onNewAuditEvent - hit the ${ MAX_PAGES }-page pagination cap (resourceType=${ resourceType || 'any' }, resourceId=${ resourceId || 'any' }); remaining pages will be picked up on the next polling cycle.`)
    }

    if (!events.length) {
      return { events: [], state: { lastSeen, seenIds: Array.from(seenIds) } }
    }

    // Don't trust the API's sort order - scan every fetched event for the true newest timestamp.
    let newestTimestamp = events[0].timestamp
    let newestMs = Date.parse(newestTimestamp)

    for (const event of events) {
      const ms = Date.parse(event.timestamp)

      if (ms > newestMs) {
        newestMs = ms
        newestTimestamp = event.timestamp
      }
    }

    const idsAtNewest = events.filter(event => event.timestamp === newestTimestamp).map(event => event.id)

    if (invocation.learningMode) {
      const sample = events.slice(0, 1)

      return { events: sample, state: { lastSeen: newestTimestamp, seenIds: idsAtNewest.slice(-MAX_SEEN_IDS) } }
    }

    if (!lastSeen) {
      // First poll: establish the baseline without emitting historical events.
      return { events: [], state: { lastSeen: newestTimestamp, seenIds: idsAtNewest.slice(-MAX_SEEN_IDS) } }
    }

    // Compound cursor: emit events strictly after lastSeen, plus same-instant events whose id
    // wasn't already seen at that boundary - this avoids dropping same-timestamp bursts that a
    // strict `>` comparison would silently discard.
    const newEvents = events.filter(event => {
      const ms = Date.parse(event.timestamp)

      if (ms > lastSeenMs) return true

      return ms === lastSeenMs && !seenIds.has(event.id)
    })

    // If the boundary timestamp didn't move, keep dedupe IDs already known for it; otherwise
    // reset the seen-set to the IDs at the new boundary timestamp.
    const nextSeenIds = newestMs === lastSeenMs
      ? Array.from(new Set([ ...seenIds, ...idsAtNewest ])).slice(-MAX_SEEN_IDS)
      : idsAtNewest.slice(-MAX_SEEN_IDS)

    return { events: newEvents, state: { lastSeen: newestTimestamp, seenIds: nextSeenIds } }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerPollingForEvent
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    logger.debug(`handleTriggerPollingForEvent.${ invocation.eventName }`)

    return this[invocation.eventName](invocation)
  }

  // ==========================================================================
  //  DICTIONARIES - back every resource-pick (*Id / metadataId) param
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Sources Dictionary
   * @description Provides a searchable list of Sources for dropdown selection in other actions.
   * @route POST /get-sources-dictionary
   * @paramDef {"type":"getSourcesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"swift","value":"qQEHquLrjRDN9j1ByrChyn","note":"Slug: swift"}],"cursor":null}
   */
  async getSourcesDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.listSources(undefined, cursor)
    const items = result?.data?.sources || []

    return {
      items: this.#filterBySearch(items, search, s => `${ s.name } ${ s.slug }`).map(source => ({
        label: source.name || source.slug,
        value: source.id,
        note: `Slug: ${ source.slug }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Destinations Dictionary
   * @description Provides a searchable list of Destinations for dropdown selection in other actions.
   * @route POST /get-destinations-dictionary
   * @paramDef {"type":"getDestinationsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"example-destination","value":"5GFhvtz8fha42Cm4B9E6L8","note":"Type: amplitude"}],"cursor":"MQ=="}
   */
  async getDestinationsDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.listDestinations(undefined, cursor)
    const items = result?.data?.destinations || []

    return {
      items: this.#filterBySearch(items, search, d => d.name).map(destination => ({
        label: destination.name,
        value: destination.id,
        note: `Type: ${ destination.metadata?.slug || 'unknown' }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Destination Filters Dictionary
   * @description Provides a searchable list of a Destination's filters for dropdown selection. Depends on the chosen Destination.
   * @route POST /get-destination-filters-dictionary
   * @paramDef {"type":"getDestinationFiltersDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent Destination criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Filter Identify events","value":"2c0vbh2htbJmSvPJSeDypz3CjVg","note":"Condition: type = \"identify\""}],"cursor":null}
   */
  async getDestinationFiltersDictionary(payload) {
    const { search, criteria } = payload || {}
    const destinationId = criteria?.destinationId

    if (!destinationId) return { items: [], cursor: null }

    const result = await this.listDestinationFilters(destinationId)
    const items = result?.data?.filters || []

    return {
      items: this.#filterBySearch(items, search, f => f.title).map(filter => ({
        label: filter.title,
        value: filter.id,
        note: `Condition: ${ filter.if }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tracking Plans Dictionary
   * @description Provides a searchable list of Tracking Plans for dropdown selection in other actions.
   * @route POST /get-tracking-plans-dictionary
   * @paramDef {"type":"getTrackingPlansDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"New TP","value":"tp_sprout_rVGCC6WdrNxjCf6JpCHP","note":"Type: LIVE"}],"cursor":null}
   */
  async getTrackingPlansDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.listTrackingPlans(undefined, undefined, cursor)
    const items = result?.data?.trackingPlans || []

    return {
      items: this.#filterBySearch(items, search, t => t.name).map(plan => ({
        label: plan.name,
        value: plan.id,
        note: `Type: ${ plan.type }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Warehouses Dictionary
   * @description Provides a searchable list of Warehouses for dropdown selection in other actions.
   * @route POST /get-warehouses-dictionary
   * @paramDef {"type":"getWarehousesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Snowflake","value":"wh_123","note":"Type: snowflake"}],"cursor":null}
   */
  async getWarehousesDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.listWarehouses(undefined, cursor)
    const items = result?.data?.warehouses || []

    return {
      items: this.#filterBySearch(items, search, w => `${ w.metadata?.name } ${ w.id }`).map(warehouse => ({
        label: warehouse.metadata?.name || warehouse.id,
        value: warehouse.id,
        note: `Type: ${ warehouse.metadata?.slug || warehouse.metadata?.name || warehouse.id }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Functions Dictionary
   * @description Provides a searchable list of Functions for dropdown selection in other actions.
   * @route POST /get-functions-dictionary
   * @paramDef {"type":"getFunctionsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"PAPI Source Function","value":"sfnc_wXzcDGFR3KmjLDrtSawNHf","note":"Type: SOURCE"}],"cursor":null}
   */
  async getFunctionsDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.listFunctions(undefined, undefined, cursor)
    const items = result?.data?.functions || []

    return {
      items: this.#filterBySearch(items, search, f => f.displayName).map(fn => ({
        label: fn.displayName,
        value: fn.id,
        note: `Type: ${ fn.resourceType }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Source Catalog Dictionary
   * @description Provides a searchable list of Source types (catalog metadata) for choosing a Source Type when creating a Source.
   * @route POST /get-source-catalog-dictionary
   * @paramDef {"type":"getSourceCatalogDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"HTTP API","value":"IqDTy1TpoU","note":"Slug: http"}],"cursor":null}
   */
  async getSourceCatalogDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/catalog/sources`,
      query: this.#paginationQuery(undefined, cursor),
      logTag: 'getSourceCatalogDictionary',
    })
    const items = result?.data?.sourcesCatalog || []

    return {
      items: this.#filterBySearch(items, search, c => `${ c.name } ${ c.slug }`).map(item => ({
        label: item.name,
        value: item.id,
        note: `Slug: ${ item.slug }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Destination Catalog Dictionary
   * @description Provides a searchable list of Destination types (catalog metadata) for choosing a Destination Type when creating a Destination.
   * @route POST /get-destination-catalog-dictionary
   * @paramDef {"type":"getDestinationCatalogDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Amplitude","value":"54521fd525e721e32a72ee91","note":"Slug: amplitude"}],"cursor":null}
   */
  async getDestinationCatalogDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/catalog/destinations`,
      query: this.#paginationQuery(undefined, cursor),
      logTag: 'getDestinationCatalogDictionary',
    })
    const items = result?.data?.destinationsCatalog || []

    return {
      items: this.#filterBySearch(items, search, c => `${ c.name } ${ c.slug }`).map(item => ({
        label: item.name,
        value: item.id,
        note: `Slug: ${ item.slug }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Warehouse Catalog Dictionary
   * @description Provides a searchable list of Warehouse types (catalog metadata) for choosing a Warehouse Type when creating a Warehouse.
   * @route POST /get-warehouse-catalog-dictionary
   * @paramDef {"type":"getWarehouseCatalogDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Snowflake","value":"meta_1","note":"Slug: snowflake"}],"cursor":null}
   */
  async getWarehouseCatalogDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/catalog/warehouses`,
      query: this.#paginationQuery(undefined, cursor),
      logTag: 'getWarehouseCatalogDictionary',
    })
    const items = result?.data?.warehousesCatalog || []

    return {
      items: this.#filterBySearch(items, search, c => `${ c.name } ${ c.slug }`).map(item => ({
        label: item.name,
        value: item.id,
        note: `Slug: ${ item.slug }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Spaces Dictionary
   * @description Provides a searchable list of Engage Spaces for dropdown selection in Engage/Unify actions.
   * @route POST /get-spaces-dictionary
   * @paramDef {"type":"getSpacesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Production","value":"spa_123","note":"Slug: production"}],"cursor":null}
   */
  async getSpacesDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.listSpaces(undefined, cursor)
    const items = result?.data?.spaces || []

    return {
      items: this.#filterBySearch(items, search, s => `${ s.name } ${ s.slug }`).map(space => ({
        label: space.name || space.slug,
        value: space.id,
        note: `Slug: ${ space.slug }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Audiences Dictionary
   * @description Provides a searchable list of an Engage Space's Audiences for dropdown selection. Depends on the chosen Space.
   * @route POST /get-audiences-dictionary
   * @paramDef {"type":"getAudiencesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent Space criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Profiles Audience V1","value":"aud_1","note":"Type: USERS"}],"cursor":null}
   */
  async getAudiencesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const spaceId = criteria?.spaceId

    if (!spaceId) return { items: [], cursor: null }

    const result = await this.listAudiences(spaceId, undefined, undefined, cursor)
    const items = result?.data?.audiences || []

    return {
      items: this.#filterBySearch(items, search, a => a.name).map(audience => ({
        label: audience.name,
        value: audience.id,
        note: `Type: ${ audience.audienceType }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Computed Traits Dictionary
   * @description Provides a searchable list of an Engage Space's Computed Traits for dropdown selection. Depends on the chosen Space.
   * @route POST /get-computed-traits-dictionary
   * @paramDef {"type":"getComputedTraitsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent Space criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"High Value","value":"ct_1","note":"Key: high_value"}],"cursor":null}
   */
  async getComputedTraitsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const spaceId = criteria?.spaceId

    if (!spaceId) return { items: [], cursor: null }

    const result = await this.listComputedTraits(spaceId, undefined, cursor)
    const items = result?.data?.computedTraits || []

    return {
      items: this.#filterBySearch(items, search, t => `${ t.name } ${ t.key }`).map(trait => ({
        label: trait.name,
        value: trait.id,
        note: `Key: ${ trait.key }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Space Filters Dictionary
   * @description Provides a searchable list of an Engage Space's Filters for dropdown selection. Depends on the chosen Space.
   * @route POST /get-space-filters-dictionary
   * @paramDef {"type":"getSpaceFiltersDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent Space criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Block test events","value":"flt_1","note":"Condition: type = \"track\""}],"cursor":null}
   */
  async getSpaceFiltersDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const integrationId = criteria?.integrationId

    if (!integrationId) return { items: [], cursor: null }

    const result = await this.listSpaceFilters(integrationId, undefined, cursor)
    const items = result?.data?.filters || []

    return {
      items: this.#filterBySearch(items, search, f => f.name).map(filter => ({
        label: filter.name,
        value: filter.id,
        note: `Condition: ${ filter.if }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Audience Schedules Dictionary
   * @description Provides a searchable list of an Audience's compute schedules for dropdown selection. Depends on the chosen Space and Audience.
   * @route POST /get-audience-schedules-dictionary
   * @paramDef {"type":"getAudienceSchedulesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent Space/Audience criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"SPECIFIC_DAYS","value":"sch_1","note":"Next run: 2006-01-02T15:04:05.000Z"}],"cursor":null}
   */
  async getAudienceSchedulesDictionary(payload) {
    const { search, criteria } = payload || {}
    const spaceId = criteria?.spaceId
    const audienceId = criteria?.audienceId

    if (!spaceId || !audienceId) return { items: [], cursor: null }

    const result = await this.listAudienceSchedules(spaceId, audienceId)
    const items = result?.data?.audienceSchedules || []

    return {
      items: this.#filterBySearch(items, search, s => s.strategy).map(schedule => ({
        label: schedule.strategy || schedule.id,
        value: schedule.id,
        note: `Next run: ${ schedule.nextExecution || 'n/a' }`,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Audience Destinations Dictionary
   * @description Provides a searchable list of an Audience's destination connections for dropdown selection. Depends on the chosen Space and Audience.
   * @route POST /get-audience-destinations-dictionary
   * @paramDef {"type":"getAudienceDestinationsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent Space/Audience criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Amplitude","value":"conn_1","note":"Destination: dst_1"}],"cursor":null}
   */
  async getAudienceDestinationsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const spaceId = criteria?.spaceId
    const audienceId = criteria?.audienceId

    if (!spaceId || !audienceId) return { items: [], cursor: null }

    const result = await this.listAudienceDestinations(spaceId, audienceId, undefined, cursor)
    const items = result?.data?.connections || []

    return {
      items: this.#filterBySearch(items, search, c => c.name).map(connection => ({
        label: connection.name || connection.id,
        value: connection.id,
        note: `Destination: ${ connection.destinationId || 'unknown' }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Supported Actions Dictionary
   * @description Provides a searchable list of the destination actions that support activation for a Space and audience type, for dropdown selection. Depends on the chosen Space, Audience Type, and optional Destination Slug.
   * @route POST /get-supported-actions-dictionary
   * @paramDef {"type":"getSupportedActionsDictionary__payload","label":"Payload","name":"payload","description":"Search text and the parent Space/audience-type/slug criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Track Event","value":"act_track","note":"Destination: amplitude"}],"cursor":null}
   */
  async getSupportedActionsDictionary(payload) {
    const { search, criteria } = payload || {}
    const spaceId = criteria?.spaceId
    const audienceType = criteria?.audienceType
    const slug = criteria?.slug

    if (!spaceId || !audienceType) return { items: [], cursor: null }

    const result = await this.listSupportedDestinations(spaceId, audienceType, slug)
    const destinations = result?.data?.destinations || {}
    const items = []

    for (const [destinationSlug, destination] of Object.entries(destinations)) {
      for (const action of destination?.actions || []) {
        items.push({
          label: action.actionName || action.actionId,
          value: action.actionId,
          note: `Destination: ${ destination.slug || destinationSlug }`,
        })
      }
    }

    return {
      items: this.#filterBySearch(items, search, a => a.label),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Reverse ETL Models Dictionary
   * @description Provides a searchable list of Reverse ETL Models for dropdown selection in other actions.
   * @route POST /get-reverse-etl-models-dictionary
   * @paramDef {"type":"getReverseEtlModelsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Daily customers","value":"mdl_1","note":"Source: src_1"}],"cursor":null}
   */
  async getReverseEtlModelsDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.listReverseEtlModels(undefined, cursor)
    const items = result?.data?.models || []

    return {
      items: this.#filterBySearch(items, search, m => m.name).map(model => ({
        label: model.name,
        value: model.id,
        note: `Source: ${ model.sourceId }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Transformations Dictionary
   * @description Provides a searchable list of Transformations for dropdown selection in other actions.
   * @route POST /get-transformations-dictionary
   * @paramDef {"type":"getTransformationsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Rename event","value":"tf_1","note":"Source: src_1"}],"cursor":null}
   */
  async getTransformationsDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.listTransformations(undefined, cursor)
    const items = result?.data?.transformations || []

    return {
      items: this.#filterBySearch(items, search, t => t.name).map(transformation => ({
        label: transformation.name,
        value: transformation.id,
        note: `Source: ${ transformation.sourceId }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of workspace Users for dropdown selection in IAM actions.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Ada Lovelace","value":"usr_1","note":"ada@example.com"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.listUsers(undefined, cursor)
    const items = result?.data?.users || []

    return {
      items: this.#filterBySearch(items, search, u => `${ u.name } ${ u.email }`).map(user => ({
        label: user.name || user.email,
        value: user.id,
        note: user.email,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get User Groups Dictionary
   * @description Provides a searchable list of workspace User Groups for dropdown selection in IAM actions.
   * @route POST /get-user-groups-dictionary
   * @paramDef {"type":"getUserGroupsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engineers","value":"grp_1","note":"Members: 4"}],"cursor":null}
   */
  async getUserGroupsDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.listUserGroups(undefined, cursor)
    const items = result?.data?.userGroups || []

    return {
      items: this.#filterBySearch(items, search, g => g.name).map(group => ({
        label: group.name,
        value: group.id,
        note: `Members: ${ group.memberCount }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Roles Dictionary
   * @description Provides a searchable list of assignable Roles for dropdown selection when granting permissions.
   * @route POST /get-roles-dictionary
   * @paramDef {"type":"getRolesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Workspace Owner","value":"rol_1","note":"Full access to the workspace"}],"cursor":null}
   */
  async getRolesDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.listRoles(undefined, cursor)
    const items = result?.data?.roles || []

    return {
      items: this.#filterBySearch(items, search, r => r.name).map(role => ({
        label: role.name,
        value: role.id,
        note: role.description,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Profiles Warehouses Dictionary
   * @description Provides a searchable list of an Engage Space's Profiles Sync warehouses for dropdown selection. Depends on the chosen Space.
   * @route POST /get-profiles-warehouses-dictionary
   * @paramDef {"type":"getProfilesWarehousesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent Space criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"pwh_1","value":"pwh_1","note":"Enabled: true"}],"cursor":null}
   */
  async getProfilesWarehousesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const spaceId = criteria?.spaceId

    if (!spaceId) return { items: [], cursor: null }

    const result = await this.listProfilesWarehouses(spaceId, undefined, cursor)
    const items = result?.data?.profilesWarehouses || []

    return {
      items: this.#filterBySearch(items, search, w => `${ w.name || '' } ${ w.id }`).map(warehouse => ({
        label: warehouse.name || warehouse.id,
        value: warehouse.id,
        note: `Enabled: ${ warehouse.enabled }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Regulations Dictionary
   * @description Provides a searchable list of workspace regulations for dropdown selection (used to pick a regulate ID).
   * @route POST /get-regulations-dictionary
   * @paramDef {"type":"getRegulationsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"SUPPRESS_ONLY — FINISHED","value":"1qJkfE1tpwvQcklImGksLN629wn","note":"Subjects: 1"}],"cursor":null}
   */
  async getRegulationsDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.listWorkspaceRegulations(undefined, undefined, undefined, cursor)
    const items = result?.data?.regulations || []

    return {
      items: this.#filterBySearch(items, search, r => `${ r.id } ${ r.regulationType } ${ r.status }`).map(regulation => ({
        label: `${ regulation.regulationType || 'Regulation' } — ${ regulation.status || '' }`.trim(),
        value: regulation.id,
        note: `Subjects: ${ (regulation.subjects || []).length }`,
      })),
      cursor: result?.data?.pagination?.next || null,
    }
  }

  // Local, case-insensitive search over a fetched page (Segment list endpoints do not take a
  // server-side text query for these resources, so dictionaries filter client-side).
  #filterBySearch(items, search, toText) {
    if (!search) return items

    const needle = String(search).toLowerCase()

    return items.filter(item => String(toText(item) || '').toLowerCase().includes(needle))
  }
}

Flowrunner.ServerCode.addService(Segment, [
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Segment Public API token. Create one in Segment under Settings > Workspace settings > Access Management > Tokens. Sent as Authorization: Bearer <token>.',
  },
  {
    name: 'writeKey',
    displayName: 'Source Write Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'The Write Key of the Segment Source events should be sent to. Find it in Segment under Connections > Sources > [your source] > Settings > API Keys. Used only for the Tracking category (Track, Identify, Group, Page, Screen, Alias, Batch); not needed for management/config actions.',
  },
])
