// ============================================================================
//  Gong integration - calls, users, library, stats, scorecards, integration
//  meetings, data-privacy (GDPR/CCPA), and audit logs. Auth is HTTP Basic with
//  the Access Key as username and the Secret as password.
//
//  The write endpoints (Add Call, Upload Call Media, Create/Update/Delete
//  Meeting, and the data-erase methods) can only be exercised against a real
//  Gong tenant: Gong has no free or self-serve tier, so confirming them needs a
//  paid admin API key and a live test.
// ============================================================================

// ============================================================================
//  CONSTANTS
// ============================================================================
const API_BASE_URL = 'https://api.gong.io'

// Friendly DROPDOWN label the UI shows, mapped to the API value Gong expects.
// UNCONFIRMED: verify aggregation-period casing against live Gong API — public docs for
// POST /v2/stats/activity/aggregate-by-period describe an "aggregation period" field but do not
// publish its exact enum casing (DAY/WEEK/MONTH vs Day/Week/Month vs day/week/month).
const ACTIVITY_PERIOD_MAP = {
  'Day': 'DAY',
  'Week': 'WEEK',
  'Month': 'MONTH',
}

// CRM object types accepted by Get CRM Objects and the CRM schema endpoints.
// API: https://help.gong.io/apidocs/get-crm-objects-v2crmentities-1 (GET /v2/crm/entities)
// API: https://help.gong.io/apidocs/list-schema-fields-v2crmentity-schema-1 (GET /v2/crm/entity-schema)
const CRM_OBJECT_TYPE_MAP = { Account: 'ACCOUNT', Contact: 'CONTACT', Deal: 'DEAL', Lead: 'LEAD' }

// Upload CRM Objects (POST /v2/crm/entities) additionally accepts Business User and Stage.
// API: https://help.gong.io/apidocs/upload-crm-objects-v2crmentities-1
const CRM_UPLOAD_OBJECT_TYPE_MAP = {
  Account: 'ACCOUNT', Contact: 'CONTACT', Deal: 'DEAL', Lead: 'LEAD', 'Business User': 'BUSINESS_USER', Stage: 'STAGE',
}

// Field types accepted by Upload CRM Object Schema.
// API: https://help.gong.io/apidocs/upload-object-schema-v2crmentity-schema-1
const CRM_FIELD_TYPE_MAP = {
  Date: 'DATE', 'Date/Time': 'DATETIME', Number: 'NUMBER', Percent: 'PERCENT', Currency: 'CURRENCY',
  ID: 'ID', URL: 'URL', String: 'STRING', Boolean: 'BOOLEAN', 'Phone Number': 'PHONENUMBER',
  'Email Address': 'EMAILADDRESS', Picklist: 'PICKLIST', Reference: 'REFERENCE', 'String Array': 'STRINGARRAY',
}

// referenceTo values, required on a schema field only when its Type is Reference.
const CRM_REFERENCE_TYPE_MAP = { Account: 'ACCOUNT', Contact: 'CONTACT', Deal: 'DEAL', Lead: 'LEAD', User: 'USER' }

// ============================================================================
//  POLLING DIFF (pure, deterministic - unit-tested without a live API call)
// ============================================================================
// The "New Call" trigger polls GET /v2/calls. Because Gong may surface a call only after
// processing finishes (its `started` can be before the watermark while it only becomes
// queryable later), the trigger queries with a small lookback OVERLAP and dedupes the overlap
// against a persisted, bounded set of already-seen call IDs so nothing is re-emitted.
const GongPolling = {
  // Lookback subtracted from the stored watermark when querying the next window (15 min).
  OVERLAP_MS: 15 * 60 * 1000,
  // Cap the carried seen-ID set so state never grows without bound (keeps the newest IDs).
  MAX_SEEN_IDS: 5000,

  // Compute { events, state } for one polling cycle from the fetched calls and prior state.
  diff(calls, state, toDateTime) {
    const fetched = Array.isArray(calls) ? calls : []
    const currentIds = fetched.map(c => c.id)

    // First run: prime the watermark + seen set, emit nothing.
    if (!state) {
      return {
        events: [],
        state: { lastFromDateTime: toDateTime, seenIds: this.boundSeen(currentIds) },
      }
    }

    const seen = new Set(state.seenIds || [])
    const fresh = fetched.filter(c => !seen.has(c.id))

    // Carry forward prior seen IDs plus this window's IDs so the overlap stays deduped across
    // cycles (the watermark only advances by less than the overlap each run).
    const mergedSeen = this.boundSeen([...(state.seenIds || []), ...currentIds])

    return {
      events: fresh,
      state: { lastFromDateTime: toDateTime, seenIds: mergedSeen },
    }
  },

  // Keep the set bounded and de-duplicated, retaining the most-recently-added IDs.
  boundSeen(ids) {
    const unique = [...new Set(ids)]

    return unique.length > this.MAX_SEEN_IDS ? unique.slice(unique.length - this.MAX_SEEN_IDS) : unique
  },
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Gong] info:', ...args),
  debug: (...args) => console.log('[Gong] debug:', ...args),
  error: (...args) => console.log('[Gong] error:', ...args),
  warn: (...args) => console.log('[Gong] warn:', ...args),
}

// Friendly, remediating messages for the failures a flow-builder actually hits.
const ERROR_HINTS = {
  400: 'Bad request — check the date range (ISO-8601) and required fields.',
  401: 'Authentication failed — verify the Access Key and Access Key Secret in the service config.',
  403: 'Permission denied — this API key is missing the required scope. A Gong Technical Admin enables it in Company Settings → Ecosystem → API.',
  404: 'Not found — the ID may be wrong; use the matching "List…"/"Get…" action to pick a valid one.',
  429: 'Rate limit hit (Gong allows 3 calls/second, 10,000/day) — retry in a moment.',
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getWorkspacesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter workspaces by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getCallsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter recent calls by title."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getUsersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter users by name or email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getLibraryFoldersDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"description":"The workspace whose library folders to list."}
 */

/**
 * @typedef {Object} getLibraryFoldersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter folders by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getLibraryFoldersDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the workspace whose folders to list."}
 */

/**
 * @typedef {Object} getScorecardsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter scorecards by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getPermissionProfilesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"description":"The workspace whose permission profiles to list."}
 */

/**
 * @typedef {Object} getPermissionProfilesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter profiles by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getPermissionProfilesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the workspace whose profiles to list."}
 */

/**
 * @typedef {Object} getCrmIntegrationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter integrations by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getFlowsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Flow Owner Email","name":"flowOwnerEmail","required":true,"description":"Email of the Gong user whose flows to list."}
 */

/**
 * @typedef {Object} getFlowsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter flows by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getFlowsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the flow owner whose flows to list."}
 */

/**
 * @integrationName Gong
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class Gong {
  constructor(config) {
    this.config = config || {}
    this.accessKey = this.config.accessKey
    this.accessKeySecret = this.config.accessKeySecret
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
        .query(this.#cleanQuery(query))

      if (body !== undefined && body !== null) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #headers() {
    const token = Buffer.from(`${ this.accessKey }:${ this.accessKeySecret }`).toString('base64')

    return {
      Authorization: `Basic ${ token }`,
      'Content-Type': 'application/json',
    }
  }

  // Drop undefined/null/empty query params so they never reach the wire as "undefined".
  #cleanQuery(query) {
    const out = {}

    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') out[key] = value
    })

    return out
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.code || error?.body?.status
    const apiErrors = error?.body?.errors
    const apiMessage = (Array.isArray(apiErrors) && apiErrors.join('; ')) ||
      error?.body?.error?.message ||
      error?.body?.message ||
      error?.message ||
      'Request failed'
    const hint = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  // Translate a friendly DROPDOWN label into the API value; pass through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Accept an Array.<String> OR a comma-separated string for bulk ID params; '' / [] -> undefined.
  #toList(value) {
    if (value === undefined || value === null || value === '') return undefined

    const arr = Array.isArray(value)
      ? value
      : String(value).split(',').map(s => s.trim()).filter(Boolean)

    return arr.length ? arr : undefined
  }

  // ==========================================================================
  //  CALLS
  // ==========================================================================
  /**
   * @operationName List Calls
   * @category Calls
   * @description Lists Gong calls that started within a date range, newest data paged via a cursor. Use this to find recent calls before pulling their details, transcript, or extensive AI data.
   * @route POST /list-calls
   * @paramDef {"type":"String","label":"From Date/Time","name":"fromDateTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the date range (ISO-8601, e.g. 2025-01-01T00:00:00Z). Returns calls that started at or after this time."}
   * @paramDef {"type":"String","label":"To Date/Time","name":"toDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the date range (ISO-8601). Leave empty to return all calls up to now."}
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"Limit results to a single Gong workspace. Use the Workspace dropdown to pick one."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor returned by a previous call in records.cursor. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-001","records":{"totalRecords":2,"currentPageSize":2,"currentPageNumber":1,"cursor":null},"calls":[{"id":"7782342274025937895","url":"https://app.gong.io/call?id=7782342274025937895","title":"Acme — Discovery","scheduled":"2025-01-12T17:00:00Z","started":"2025-01-12T17:02:00Z","duration":1820,"primaryUserId":"234599484848423","direction":"Inbound","workspaceId":"623457289"}]}
   */
  async listCalls(fromDateTime, toDateTime, workspaceId, cursor) {
    if (!fromDateTime) throw new Error('From Date/Time is required (ISO-8601, e.g. 2025-01-01T00:00:00Z).')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/calls`,
      method: 'get',
      query: { fromDateTime, toDateTime, workspaceId, cursor },
      logTag: 'listCalls',
    })
  }

  /**
   * @operationName Get Call
   * @category Calls
   * @description Retrieves the metadata of a single Gong call by its ID (title, times, duration, host, direction). Use after List Calls to inspect one call's details.
   * @route POST /get-call
   * @paramDef {"type":"String","label":"Call","name":"callId","required":true,"dictionary":"getCallsDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The Gong call to retrieve. Pick from recent calls or paste a call ID (up to 20 digits)."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-002","call":{"id":"7782342274025937895","url":"https://app.gong.io/call?id=7782342274025937895","title":"Acme — Discovery","scheduled":"2025-01-12T17:00:00Z","started":"2025-01-12T17:02:00Z","duration":1820,"primaryUserId":"234599484848423","direction":"Inbound","workspaceId":"623457289"}}
   */
  async getCall(callId) {
    if (!callId) throw new Error('Call is required — use List Calls to pick one.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/calls/${ encodeURIComponent(callId) }`,
      method: 'get',
      logTag: 'getCall',
    })
  }

  // API: https://help.gong.io/docs/uploading-calls-from-a-non-integrated-telephony-system
  // The minimal body (clientUniqueId/actualStart/primaryUser/parties/direction/downloadMediaUrl)
  // matches the help-doc example; the richer parties[name,phone,email]/context fields aren't shown
  // in any doc, so that part of the body should be confirmed with a live test.
  /**
   * @operationName Add Call
   * @category Calls
   * @description Uploads a call from a non-integrated telephony system into Gong so it can be processed and analyzed. Provide the parties (internal users by userId, external people by name + email/phone) and a media download URL or follow up with Upload Call Media. The Primary User is automatically added to the parties if you do not list them, since Gong requires the host to be a party.
   * @route POST /add-call
   * @paramDef {"type":"String","label":"Client Unique ID","name":"clientReference","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Your telephony system's own unique reference for this call (a caller-defined value, not a Gong ID). Gong uses it to prevent duplicate uploads."}
   * @paramDef {"type":"String","label":"Actual Start","name":"actualStart","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the call actually started (ISO-8601, e.g. 2018-02-17T02:30:00-08:00)."}
   * @paramDef {"type":"String","label":"Primary User","name":"primaryUser","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The Gong user who hosted/owned the call. Pick from your team."}
   * @paramDef {"type":"String","label":"Direction","name":"direction","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Inbound","Outbound","Conference","Unknown"]}},"description":"Call direction from your system's perspective. Use Unknown when the call cannot be classified."}
   * @paramDef {"type":"Array<Object>","label":"Parties","name":"parties","required":true,"schemaLoader":"getPartiesSchema","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"People on the call. Each party needs a userId (internal) OR a name + emailAddress/phoneNumber (external)."}
   * @paramDef {"type":"String","label":"Title","name":"title","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display title for the call in Gong."}
   * @paramDef {"type":"String","label":"Media Download URL","name":"downloadMediaUrl","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A URL Gong can fetch the recording from. Omit if you will upload the file via Upload Call Media."}
   * @paramDef {"type":"String","label":"Call Provider Code","name":"callProviderCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Identifier of the telephony/recording provider (e.g. \"clearslide\")."}
   * @paramDef {"type":"Number","label":"Duration (seconds)","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Call length in seconds."}
   * @returns {Object}
   * @sampleResult {"callId":"7782342274025937895","requestId":"4al018gzaztcr8nbukw","url":"https://app.gong.io/call?id=7782342274025937895"}
   */
  async addCall(clientReference, actualStart, primaryUser, direction, parties, title, downloadMediaUrl, callProviderCode, duration) {
    if (!clientReference) throw new Error('Client Unique ID is required.')
    if (!actualStart) throw new Error('Actual Start is required (ISO-8601).')
    if (!primaryUser) throw new Error('Primary User is required — use the Primary User picker.')
    if (!direction) throw new Error('Direction is required (Inbound, Outbound, Conference, or Unknown).')

    const partyList = Array.isArray(parties) ? parties : []
    if (!partyList.length) throw new Error('At least one party is required.')

    // Gong requires the primary user to also be a party; add them if the caller left them out.
    const hasPrimaryParty = partyList.some(p => p && p.userId === primaryUser)
    const partiesWithPrimary = hasPrimaryParty ? partyList : [...partyList, { userId: primaryUser }]

    const body = {
      clientUniqueId: clientReference,
      actualStart,
      primaryUser,
      // docs: help.gong.io "Uploading calls from a non-integrated telephony system" - direction is one of Inbound | Outbound | Conference | Unknown
      direction,
      parties: partiesWithPrimary,
    }

    if (title) body.title = title
    if (downloadMediaUrl) body.downloadMediaUrl = downloadMediaUrl
    if (callProviderCode) body.callProviderCode = callProviderCode
    if (duration !== undefined && duration !== null && duration !== '') body.duration = Number(duration)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/calls`,
      method: 'post',
      body,
      logTag: 'addCall',
    })
  }

  /**
   * @operationName Get Extensive Call Data
   * @category Calls
   * @description Retrieves rich, AI-derived data for calls - topics, trackers, brief, outline, highlights, key points, parties, interaction stats, and media URLs. Filter by specific Call IDs or by a date range. Toggle which content sections to include.
   * @route POST /get-extensive-call-data
   * @paramDef {"type":"Array<String>","label":"Call IDs","name":"callIds","dictionary":"getCallsDictionary","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Specific calls to pull rich data for. Provide either Call IDs or a From Date/Time. Accepts a list or comma-separated IDs."}
   * @paramDef {"type":"String","label":"From Date/Time","name":"fromDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Pull extensive data for all calls started at/after this time (ISO-8601). Use instead of Call IDs to scan a range."}
   * @paramDef {"type":"String","label":"To Date/Time","name":"toDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the range (ISO-8601). Optional."}
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"Limit to one workspace."}
   * @paramDef {"type":"Boolean","label":"Include AI Content","name":"includeContent","uiComponent":{"type":"TOGGLE"},"description":"Include AI-derived content (topics, trackers, brief, outline, highlights, key points, call outcome)."}
   * @paramDef {"type":"Boolean","label":"Include Media URLs","name":"includeMedia","uiComponent":{"type":"TOGGLE"},"description":"Include audio/video download URLs (requires the media-url scope on your key)."}
   * @paramDef {"type":"Boolean","label":"Include Parties","name":"includeParties","uiComponent":{"type":"TOGGLE"},"description":"Include the list of call participants."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from a previous response for the next page."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-003","records":{"totalRecords":1,"currentPageSize":1,"currentPageNumber":1,"cursor":null},"calls":[{"metaData":{"id":"7782342274025937895","title":"Acme — Discovery","started":"2025-01-12T17:02:00Z","duration":1820,"primaryUserId":"234599484848423","direction":"Inbound"},"content":{"brief":"Discovery on pipeline analytics.","topics":[{"name":"Pricing","duration":120}],"highlights":[],"keyPoints":[{"text":"Budget approved for Q2"}],"callOutcome":"No Decision"},"parties":[{"name":"Jane Doe","userId":"234599484848423","speakerId":"6143068094786164742"}],"media":{"audioUrl":"https://media.gong.io/audio/example-token","videoUrl":"https://media.gong.io/video/example-token"}}]}
   */
  async getExtensiveCallData(callIds, fromDateTime, toDateTime, workspaceId, includeContent, includeMedia, includeParties, cursor) {
    const ids = this.#toList(callIds)

    if (!ids && !fromDateTime) {
      throw new Error('Provide either Call IDs or a From Date/Time — Gong requires at least one filter.')
    }

    const filter = {}
    if (ids) filter.callIds = ids
    if (fromDateTime) filter.fromDateTime = fromDateTime
    if (toDateTime) filter.toDateTime = toDateTime
    if (workspaceId) filter.workspaceId = workspaceId

    const contentSelector = {
      context: 'Extended',
      contextTiming: ['Now', 'TimeOfCall'],
      exposedFields: {},
    }

    if (includeContent) {
      contentSelector.exposedFields.content = {
        pointsOfInterest: true,
        structure: true,
        topics: true,
        trackers: true,
        trackerOccurrences: true,
        brief: true,
        outline: true,
        highlights: true,
        callOutcome: true,
        keyPoints: true,
      }
    }

    if (includeMedia) contentSelector.exposedFields.media = true
    if (includeParties) contentSelector.exposedFields.parties = true

    const body = { filter, contentSelector }
    if (cursor) body.cursor = cursor

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/calls/extensive`,
      method: 'post',
      body,
      logTag: 'getExtensiveCallData',
    })
  }

  /**
   * @operationName Get Call Transcripts
   * @category Calls
   * @description Retrieves speaker-attributed, time-stamped transcripts for one or more calls. Filter by specific Call IDs or by a date range. Use to feed call text into summarization, search, or compliance flows.
   * @route POST /get-call-transcripts
   * @paramDef {"type":"Array<String>","label":"Call IDs","name":"callIds","dictionary":"getCallsDictionary","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Calls to fetch transcripts for. Provide either Call IDs or a From/To date range. Accepts a list or comma-separated IDs."}
   * @paramDef {"type":"String","label":"From Date/Time","name":"fromDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Fetch transcripts for all calls started at/after this time (ISO-8601). Use instead of Call IDs."}
   * @paramDef {"type":"String","label":"To Date/Time","name":"toDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the range (ISO-8601). Optional."}
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"Limit to one workspace."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from a previous response for the next page."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-004","records":{"totalRecords":1,"currentPageSize":1,"currentPageNumber":1,"cursor":null},"callTranscripts":[{"callId":"7782342274025937895","transcript":[{"speakerId":"6143068094786164742","topic":"Call Setup","sentences":[{"start":60,"end":600,"text":"hey, Guillherme."}]}]}]}
   */
  async getCallTranscripts(callIds, fromDateTime, toDateTime, workspaceId, cursor) {
    const ids = this.#toList(callIds)

    if (!ids && !fromDateTime) {
      throw new Error('Provide either Call IDs or a From Date/Time — Gong requires at least one filter.')
    }

    const filter = {}
    if (ids) filter.callIds = ids
    if (fromDateTime) filter.fromDateTime = fromDateTime
    if (toDateTime) filter.toDateTime = toDateTime
    if (workspaceId) filter.workspaceId = workspaceId

    const body = { filter }
    if (cursor) body.cursor = cursor

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/calls/transcript`,
      method: 'post',
      body,
      logTag: 'getCallTranscripts',
    })
  }

  // API: https://github.com/ksindi/gong-client/blob/main/docs/CallsApi.md  (addCallMedia | PUT | /v2/calls/{id}/media)
  // Multipart binary upload - no doc shows the exact request shape, so confirm it with a live test.
  /**
   * @operationName Upload Call Media
   * @category Calls
   * @description Attaches an audio or video recording (up to 1.5GB) to a call that was created with Add Call. Use this when you uploaded call metadata first and now want to push the recording file itself.
   * @route POST /upload-call-media
   * @paramDef {"type":"String","label":"Call","name":"callId","required":true,"dictionary":"getCallsDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The call to attach a recording to. Use the Call ID returned by Add Call."}
   * @paramDef {"type":"String","label":"Media File","name":"mediaFileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The audio/video recording to upload (max 1.5GB). Select a Flowrunner file."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-005","url":"https://app.gong.io/call?id=7782342274025937895"}
   */
  async uploadCallMedia(callId, mediaFileUrl) {
    if (!callId) throw new Error('Call is required — use the Call returned by Add Call.')
    if (!mediaFileUrl) throw new Error('Media File is required — select a Flowrunner file.')

    const downloaded = await Flowrunner.Request.get(mediaFileUrl).setEncoding(null)
    const buffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded)
    const filename = decodeURIComponent(String(mediaFileUrl).split('/').pop().split('?')[0]) || 'recording'

    // Do NOT set Content-Type manually — the form supplies the multipart boundary.
    const formData = new Flowrunner.Request.FormData()
    formData.append('mediaFile', buffer, { filename })

    try {
      return await Flowrunner.Request.put(`${ API_BASE_URL }/v2/calls/${ encodeURIComponent(callId) }/media`)
        .set({ Authorization: this.#headers().Authorization })
        .form(formData)
    } catch (error) {
      this.#handleError(error, 'uploadCallMedia')
    }
  }

  // ==========================================================================
  //  USERS
  // ==========================================================================
  /**
   * @operationName List Users
   * @category Users
   * @description Lists the Gong users in your account (name, email, active status, title, manager), paged via a cursor. Use to enumerate your team or feed user pickers.
   * @route POST /list-users
   * @paramDef {"type":"Boolean","label":"Include Avatars","name":"includeAvatars","uiComponent":{"type":"TOGGLE"},"description":"Include each user's avatar image URL in the result."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from a previous response for the next page."}
   * @returns {Object}
   * @sampleResult {"requestId":"abc123","records":{"totalRecords":250,"currentPageSize":100,"cursor":"example-cursor"},"users":[{"id":"7782342274025","emailAddress":"jane@acme.com","firstName":"Jane","lastName":"Doe","active":true,"title":"AE","managerId":"99110022"}]}
   */
  async listUsers(includeAvatars, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/users`,
      method: 'get',
      query: { includeAvatars: includeAvatars ? true : undefined, cursor },
      logTag: 'listUsers',
    })
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves a single Gong user by ID (email, name, title, phone, manager, active status). Use after List Users to inspect one teammate.
   * @route POST /get-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The Gong user to retrieve. Pick from your team."}
   * @returns {Object}
   * @sampleResult {"requestId":"def456","user":{"id":"7782342274025","emailAddress":"jane@acme.com","firstName":"Jane","lastName":"Doe","active":true,"title":"AE","phoneNumber":"+15551234567","managerId":"99110022"}}
   */
  async getUser(userId) {
    if (!userId) throw new Error('User is required — use List Users to pick one.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/users/${ encodeURIComponent(userId) }`,
      method: 'get',
      logTag: 'getUser',
    })
  }

  /**
   * @operationName List Users (Extensive)
   * @category Users
   * @description Lists users with filtering - by specific User IDs or a created-date range - and optional avatars. Use when you need to narrow the user list rather than fetch everyone.
   * @route POST /list-users-extensive
   * @paramDef {"type":"Array<String>","label":"User IDs","name":"userIds","dictionary":"getUsersDictionary","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Limit to specific users. Accepts a list or comma-separated IDs. Leave empty for all users."}
   * @paramDef {"type":"Boolean","label":"Include Avatars","name":"includeAvatars","uiComponent":{"type":"TOGGLE"},"description":"Include each user's avatar image URL."}
   * @paramDef {"type":"String","label":"Created From","name":"createdFromDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only users created at/after this time (ISO-8601)."}
   * @paramDef {"type":"String","label":"Created To","name":"createdToDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only users created at/before this time (ISO-8601)."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from a previous response for the next page."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-006","records":{"totalRecords":1,"currentPageSize":1,"cursor":null},"users":[{"id":"7782342274025","emailAddress":"jane@acme.com","firstName":"Jane","lastName":"Doe","active":true,"title":"AE","created":"2024-03-01T10:00:00Z","managerId":"99110022"}]}
   */
  async listUsersExtensive(userIds, includeAvatars, createdFromDateTime, createdToDateTime, cursor) {
    const filter = {}
    const ids = this.#toList(userIds)
    if (ids) filter.userIds = ids
    if (includeAvatars) filter.includeAvatars = true
    if (createdFromDateTime) filter.createdFromDateTime = createdFromDateTime
    if (createdToDateTime) filter.createdToDateTime = createdToDateTime

    const body = { filter }
    if (cursor) body.cursor = cursor

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/users/extensive`,
      method: 'post',
      body,
      logTag: 'listUsersExtensive',
    })
  }

  // ==========================================================================
  //  WORKSPACES
  // ==========================================================================
  /**
   * @operationName List Workspaces
   * @category Workspaces
   * @description Lists all workspaces in your Gong company (id, name, description). Use to discover workspace IDs that scope calls, library, scorecards, and permission profiles.
   * @route POST /list-workspaces
   * @returns {Object}
   * @sampleResult {"requestId":"req-007","workspaces":[{"id":"623457289","name":"North America","description":"NA sales org"},{"id":"623457290","name":"EMEA","description":"EMEA sales org"}]}
   */
  async listWorkspaces() {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/workspaces`,
      method: 'get',
      logTag: 'listWorkspaces',
    })
  }

  // ==========================================================================
  //  LIBRARY
  // ==========================================================================
  /**
   * @operationName List Library Folders
   * @category Library
   * @description Returns the library folder hierarchy for a workspace (folder names, who created them, nested subfolders). Use to navigate the call library before listing a folder's calls.
   * @route POST /list-library-folders
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The workspace whose library hierarchy you want."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-008","folders":[{"id":"folder-100","name":"Best Discovery Calls","createdBy":"234599484848423","updated":"2025-01-10T12:00:00Z"}]}
   */
  async listLibraryFolders(workspaceId) {
    if (!workspaceId) throw new Error('Workspace is required — use List Workspaces to pick one.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/library/folders`,
      method: 'get',
      query: { workspaceId },
      logTag: 'listLibraryFolders',
    })
  }

  /**
   * @operationName List Calls in Folder
   * @category Library
   * @description Lists the calls saved in a specific library folder (title, URL, when added, and any note). Use to pull the curated calls a team has bookmarked.
   * @route POST /list-folder-calls
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getLibraryFoldersDictionary","dependsOn":["workspaceId"],"uiComponent":{"type":"DROPDOWN"},"description":"The library folder whose calls you want to list."}
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The workspace the folder belongs to (used to populate the Folder picker)."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-009","calls":[{"id":"7782342274025937895","title":"Acme — Discovery","url":"https://app.gong.io/call?id=7782342274025937895","created":"2025-01-12T18:00:00Z","note":"Great objection handling"}]}
   */
  async listFolderCalls(folderId, workspaceId) {
    if (!folderId) throw new Error('Folder is required — use List Library Folders to pick one.')
    void workspaceId

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/library/folder-content`,
      method: 'get',
      query: { folderId },
      logTag: 'listFolderCalls',
    })
  }

  // ==========================================================================
  //  STATS (computed read-only reports)
  // ==========================================================================
  /**
   * @operationName Get Day-by-Day Activity
   * @category Stats
   * @description Returns per-user activity counters broken out day by day over a date range (calls hosted, calls attended, and more). Use for daily activity dashboards and rep coaching.
   * @route POST /get-activity-day-by-day
   * @paramDef {"type":"String","label":"From Date/Time","name":"fromDateTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the reporting range (ISO-8601)."}
   * @paramDef {"type":"String","label":"To Date/Time","name":"toDateTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the reporting range (ISO-8601)."}
   * @paramDef {"type":"Array<String>","label":"User IDs","name":"userIds","dictionary":"getUsersDictionary","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Limit to specific users. Accepts a list or comma-separated IDs. Leave empty for all."}
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"Limit to one workspace."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from a previous response for the next page."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-010","records":{"totalRecords":1,"currentPageSize":1,"cursor":null},"usersAggregateActivityStats":[{"userId":"234599484848423","fromDateTime":"2025-01-01T00:00:00Z","toDateTime":"2025-01-02T00:00:00Z","callsAsHost":3,"callsAttended":5}]}
   */
  async getActivityDayByDay(fromDateTime, toDateTime, userIds, workspaceId, cursor) {
    return await this.#statsRequest('/v2/stats/activity/day-by-day', 'getActivityDayByDay', { fromDateTime, toDateTime, userIds, workspaceId, cursor })
  }

  /**
   * @operationName Get Aggregated Activity
   * @category Stats
   * @description Returns per-user activity counters aggregated over the whole date range (one row per user). Use for period-over-period rollups and leaderboards.
   * @route POST /get-activity-aggregate
   * @paramDef {"type":"String","label":"From Date/Time","name":"fromDateTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the reporting range (ISO-8601)."}
   * @paramDef {"type":"String","label":"To Date/Time","name":"toDateTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the reporting range (ISO-8601)."}
   * @paramDef {"type":"Array<String>","label":"User IDs","name":"userIds","dictionary":"getUsersDictionary","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Limit to specific users. Accepts a list or comma-separated IDs. Leave empty for all."}
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"Limit to one workspace."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from a previous response for the next page."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-011","records":{"totalRecords":1,"currentPageSize":1,"cursor":null},"usersAggregateActivityStats":[{"userId":"234599484848423","callsAsHost":42,"callsAttended":61,"emailsSent":120}]}
   */
  async getActivityAggregate(fromDateTime, toDateTime, userIds, workspaceId, cursor) {
    return await this.#statsRequest('/v2/stats/activity/aggregate', 'getActivityAggregate', { fromDateTime, toDateTime, userIds, workspaceId, cursor })
  }

  /**
   * @operationName Get Activity by Period
   * @category Stats
   * @description Returns per-user activity counters grouped into time buckets (day, week, or month) across the date range. Use to chart activity trends over time.
   * @route POST /get-activity-by-period
   * @paramDef {"type":"String","label":"From Date/Time","name":"fromDateTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the reporting range (ISO-8601)."}
   * @paramDef {"type":"String","label":"To Date/Time","name":"toDateTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the reporting range (ISO-8601)."}
   * @paramDef {"type":"String","label":"Group By Period","name":"period","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Week","Month"]}},"description":"Bucket the activity by day, week, or month."}
   * @paramDef {"type":"Array<String>","label":"User IDs","name":"userIds","dictionary":"getUsersDictionary","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Limit to specific users. Accepts a list or comma-separated IDs."}
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"Limit to one workspace."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from a previous response for the next page."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-012","records":{"totalRecords":1,"currentPageSize":1,"cursor":null},"usersAggregateByPeriodActivityStats":[{"userId":"234599484848423","period":"2025-W02","callsAsHost":7}]}
   */
  async getActivityByPeriod(fromDateTime, toDateTime, period, userIds, workspaceId, cursor) {
    if (!period) throw new Error('Group By Period is required (Day, Week, or Month).')

    return await this.#statsRequest('/v2/stats/activity/aggregate-by-period', 'getActivityByPeriod', { fromDateTime, toDateTime, period: this.#resolveChoice(period, ACTIVITY_PERIOD_MAP), userIds, workspaceId, cursor })
  }

  /**
   * @operationName Get Interaction Stats
   * @category Stats
   * @description Returns conversation-interaction metrics per user over a date range (talk ratio, longest monologue, interactivity). Use to surface coaching signals on listening vs. talking.
   * @route POST /get-interaction-stats
   * @paramDef {"type":"String","label":"From Date/Time","name":"fromDateTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the reporting range (ISO-8601)."}
   * @paramDef {"type":"String","label":"To Date/Time","name":"toDateTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the reporting range (ISO-8601)."}
   * @paramDef {"type":"Array<String>","label":"User IDs","name":"userIds","dictionary":"getUsersDictionary","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Limit to specific users. Accepts a list or comma-separated IDs."}
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"Limit to one workspace."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from a previous response for the next page."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-013","records":{"totalRecords":1,"currentPageSize":1,"cursor":null},"peopleInteractionStats":[{"userId":"234599484848423","talkRatio":0.46,"longestMonologue":75,"interactivity":0.8}]}
   */
  async getInteractionStats(fromDateTime, toDateTime, userIds, workspaceId, cursor) {
    return await this.#statsRequest('/v2/stats/interaction', 'getInteractionStats', { fromDateTime, toDateTime, userIds, workspaceId, cursor })
  }

  // Shared body builder for the user-activity/interaction stats endpoints (same request model).
  async #statsRequest(routePath, logTag, { fromDateTime, toDateTime, period, userIds, workspaceId, cursor }) {
    if (!fromDateTime) throw new Error('From Date/Time is required (ISO-8601).')
    if (!toDateTime) throw new Error('To Date/Time is required (ISO-8601).')

    const body = { fromDateTime, toDateTime }
    if (period) body.period = period
    const ids = this.#toList(userIds)
    if (ids) body.userIds = ids
    if (workspaceId) body.workspaceId = workspaceId
    if (cursor) body.cursor = cursor

    return await this.#apiRequest({
      url: `${ API_BASE_URL }${ routePath }`,
      method: 'post',
      body,
      logTag,
    })
  }

  // ==========================================================================
  //  SCORECARDS
  // ==========================================================================
  /**
   * @operationName List Scorecards
   * @category Scorecards
   * @description Lists the call scorecards configured in Gong (name, workspace, enabled status, and their questions). Use to discover scorecard IDs and question structure before reading answered scorecards.
   * @route POST /list-scorecards
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"Limit scorecards to one workspace. Leave empty for all."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-014","scorecards":[{"scorecardId":"sc-100","scorecardName":"Discovery Quality","workspaceId":"623457289","enabled":true,"updaterUserId":"234599484848423","created":"2024-09-01T10:00:00Z","updated":"2025-01-01T10:00:00Z","questions":[{"questionId":"q1","questionText":"Did the rep uncover pain?","isOverall":false}]}]}
   */
  async listScorecards(workspaceId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/settings/scorecards`,
      method: 'get',
      query: { workspaceId },
      logTag: 'listScorecards',
    })
  }

  /**
   * @operationName Get Answered Scorecards
   * @category Scorecards
   * @description Returns the filled-in scorecard reviews for calls - who was reviewed, by whom, when, and the per-question answers and scores. Filter by call date, review date, reviewed users, or scorecards.
   * @route POST /get-answered-scorecards
   * @paramDef {"type":"String","label":"Call From Date","name":"callFromDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Include scorecards for calls that took place at/after this date (ISO-8601). Provide a call range or a review range."}
   * @paramDef {"type":"String","label":"Call To Date","name":"callToDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Include scorecards for calls up to this date (ISO-8601)."}
   * @paramDef {"type":"String","label":"Review From Date","name":"reviewFromDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Include scorecards reviewed at/after this date (ISO-8601)."}
   * @paramDef {"type":"String","label":"Review To Date","name":"reviewToDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Include scorecards reviewed up to this date (ISO-8601)."}
   * @paramDef {"type":"Array<String>","label":"Reviewed User IDs","name":"reviewedUserIds","dictionary":"getUsersDictionary","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Limit to scorecards for these reviewed users. Accepts a list or comma-separated IDs."}
   * @paramDef {"type":"Array<String>","label":"Scorecard IDs","name":"scorecardIds","dictionary":"getScorecardsDictionary","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Limit to specific scorecards. Accepts a list or comma-separated IDs."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from a previous response for the next page."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-015","records":{"totalRecords":1,"currentPageSize":1,"cursor":null},"answeredScorecards":[{"answeredScorecardId":"asc-9","scorecardId":"sc-100","scorecardName":"Discovery Quality","callId":"7782342274025937895","callStartTime":"2025-01-12T17:02:00Z","reviewedUserId":"234599484848423","reviewerUserId":"99110022","reviewTime":"2025-01-13T09:00:00Z","visibilityType":"Public","answers":[{"questionId":"q1","answerText":"Yes","score":5}]}]}
   */
  async getAnsweredScorecards(callFromDate, callToDate, reviewFromDate, reviewToDate, reviewedUserIds, scorecardIds, cursor) {
    const filter = {}
    if (callFromDate) filter.callFromDate = callFromDate
    if (callToDate) filter.callToDate = callToDate
    if (reviewFromDate) filter.reviewFromDate = reviewFromDate
    if (reviewToDate) filter.reviewToDate = reviewToDate
    const reviewed = this.#toList(reviewedUserIds)
    if (reviewed) filter.reviewedUserIds = reviewed
    const cards = this.#toList(scorecardIds)
    if (cards) filter.scorecardIds = cards

    if (!Object.keys(filter).length) {
      throw new Error('Provide at least one date range (call or review) for Get Answered Scorecards.')
    }

    const body = { filter }
    if (cursor) body.cursor = cursor

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/stats/activity/scorecards`,
      method: 'post',
      body,
      logTag: 'getAnsweredScorecards',
    })
  }

  // ==========================================================================
  //  INTEGRATION MEETINGS (Beta)
  // ==========================================================================
  // API: https://developers.getknit.dev/docs/gong-usecases  (add_meeting | POST | /v2/meetings)
  // Body fields (required: startTime/endTime/invitees/organizerEmail; optional: title/externalId)
  // come from the cited field list; no doc shows a full JSON body, so confirm it with a live test.
  /**
   * @operationName Create Meeting
   * @category Meetings
   * @description Schedules a new integration meeting in Gong with an organizer and a list of invitees. Use to push externally-scheduled meetings into Gong so they can be recorded and analyzed.
   * @route POST /create-meeting
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Meeting start (ISO-8601)."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Meeting end (ISO-8601)."}
   * @paramDef {"type":"String","label":"Organizer Email","name":"organizerEmail","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the Gong user organizing the meeting."}
   * @paramDef {"type":"Array<Object>","label":"Invitees","name":"invitees","required":true,"schemaLoader":"getInviteesSchema","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"People invited to the meeting. Each invitee has an email address and a display name."}
   * @paramDef {"type":"String","label":"Title","name":"title","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Meeting title shown in Gong."}
   * @paramDef {"type":"String","label":"External ID","name":"externalRef","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Your own identifier for the meeting (a caller-defined value), to correlate it back to your system."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-016","meetingId":"mtg-555","gongMeetingId":"gmtg-555","url":"https://app.gong.io/meeting?id=mtg-555"}
   */
  async createMeeting(startTime, endTime, organizerEmail, invitees, title, externalRef) {
    if (!startTime) throw new Error('Start Time is required (ISO-8601).')
    if (!endTime) throw new Error('End Time is required (ISO-8601).')
    if (!organizerEmail) throw new Error('Organizer Email is required.')

    const inviteeList = Array.isArray(invitees) ? invitees : []
    if (!inviteeList.length) throw new Error('At least one invitee is required.')

    const body = { startTime, endTime, organizerEmail, invitees: inviteeList }
    if (title) body.title = title
    if (externalRef) body.externalId = externalRef

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/meetings`,
      method: 'post',
      body,
      logTag: 'createMeeting',
    })
  }

  // API: https://developers.getknit.dev/docs/gong-usecases  (update_meeting | PUT | /v2/meetings/{meetingId})
  // Same field list as create; no doc shows a full JSON body, so confirm it with a live test.
  /**
   * @operationName Update Meeting
   * @category Meetings
   * @description Updates an existing integration meeting's time, organizer, and full invitee list (the invitee list replaces the previous one). Use to reschedule or change attendees of a meeting created via Create Meeting.
   * @route POST /update-meeting
   * @paramDef {"type":"String","label":"Meeting","name":"meeting","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The Gong meeting to update — paste the Meeting ID returned by Create Meeting (there is no list-meetings endpoint to back a picker)."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New meeting start (ISO-8601)."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New meeting end (ISO-8601)."}
   * @paramDef {"type":"String","label":"Organizer Email","name":"organizerEmail","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the meeting organizer."}
   * @paramDef {"type":"Array<Object>","label":"Invitees","name":"invitees","required":true,"schemaLoader":"getInviteesSchema","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The full invitee list for the meeting (replaces the previous list). Each invitee has an email address and a display name."}
   * @paramDef {"type":"String","label":"Title","name":"title","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Updated meeting title."}
   * @paramDef {"type":"String","label":"External ID","name":"externalRef","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Updated external identifier (a caller-defined value)."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-017","meetingId":"mtg-555"}
   */
  async updateMeeting(meeting, startTime, endTime, organizerEmail, invitees, title, externalRef) {
    if (!meeting) throw new Error('Meeting is required — use the Meeting ID returned by Create Meeting.')
    if (!startTime) throw new Error('Start Time is required (ISO-8601).')
    if (!endTime) throw new Error('End Time is required (ISO-8601).')
    if (!organizerEmail) throw new Error('Organizer Email is required.')

    const inviteeList = Array.isArray(invitees) ? invitees : []
    if (!inviteeList.length) throw new Error('At least one invitee is required.')

    const body = { startTime, endTime, organizerEmail, invitees: inviteeList }
    if (title) body.title = title
    if (externalRef) body.externalId = externalRef

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/meetings/${ encodeURIComponent(meeting) }`,
      method: 'put',
      body,
      logTag: 'updateMeeting',
    })
  }

  // docs: https://github.com/matteeyah/gong-api/blob/main/README.md  (delete_meeting | DELETE | /v2/meetings/{meetingId})
  // N1: destructive; path+verb cited, no body. Default fixture mocks it; live runs need --destructive.
  /**
   * @operationName Delete Meeting
   * @category Meetings
   * @description Cancels/deletes an integration meeting in Gong by its ID. This removes the scheduled meeting created via Create Meeting; use with care.
   * @route POST /delete-meeting
   * @paramDef {"type":"String","label":"Meeting","name":"meeting","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The Gong meeting to delete/cancel — paste the Meeting ID returned by Create Meeting (there is no list-meetings endpoint to back a picker)."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-018"}
   */
  async deleteMeeting(meeting) {
    if (!meeting) throw new Error('Meeting is required — use the Meeting ID returned by Create Meeting.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/meetings/${ encodeURIComponent(meeting) }`,
      method: 'delete',
      logTag: 'deleteMeeting',
    })
  }

  /**
   * @operationName Get Meeting Integration Status
   * @category Meetings
   * @description Validates that the meetings integration is configured and returns its status. Use as a connectivity/health check before creating or updating meetings.
   * @route POST /get-meeting-integration-status
   * @returns {Object}
   * @sampleResult {"requestId":"req-027","integrationStatus":"ACTIVE"}
   */
  async getMeetingIntegrationStatus() {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/meetings/integration/status`,
      method: 'post',
      body: {},
      logTag: 'getMeetingIntegrationStatus',
    })
  }

  // ==========================================================================
  //  DATA PRIVACY (GDPR/CCPA)
  // ==========================================================================
  /**
   * @operationName Get Data for Email
   * @category Data Privacy
   * @description Finds all Gong data (calls, emails, references) associated with an email address. Use this to review what exists for a person before running an erasure for a GDPR/CCPA request.
   * @route POST /get-data-for-email
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Find all Gong data (calls, emails, references) associated with this email address. Use before erasing to review what will be removed."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-019","calls":[{"callId":"7782342274025937895"}],"emails":[],"customerEngagement":{}}
   */
  async getDataForEmail(emailAddress) {
    if (!emailAddress) throw new Error('Email Address is required.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/data-privacy/data-for-email-address`,
      method: 'get',
      query: { 'email_address': emailAddress },
      logTag: 'getDataForEmail',
    })
  }

  // docs: https://github.com/matteeyah/gong-api/blob/main/docs/DataPrivacyApi.md  (purge_email_address | POST | /v2/data-privacy/erase-data-for-email-address)
  // N1: DESTRUCTIVE/IRREVERSIBLE. The only input is the email_address query param (cited). Default fixture mocks it.
  /**
   * @operationName Erase Data for Email
   * @category Data Privacy
   * @description PERMANENTLY and irreversibly erases all Gong data associated with an email address (for GDPR/CCPA right-to-be-forgotten). Run Get Data for Email first to review the impact - this cannot be undone.
   * @route POST /erase-data-for-email
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"PERMANENTLY erase all Gong data associated with this email address. This is irreversible — review with Get Data for Email first."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-020"}
   */
  async eraseDataForEmail(emailAddress) {
    if (!emailAddress) throw new Error('Email Address is required.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/data-privacy/erase-data-for-email-address`,
      method: 'post',
      body: {},
      query: { 'email_address': emailAddress },
      logTag: 'eraseDataForEmail',
    })
  }

  /**
   * @operationName Get Data for Phone
   * @category Data Privacy
   * @description Finds all Gong data associated with a phone number. Use to review references for a person (by phone) before running an erasure for a GDPR/CCPA request.
   * @route POST /get-data-for-phone
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Find all Gong data associated with this phone number. Must start with '+' and include country/area code (e.g. +15551234567)."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-021","calls":[],"references":[]}
   */
  async getDataForPhone(phoneNumber) {
    if (!phoneNumber) throw new Error('Phone Number is required.')
    if (!String(phoneNumber).startsWith('+')) throw new Error('Phone Number must start with "+" and include the country/area code (e.g. +15551234567).')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/data-privacy/data-for-phone-number`,
      method: 'get',
      query: { 'phone_number': phoneNumber },
      logTag: 'getDataForPhone',
    })
  }

  // docs: https://github.com/matteeyah/gong-api/blob/main/docs/DataPrivacyApi.md  (purge_phone_number | POST | /v2/data-privacy/erase-data-for-phone-number)
  // N1: DESTRUCTIVE/IRREVERSIBLE. Only input is the phone_number query param (cited). Default fixture mocks it.
  /**
   * @operationName Erase Data for Phone
   * @category Data Privacy
   * @description PERMANENTLY and irreversibly erases all Gong data associated with a phone number (for GDPR/CCPA right-to-be-forgotten). Run Get Data for Phone first to review the impact - this cannot be undone.
   * @route POST /erase-data-for-phone
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"PERMANENTLY erase all Gong data associated with this phone number. Irreversible. Must start with '+' and include country/area code."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-022"}
   */
  async eraseDataForPhone(phoneNumber) {
    if (!phoneNumber) throw new Error('Phone Number is required.')
    if (!String(phoneNumber).startsWith('+')) throw new Error('Phone Number must start with "+" and include the country/area code (e.g. +15551234567).')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/data-privacy/erase-data-for-phone-number`,
      method: 'post',
      body: {},
      query: { 'phone_number': phoneNumber },
      logTag: 'eraseDataForPhone',
    })
  }

  // ==========================================================================
  //  LOGS
  // ==========================================================================
  /**
   * @operationName List Logs
   * @category Logs
   * @description Retrieves Gong audit/API logs of a given type within a time range (who did what, when). Use for auditing API usage and account activity. Gong does not publish a fixed list of log types, so enter the type string exactly.
   * @route POST /list-logs
   * @paramDef {"type":"String","label":"Log Type","name":"logType","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The category of logs to retrieve (e.g. an API or audit log type defined in your Gong account). Gong does not publish a fixed list, so enter the type string exactly."}
   * @paramDef {"type":"String","label":"From Date/Time","name":"fromDateTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the log range (ISO-8601)."}
   * @paramDef {"type":"String","label":"To Date/Time","name":"toDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the log range (ISO-8601). Optional — defaults to now."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from a previous response for the next page."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-023","records":{"totalRecords":1,"currentPageSize":1,"cursor":null},"logs":[{"userId":"234599484848423","userEmailAddress":"jane@acme.com","logRecord":"GET /v2/calls","logType":"API","logTime":"2025-01-12T17:05:00Z"}]}
   */
  async listLogs(logType, fromDateTime, toDateTime, cursor) {
    if (!logType) throw new Error('Log Type is required.')
    if (!fromDateTime) throw new Error('From Date/Time is required (ISO-8601).')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/logs`,
      method: 'get',
      query: { logType, fromDateTime, toDateTime, cursor },
      logTag: 'listLogs',
    })
  }

  // ==========================================================================
  //  PERMISSION PROFILES (secondary)
  // ==========================================================================
  /**
   * @operationName List Permission Profiles
   * @category Permission Profiles
   * @description Lists all permission profiles in a workspace (id, name, description). Use to discover the access profiles available before fetching one or its members.
   * @route POST /list-permission-profiles
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The workspace whose permission profiles you want."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-024","profiles":[{"id":"pp-1","name":"Sales Rep","description":"Standard rep access"},{"id":"pp-2","name":"Manager","description":"Team manager access"}]}
   */
  async listPermissionProfiles(workspaceId) {
    if (!workspaceId) throw new Error('Workspace is required — use List Workspaces to pick one.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/all-permission-profiles`,
      method: 'get',
      query: { workspaceId },
      logTag: 'listPermissionProfiles',
    })
  }

  /**
   * @operationName Get Permission Profile
   * @category Permission Profiles
   * @description Retrieves a single permission profile by ID, including its permission flags. Use after List Permission Profiles to inspect what a profile grants.
   * @route POST /get-permission-profile
   * @paramDef {"type":"String","label":"Permission Profile","name":"profileId","required":true,"dictionary":"getPermissionProfilesDictionary","dependsOn":["workspaceId"],"uiComponent":{"type":"DROPDOWN"},"description":"The permission profile to retrieve."}
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The workspace the profile belongs to (used to populate the Permission Profile picker)."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-025","profile":{"id":"pp-1","name":"Sales Rep","description":"Standard rep access","viewCalls":true,"manageLibrary":false}}
   */
  async getPermissionProfile(profileId, workspaceId) {
    if (!profileId) throw new Error('Permission Profile is required — use List Permission Profiles to pick one.')
    void workspaceId

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/permission-profile`,
      method: 'get',
      query: { profileId },
      logTag: 'getPermissionProfile',
    })
  }

  /**
   * @operationName List Permission Profile Users
   * @category Permission Profiles
   * @description Lists the users assigned to a permission profile, paged via a cursor. Use to audit who holds a given access profile.
   * @route POST /list-permission-profile-users
   * @paramDef {"type":"String","label":"Permission Profile","name":"profileId","required":true,"dictionary":"getPermissionProfilesDictionary","dependsOn":["workspaceId"],"uiComponent":{"type":"DROPDOWN"},"description":"The permission profile whose users you want to list."}
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The workspace the profile belongs to (used to populate the Permission Profile picker)."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from a previous response for the next page."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-026","records":{"totalRecords":1,"currentPageSize":1,"cursor":null},"users":[{"id":"234599484848423","emailAddress":"jane@acme.com","firstName":"Jane","lastName":"Doe"}]}
   */
  async listPermissionProfileUsers(profileId, workspaceId, cursor) {
    if (!profileId) throw new Error('Permission Profile is required — use List Permission Profiles to pick one.')
    void workspaceId

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/permission-profile/users`,
      method: 'get',
      query: { profileId, cursor },
      logTag: 'listPermissionProfileUsers',
    })
  }

  // ==========================================================================
  //  CRM DATA API - register a Generic CRM integration, then upload/read its
  //  objects and schema. Uploads and deletes are asynchronous; poll Get CRM
  //  Request Status with the same Client Request ID to confirm completion.
  // ==========================================================================
  // API: https://help.gong.io/apidocs/register-a-generic-crm-integration-v2crmintegrations-1 (PUT /v2/crm/integrations)
  // Gong's docs note the returned integrationId is a 64-bit integer and must be parsed as
  // Long/BigInt or it gets silently truncated. Flowrunner.Request parses JSON with standard JS
  // numbers (safe only up to 2^53-1), so an extremely large integrationId could lose precision
  // here; there is no workaround available at this layer.
  /**
   * @operationName Register CRM Integration
   * @category CRM
   * @description Registers a new Generic CRM integration in Gong and returns its Integration ID, which every other CRM Data API call needs to identify which CRM dataset to read or write. Gong allows only one active integration at a time - registering while one already exists returns a conflict.
   * @route POST /register-crm-integration
   * @paramDef {"type":"String","label":"Owner Email","name":"ownerEmail","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the person responsible for this CRM integration."}
   * @paramDef {"type":"String","label":"Integration Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name for the integration, e.g. your CRM system's name."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-030","integrationId":"555001234567890123"}
   */
  async registerCrmIntegration(ownerEmail, name) {
    if (!ownerEmail) throw new Error('Owner Email is required.')
    if (!name) throw new Error('Integration Name is required.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/crm/integrations`,
      method: 'put',
      body: { ownerEmail, name },
      logTag: 'registerCrmIntegration',
    })
  }

  /**
   * @operationName List CRM Integrations
   * @category CRM
   * @description Lists every Generic CRM integration registered on this Gong account, including each one's Integration ID, owner email, and name. Use to find the Integration ID needed by every other CRM Data API call, or to confirm none exists yet before Register CRM Integration.
   * @route POST /list-crm-integrations
   * @returns {Object}
   * @sampleResult {"requestId":"req-031","integrations":[{"integrationId":"555001234567890123","ownerEmail":"admin@acme.com","name":"Acme CRM Sync"}]}
   */
  async listCrmIntegrations() {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/crm/integrations`,
      method: 'get',
      logTag: 'listCrmIntegrations',
    })
  }

  // API: https://help.gong.io/apidocs/delete-a-generic-crm-integration-v2crmintegrations-1 (DELETE /v2/crm/integrations)
  // N1: DESTRUCTIVE - removes the integration and all of its uploaded CRM data. Runs asynchronously
  // (up to 24 hours); poll Get CRM Request Status with the same Client Request ID.
  /**
   * @operationName Delete CRM Integration
   * @category CRM
   * @description Permanently deletes a Generic CRM integration and all of its uploaded CRM data. This runs asynchronously and can take up to 24 hours - poll Get CRM Request Status with the same Client Request ID to track completion. This is irreversible.
   * @route POST /delete-crm-integration
   * @paramDef {"type":"String","label":"Integration","name":"integrationId","required":true,"dictionary":"getCrmIntegrationsDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The CRM integration to permanently delete."}
   * @paramDef {"type":"String","label":"Client Request ID","name":"clientRequestId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Your own unique identifier for this request (letters, numbers, dashes, underscores) - pass it to Get CRM Request Status to check progress."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-032","clientRequestId":"delete-2025-01-01"}
   */
  async deleteCrmIntegration(integrationId, clientRequestId) {
    if (!integrationId) throw new Error('Integration is required — use List CRM Integrations to pick one.')
    if (!clientRequestId) throw new Error('Client Request ID is required.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/crm/integrations`,
      method: 'delete',
      query: { integrationId, clientRequestId },
      logTag: 'deleteCrmIntegration',
    })
  }

  // API: https://help.gong.io/apidocs/upload-crm-objects-v2crmentities-1 (POST /v2/crm/entities)
  // Multipart LDJSON upload (max 200MB) - mirrors Upload Call Media's file-download-then-form-upload
  // pattern below.
  /**
   * @operationName Upload CRM Objects
   * @category CRM
   * @description Uploads CRM entity records (accounts, contacts, deals, leads, business users, or stages) to Gong from a newline-delimited JSON (LDJSON) file - one JSON object per line, all of the same Object Type. Processing is asynchronous; poll Get CRM Request Status with the same Client Request ID to confirm success.
   * @route POST /upload-crm-objects
   * @paramDef {"type":"String","label":"Integration","name":"integrationId","required":true,"dictionary":"getCrmIntegrationsDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The CRM integration to upload data into."}
   * @paramDef {"type":"String","label":"Object Type","name":"objectType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Account","Contact","Deal","Lead","Business User","Stage"]}},"description":"The type of CRM entity contained in the file. Every record in the file must be this same type."}
   * @paramDef {"type":"String","label":"Client Request ID","name":"clientRequestId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Your own unique identifier for this upload (letters, numbers, dashes, underscores) - pass it to Get CRM Request Status to check progress."}
   * @paramDef {"type":"String","label":"Data File","name":"dataFileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"An LDJSON file (max 200MB) with one CRM record per line, all matching the Object Type selected above."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-033","clientRequestId":"upload-2025-01-01"}
   */
  async uploadCrmObjects(integrationId, objectType, clientRequestId, dataFileUrl) {
    if (!integrationId) throw new Error('Integration is required — use List CRM Integrations to pick one.')
    if (!objectType) throw new Error('Object Type is required.')
    if (!clientRequestId) throw new Error('Client Request ID is required.')
    if (!dataFileUrl) throw new Error('Data File is required — select an LDJSON Flowrunner file.')

    const downloaded = await Flowrunner.Request.get(dataFileUrl).setEncoding(null)
    const buffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded)
    const filename = decodeURIComponent(String(dataFileUrl).split('/').pop().split('?')[0]) || 'crm-objects.ldjson'

    // Do NOT set Content-Type manually — the form supplies the multipart boundary.
    const formData = new Flowrunner.Request.FormData()
    formData.append('dataFile', buffer, { filename })

    try {
      return await Flowrunner.Request.post(`${ API_BASE_URL }/v2/crm/entities`)
        .query(this.#cleanQuery({ integrationId, objectType: this.#resolveChoice(objectType, CRM_UPLOAD_OBJECT_TYPE_MAP), clientRequestId }))
        .set({ Authorization: this.#headers().Authorization })
        .form(formData)
    } catch (error) {
      this.#handleError(error, 'uploadCrmObjects')
    }
  }

  // API: https://help.gong.io/apidocs/get-crm-objects-v2crmentities-1 (GET /v2/crm/entities)
  // Unusual but documented: a GET request that also carries a JSON body (the array of object IDs).
  /**
   * @operationName Get CRM Objects
   * @category CRM
   * @description Retrieves the field values Gong has stored for specific CRM objects, looked up by their CRM IDs, within one integration. Provide up to 100 object IDs per request; any IDs beyond 100 are ignored by Gong.
   * @route POST /get-crm-objects
   * @paramDef {"type":"String","label":"Integration","name":"integrationId","required":true,"dictionary":"getCrmIntegrationsDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The CRM integration to read data from."}
   * @paramDef {"type":"String","label":"Object Type","name":"objectType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Account","Contact","Deal","Lead"]}},"description":"The type of CRM entity to fetch."}
   * @paramDef {"type":"Array<String>","label":"Object IDs","name":"objectIds","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The CRM IDs of the objects to fetch (max 100 per request). Accepts a list or comma-separated IDs."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-034","crmObjectsMap":{"0061234567890ABC":{"Name":"Acme Corp","Industry":"Software"}}}
   */
  async getCrmObjects(integrationId, objectType, objectIds) {
    if (!integrationId) throw new Error('Integration is required — use List CRM Integrations to pick one.')
    if (!objectType) throw new Error('Object Type is required.')
    const ids = this.#toList(objectIds)
    if (!ids) throw new Error('At least one Object ID is required.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/crm/entities`,
      method: 'get',
      query: { integrationId, objectType: this.#resolveChoice(objectType, CRM_OBJECT_TYPE_MAP) },
      body: ids,
      logTag: 'getCrmObjects',
    })
  }

  // API: https://help.gong.io/apidocs/upload-object-schema-v2crmentity-schema-1 (POST /v2/crm/entity-schema)
  /**
   * @operationName Upload CRM Object Schema
   * @category CRM
   * @description Defines or updates which CRM fields Gong should track for an object type - add new fields, relabel existing ones, or mark a field deleted (which removes it from the schema and clears its value from every object). Run this before uploading objects that reference the new fields with Upload CRM Objects.
   * @route POST /upload-crm-object-schema
   * @paramDef {"type":"String","label":"Integration","name":"integrationId","required":true,"dictionary":"getCrmIntegrationsDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The CRM integration this schema belongs to."}
   * @paramDef {"type":"String","label":"Object Type","name":"objectType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Account","Contact","Deal","Lead"]}},"description":"The CRM entity type this schema applies to."}
   * @paramDef {"type":"Array<Object>","label":"Fields","name":"fields","required":true,"schemaLoader":"getCrmSchemaFieldSchema","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The fields to add, update, or delete. Each needs a Unique Name, a Label, and a Type; Reference fields also need Reference To, and Picklist fields need an Ordered Value List."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-035"}
   */
  async uploadCrmObjectSchema(integrationId, objectType, fields) {
    if (!integrationId) throw new Error('Integration is required — use List CRM Integrations to pick one.')
    if (!objectType) throw new Error('Object Type is required.')
    const fieldList = Array.isArray(fields) ? fields : []
    if (!fieldList.length) throw new Error('At least one field is required.')

    const body = fieldList.map(field => {
      const mapped = {
        uniqueName: field.uniqueName,
        label: field.label,
        type: this.#resolveChoice(field.type, CRM_FIELD_TYPE_MAP),
      }

      if (field.lastModified) mapped.lastModified = field.lastModified
      if (field.isDeleted) mapped.isDeleted = true
      if (field.referenceTo) mapped.referenceTo = this.#resolveChoice(field.referenceTo, CRM_REFERENCE_TYPE_MAP)
      const orderedValues = this.#toList(field.orderedValueList)
      if (orderedValues) mapped.orderedValueList = orderedValues

      return mapped
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/crm/entity-schema`,
      method: 'post',
      query: { integrationId, objectType: this.#resolveChoice(objectType, CRM_OBJECT_TYPE_MAP) },
      body,
      logTag: 'uploadCrmObjectSchema',
    })
  }

  // API: https://help.gong.io/apidocs/list-schema-fields-v2crmentity-schema-1 (GET /v2/crm/entity-schema)
  /**
   * @operationName List CRM Object Schema Fields
   * @category CRM
   * @description Lists the CRM fields Gong currently tracks for an integration, optionally filtered to one object type. Use to review a schema before uploading changes with Upload CRM Object Schema.
   * @route POST /list-crm-object-schema-fields
   * @paramDef {"type":"String","label":"Integration","name":"integrationId","required":true,"dictionary":"getCrmIntegrationsDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The CRM integration whose schema you want to inspect."}
   * @paramDef {"type":"String","label":"Object Type","name":"objectType","uiComponent":{"type":"DROPDOWN","options":{"values":["Account","Contact","Deal","Lead"]}},"description":"Limit to one CRM entity type. Leave empty to return every object type's fields."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-036","objectTypeToSelectedFields":{"ACCOUNT":[{"name":"Industry","label":"Industry","type":"STRING"}]}}
   */
  async listCrmObjectSchemaFields(integrationId, objectType) {
    if (!integrationId) throw new Error('Integration is required — use List CRM Integrations to pick one.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/crm/entity-schema`,
      method: 'get',
      query: { integrationId, objectType: this.#resolveChoice(objectType, CRM_OBJECT_TYPE_MAP) },
      logTag: 'listCrmObjectSchemaFields',
    })
  }

  // API: https://help.gong.io/apidocs/get-request-status-v2crmrequest-status (GET /v2/crm/request-status)
  /**
   * @operationName Get CRM Request Status
   * @category CRM
   * @description Checks the processing status of an asynchronous CRM Data API call (Upload CRM Objects, Upload CRM Object Schema, or Delete CRM Integration) by its Client Request ID. Returns PENDING, IN_PROGRESS, DONE, or FAILED, plus per-line error details when a bulk upload partially fails.
   * @route POST /get-crm-request-status
   * @paramDef {"type":"String","label":"Integration","name":"integrationId","required":true,"dictionary":"getCrmIntegrationsDictionary","uiComponent":{"type":"DROPDOWN"},"description":"The CRM integration the original request was made against."}
   * @paramDef {"type":"String","label":"Client Request ID","name":"clientRequestId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The Client Request ID you supplied to the original asynchronous call."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-037","status":"DONE","totalSuccessCount":120,"totalErrorCount":0}
   */
  async getCrmRequestStatus(integrationId, clientRequestId) {
    if (!integrationId) throw new Error('Integration is required — use List CRM Integrations to pick one.')
    if (!clientRequestId) throw new Error('Client Request ID is required.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/crm/request-status`,
      method: 'get',
      query: { integrationId, clientRequestId },
      logTag: 'getCrmRequestStatus',
    })
  }

  // ==========================================================================
  //  ENGAGE FLOWS API - list flows and manage which prospects are assigned to
  //  them. Gong's public API only supports the prospect -> flows lookup
  //  direction; there is no documented endpoint that lists every prospect
  //  currently assigned to a given flow (see Get Prospects' Assigned Flows).
  // ==========================================================================
  // API: https://help.gong.io/apidocs/list-gong-engage-flows-v2flows-1 (GET /v2/flows)
  /**
   * @operationName List Flows
   * @category Flows
   * @description Lists the Gong Engage flows visible to a user - their own flows, company flows, and flows shared with them (name, folder, visibility, creation date), paged via a cursor. Flows in deleted or inaccessible folders are omitted. Use to discover Flow IDs before assigning prospects.
   * @route POST /list-flows
   * @paramDef {"type":"String","label":"Flow Owner Email","name":"flowOwnerEmail","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the Gong user whose personal, company, and shared flows to return."}
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"Limit results to flows in one workspace. Leave empty for all workspaces."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Cursor from a previous response for the next page."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-040","records":{"totalRecords":1,"currentPageSize":1,"currentPageNumber":1,"cursor":null},"flows":[{"id":"1695493301223590792","name":"Cold Outreach - SMB","folderId":"folder-200","folderName":"Sales Flows","visibility":"Company","creationDate":"2024-11-01T09:00:00Z","exclusive":false}]}
   */
  async listFlows(flowOwnerEmail, workspaceId, cursor) {
    if (!flowOwnerEmail) throw new Error('Flow Owner Email is required.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/flows`,
      method: 'get',
      query: { flowOwnerEmail, workspaceId, cursor },
      logTag: 'listFlows',
    })
  }

  // API: https://help.gong.io/apidocs/assign-prospects-contacts-or-leads-to-an-engage-flow-v2flowsprospectsassign-1 (POST /v2/flows/prospects/assign)
  /**
   * @operationName Assign Prospects to Flow
   * @category Flows
   * @description Adds contacts or leads (by CRM ID) to a Gong Engage flow, creating a running flow instance for each. Assign up to 200 prospects per request; the response separates successfully assigned prospects from any that failed, with a reason for each failure.
   * @route POST /assign-prospects-to-flow
   * @paramDef {"type":"String","label":"Flow Owner Email","name":"flowOwnerEmail","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the Gong user who will own the resulting flow to-dos, and whose flows populate the Flow picker below."}
   * @paramDef {"type":"String","label":"Flow","name":"flowId","required":true,"dictionary":"getFlowsDictionary","dependsOn":["flowOwnerEmail"],"uiComponent":{"type":"DROPDOWN"},"description":"The Engage flow to assign prospects to."}
   * @paramDef {"type":"Array<String>","label":"CRM Prospect IDs","name":"crmProspectsIds","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"CRM IDs of the contacts or leads to assign (max 200 per request). Accepts a list or comma-separated IDs."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-041","prospectsAssigned":[{"flowId":"1695493301223590792","flowName":"Cold Outreach - SMB","crmProspectId":"a5V1Q00A120DP4CVAW","flowInstanceId":"inst-9001","flowInstanceOwnerEmail":"rep@acme.com","flowInstanceStatus":"Running","workspaceId":"623457289","exclusive":false}],"prospectsNotAssigned":[]}
   */
  async assignProspectsToFlow(flowOwnerEmail, flowId, crmProspectsIds) {
    if (!flowOwnerEmail) throw new Error('Flow Owner Email is required.')
    if (!flowId) throw new Error('Flow is required — use List Flows to pick one.')
    const ids = this.#toList(crmProspectsIds)
    if (!ids) throw new Error('At least one CRM Prospect ID is required.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/flows/prospects/assign`,
      method: 'post',
      body: { crmProspectsIds: ids, flowId, flowInstanceOwnerEmail: flowOwnerEmail },
      logTag: 'assignProspectsToFlow',
    })
  }

  // API: https://help.gong.io/apidocs/list-assigned-flows-for-the-given-prospects-v2flowsprospects-1 (POST /v2/flows/prospects)
  // NOTE: Gong's public Flows API only supports this prospect -> flows direction. There is no
  // documented endpoint to list every prospect currently in a given flow (the reverse lookup), so
  // this returns each prospect's own flow-instance assignments rather than a flow's full roster.
  /**
   * @operationName Get Prospects' Assigned Flows
   * @category Flows
   * @description Looks up which Gong Engage flow instances the given CRM prospects (contacts or leads) are currently assigned to, including flow name, instance owner, status, and workspace. Gong's API only supports this prospect-to-flows direction - there is no endpoint that lists every prospect assigned to a given flow.
   * @route POST /get-prospects-assigned-flows
   * @paramDef {"type":"Array<String>","label":"CRM Prospect IDs","name":"crmProspectsIds","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"CRM IDs of the contacts or leads to look up. Accepts a list or comma-separated IDs."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-042","prospectsAssigned":[{"flowId":"1695493301223590792","flowName":"Cold Outreach - SMB","crmProspectId":"a5V1Q00A120DP4CVAW","flowInstanceId":"inst-9001","flowInstanceOwnerEmail":"rep@acme.com","flowInstanceOwnerFullName":"Rep Name","flowInstanceCreateDate":"2025-01-01T09:00:00Z","flowInstanceStatus":"Running","workspaceId":"623457289","exclusive":false}]}
   */
  async getProspectsAssignedFlows(crmProspectsIds) {
    const ids = this.#toList(crmProspectsIds)
    if (!ids) throw new Error('At least one CRM Prospect ID is required.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/flows/prospects`,
      method: 'post',
      body: { crmProspectsIds: ids },
      logTag: 'getProspectsAssignedFlows',
    })
  }

  // API: https://help.gong.io/apidocs/unassign-flows-by-crm-prospect-id-v2flowsprospectsunassign-flows-by-crm-id-1 (POST /v2/flows/prospects/unassign-flows-by-crm-id)
  /**
   * @operationName Remove Prospect from Flow by CRM ID
   * @category Flows
   * @description Removes one CRM prospect (contact or lead) from a Gong Engage flow by their CRM ID. Leave Flow empty to remove the prospect from every flow they are currently assigned to; returns the flow instance IDs that were unassigned.
   * @route POST /remove-prospect-from-flow-by-crm-id
   * @paramDef {"type":"String","label":"CRM Prospect ID","name":"crmProspectId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"CRM ID of the prospect to unassign."}
   * @paramDef {"type":"String","label":"Flow","name":"flowId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Remove the prospect from only this flow (paste the Flow ID from List Flows). Leave empty to remove them from every flow they are assigned to."}
   * @paramDef {"type":"String","label":"Removed By Email","name":"unassignedByUserEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the Gong user requesting the removal, for auditing. Optional."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-043","unassignedFlowInstanceIds":["inst-9001"]}
   */
  async removeProspectFromFlowByCrmId(crmProspectId, flowId, unassignedByUserEmail) {
    if (!crmProspectId) throw new Error('CRM Prospect ID is required.')

    const body = { crmProspectId }
    if (flowId) body.flowId = flowId
    if (unassignedByUserEmail) body.unassignedByUserEmail = unassignedByUserEmail

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/flows/prospects/unassign-flows-by-crm-id`,
      method: 'post',
      body,
      logTag: 'removeProspectFromFlowByCrmId',
    })
  }

  // API: https://help.gong.io/apidocs/unassign-flows-by-flow-instance-id-v2flowsprospectsunassign-flows-by-instance-id-1 (POST /v2/flows/prospects/unassign-flows-by-instance-id)
  /**
   * @operationName Remove Prospects from Flow by Instance ID
   * @category Flows
   * @description Removes prospects from their Gong Engage flows using flow instance IDs (returned by Assign Prospects to Flow or Get Prospects' Assigned Flows). Accepts up to 100 flow instance IDs per request and returns which ones were successfully unassigned.
   * @route POST /remove-prospects-from-flow-by-instance-id
   * @paramDef {"type":"Array<String>","label":"Flow Instance IDs","name":"flowInstanceIds","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Flow instance IDs to unassign (max 100 per request). Accepts a list or comma-separated IDs."}
   * @paramDef {"type":"String","label":"Removed By Email","name":"unassignedByUserEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the Gong user requesting the removal, for auditing. Optional."}
   * @returns {Object}
   * @sampleResult {"requestId":"req-044","unassignedFlowInstanceIds":["inst-9001"]}
   */
  async removeProspectsFromFlowByInstanceId(flowInstanceIds, unassignedByUserEmail) {
    const ids = this.#toList(flowInstanceIds)
    if (!ids) throw new Error('At least one Flow Instance ID is required.')

    const body = { flowInstanceIds: ids }
    if (unassignedByUserEmail) body.unassignedByUserEmail = unassignedByUserEmail

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/flows/prospects/unassign-flows-by-instance-id`,
      method: 'post',
      body,
      logTag: 'removeProspectsFromFlowByInstanceId',
    })
  }

  // ==========================================================================
  //  DICTIONARIES - back every resource-pick (*Id) param with one of these
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Workspaces Dictionary
   * @description Provides a searchable list of Gong workspaces for dropdown selection.
   * @route POST /get-workspaces-dictionary
   * @paramDef {"type":"getWorkspacesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"North America","value":"623457289","note":"ID: 623457289"}],"cursor":null}
   */
  async getWorkspacesDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/v2/workspaces`, method: 'get', logTag: 'getWorkspacesDictionary' })
    const workspaces = (result && result.workspaces) || []
    const filtered = this.#filterByLabel(workspaces, search, w => w.name)

    return {
      items: filtered.map(w => ({ label: w.name, value: w.id, note: `ID: ${ w.id }` })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Calls Dictionary
   * @description Provides a searchable list of recent Gong calls (last 30 days) for dropdown selection.
   * @route POST /get-calls-dictionary
   * @paramDef {"type":"getCallsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme — Discovery","value":"7782342274025937895","note":"2025-01-12T17:02:00Z"}],"cursor":null}
   */
  async getCallsDictionary(payload) {
    const { search, cursor } = payload || {}
    const fromDateTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/calls`,
      method: 'get',
      query: { fromDateTime, cursor },
      logTag: 'getCallsDictionary',
    })
    const calls = (result && result.calls) || []
    const filtered = this.#filterByLabel(calls, search, c => c.title)

    return {
      items: filtered.map(c => ({ label: c.title || c.id, value: c.id, note: c.started || c.scheduled || '' })),
      cursor: (result && result.records && result.records.cursor) || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of Gong users for dropdown selection.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe <jane@acme.com>","value":"7782342274025","note":"jane@acme.com"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}
    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/users`,
      method: 'get',
      query: { cursor },
      logTag: 'getUsersDictionary',
    })
    const users = (result && result.users) || []
    const labelOf = u => `${ u.firstName || '' } ${ u.lastName || '' } <${ u.emailAddress || '' }>`.trim()
    const filtered = this.#filterByLabel(users, search, u => `${ labelOf(u) } ${ u.emailAddress || '' }`)

    return {
      items: filtered.map(u => ({ label: labelOf(u), value: u.id, note: u.emailAddress || '' })),
      cursor: (result && result.records && result.records.cursor) || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Library Folders Dictionary
   * @description Provides a searchable list of library folders for a workspace, for dropdown selection.
   * @route POST /get-library-folders-dictionary
   * @paramDef {"type":"getLibraryFoldersDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the workspace criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Best Discovery Calls","value":"folder-100","note":"ID: folder-100"}],"cursor":null}
   */
  async getLibraryFoldersDictionary(payload) {
    const { search, criteria } = payload || {}
    const workspaceId = criteria && criteria.workspaceId
    if (!workspaceId) return { items: [], cursor: null }

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/library/folders`,
      method: 'get',
      query: { workspaceId },
      logTag: 'getLibraryFoldersDictionary',
    })
    const folders = this.#flattenFolders((result && result.folders) || [])
    const filtered = this.#filterByLabel(folders, search, f => f.name)

    return {
      items: filtered.map(f => ({ label: f.name, value: f.id, note: `ID: ${ f.id }` })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Scorecards Dictionary
   * @description Provides a searchable list of Gong scorecards for dropdown selection.
   * @route POST /get-scorecards-dictionary
   * @paramDef {"type":"getScorecardsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Discovery Quality","value":"sc-100","note":"ID: sc-100"}],"cursor":null}
   */
  async getScorecardsDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/v2/settings/scorecards`, method: 'get', logTag: 'getScorecardsDictionary' })
    const scorecards = (result && result.scorecards) || []
    const filtered = this.#filterByLabel(scorecards, search, s => s.scorecardName)

    return {
      items: filtered.map(s => ({ label: s.scorecardName, value: s.scorecardId, note: `ID: ${ s.scorecardId }` })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Permission Profiles Dictionary
   * @description Provides a searchable list of permission profiles for a workspace, for dropdown selection.
   * @route POST /get-permission-profiles-dictionary
   * @paramDef {"type":"getPermissionProfilesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the workspace criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Rep","value":"pp-1","note":"ID: pp-1"}],"cursor":null}
   */
  async getPermissionProfilesDictionary(payload) {
    const { search, criteria } = payload || {}
    const workspaceId = criteria && criteria.workspaceId
    if (!workspaceId) return { items: [], cursor: null }

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/all-permission-profiles`,
      method: 'get',
      query: { workspaceId },
      logTag: 'getPermissionProfilesDictionary',
    })
    const profiles = (result && result.profiles) || []
    const filtered = this.#filterByLabel(profiles, search, p => p.name)

    return {
      items: filtered.map(p => ({ label: p.name, value: p.id, note: `ID: ${ p.id }` })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get CRM Integrations Dictionary
   * @description Provides a searchable list of registered Generic CRM integrations for dropdown selection.
   * @route POST /get-crm-integrations-dictionary
   * @paramDef {"type":"getCrmIntegrationsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme CRM Sync","value":"555001234567890123","note":"admin@acme.com"}],"cursor":null}
   */
  async getCrmIntegrationsDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/v2/crm/integrations`, method: 'get', logTag: 'getCrmIntegrationsDictionary' })
    const integrations = (result && result.integrations) || []
    const filtered = this.#filterByLabel(integrations, search, i => i.name)

    return {
      items: filtered.map(i => ({ label: i.name, value: String(i.integrationId), note: i.ownerEmail || '' })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Flows Dictionary
   * @description Provides a searchable list of Gong Engage flows visible to the given Flow Owner Email, for dropdown selection.
   * @route POST /get-flows-dictionary
   * @paramDef {"type":"getFlowsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the flow owner email criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Cold Outreach - SMB","value":"1695493301223590792","note":"Company"}],"cursor":null}
   */
  async getFlowsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const flowOwnerEmail = criteria && criteria.flowOwnerEmail
    if (!flowOwnerEmail) return { items: [], cursor: null }

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/flows`,
      method: 'get',
      query: { flowOwnerEmail, cursor },
      logTag: 'getFlowsDictionary',
    })
    const flows = (result && result.flows) || []
    const filtered = this.#filterByLabel(flows, search, f => f.name)

    return {
      items: filtered.map(f => ({ label: f.name, value: f.id, note: f.visibility || '' })),
      cursor: (result && result.records && result.records.cursor) || null,
    }
  }

  // Local label filter for dictionaries whose source endpoint has no server-side search.
  #filterByLabel(items, search, labelFn) {
    if (!search) return items
    const needle = String(search).toLowerCase()

    return items.filter(item => String(labelFn(item) || '').toLowerCase().includes(needle))
  }

  // Flatten the nested library folder hierarchy into a single pickable list.
  #flattenFolders(folders, out = []) {
    folders.forEach(folder => {
      out.push(folder)
      if (Array.isArray(folder.folders)) this.#flattenFolders(folder.folders, out)
    })

    return out
  }

  // ==========================================================================
  //  PARAM SCHEMA LOADERS - render sub-forms for Array.<Object> params
  // ==========================================================================
  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @operationName Get Parties Schema
   * @description Field schema for a single Add Call party (internal user OR external person).
   * @route POST /get-parties-schema
   * @returns {Object}
   */
  async getPartiesSchema() {
    return [
      { type: 'String', label: 'User', name: 'userId', required: false, dictionary: 'getUsersDictionary', uiComponent: { type: 'DROPDOWN' }, description: 'For an internal participant: the Gong user. Leave empty for an external person.' },
      { type: 'String', label: 'Name', name: 'name', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'For an external participant: their display name.' },
      { type: 'String', label: 'Email Address', name: 'emailAddress', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'For an external participant: their email address.' },
      { type: 'String', label: 'Phone Number', name: 'phoneNumber', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'For an external participant: their phone number.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @operationName Get Invitees Schema
   * @description Field schema for a single meeting invitee (email + display name).
   * @route POST /get-invitees-schema
   * @returns {Object}
   */
  async getInviteesSchema() {
    return [
      { type: 'String', label: 'Email Address', name: 'emailAddress', required: true, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The invitee\'s email address.' },
      { type: 'String', label: 'Display Name', name: 'displayName', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The invitee\'s display name.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @operationName Get CRM Schema Field Schema
   * @description Field schema for a single CRM object schema field definition (Upload CRM Object Schema).
   * @route POST /get-crm-schema-field-schema
   * @returns {Object}
   */
  async getCrmSchemaFieldSchema() {
    return [
      { type: 'String', label: 'Unique Name', name: 'uniqueName', required: true, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The field\'s unique name in the source CRM system.' },
      { type: 'String', label: 'Label', name: 'label', required: true, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The label to show for this field in Gong\'s UI.' },
      { type: 'String', label: 'Type', name: 'type', required: true, uiComponent: { type: 'DROPDOWN', options: { values: ['Date', 'Date/Time', 'Number', 'Percent', 'Currency', 'ID', 'URL', 'String', 'Boolean', 'Phone Number', 'Email Address', 'Picklist', 'Reference', 'String Array'] } }, description: 'The field\'s data type.' },
      { type: 'String', label: 'Reference To', name: 'referenceTo', required: false, uiComponent: { type: 'DROPDOWN', options: { values: ['Account', 'Contact', 'Deal', 'Lead', 'User'] } }, description: 'Required when Type is Reference: the CRM object this field points to.' },
      { type: 'Array<String>', label: 'Ordered Value List', name: 'orderedValueList', required: false, description: 'Required when Type is Picklist: the field\'s allowed values, in display order.' },
      { type: 'Boolean', label: 'Deleted', name: 'isDeleted', required: false, uiComponent: { type: 'TOGGLE' }, description: 'Set to remove this field from the schema and clear its value from every object.' },
      { type: 'String', label: 'Last Modified', name: 'lastModified', required: false, uiComponent: { type: 'DATE_TIME_PICKER' }, description: 'ISO-8601 timestamp (no milliseconds) this field was last modified in the source CRM.' },
    ]
  }

  // ==========================================================================
  //  TRIGGERS (polling) - "New Call"
  // ==========================================================================
  /**
   * @registerAs POLLING_TRIGGER
   * @operationName On New Call
   * @category Triggers
   * @description Fires when a new call becomes available in Gong. Polling interval can be customized (minimum 30 seconds). Optionally scope to a single workspace.
   * @route POST /on-new-call
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","uiComponent":{"type":"DROPDOWN"},"description":"Only fire for calls in this workspace. Leave empty for all workspaces."}
   * @returns {Object}
   * @sampleResult {"id":"7782342274025937895","url":"https://app.gong.io/call?id=7782342274025937895","title":"Acme — Discovery","started":"2025-01-12T17:02:00Z","duration":1820,"primaryUserId":"234599484848423","direction":"Inbound","workspaceId":"623457289"}
   */
  async onNewCall(invocation) {
    const triggerData = (invocation && invocation.triggerData) || {}
    const workspaceId = triggerData.workspaceId
    const now = new Date()
    const state = (invocation && invocation.state) || null

    // Poll with a small lookback so calls that finish processing late (and only become
    // queryable after the watermark advanced) still land in the window; the seen-ID set
    // dedupes the overlap so nothing is re-emitted. Restart pagination each cycle from this
    // window (cursors are time-limited; never cache a cursor across runs).
    const fromDateTime = state && state.lastFromDateTime
      ? new Date(new Date(state.lastFromDateTime).getTime() - GongPolling.OVERLAP_MS).toISOString()
      : new Date(now.getTime() - 60 * 60 * 1000).toISOString()
    const toDateTime = now.toISOString()

    const calls = await this.#fetchAllCalls(fromDateTime, toDateTime, workspaceId)

    return GongPolling.diff(calls, state, toDateTime)
  }

  // Page through every GET /v2/calls cursor page for one polling window.
  async #fetchAllCalls(fromDateTime, toDateTime, workspaceId) {
    const all = []
    let cursor

    do {
      const result = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/calls`,
        method: 'get',
        query: { fromDateTime, toDateTime, workspaceId, cursor },
        logTag: 'onNewCall',
      })
      const calls = (result && result.calls) || []
      all.push(...calls)
      cursor = result && result.records && result.records.cursor
    } while (cursor)

    return all
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

Flowrunner.ServerCode.addService(Gong, [
  {
    name: 'accessKey',
    displayName: 'Access Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Gong Access Key (Basic-auth username). A Technical Admin mints it in Company Settings → Ecosystem → API.',
  },
  {
    name: 'accessKeySecret',
    displayName: 'Access Key Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Gong Access Key Secret (Basic-auth password), issued alongside the Access Key.',
  },
])

// Expose the pure polling-diff helper for unit tests (no effect under CodeRunner).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Gong, GongPolling }
}
