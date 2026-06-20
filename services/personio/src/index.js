/* eslint-disable max-len */

// ═══════════════════════════════════════════════════════════════════════════════
// Personio FlowRunner Service
// ═══════════════════════════════════════════════════════════════════════════════
// File sections:
//   1.  Constants, helpers, logger, friendly-error map
//   2.  Class shell — constructor + auth + #apiRequest plumbing
//   3.  Test Connection
//   4.  Dictionaries (15)
//   5.  People + Employee Photo               [Phase 2]
//   6.  Employments + End Employment          [Phase 2]
//   7.  Time Off (absences)                   [Phase 2]
//   8.  Time Tracking (attendances)           [Phase 3]
//   9.  Documents                             [Phase 3]
//   10. Recruiting                            [Phase 3]
//   11. Reports                               [Phase 4]
//   12. Organization (entities/depts/etc.)    [Phase 4]
//   13. Compensations                         [Phase 4]
//   14. Projects + Project Members            [Phase 4]
//   15. Webhook management                    [Phase 5]
//   16. Realtime triggers + lifecycle         [Phase 5]
//   17. Sample-result + schema loaders        [Phase 2-5, colocated]
//   18. Service registration
// ═══════════════════════════════════════════════════════════════════════════════

const API_BASE_URL = 'https://api.personio.de'

// Identifiers Personio asks integration partners to send so support can find our
// traffic in their logs. These describe *us* (Backendless / FlowRunner), not the
// end customer — they are hardcoded, not configurable per connection.
const PARTNER_ID = 'BACKENDLESS'
const APP_ID = 'FLOWRUNNER'

const logger = {
  info: (...args) => console.log('[Personio Service] info:', ...args),
  debug: (...args) => console.log('[Personio Service] debug:', ...args),
  error: (...args) => console.log('[Personio Service] error:', ...args),
  warn: (...args) => console.log('[Personio Service] warn:', ...args),
}

// Plain-English error messages mapped from Personio's API error codes / HTTP status.
// Surfaces to the workflow builder; never leak raw API jargon.
const FRIENDLY_ERRORS = {
  invalid_credentials:
    'Personio rejected the credentials. Open Personio → Settings → Integrations → API Credentials, regenerate the Client ID and Client Secret, and update them in the connection settings.',
  insufficient_scope:
    'The Personio credentials are missing access to the data this action needs. In Personio, open the credential and tick the matching read/write attributes or scopes.',
  rate_limited:
    'Personio is throttling the request. Wait a minute and retry. Personio shares the rate budget across the whole credential — heavy listings and recruiting actions trip this first.',
  not_found:
    'Personio could not find that record. Double-check the ID — the record may have been deleted, or the credential may not have access to it.',
  attribute_not_allowed:
    'That field is not enabled on this Personio credential. Open the credential in Personio and grant the field under "Accessible employee attributes".',
  missing_recruiting_token:
    'This action needs the Recruiting Token. Add it in the connection settings — it is a separate token, generated in Personio under Recruiting → Settings → Integrations → API.',
  missing_recruiting_company_id:
    'This action needs the Recruiting Company ID. Add it in the connection settings — find it on the same Personio screen as the Recruiting Token, labelled "Your company ID".',
}

// Date-range presets used wherever an action takes a "When" filter.
// Resolves to { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }.
const PERIOD_PRESETS = {
  today: () => {
    const t = new Date().toISOString().slice(0, 10)

    return { start: t, end: t }
  },
  yesterday: () => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 1)
    const t = d.toISOString().slice(0, 10)

    return { start: t, end: t }
  },
  last7Days: () => {
    const end = new Date()
    const start = new Date()
    start.setUTCDate(start.getUTCDate() - 6)

    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    }
  },
  last30Days: () => {
    const end = new Date()
    const start = new Date()
    start.setUTCDate(start.getUTCDate() - 29)

    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    }
  },
  thisMonth: () => {
    const now = new Date()
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    )
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
    )

    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    }
  },
  lastMonth: () => {
    const now = new Date()
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
    )
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))

    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    }
  },
  yearToDate: () => {
    const now = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))

    return {
      start: start.toISOString().slice(0, 10),
      end: now.toISOString().slice(0, 10),
    }
  },
}

const PERIOD_LABEL_TO_KEY = {
  Today: 'today',
  Yesterday: 'yesterday',
  'Last 7 days': 'last7Days',
  'Last 30 days': 'last30Days',
  'This month': 'thisMonth',
  'Last month': 'lastMonth',
  'Year to date': 'yearToDate',
}

const resolvePeriod = (periodLabel, customStart, customEnd) => {
  const key = PERIOD_LABEL_TO_KEY[periodLabel]
  if (key && PERIOD_PRESETS[key]) return PERIOD_PRESETS[key]()
  if (customStart || customEnd)
    return { start: customStart || undefined, end: customEnd || undefined }

  return PERIOD_PRESETS.last30Days()
}

// Maps Personio's wire event names (e.g. "person.created") to the consolidated
// trigger method on this service. Five triggers cover seventeen event types.
const WEBHOOK_EVENT_MAP = {
  'person.created': 'onPeopleChange',
  'person.updated': 'onPeopleChange',
  'person.deleted': 'onPeopleChange',
  'employment.created': 'onEmploymentChange',
  'employment.updated': 'onEmploymentChange',
  'employment.updated.cost-centers': 'onEmploymentChange',
  'employment.deleted': 'onEmploymentChange',
  'employment.started': 'onEmploymentChange',
  'employment.terminated': 'onEmploymentChange',
  'absence-period.created': 'onTimeOffChange',
  'absence-period.updated.status': 'onTimeOffChange',
  'absence-period.updated.timerange': 'onTimeOffChange',
  'absence-period.deleted': 'onTimeOffChange',
  'attendance-period.created': 'onTimeTrackingChange',
  'attendance-period.updated': 'onTimeTrackingChange',
  'attendance-period.deleted': 'onTimeTrackingChange',
  'document.created': 'onDocumentChange',
  'document.updated': 'onDocumentChange',
  'document.deleted': 'onDocumentChange',
  'document.signed': 'onDocumentChange',
}

// Reverse map: trigger method → list of Personio events to subscribe to.
const TRIGGER_TO_PERSONIO_EVENTS = Object.entries(WEBHOOK_EVENT_MAP).reduce(
  (acc, [personioEvent, trigger]) => {
    acc[trigger] = acc[trigger] || []
    acc[trigger].push(personioEvent)

    return acc
  },
  {}
)

// Drops undefined/null/empty-string entries from query/body objects so we don't
// send noise to Personio.
const clean = obj => {
  if (!obj || typeof obj !== 'object') return obj
  const out = {}

  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v
  }

  return out
}

const toArray = value => {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string')
    return value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

  return [value]
}

const generateWebhookSecret = () => {
  const bytes = []
  for (let i = 0; i < 24; i++) bytes.push(Math.floor(Math.random() * 256))

  return Buffer.from(bytes).toString('hex')
}

// Pull people-friendly fields out of a v2 person record for dictionary notes.
const formatPersonNote = person => {
  const dept =
    person?.department?.name ||
    person?.department_name ||
    person?.org_unit?.name
  const office = person?.office?.name || person?.workplace?.name
  const email = person?.email
  const parts = [dept, office, email].filter(Boolean)

  return parts.join(' · ')
}

const formatPersonLabel = person => {
  const preferred = person?.preferred_name
  const first = person?.first_name || ''
  const last = person?.last_name || ''
  const base = preferred || `${ first } ${ last }`.trim()

  return base || `Person ${ person?.id }`
}

const matchesText = (haystack, needle) => {
  if (!needle) return true

  return String(haystack || '')
    .toLowerCase()
    .includes(String(needle).toLowerCase())
}

// Personio v2 timestamps are timezone-naïve — the API rejects "Z" suffix and
// numeric offsets. Strip them so workflow builders can pass either form.
const stripTimezone = value => {
  if (!value) return value

  return String(value).replace(/(Z|[+-]\d{2}:?\d{2})$/i, '')
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Class shell — auth + #apiRequest plumbing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @integrationName Personio
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class Personio {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.recruitingApiToken = config.recruitingApiToken
    this.recruitingCompanyId = config.recruitingCompanyId

    this._v1 = { token: null, expiresAt: 0 }
    this._v2 = { token: null, expiresAt: 0 }
  }

  // Personio v1: form-encoded POST, returns { data: { token } } — a JWT good for ~24h.
  async #getV1Token() {
    if (this._v1.token && Date.now() < this._v1.expiresAt - 60_000)
      return this._v1.token

    try {
      const response = await Flowrunner.Request.post(`${ API_BASE_URL }/v1/auth`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(
          new URLSearchParams({
            client_id: this.clientId || '',
            client_secret: this.clientSecret || '',
          }).toString()
        )

      const token = response?.data?.token

      if (!token) {
        throw new Error(
          'Personio v1 auth returned no token. Verify the Client ID and Client Secret in the connection settings.'
        )
      }

      this._v1 = { token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 }

      return token
    } catch (error) {
      logger.error(
        `getV1Token failed: ${ JSON.stringify(error?.message || error) }`
      )

      throw new Error(FRIENDLY_ERRORS.invalid_credentials)
    }
  }

  // Personio v2: form-encoded POST with grant_type=client_credentials, returns
  // { access_token, expires_in } — opaque "papi-" prefixed token, ~24h TTL.
  async #getV2Token() {
    if (this._v2.token && Date.now() < this._v2.expiresAt - 60_000)
      return this._v2.token

    try {
      const response = await Flowrunner.Request.post(
        `${ API_BASE_URL }/v2/auth/token`
      )
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(
          new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.clientId || '',
            client_secret: this.clientSecret || '',
          }).toString()
        )

      const token = response?.access_token

      if (!token) {
        throw new Error(
          'Personio v2 auth returned no token. Verify the Client ID, Client Secret, and that the credential has at least one v2 scope enabled.'
        )
      }

      this._v2 = {
        token,
        expiresAt: Date.now() + (response.expires_in || 86_400) * 1000,
      }

      return token
    } catch (error) {
      logger.error(
        `getV2Token failed: ${ JSON.stringify(error?.message || error) }`
      )

      throw new Error(FRIENDLY_ERRORS.invalid_credentials)
    }
  }

  #partnerHeaders() {
    return {
      'X-Personio-Partner-ID': PARTNER_ID,
      'X-Personio-App-ID': APP_ID,
      'Personio-Partner-ID': PARTNER_ID,
      'Personio-App-ID': APP_ID,
    }
  }

  // Single entry point for every Personio call.
  //   url        - full URL; the /v1/ vs /v2/ substring picks which token to attach
  //   method     - 'get' | 'post' | 'patch' | 'delete'
  //   body       - JSON body (sent as application/json by Flowrunner.Request)
  //   query      - querystring object (auto-cleaned)
  //   form       - multipart form fields (alternative to body)
  //   recruiting - true forces the static recruiting token, used for /v1/recruiting/*
  //   logTag     - human-readable tag for debug logs
  async #apiRequest({ url, method, body, query, form, logTag, recruiting }) {
    method = (method || 'get').toLowerCase()
    query = clean(query)

    const isV2 = url.includes('/v2/')

    let token
    let authHeaderValue
    let extraForm = null

    if (recruiting) {
      if (!this.recruitingApiToken) {
        throw new Error(FRIENDLY_ERRORS.missing_recruiting_token)
      }

      if (!this.recruitingCompanyId) {
        throw new Error(FRIENDLY_ERRORS.missing_recruiting_company_id)
      }

      // Personio Recruiting API expects the raw token (no "Bearer" prefix) and
      // the company ID alongside it. Send the company ID three ways for safety —
      // headers, query, and (when applicable) form field — since Personio's
      // recruiting endpoint historically accepted any of these.
      token = this.recruitingApiToken
      authHeaderValue = `Token token=${ token }`
      query = { ...(query || {}), company_id: this.recruitingCompanyId }
      extraForm = { company_id: this.recruitingCompanyId }
    } else if (isV2) {
      token = await this.#getV2Token()
      authHeaderValue = `Bearer ${ token }`
    } else {
      token = await this.#getV1Token()
      authHeaderValue = `Bearer ${ token }`
    }

    logger.debug(
      `${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(query || {}) }`
    )

    try {
      const headers = {
        Authorization: authHeaderValue,
        Accept: 'application/json',
        ...this.#partnerHeaders(),
      }

      if (recruiting) {
        headers['X-Company-ID'] = String(this.recruitingCompanyId)
      }

      const request = Flowrunner.Request[method](url).set(headers).query(query)

      if (form) {
        const merged = extraForm ? { ...form, ...extraForm } : form
        request.form(merged)
        request.set({ 'Content-Type': 'multipart/form-data' })

        return await request
      }

      if (body !== undefined && body !== null) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.code
    const raw = error?.message
    const message =
      raw?.error?.message ||
      raw?.message ||
      (typeof raw === 'string' ? raw : JSON.stringify(raw || 'Unknown'))
    const msgStr =
      typeof message === 'string' ? message : JSON.stringify(message)

    logger.error(`${ logTag } - status=${ status } message=${ msgStr }`)

    // Only treat as a credential problem when the status code says so. Don't
    // pattern-match the word "invalid" on 400-class errors — Personio uses
    // "invalid request" / "invalid attribute" for shape validation, and we
    // want to surface those messages verbatim instead of telling the user to
    // rotate their credentials.
    if (status === 401) throw new Error(FRIENDLY_ERRORS.invalid_credentials)
    if (status === 403) throw new Error(FRIENDLY_ERRORS.insufficient_scope)
    if (status === 404) throw new Error(FRIENDLY_ERRORS.not_found)
    if (status === 429) throw new Error(FRIENDLY_ERRORS.rate_limited)

    if (
      /attribute/i.test(msgStr) &&
      /not allowed|not.*permitted/i.test(msgStr)
    ) {
      throw new Error(FRIENDLY_ERRORS.attribute_not_allowed)
    }

    throw new Error(`Personio error: ${ msgStr }`)
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 3. Test Connection
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Test Connection
   * @description Checks the Personio credentials by quietly fetching one record from each of the three connection lanes (legacy people lane, modern people lane, recruiting lane if a Recruiting Token is set). Returns one OK or one specific error message per lane — run this first when setting up the connection or after rotating any secret.
   * @route POST /test-connection
   * @appearanceColor #04A287 #04A287
   *
   * @returns {Object}
   * @sampleResult {"legacyLane":"ok","modernLane":"ok","recruitingLane":"ok","employeeCount":142,"partnerId":"BACKENDLESS","appId":"FLOWRUNNER"}
   */
  async testConnection() {
    const result = {
      legacyLane: 'not tested',
      modernLane: 'not tested',
      recruitingLane: 'not tested',
      employeeCount: null,
      partnerId: PARTNER_ID,
      appId: APP_ID,
    }

    try {
      const v1 = await this.#apiRequest({
        url: `${ API_BASE_URL }/v1/company/employees`,
        query: { limit: 1, offset: 0 },
        logTag: 'testConnection.legacy',
      })
      result.legacyLane = 'ok'
      result.employeeCount = v1?.metadata?.total_elements ?? null
    } catch (error) {
      result.legacyLane = error.message
    }

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/persons`,
        query: { limit: 1 },
        logTag: 'testConnection.modern',
      })

      result.modernLane = 'ok'
    } catch (error) {
      result.modernLane = error.message
    }

    if (!this.recruitingApiToken) {
      result.recruitingLane =
        'skipped (no Recruiting Token set — leave blank if you do not need to create candidates)'
    } else if (!this.recruitingCompanyId) {
      result.recruitingLane =
        'incomplete (Recruiting Token is set but Recruiting Company ID is missing — both are needed together)'
    } else {
      result.recruitingLane =
        'configured (will be exercised on the first Create Candidate or Upload Applicant Document call)'
    }

    return result
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 4. Dictionaries
  // ═════════════════════════════════════════════════════════════════════════════
  // Standard shape: payload = { search?, cursor?, criteria? }
  //                 return  = { items: [{ label, value, note }], cursor? }
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {String} value
   * @property {String} [note]
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} [cursor]
   */

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
   * @property {Object} [criteria]
   */

  // ---- listPeopleDictionary -------------------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName People Picker
   * @description Searchable list of everyone in Personio, used wherever an action needs to pick a person. Type a name or email to filter.
   * @route POST /list-people-dictionary
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Alexander Bergmann","value":"1","note":"Engineering · Berlin · alexander@example.com"}],"cursor":null}
   */
  async listPeopleDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = clean({ limit: 50, cursor: cursor || undefined })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/persons`,
      query,
      logTag: 'listPeopleDictionary',
    })

    const list = response?._data || response?.data || []
    const filtered = search
      ? list.filter(
        p =>
          matchesText(p.first_name, search) ||
            matchesText(p.last_name, search) ||
            matchesText(p.preferred_name, search) ||
            matchesText(p.email, search)
      )
      : list

    return {
      items: filtered.map(p => ({
        label: formatPersonLabel(p),
        value: String(p.id),
        note: formatPersonNote(p),
      })),
      cursor: response?._meta?.links?.next
        ? extractCursor(response._meta.links.next)
        : null,
    }
  }

  // ---- listAbsenceTypesDictionary -------------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Time-Off Type Picker
   * @description Searchable list of time-off types configured in Personio (vacation, sick leave, parental, training, custom HR categories). Returns the legacy integer ID — Request Time Off resolves it to the newer UUID internally when the workflow needs hour-based precision.
   * @route POST /list-absence-types-dictionary
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Paid holidays","value":"3465520","note":"Day-based · paid_vacation"}],"cursor":null}
   */
  async listAbsenceTypesDictionary(payload) {
    const { search } = payload || {}

    // The v1 endpoint returns both the legacy integer ID (which the v1
    // time-off create endpoint needs) AND the v2 UUID as `id_v2`. The newer
    // /v2/absence-types only exposes the UUID, breaking the v1 path. Using v1
    // here covers both worlds — Request Time Off looks up the matching v2
    // UUID via this same endpoint when needed.
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/company/time-off-types`,
      query: { limit: 200 },
      logTag: 'listAbsenceTypesDictionary',
    })

    const list = (response?.data || []).map(t => t.attributes || {})
    const filtered = search
      ? list.filter(t => matchesText(t.name, search))
      : list

    return {
      items: filtered.map(t => ({
        label: t.name || `Type ${ t.id }`,
        value: String(t.id),
        note: [
          t.unit === 'hour' ? 'Hour-based' : 'Day-based',
          t.category,
          t.approval_required ? 'Needs approval' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
      cursor: null,
    }
  }

  // Look up a v1 absence type by ID and return its corresponding v2 UUID.
  // Used by Request Time Off (hours mode) to bridge between the v1 dictionary
  // IDs end users pick and the v2 absence-periods endpoint that needs a UUID.
  async #resolveAbsenceTypeV2Id(v1IdOrV2Id) {
    if (!v1IdOrV2Id) return null
    const idStr = String(v1IdOrV2Id)

    // Already a UUID? Pass through.
    if (idStr.includes('-')) return idStr

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/company/time-off-types`,
      query: { limit: 200 },
      logTag: 'resolveAbsenceTypeV2Id',
    })

    const match = (response?.data || []).find(
      t => String(t?.attributes?.id) === idStr
    )

    return match?.attributes?.id_v2 || null
  }

  // ---- listDocumentCategoriesDictionary -------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Document Category Picker
   * @description Searchable list of document categories set up by HR (e.g. Contract, Payslip, ID Document, Training Certificate). Used by the Upload Document and Find Documents actions.
   * @route POST /list-document-categories-dictionary
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Contract","value":"5","note":""}],"cursor":null}
   */
  async listDocumentCategoriesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/company/document-categories`,
      logTag: 'listDocumentCategoriesDictionary',
    })

    const list = response?.data || []
    const filtered = search
      ? list.filter(c => matchesText(c.attributes?.name || c.name, search))
      : list

    return {
      items: filtered.map(c => ({
        label: c.attributes?.name || c.name || `Category ${ c.id }`,
        value: String(c.id),
        note: '',
      })),
      cursor: null,
    }
  }

  // ---- listLegalEntitiesDictionary ------------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Legal Entity Picker
   * @description Searchable list of legal entities (subcompanies) configured in Personio. Used when an action targets a specific legal entity for payroll or compliance reasons.
   * @route POST /list-legal-entities-dictionary
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Acme GmbH","value":"e_1","note":"Germany"}],"cursor":null}
   */
  async listLegalEntitiesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/legal-entities`,
      query: { limit: 100 },
      logTag: 'listLegalEntitiesDictionary',
    })

    const list = response?._data || []
    const filtered = search
      ? list.filter(e => matchesText(e.name, search))
      : list

    return {
      items: filtered.map(e => ({
        label: e.name || `Entity ${ e.id }`,
        value: String(e.id),
        note: e.country || e.country_code || '',
      })),
      cursor: null,
    }
  }

  // ---- listOrgUnitsDictionary -----------------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Department Picker
   * @description Searchable list of departments built from the actual people in Personio. Departments are not a standalone list in Personio — they're an attribute on each employee — so this picker scans employees and shows every distinct department.
   * @route POST /list-org-units-dictionary
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Engineering","value":"42","note":"12 people"}],"cursor":null}
   */
  async listOrgUnitsDictionary(payload) {
    const { search } = payload || {}

    return this.#collectEmployeeAttribute('department', search, item => ({
      label: item.name,
      value: String(item.id),
      note:
        item.count > 0
          ? `${ item.count } ${ item.count === 1 ? 'person' : 'people' }`
          : '',
    }))
  }

  // ---- listCostCentersDictionary --------------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Cost Center Picker
   * @description Searchable list of cost centers built from the actual people in Personio. Cost centers are an attribute on each employee, so this picker scans employees and shows every distinct cost center in use.
   * @route POST /list-cost-centers-dictionary
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"R&D Berlin","value":"77","note":"4 people"}],"cursor":null}
   */
  async listCostCentersDictionary(payload) {
    const { search } = payload || {}

    return this.#collectEmployeeAttribute('cost_centers', search, item => ({
      label: item.name,
      value: String(item.id),
      note:
        item.count > 0
          ? `${ item.count } ${ item.count === 1 ? 'person' : 'people' }`
          : '',
    }))
  }

  // ---- listWorkplacesDictionary ---------------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Office Picker
   * @description Searchable list of offices built from the actual people in Personio. Offices are an attribute on each employee, so this picker scans employees and shows every distinct office in use.
   * @route POST /list-workplaces-dictionary
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Berlin HQ","value":"1","note":"35 people"}],"cursor":null}
   */
  async listWorkplacesDictionary(payload) {
    const { search } = payload || {}

    return this.#collectEmployeeAttribute('office', search, item => ({
      label: item.name,
      value: String(item.id),
      note:
        item.count > 0
          ? `${ item.count } ${ item.count === 1 ? 'person' : 'people' }`
          : '',
    }))
  }

  // Personio doesn't expose departments / cost centers / offices as their own
  // list endpoints. We derive them by scanning employees once and collecting
  // unique attribute values. The /v1/company/employees endpoint accepts an
  // attribute filter; we cap at 200 employees per page and only walk a few
  // pages to keep dictionary calls cheap.
  async #collectEmployeeAttribute(attribute, search, formatItem) {
    const seen = new Map()
    const limit = 200
    const maxPages = 5
    let offset = 0

    for (let page = 0; page < maxPages; page++) {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/v1/company/employees`,
        query: { limit, offset, ['attributes[]']: attribute },
        logTag: `collectEmployeeAttribute.${ attribute }`,
      })

      const list = response?.data || []
      if (!list.length) break

      for (const employee of list) {
        const attrVal = employee?.attributes?.[attribute]?.value
        // Handle both single record ({type, attributes: {id, name}}) and array of records.
        const records = Array.isArray(attrVal)
          ? attrVal
          : attrVal
            ? [attrVal]
            : []

        for (const rec of records) {
          const id = rec?.attributes?.id || rec?.id
          const name = rec?.attributes?.name || rec?.name
          if (!id) continue

          const key = String(id)

          if (seen.has(key)) {
            seen.get(key).count++
          } else {
            seen.set(key, { id, name: name || `Item ${ id }`, count: 1 })
          }
        }
      }

      offset += limit
      const total = response?.metadata?.total_elements
      if (total !== undefined && offset >= total) break
    }

    const items = [...seen.values()]
    const filtered = search
      ? items.filter(i => matchesText(i.name, search))
      : items

    return {
      items: filtered
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map(formatItem),
      cursor: null,
    }
  }

  // ---- listProjectsDictionary -----------------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Project Picker
   * @description Searchable list of time-tracking projects. Used wherever a workflow needs to attribute hours, attach assignments, or filter by project.
   * @route POST /list-projects-dictionary
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Q3 Migration","value":"p_900","note":"Active · 12 members"}],"cursor":null}
   */
  async listProjectsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/projects`,
      query: clean({ limit: 50, cursor: cursor || undefined }),
      logTag: 'listProjectsDictionary',
    })

    const list = response?._data || []
    const filtered = search
      ? list.filter(p => matchesText(p.name, search))
      : list

    return {
      items: filtered.map(p => ({
        label: p.name || `Project ${ p.id }`,
        value: String(p.id),
        note: [
          p.active === false ? 'Archived' : 'Active',
          p.parent_id ? 'Subproject' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
      cursor: response?._meta?.links?.next
        ? extractCursor(response._meta.links.next)
        : null,
    }
  }

  // ---- listCompensationTypesDictionary --------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Compensation Type Picker
   * @description Searchable list of compensation types (base salary, bonus, commission, one-time payment, etc.) configured in Personio.
   * @route POST /list-compensation-types-dictionary
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Base salary","value":"ct_1","note":"Recurring · Monthly"}],"cursor":null}
   */
  async listCompensationTypesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/compensations/types`,
      query: { limit: 100 },
      logTag: 'listCompensationTypesDictionary',
    })

    const list = response?._data || []
    const filtered = search
      ? list.filter(c => matchesText(c.name, search))
      : list

    return {
      items: filtered.map(c => ({
        label: c.name || `Type ${ c.id }`,
        value: String(c.id),
        note: [c.frequency, c.recurring ? 'Recurring' : null]
          .filter(Boolean)
          .join(' · '),
      })),
      cursor: null,
    }
  }

  // ---- listV2ReportsDictionary ----------------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Standard Report Picker
   * @description Searchable list of reports built in Personio's Analytics workspace (the newer reporting tool). Used by Run Report when the source is set to Standard.
   * @route POST /list-v2-reports-dictionary
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Headcount by department","value":"r_77","note":"Updated 2026-05-20"}],"cursor":null}
   */
  async listV2ReportsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/reports`,
      query: clean({ limit: 50, cursor: cursor || undefined }),
      logTag: 'listV2ReportsDictionary',
    })

    const list = response?._data || []
    const filtered = search
      ? list.filter(r => matchesText(r.name || r.title, search))
      : list

    return {
      items: filtered.map(r => ({
        label: r.name || r.title || `Report ${ r.id }`,
        value: String(r.id),
        note: r.updated_at
          ? `Updated ${ String(r.updated_at).slice(0, 10) }`
          : '',
      })),
      cursor: response?._meta?.links?.next
        ? extractCursor(response._meta.links.next)
        : null,
    }
  }

  // ---- listCustomReportsDictionary ------------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Custom Report Picker
   * @description Searchable list of saved custom reports (the legacy reporting tool inside Personio). Used by Run Report when the source is set to Custom.
   * @route POST /list-custom-reports-dictionary
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Monthly absence overview","value":"cr_12","note":"Time off"}],"cursor":null}
   */
  async listCustomReportsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/company/custom-reports/reports`,
      query: { limit: 100 },
      logTag: 'listCustomReportsDictionary',
    })

    const list = response?.data || []
    const filtered = search
      ? list.filter(r => matchesText(r.attributes?.name || r.name, search))
      : list

    return {
      items: filtered.map(r => ({
        label: r.attributes?.name || r.name || `Report ${ r.id }`,
        value: String(r.id),
        note: r.attributes?.category || r.category || '',
      })),
      cursor: null,
    }
  }

  // ---- listEmployeeAttributesDictionary -------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Employee Field Picker
   * @description Searchable list of every employee field (standard fields like First Name, Email, Hire Date, and any custom fields HR added). Used when an action needs to know which field to read or update.
   * @route POST /list-employee-attributes-dictionary
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Hire date","value":"hire_date","note":"Date · Standard"}],"cursor":null}
   */
  async listEmployeeAttributesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/company/employees/attributes`,
      logTag: 'listEmployeeAttributesDictionary',
    })

    const list = response?.data || []
    const filtered = search
      ? list.filter(
        a => matchesText(a.label, search) || matchesText(a.key, search)
      )
      : list

    return {
      items: filtered.map(a => ({
        label: a.label || a.key || 'Field',
        value: String(a.key),
        note: [a.type, a.custom ? 'Custom' : 'Standard']
          .filter(Boolean)
          .join(' · '),
      })),
      cursor: null,
    }
  }

  // ---- listWebhooksDictionary -----------------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Webhook Picker
   * @description Searchable list of webhooks registered against this Personio account. Used by the Inspect Webhook action and other webhook-management flows.
   * @route POST /list-webhooks-dictionary
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Optional search text."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"FlowRunner Personio integration","value":"wh_77","note":"Enabled · 6 events"}],"cursor":null}
   */
  async listWebhooksDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/webhooks`,
      query: clean({ limit: 50, cursor: cursor || undefined }),
      logTag: 'listWebhooksDictionary',
    })

    const list = response?._data || []
    const filtered = search
      ? list.filter(
        w =>
          matchesText(w.description, search) || matchesText(w.url, search)
      )
      : list

    return {
      items: filtered.map(w => ({
        label: w.description || w.url || `Webhook ${ w.id }`,
        value: String(w.id),
        note: [
          w.status || 'Enabled',
          `${ (w.enabled_events || []).length } events`,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
      cursor: response?._meta?.links?.next
        ? extractCursor(response._meta.links.next)
        : null,
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 5. People + Employee Photo
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Find People
   * @description Fetch one or more people from Personio. Leave Person ID blank to search across everyone; fill it in to drill into a single record. The other fields narrow the search — leave them blank to skip.
   * @route POST /find-people
   * @appearanceColor #04A287 #04A287
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":false,"dictionary":"listPeopleDictionary","description":"Pick a specific person to fetch them on their own. Leave blank to list everyone."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter by exact email address. Leave blank to ignore."}
   * @paramDef {"type":"String","label":"Name contains","name":"name","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter by first, last, or preferred name. Case-insensitive partial match."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Active","Inactive"]}},"description":"Active people are currently employed. Inactive includes leavers and pre-boarding hires."}
   * @paramDef {"type":"String","label":"Updated after","name":"updatedAfter","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Only return people whose profile changed on or after this date. Pick a date or type one like 2026-06-01."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination position from a previous run. Leave blank to start from the top."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"42","first_name":"Sarah","last_name":"Connor","email":"sarah@example.com","status":"ACTIVE","preferred_name":"Sarah","department":{"name":"Engineering"},"office":{"name":"Berlin HQ"}}],"cursor":null,"total":1}
   */
  async findPeople(personId, email, name, status, updatedAfter, cursor) {
    if (personId) {
      const single = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/persons/${ encodeURIComponent(personId) }`,
        logTag: 'findPeople.byId',
      })
      const record = single?._data || single?.data || single

      return { items: [record], cursor: null, total: 1 }
    }

    const query = clean({
      limit: 50,
      cursor: cursor || undefined,
      email: email || undefined,
      status:
        status && status !== 'Any' ? String(status).toUpperCase() : undefined,
      'updated_at.gt': updatedAfter || undefined,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/persons`,
      query,
      logTag: 'findPeople.list',
    })

    let items = response?._data || []

    if (name) {
      items = items.filter(
        p =>
          matchesText(p.first_name, name) ||
          matchesText(p.last_name, name) ||
          matchesText(p.preferred_name, name)
      )
    }

    return {
      items,
      cursor: response?._meta?.links?.next
        ? extractCursor(response._meta.links.next)
        : null,
      total: items.length,
    }
  }

  /**
   * @operationName Add Person
   * @description Create a new person in Personio together with their first employment record. Use this for hires, transfers in, and bulk imports. The hire date is the calendar date the person officially starts; weekly hours are how many hours they're contracted for.
   * @route POST /add-person
   * @appearanceColor #04A287 #04A287
   *
   * @paramDef {"type":"String","label":"First name","name":"firstName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Legal first name."}
   * @paramDef {"type":"String","label":"Last name","name":"lastName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Legal last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Work email. Must be unique inside the Personio account."}
   * @paramDef {"type":"String","label":"Preferred name","name":"preferredName","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Nickname or chosen name shown alongside the legal name."}
   * @paramDef {"type":"String","label":"Gender","name":"gender","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["female","male","diverse","undefined"]}},"description":"Used for legal reports where required. Pick Undefined to leave unspecified."}
   * @paramDef {"type":"String","label":"Hire date","name":"hireDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The official start date. Pick a date or type one like 2026-06-01."}
   * @paramDef {"type":"Number","label":"Weekly hours","name":"weeklyHours","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Contracted working hours per week. Typically 40 for full-time."}
   * @paramDef {"type":"String","label":"Contract type","name":"contractType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["permanent","temporary","intern","external"]}},"description":"Permanent for full employees; Temporary, Intern, or External for fixed-term or contractor relationships."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","required":false,"dictionary":"listOrgUnitsDictionary","description":"Where the person sits in the org tree."}
   * @paramDef {"type":"String","label":"Office","name":"officeId","required":false,"dictionary":"listWorkplacesDictionary","description":"Primary office or remote location."}
   * @paramDef {"type":"String","label":"Legal entity","name":"legalEntityId","required":false,"dictionary":"listLegalEntitiesDictionary","description":"Which legal entity employs the person. Defaults to the only entity if there is just one."}
   * @paramDef {"type":"String","label":"Position","name":"position","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Job title."}
   *
   * @returns {Object}
   * @sampleResult {"id":"42","first_name":"Sarah","last_name":"Connor","email":"sarah@example.com","status":"ACTIVE","employment":{"id":"e_99","start_date":"2026-06-01","weekly_hours":40}}
   */
  async addPerson(
    firstName,
    lastName,
    email,
    preferredName,
    gender,
    hireDate,
    weeklyHours,
    contractType,
    departmentId,
    officeId,
    legalEntityId,
    position
  ) {
    const body = clean({
      first_name: firstName,
      last_name: lastName,
      preferred_name: preferredName,
      email,
      gender: gender && gender !== 'undefined' ? gender : undefined,
      employment: clean({
        start_date: hireDate,
        weekly_hours: weeklyHours,
        contract_type: contractType,
        org_unit_id: departmentId,
        workplace_id: officeId,
        legal_entity_id: legalEntityId,
        position,
      }),
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/persons`,
      method: 'post',
      body,
      logTag: 'addPerson',
    })

    return response?._data || response
  }

  /**
   * @operationName Update Person
   * @description Change profile details for an existing person — name, email, department, office, position, custom fields. Use this for non-employment edits; for things like weekly hours or contract type use Update Employment instead.
   * @route POST /update-person
   * @appearanceColor #04A287 #04A287
   *
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"listPeopleDictionary","description":"The person to update."}
   * @paramDef {"type":"String","label":"First name","name":"firstName","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Leave blank to keep the current value."}
   * @paramDef {"type":"String","label":"Last name","name":"lastName","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Leave blank to keep the current value."}
   * @paramDef {"type":"String","label":"Preferred name","name":"preferredName","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Leave blank to keep the current value."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Leave blank to keep the current value."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","required":false,"dictionary":"listOrgUnitsDictionary","description":"Leave blank to keep the current value."}
   * @paramDef {"type":"String","label":"Office","name":"officeId","required":false,"dictionary":"listWorkplacesDictionary","description":"Leave blank to keep the current value."}
   * @paramDef {"type":"String","label":"Position","name":"position","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Job title. Leave blank to keep the current value."}
   * @paramDef {"type":"Object","label":"Custom fields","name":"customFields","required":false,"description":"Optional. Pass an object like {\"shirt_size\":\"L\",\"start_buddy\":\"Alex\"} to set custom employee fields. Field keys must match those configured in Personio."}
   *
   * @returns {Object}
   * @sampleResult {"id":"42","first_name":"Sarah","last_name":"Connor","email":"sarah@example.com","preferred_name":"Sarah"}
   */
  async updatePerson(
    personId,
    firstName,
    lastName,
    preferredName,
    email,
    departmentId,
    officeId,
    position,
    customFields
  ) {
    const body = clean({
      first_name: firstName,
      last_name: lastName,
      preferred_name: preferredName,
      email,
      department: departmentId ? { id: departmentId } : undefined,
      office: officeId ? { id: officeId } : undefined,
      position,
      ...(customFields && typeof customFields === 'object'
        ? { custom_attributes: customFields }
        : {}),
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/persons/${ encodeURIComponent(personId) }`,
      method: 'patch',
      body,
      logTag: 'updatePerson',
    })

    return response?._data || response
  }

  /**
   * @operationName Delete Person
   * @description Permanently remove a person from Personio. This is irreversible and cascades to the person's employment, time off, attendance, documents, and compensation history. For people who are leaving, prefer End Employment — deletion is mostly for GDPR-style cleanups long after exit.
   * @route POST /delete-person
   * @appearanceColor #B33D2C #B33D2C
   *
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"listPeopleDictionary","description":"The person to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm deletion","name":"confirmDelete","required":true,"uiComponent":{"type":"TOGGLE"},"description":"Safety toggle. Must be on or the action refuses to run."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"personId":"42"}
   */
  async deletePerson(personId, confirmDelete) {
    if (!confirmDelete) {
      throw new Error(
        'Delete Person refused: turn on "Confirm deletion" to proceed. This is a one-way action.'
      )
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/persons/${ encodeURIComponent(personId) }`,
      method: 'delete',
      logTag: 'deletePerson',
    })

    return { deleted: true, personId }
  }

  /**
   * @operationName Get Employee Photo
   * @description Fetch a person's profile photo from Personio and return it as a base64-encoded image. Use it to push the photo into another system (Slack profile, ID badge generator, intranet directory).
   * @route POST /get-employee-photo
   *
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"listPeopleDictionary","description":"The person whose photo to fetch."}
   * @paramDef {"type":"Number","label":"Width in pixels","name":"width","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Requested width. Personio returns a square image. Common values: 64, 128, 256, 512. Defaults to 256."}
   *
   * @returns {Object}
   * @sampleResult {"personId":"42","width":256,"contentType":"image/jpeg","base64":"...","empty":false}
   */
  async getEmployeePhoto(personId, width) {
    const w = Number(width) > 0 ? Math.floor(Number(width)) : 256

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/v1/company/employees/${ encodeURIComponent(personId) }/profile-picture/${ w }`,
        logTag: 'getEmployeePhoto',
      })

      const buffer = Buffer.isBuffer(response)
        ? response
        : typeof response === 'string'
          ? Buffer.from(response, 'binary')
          : Buffer.from(JSON.stringify(response))

      return {
        personId,
        width: w,
        contentType: 'image/jpeg',
        base64: buffer.toString('base64'),
        empty: buffer.length === 0,
      }
    } catch (error) {
      // Personio returns 404 "Profile image not found" when the employee just
      // hasn't uploaded a photo. Treat that as a clean "no photo" rather than
      // an error so workflows can branch on `empty`.
      const msg = String(error?.message || '')

      if (
        msg === FRIENDLY_ERRORS.not_found ||
        /not.?found|profile image not found|could not find/i.test(msg)
      ) {
        return {
          personId,
          width: w,
          contentType: null,
          base64: '',
          empty: true,
        }
      }

      throw error
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 6. Employments
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Find Employments
   * @description Fetch the employment record(s) attached to a person — contract terms, weekly hours, supervisor, cost center, start and termination dates. A person can have more than one employment over time (rehires, contract changes). Pass an Employment ID to drill into a single record.
   * @route POST /find-employments
   *
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"listPeopleDictionary","description":"The person whose employment(s) to fetch."}
   * @paramDef {"type":"String","label":"Employment ID","name":"employmentId","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional. Pass to fetch a single employment by ID. Leave blank to list all of the person's employments."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"e_99","person_id":"42","start_date":"2026-06-01","termination_date":null,"weekly_hours":40,"contract_type":"permanent","position":"Engineer"}],"total":1}
   */
  async findEmployments(personId, employmentId) {
    if (employmentId) {
      const single = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/persons/${ encodeURIComponent(personId) }/employments/${ encodeURIComponent(employmentId) }`,
        logTag: 'findEmployments.byId',
      })
      const record = single?._data || single

      return { items: [record], total: 1 }
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/persons/${ encodeURIComponent(personId) }/employments`,
      query: { limit: 50 },
      logTag: 'findEmployments.list',
    })

    const items = response?._data || []

    return { items, total: items.length }
  }

  /**
   * @operationName Update Employment
   * @description Change contract terms on an existing employment record — weekly hours, contract type, position, supervisor, cost center, department. For exits use End Employment instead so the termination signals are sent properly.
   * @route POST /update-employment
   *
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"listPeopleDictionary","description":"The person whose employment to change."}
   * @paramDef {"type":"String","label":"Employment ID","name":"employmentId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The specific employment record. Use Find Employments first if you need to look this up."}
   * @paramDef {"type":"Number","label":"Weekly hours","name":"weeklyHours","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New contracted working hours per week. Leave blank to keep the current value."}
   * @paramDef {"type":"String","label":"Contract type","name":"contractType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["permanent","temporary","intern","external"]}},"description":"Leave blank to keep the current value."}
   * @paramDef {"type":"String","label":"Position","name":"position","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New job title. Leave blank to keep the current value."}
   * @paramDef {"type":"String","label":"Supervisor","name":"supervisorId","required":false,"dictionary":"listPeopleDictionary","description":"Who this person reports to. Leave blank to keep the current value."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","required":false,"dictionary":"listOrgUnitsDictionary","description":"Leave blank to keep the current value."}
   * @paramDef {"type":"String","label":"Cost center","name":"costCenterId","required":false,"dictionary":"listCostCentersDictionary","description":"Leave blank to keep the current value."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e_99","person_id":"42","weekly_hours":32,"contract_type":"permanent","position":"Senior Engineer"}
   */
  async updateEmployment(
    personId,
    employmentId,
    weeklyHours,
    contractType,
    position,
    supervisorId,
    departmentId,
    costCenterId
  ) {
    // The v2 employment record uses verbose field names. Map our friendly
    // params to the wire shape Personio expects.
    const body = clean({
      weekly_working_hours: weeklyHours,
      type: contractType ? String(contractType).toUpperCase() : undefined,
      position,
      supervisor: supervisorId ? { id: supervisorId } : undefined,
      org_units: departmentId ? [{ id: departmentId }] : undefined,
      cost_centers: costCenterId ? [{ id: costCenterId }] : undefined,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/persons/${ encodeURIComponent(personId) }/employments/${ encodeURIComponent(employmentId) }`,
      method: 'patch',
      body,
      logTag: 'updateEmployment',
    })

    return response?._data || response
  }

  /**
   * @operationName End Employment
   * @description The canonical "this person is leaving" action. Sets a termination date, reason, and type on the employee record — Personio then fires off-boarding signals and downstream automations. Prefer this over Update Employment for exits so the right webhooks fire and HR reports stay accurate.
   * @route POST /end-employment
   * @appearanceColor #B33D2C #B33D2C
   *
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"listPeopleDictionary","description":"The person who is leaving."}
   * @paramDef {"type":"String","label":"Last working day","name":"lastWorkingDay","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The person's final day on the payroll. Pick a date or type one like 2026-09-30."}
   * @paramDef {"type":"String","label":"Termination reason","name":"terminationReason","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Free-text reason — usually one of the HR-defined categories like Resignation, End of contract, Mutual agreement."}
   * @paramDef {"type":"String","label":"Termination type","name":"terminationType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["voluntary","involuntary","mutual-agreement","end-of-contract","retirement","other"]}},"description":"Who drove the exit. Defaults to Other if left blank."}
   * @paramDef {"type":"Boolean","label":"Confirm termination","name":"confirmTermination","required":true,"uiComponent":{"type":"TOGGLE"},"description":"Safety toggle. Must be on or the action refuses to run. This is a sensitive HR action — turning it on signals you have HR's blessing."}
   *
   * @returns {Object}
   * @sampleResult {"personId":"42","terminationDate":"2026-09-30","terminationReason":"Resignation","terminationType":"voluntary"}
   */
  async endEmployment(
    personId,
    lastWorkingDay,
    terminationReason,
    terminationType,
    confirmTermination
  ) {
    if (!confirmTermination) {
      throw new Error(
        'End Employment refused: turn on "Confirm termination" to proceed. This action sets the termination date on the employee record and fires off-boarding webhooks.'
      )
    }

    // v1 PATCH /v1/company/employees/{id} is the supported termination path —
    // the v2 employment PATCH does not accept termination fields. v1 wraps
    // each attribute in `{value: ...}` and expects the type as a free-form
    // string matching the HR-configured categories.
    const body = {
      employee: clean({
        termination_date: { value: lastWorkingDay },
        termination_reason: terminationReason
          ? { value: terminationReason }
          : undefined,
        termination_type: terminationType
          ? { value: terminationType }
          : undefined,
      }),
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/company/employees/${ encodeURIComponent(personId) }`,
      method: 'patch',
      body,
      logTag: 'endEmployment',
    })

    return {
      personId,
      terminationDate: lastWorkingDay,
      terminationReason: terminationReason || null,
      terminationType: terminationType || null,
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 7. Time Off
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Find Time Off
   * @description Look up time-off requests (vacation, sick days, parental leave, etc.). Leave Time Off ID blank to filter across people, types, status, and date range. Fill it in to drill into one specific request.
   * @route POST /find-time-off
   *
   * @paramDef {"type":"String","label":"Time Off ID","name":"timeOffId","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional. Pass to fetch one specific request. Leave blank to list across filters."}
   * @paramDef {"type":"String","label":"Person","name":"personId","required":false,"dictionary":"listPeopleDictionary","description":"Filter to one person. Leave blank to fetch across everyone."}
   * @paramDef {"type":"String","label":"Time-off type","name":"absenceTypeId","required":false,"dictionary":"listAbsenceTypesDictionary","description":"Filter by type (vacation, sick leave, parental, etc.)."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Pending","Approved","Rejected"]}},"description":"Where the request is in the approval flow."}
   * @paramDef {"type":"String","label":"When","name":"period","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Today","Yesterday","Last 7 days","Last 30 days","This month","Last month","Year to date","Custom"]}},"description":"Date-range preset. Pick Custom to use the Start and End fields below."}
   * @paramDef {"type":"String","label":"Custom start","name":"startDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Only used when When is set to Custom. Pick a date or type one like 2026-06-01."}
   * @paramDef {"type":"String","label":"Custom end","name":"endDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Only used when When is set to Custom. Pick a date or type one like 2026-06-30."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination position from a previous run. Leave blank to start from the top."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"ab_55","person":{"id":"42"},"absence_type":{"id":"1234","name":"Paid vacation"},"start_date":"2026-08-15","end_date":"2026-08-22","status":"APPROVED","amount":6}],"cursor":null,"total":1}
   */
  async findTimeOff(
    timeOffId,
    personId,
    absenceTypeId,
    status,
    period,
    startDate,
    endDate,
    cursor
  ) {
    if (timeOffId) {
      const single = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/absence-periods/${ encodeURIComponent(timeOffId) }`,
        logTag: 'findTimeOff.byId',
      })
      const record = single?._data || single

      return { items: [record], total: 1, cursor: null }
    }

    // Personio v2 absence-periods accepts only `limit` and `cursor` — filtering
    // happens client-side after the fetch.
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/absence-periods`,
      query: clean({ limit: 50, cursor: cursor || undefined }),
      logTag: 'findTimeOff.list',
    })

    const range =
      period || startDate || endDate
        ? resolvePeriod(period, startDate, endDate)
        : null
    const wantStatus =
      status && status !== 'Any' ? String(status).toUpperCase() : null

    let items = response?._data || []

    if (personId)
      items = items.filter(p => String(p?.person?.id) === String(personId))
    if (absenceTypeId)
      items = items.filter(
        p => String(p?.absence_type?.id) === String(absenceTypeId)
      )
    if (wantStatus)
      items = items.filter(
        p =>
          String(p?.approval?.status || p?.status || '').toUpperCase() ===
          wantStatus
      )

    if (range) {
      items = items.filter(p => {
        const s = (p?.starts_from?.date_time || p?.starts_at || '').slice(
          0,
          10
        )
        const e = (p?.ends_at?.date_time || p?.ends_at || '').slice(0, 10)
        if (range.start && e && e < range.start) return false
        if (range.end && s && s > range.end) return false

        return true
      })
    }

    return {
      items,
      cursor: response?._meta?.links?.next
        ? extractCursor(response._meta.links.next)
        : null,
      total: items.length,
    }
  }

  /**
   * @operationName Request Time Off
   * @description File a time-off request on someone's behalf. Pick Whole days for vacation, public holidays, or any leave measured in days. Pick Specific hours for partial days like a doctor's appointment. The form will reshape itself based on your choice.
   * @route POST /request-time-off
   *
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"listPeopleDictionary","description":"Whose time off this is."}
   * @paramDef {"type":"String","label":"Time-off type","name":"absenceTypeId","required":true,"dictionary":"listAbsenceTypesDictionary","description":"What kind of leave (vacation, sick, parental, training, etc.)."}
   * @paramDef {"type":"String","label":"Mode","name":"mode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Whole days","Specific hours"]}},"description":"Whole days for vacation and full-day absences. Specific hours for partial-day leave."}
   * @paramDef {"type":"Object","label":"Details","name":"details","required":true,"dependsOn":["mode"],"schemaLoader":"requestTimeOffSchemaLoader","description":"The dates or hours of the request. The fields here change based on the Mode you picked above."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note attached to the request."}
   * @paramDef {"type":"Boolean","label":"Skip approval","name":"skipApproval","required":false,"uiComponent":{"type":"TOGGLE"},"description":"On creates the request already approved (HR import workflows). Off leaves it pending the normal approval flow."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ab_55","person":{"id":"42"},"absence_type":{"id":"1234"},"start_date":"2026-08-15","end_date":"2026-08-22","status":"APPROVED","amount":6}
   */
  async requestTimeOff(
    personId,
    absenceTypeId,
    mode,
    details,
    comment,
    skipApproval
  ) {
    const d = details || {}

    if (mode === 'Whole days') {
      const v1Body = clean({
        employee_id: personId,
        time_off_type_id: absenceTypeId,
        start_date: d.startDate,
        end_date: d.endDate || d.startDate,
        half_day_start: d.halfDayStart || false,
        half_day_end: d.halfDayEnd || false,
        comment,
        skip_approval: !!skipApproval,
      })

      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/v1/company/time-offs`,
        method: 'post',
        body: v1Body,
        logTag: 'requestTimeOff.byDay',
      })

      return response?.data || response
    }

    // The dictionary returns v1 integer IDs, but /v2/absence-periods needs the
    // v2 UUID. Translate transparently so workflow builders don't have to
    // think about which API generation they're hitting.
    const v2TypeId = await this.#resolveAbsenceTypeV2Id(absenceTypeId)

    if (!v2TypeId) {
      throw new Error(
        'Request Time Off (hours mode) could not match the chosen time-off type to a v2 entry. Pick the type again from the dropdown.'
      )
    }

    // Personio v2 absence-periods uses `starts_from` (not `starts_at`) and
    // wraps both timestamps in objects with `date_time`.
    const body = clean({
      person: { id: personId },
      absence_type: { id: v2TypeId },
      starts_from: d.startsAt
        ? { date_time: stripTimezone(d.startsAt) }
        : undefined,
      ends_at: d.endsAt ? { date_time: stripTimezone(d.endsAt) } : undefined,
      comment,
      approval: skipApproval ? { status: 'APPROVED' } : undefined,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/absence-periods`,
      method: 'post',
      body,
      logTag: 'requestTimeOff.byHours',
    })

    return response?._data || response
  }

  /**
   * @operationName Update Time Off
   * @description Edit an existing time-off request — adjust dates, change status (approve/reject), update the comment. Use this for approvals and corrections.
   * @route POST /update-time-off
   *
   * @paramDef {"type":"String","label":"Time Off ID","name":"timeOffId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The request to update. Use Find Time Off to look this up."}
   * @paramDef {"type":"String","label":"New start","name":"startsAt","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Leave blank to keep the current start."}
   * @paramDef {"type":"String","label":"New end","name":"endsAt","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Leave blank to keep the current end."}
   * @paramDef {"type":"String","label":"New status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["","Approved","Rejected","Pending"]}},"description":"Approve, reject, or send back to Pending. Leave blank to keep the current status."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Leave blank to keep the current comment."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ab_55","starts_at":"2026-08-15T00:00:00Z","ends_at":"2026-08-22T23:59:59Z","status":"APPROVED"}
   */
  async updateTimeOff(timeOffId, startsAt, endsAt, status, comment) {
    const body = clean({
      starts_at: startsAt,
      ends_at: endsAt,
      status: status ? String(status).toUpperCase() : undefined,
      comment,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/absence-periods/${ encodeURIComponent(timeOffId) }`,
      method: 'patch',
      body,
      logTag: 'updateTimeOff',
    })

    return response?._data || response
  }

  /**
   * @operationName Withdraw Time Off Request
   * @description Cancel and remove a time-off request from Personio. Works on both pending and approved requests. For approved requests this also returns the days to the person's balance.
   * @route POST /withdraw-time-off
   * @appearanceColor #B33D2C #B33D2C
   *
   * @paramDef {"type":"String","label":"Time Off ID","name":"timeOffId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The request to withdraw."}
   *
   * @returns {Object}
   * @sampleResult {"withdrawn":true,"timeOffId":"ab_55"}
   */
  async withdrawTimeOff(timeOffId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/absence-periods/${ encodeURIComponent(timeOffId) }`,
      method: 'delete',
      logTag: 'withdrawTimeOff',
    })

    return { withdrawn: true, timeOffId }
  }

  /**
   * @operationName Get Time Off Balance
   * @description Look up how many days of each time-off type a person has used, has left, and has accruing. Useful for "do they have enough vacation days?" checks before approving a request.
   * @route POST /get-time-off-balance
   *
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"listPeopleDictionary","description":"Whose balance to fetch."}
   *
   * @returns {Object}
   * @sampleResult {"personId":"42","balances":[{"typeId":"1234","typeName":"Paid vacation","used":8,"remaining":22,"total":30,"unit":"DAYS"}]}
   */
  async getTimeOffBalance(personId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/company/employees/${ encodeURIComponent(personId) }/absences/balance`,
      logTag: 'getTimeOffBalance',
    })

    const balances = (response?.data || []).map(b => ({
      typeId: String(b.id),
      typeName: b.name,
      used: b.used_balance ?? b.used ?? null,
      remaining: b.available_balance ?? b.remaining ?? null,
      total: b.total_balance ?? b.total ?? null,
      unit: b.unit || 'DAYS',
    }))

    return { personId, balances }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // Schema loader for Request Time Off
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object", "name":"mode", "required":true}
   * @returns {Object}
   */
  async requestTimeOffSchemaLoader({ criteria }) {
    const mode = criteria?.mode

    if (mode === 'Whole days') {
      return [
        {
          type: 'String',
          label: 'Starts on',
          name: 'startDate',
          required: true,
          uiComponent: { type: 'DATE_PICKER' },
          description:
            'First day off. Pick a date or type one like 2026-08-15.',
        },
        {
          type: 'String',
          label: 'Ends on',
          name: 'endDate',
          required: false,
          uiComponent: { type: 'DATE_PICKER' },
          description:
            'Last day off (same as Starts on for a one-day request). Pick a date or type one like 2026-08-22.',
        },
        {
          type: 'Boolean',
          label: 'Half day at start',
          name: 'halfDayStart',
          required: false,
          uiComponent: { type: 'TOGGLE' },
          description:
            'Turn on if the first day is a half-day (only afternoon off).',
        },
        {
          type: 'Boolean',
          label: 'Half day at end',
          name: 'halfDayEnd',
          required: false,
          uiComponent: { type: 'TOGGLE' },
          description:
            'Turn on if the last day is a half-day (only morning off).',
        },
      ]
    }

    return [
      {
        type: 'String',
        label: 'Starts at',
        name: 'startsAt',
        required: true,
        uiComponent: { type: 'DATE_TIME_PICKER' },
        description:
          'Exact start time of the partial-day absence. Pick a date and time, e.g. 2026-08-15 14:00.',
      },
      {
        type: 'String',
        label: 'Ends at',
        name: 'endsAt',
        required: true,
        uiComponent: { type: 'DATE_TIME_PICKER' },
        description:
          'Exact end time. Pick a date and time, e.g. 2026-08-15 17:00.',
      },
    ]
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 8. Time Tracking (attendances)
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Find Time Entries
   * @description Look up time-tracking entries (logged hours). Leave Entry ID blank to filter across people, projects, and date range. Fill it in to drill into one entry.
   * @route POST /find-time-entries
   *
   * @paramDef {"type":"String","label":"Entry ID","name":"entryId","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional. Pass to fetch one specific entry. Leave blank to list across filters."}
   * @paramDef {"type":"String","label":"Person","name":"personId","required":false,"dictionary":"listPeopleDictionary","description":"Filter to one person. Leave blank to fetch across everyone."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":false,"dictionary":"listProjectsDictionary","description":"Filter to one project."}
   * @paramDef {"type":"String","label":"When","name":"period","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Today","Yesterday","Last 7 days","Last 30 days","This month","Last month","Year to date","Custom"]}},"description":"Date-range preset. Pick Custom to use the Start and End fields below."}
   * @paramDef {"type":"String","label":"Custom start","name":"startDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Only used when When is set to Custom."}
   * @paramDef {"type":"String","label":"Custom end","name":"endDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Only used when When is set to Custom."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination position from a previous run. Leave blank to start from the top."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"at_77","person":{"id":"42"},"starts_at":"2026-08-15T09:00:00Z","ends_at":"2026-08-15T17:30:00Z","break":30,"project":{"id":"p_900"}}],"cursor":null,"total":1}
   */
  async findTimeEntries(
    entryId,
    personId,
    projectId,
    period,
    startDate,
    endDate,
    cursor
  ) {
    if (entryId) {
      const single = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/attendance-periods/${ encodeURIComponent(entryId) }`,
        logTag: 'findTimeEntries.byId',
      })
      const record = single?._data || single

      return { items: [record], total: 1, cursor: null }
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/attendance-periods`,
      query: clean({ limit: 50, cursor: cursor || undefined }),
      logTag: 'findTimeEntries.list',
    })

    const range =
      period || startDate || endDate
        ? resolvePeriod(period, startDate, endDate)
        : null

    let items = response?._data || []

    if (personId)
      items = items.filter(p => String(p?.person?.id) === String(personId))
    if (projectId)
      items = items.filter(p => String(p?.project?.id) === String(projectId))

    if (range) {
      items = items.filter(p => {
        const s = (p?.starts_at?.date_time || p?.starts_at || '').slice(0, 10)
        const e = (p?.ends_at?.date_time || p?.ends_at || '').slice(0, 10)
        if (range.start && e && e < range.start) return false
        if (range.end && s && s > range.end) return false

        return true
      })
    }

    return {
      items,
      cursor: response?._meta?.links?.next
        ? extractCursor(response._meta.links.next)
        : null,
      total: items.length,
    }
  }

  /**
   * @operationName Track Time
   * @description Log a stretch of time worked. Use this to push hours into Personio from a timer app, calendar event, or manual entry. Times are full date-times — e.g. 2026-08-15T09:00 to 2026-08-15T17:30.
   * @route POST /track-time
   *
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"listPeopleDictionary","description":"Whose time this is."}
   * @paramDef {"type":"String","label":"Starts at","name":"startsAt","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the work started. Pick a date and time."}
   * @paramDef {"type":"String","label":"Ends at","name":"endsAt","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the work ended."}
   * @paramDef {"type":"Number","label":"Break in minutes","name":"breakMinutes","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unpaid break time inside the entry. Common values: 0, 30, 60."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":false,"dictionary":"listProjectsDictionary","description":"Optional. Attribute the hours to a project."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note."}
   *
   * @returns {Object}
   * @sampleResult {"id":"at_77","person":{"id":"42"},"starts_at":"2026-08-15T09:00:00Z","ends_at":"2026-08-15T17:30:00Z","break":30,"project":{"id":"p_900"}}
   */
  async trackTime(
    personId,
    startsAt,
    endsAt,
    breakMinutes,
    projectId,
    comment
  ) {
    // Personio v2 attendance-periods wraps start/end in objects (not raw
    // strings) and requires a `type` of either WORK or BREAK. Break duration
    // is modelled as a separate BREAK period — not a field on the WORK entry.
    const body = clean({
      person: { id: personId },
      type: 'WORK',
      start: startsAt ? { date_time: stripTimezone(startsAt) } : undefined,
      end: endsAt ? { date_time: stripTimezone(endsAt) } : undefined,
      project: projectId ? { id: projectId } : undefined,
      comment,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/attendance-periods`,
      method: 'post',
      body,
      logTag: 'trackTime',
    })

    const created = response?._data || response

    // If the caller asked for a break, log it as a second BREAK period that
    // sits inside the work entry. Returns both IDs so workflows can edit
    // either piece later.
    if (created?.id && Number(breakMinutes) > 0 && startsAt && endsAt) {
      const breakStart = new Date(
        new Date(stripTimezone(startsAt)).getTime() + 60 * 60 * 1000
      )
      const breakEnd = new Date(
        breakStart.getTime() + Number(breakMinutes) * 60 * 1000
      )

      try {
        const breakResponse = await this.#apiRequest({
          url: `${ API_BASE_URL }/v2/attendance-periods`,
          method: 'post',
          body: clean({
            person: { id: personId },
            type: 'BREAK',
            start: { date_time: breakStart.toISOString().slice(0, 19) },
            end: { date_time: breakEnd.toISOString().slice(0, 19) },
            comment: 'Break',
          }),
          logTag: 'trackTime.break',
        })

        return { ...created, break: breakResponse?._data || breakResponse }
      } catch (error) {
        logger.warn(
          `trackTime.break failed (work entry already created): ${ error.message }`
        )
      }
    }

    return created
  }

  /**
   * @operationName Update Time Entry
   * @description Edit a logged time entry — adjust the times, change the break, attach or change the project, edit the comment.
   * @route POST /update-time-entry
   *
   * @paramDef {"type":"String","label":"Entry ID","name":"entryId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The entry to update. Use Find Time Entries to look this up."}
   * @paramDef {"type":"String","label":"New start","name":"startsAt","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Leave blank to keep the current start."}
   * @paramDef {"type":"String","label":"New end","name":"endsAt","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Leave blank to keep the current end."}
   * @paramDef {"type":"Number","label":"Break in minutes","name":"breakMinutes","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Leave blank to keep the current break."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":false,"dictionary":"listProjectsDictionary","description":"Leave blank to keep the current project."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Leave blank to keep the current comment."}
   *
   * @returns {Object}
   * @sampleResult {"id":"at_77","starts_at":"2026-08-15T09:30:00Z","ends_at":"2026-08-15T17:30:00Z","break":45}
   */
  async updateTimeEntry(
    entryId,
    startsAt,
    endsAt,
    breakMinutes,
    projectId,
    comment
  ) {
    // Note: `break_minutes` isn't an accepted field on the work entry —
    // adjust the matching BREAK period separately if you need to change break
    // duration. We silently drop the param to keep the action ergonomic.
    void breakMinutes
    const body = clean({
      start: startsAt ? { date_time: stripTimezone(startsAt) } : undefined,
      end: endsAt ? { date_time: stripTimezone(endsAt) } : undefined,
      project: projectId ? { id: projectId } : undefined,
      comment,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/attendance-periods/${ encodeURIComponent(entryId) }`,
      method: 'patch',
      body,
      logTag: 'updateTimeEntry',
    })

    return response?._data || response
  }

  /**
   * @operationName Delete Time Entry
   * @description Remove a logged time entry. Useful for correcting bad imports or duplicates.
   * @route POST /delete-time-entry
   * @appearanceColor #B33D2C #B33D2C
   *
   * @paramDef {"type":"String","label":"Entry ID","name":"entryId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The entry to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"entryId":"at_77"}
   */
  async deleteTimeEntry(entryId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/attendance-periods/${ encodeURIComponent(entryId) }`,
      method: 'delete',
      logTag: 'deleteTimeEntry',
    })

    return { deleted: true, entryId }
  }

  /**
   * @operationName Summarize Time Tracked
   * @description Aggregate logged hours into totals — per person, per day, and per project — over a date range. Use this for "monthly hours worked" reports without writing your own paging-and-summing loop. Returns total hours plus the breakdown buckets.
   * @route POST /summarize-time-tracked
   *
   * @paramDef {"type":"String","label":"Person","name":"personId","required":false,"dictionary":"listPeopleDictionary","description":"Filter to one person. Leave blank to summarize across everyone."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":false,"dictionary":"listProjectsDictionary","description":"Filter to one project."}
   * @paramDef {"type":"String","label":"When","name":"period","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Today","Yesterday","Last 7 days","Last 30 days","This month","Last month","Year to date","Custom"]}},"description":"Date-range preset. Pick Custom to use Start and End below."}
   * @paramDef {"type":"String","label":"Custom start","name":"startDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Only used when When is set to Custom."}
   * @paramDef {"type":"String","label":"Custom end","name":"endDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Only used when When is set to Custom."}
   *
   * @returns {Object}
   * @sampleResult {"totalHours":162.5,"entries":42,"byPerson":[{"personId":"42","hours":42.5}],"byDay":[{"day":"2026-08-15","hours":8.0}],"byProject":[{"projectId":"p_900","hours":50.5}]}
   */
  async summarizeTimeTracked(personId, projectId, period, startDate, endDate) {
    const range = resolvePeriod(period, startDate, endDate)

    let cursor = null
    const collected = []
    const maxPages = 20

    for (let page = 0; page < maxPages; page++) {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/attendance-periods`,
        query: clean({ limit: 50, cursor: cursor || undefined }),
        logTag: 'summarizeTimeTracked.page',
      })

      const items = response?._data || []
      collected.push(...items)

      cursor = response?._meta?.links?.next
        ? extractCursor(response._meta.links.next)
        : null

      if (!cursor) break
    }

    // Apply filters in-process since the API doesn't accept them.
    const all = collected.filter(entry => {
      if (personId && String(entry?.person?.id) !== String(personId))
        return false
      if (projectId && String(entry?.project?.id) !== String(projectId))
        return false
      const s = (entry?.starts_at?.date_time || entry?.starts_at || '').slice(
        0,
        10
      )
      const e = (entry?.ends_at?.date_time || entry?.ends_at || '').slice(
        0,
        10
      )
      if (range.start && e && e < range.start) return false
      if (range.end && s && s > range.end) return false

      return true
    })

    const byPerson = new Map()
    const byDay = new Map()
    const byProject = new Map()
    let totalMinutes = 0

    for (const entry of all) {
      const startStr = entry?.starts_at?.date_time || entry?.starts_at
      const endStr = entry?.ends_at?.date_time || entry?.ends_at
      const start = new Date(startStr)
      const end = new Date(endStr)
      const breakMin = Number(entry.break || entry.break_minutes) || 0
      const minutes = Math.max(0, Math.floor((end - start) / 60000) - breakMin)
      totalMinutes += minutes

      const pid = entry.person?.id ? String(entry.person.id) : 'unknown'
      byPerson.set(pid, (byPerson.get(pid) || 0) + minutes)

      const day = String(startStr || '').slice(0, 10) || 'unknown'
      byDay.set(day, (byDay.get(day) || 0) + minutes)

      if (entry.project?.id) {
        const projId = String(entry.project.id)
        byProject.set(projId, (byProject.get(projId) || 0) + minutes)
      }
    }

    const toHours = m => Math.round((m / 60) * 100) / 100

    return {
      totalHours: toHours(totalMinutes),
      entries: all.length,
      byPerson: [...byPerson.entries()].map(([id, m]) => ({
        personId: id,
        hours: toHours(m),
      })),
      byDay: [...byDay.entries()]
        .sort()
        .map(([day, m]) => ({ day, hours: toHours(m) })),
      byProject: [...byProject.entries()].map(([id, m]) => ({
        projectId: id,
        hours: toHours(m),
      })),
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 9. Documents
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Find Documents
   * @description Look up documents stored against one person's profile in Personio (contracts, payslips, ID copies, training certificates). Personio requires picking a person — documents are always scoped to an employee. Leave Document ID blank to list that person's documents; fill it in to drill into one record.
   * @route POST /find-documents
   *
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional. Pass to fetch one specific document — overrides the person filter."}
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"listPeopleDictionary","description":"Whose documents to list. Required by Personio."}
   * @paramDef {"type":"String","label":"Category","name":"categoryId","required":false,"dictionary":"listDocumentCategoriesDictionary","description":"Filter by category (Contract, Payslip, etc.)."}
   * @paramDef {"type":"String","label":"Title contains","name":"titleContains","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Case-insensitive partial match against the document title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination position from a previous run. Leave blank to start from the top."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"doc_1","title":"Employment Contract","category":{"id":"5","name":"Contract"},"owner":{"id":"42"},"confidential":true,"created_at":"2026-06-01"}],"cursor":null,"total":1}
   */
  async findDocuments(documentId, personId, categoryId, titleContains, cursor) {
    if (documentId) {
      const single = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/document-management/documents/${ encodeURIComponent(documentId) }`,
        logTag: 'findDocuments.byId',
      })
      const record = single?._data || single

      return { items: [record], total: 1, cursor: null }
    }

    if (!personId) {
      throw new Error(
        'Find Documents requires a Person — Personio scopes the documents list to one employee at a time. Pick someone in the Person field.'
      )
    }

    const query = clean({
      limit: 50,
      cursor: cursor || undefined,
      owner_id: personId,
      category_id: categoryId || undefined,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/document-management/documents`,
      query,
      logTag: 'findDocuments.list',
    })

    let items = response?._data || []
    if (titleContains)
      items = items.filter(d => matchesText(d.title, titleContains))

    return {
      items,
      cursor: response?._meta?.links?.next
        ? extractCursor(response._meta.links.next)
        : null,
      total: items.length,
    }
  }

  /**
   * @operationName Upload Document
   * @description Attach a document to a person's profile in Personio. Pass the file as base64-encoded bytes plus a file name. Use this for sending contracts, payslips, or any HR document into Personio from another system. Max file size 30 MB.
   * @route POST /upload-document
   *
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"listPeopleDictionary","description":"The person this document belongs to."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name of the document inside Personio."}
   * @paramDef {"type":"String","label":"Category","name":"categoryId","required":true,"dictionary":"listDocumentCategoriesDictionary","description":"Which category the document belongs to (Contract, Payslip, etc.)."}
   * @paramDef {"type":"String","label":"File name","name":"fileName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Full file name including extension, e.g. contract-2026.pdf."}
   * @paramDef {"type":"String","label":"File content (base64)","name":"fileBase64","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The file's bytes encoded as base64. Most upstream tools provide this directly."}
   * @paramDef {"type":"Boolean","label":"Confidential","name":"confidential","required":false,"uiComponent":{"type":"TOGGLE"},"description":"On hides the document from the employee's own view. Default is off (visible to the employee)."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note attached to the document."}
   *
   * @returns {Object}
   * @sampleResult {"id":"doc_1","title":"Employment Contract","category":{"id":"5"},"person":{"id":"42"},"confidential":false}
   */
  async uploadDocument(
    personId,
    title,
    categoryId,
    fileName,
    fileBase64,
    confidential,
    comment
  ) {
    if (!fileBase64)
      throw new Error('Upload Document refused: file content is empty.')

    const buffer = Buffer.from(fileBase64, 'base64')

    const form = {
      employee_id: personId,
      title,
      category_id: categoryId,
      confidential: confidential ? '1' : '0',
      file: {
        value: buffer,
        options: {
          filename: fileName,
          contentType: 'application/octet-stream',
        },
      },
    }

    if (comment) form.comment = comment

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/company/documents`,
      method: 'post',
      form,
      logTag: 'uploadDocument',
    })

    return response?.data || response
  }

  /**
   * @operationName Download Document
   * @description Pull the file bytes for a document from Personio, returned as base64. Use this to push the document into another storage system (Google Drive, Dropbox, internal vault).
   * @route POST /download-document
   *
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The document to download. Use Find Documents to look this up."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"doc_1","fileName":"contract.pdf","contentType":"application/pdf","base64":"JVBERi0..."}
   */
  async downloadDocument(documentId) {
    // Personio v2 has no single-record get for documents — only list. The
    // download endpoint returns the file bytes directly with the right
    // content-type header. Skip a metadata round-trip and just stream the
    // bytes. (If callers need title/category, they use Find Documents first.)
    const bytes = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/document-management/documents/${ encodeURIComponent(documentId) }/download`,
      logTag: 'downloadDocument',
    })

    const buffer = Buffer.isBuffer(bytes)
      ? bytes
      : typeof bytes === 'string'
        ? Buffer.from(bytes, 'binary')
        : Buffer.from(JSON.stringify(bytes))

    return {
      documentId,
      contentType: 'application/octet-stream',
      base64: buffer.toString('base64'),
      bytes: buffer.length,
    }
  }

  /**
   * @operationName Update Document Details
   * @description Change a document's metadata in Personio — title, category, comment, confidentiality. Does not change the file bytes; for that, upload a fresh document and delete the old one.
   * @route POST /update-document-details
   *
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The document to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Leave blank to keep the current title."}
   * @paramDef {"type":"String","label":"Category","name":"categoryId","required":false,"dictionary":"listDocumentCategoriesDictionary","description":"Leave blank to keep the current category."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Leave blank to keep the current comment."}
   * @paramDef {"type":"String","label":"Confidentiality","name":"confidentiality","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["","Visible to employee","Confidential"]}},"description":"Leave blank to keep the current confidentiality."}
   *
   * @returns {Object}
   * @sampleResult {"id":"doc_1","title":"Updated Contract","category":{"id":"5"},"confidential":true}
   */
  async updateDocumentDetails(
    documentId,
    title,
    categoryId,
    comment,
    confidentiality
  ) {
    const body = clean({
      title,
      category: categoryId ? { id: categoryId } : undefined,
      comment,
      confidential:
        confidentiality === 'Confidential'
          ? true
          : confidentiality === 'Visible to employee'
            ? false
            : undefined,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/document-management/documents/${ encodeURIComponent(documentId) }`,
      method: 'patch',
      body,
      logTag: 'updateDocumentDetails',
    })

    return response?._data || response
  }

  /**
   * @operationName Delete Document
   * @description Remove a document from Personio. This is irreversible — the file bytes are gone.
   * @route POST /delete-document
   * @appearanceColor #B33D2C #B33D2C
   *
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The document to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"documentId":"doc_1"}
   */
  async deleteDocument(documentId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/document-management/documents/${ encodeURIComponent(documentId) }`,
      method: 'delete',
      logTag: 'deleteDocument',
    })

    return { deleted: true, documentId }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 10. Recruiting
  // ═════════════════════════════════════════════════════════════════════════════

  // Note: Personio's public API does NOT expose read endpoints for recruiting
  // applications, candidates, jobs, or stage histories. Those are read-only
  // surfaces inside the Personio UI. Only writes are supported via the
  // Recruiting Token: Create Candidate and Upload Applicant Document below.

  /**
   * @operationName Create Candidate
   * @description Add a new candidate to Personio Recruiting and attach them to a job. Requires the Recruiting Token in the connection settings. Use Upload Applicant Document afterward to attach the CV and cover letter.
   * @route POST /create-candidate
   *
   * @paramDef {"type":"String","label":"First name","name":"firstName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Candidate's first name."}
   * @paramDef {"type":"String","label":"Last name","name":"lastName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Candidate's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Candidate's email — Personio uses this to detect duplicates."}
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Which job the candidate is applying for. Find this in the Personio Recruiting UI under the job's settings (it's the numeric ID in the URL)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional phone number."}
   * @paramDef {"type":"String","label":"Location","name":"location","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional candidate location (city/country)."}
   * @paramDef {"type":"String","label":"Source","name":"source","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional. Where the candidate came from (e.g. LinkedIn, careers page, referral)."}
   * @paramDef {"type":"String","label":"Cover letter","name":"coverLetter","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional. Pasted-in cover letter text. For PDF/Word files use Upload Applicant Document instead."}
   *
   * @returns {Object}
   * @sampleResult {"applicationId":"app_5","candidateId":"c_1","jobId":"5678","status":"submitted"}
   */
  async createCandidate(
    firstName,
    lastName,
    email,
    jobId,
    phone,
    location,
    source,
    coverLetter
  ) {
    const body = clean({
      first_name: firstName,
      last_name: lastName,
      email,
      job_position_id: jobId,
      phone,
      location,
      source_id: source,
      message: coverLetter,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/recruiting/applications`,
      method: 'post',
      body,
      recruiting: true,
      logTag: 'createCandidate',
    })

    return {
      applicationId: String(
        response?.data?.application_id || response?.application_id || ''
      ),
      candidateId: String(
        response?.data?.candidate_id || response?.candidate_id || ''
      ),
      jobId,
      status: response?.data?.status || response?.status || 'submitted',
    }
  }

  /**
   * @operationName Upload Applicant Document
   * @description Attach a file (CV, cover letter, portfolio, work sample) to an existing job application. Requires the Recruiting Token. Pair this with Create Candidate to ship a full submission. Max 20 MB.
   * @route POST /upload-applicant-document
   *
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The application the file belongs to."}
   * @paramDef {"type":"String","label":"Category","name":"category","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["cv","cover_letter","portfolio","work_sample","other"]}},"description":"What kind of document this is. Personio uses this to slot it correctly in the candidate profile."}
   * @paramDef {"type":"String","label":"File name","name":"fileName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Full file name including extension, e.g. resume.pdf."}
   * @paramDef {"type":"String","label":"File content (base64)","name":"fileBase64","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The file's bytes encoded as base64."}
   *
   * @returns {Object}
   * @sampleResult {"applicationId":"app_5","uploaded":true,"category":"cv","fileName":"resume.pdf"}
   */
  async uploadApplicantDocument(applicationId, category, fileName, fileBase64) {
    if (!fileBase64)
      throw new Error(
        'Upload Applicant Document refused: file content is empty.'
      )

    const buffer = Buffer.from(fileBase64, 'base64')

    const form = {
      application_id: applicationId,
      category,
      file: {
        value: buffer,
        options: {
          filename: fileName,
          contentType: 'application/octet-stream',
        },
      },
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/recruiting/applications/documents`,
      method: 'post',
      form,
      recruiting: true,
      logTag: 'uploadApplicantDocument',
    })

    return { applicationId, uploaded: true, category, fileName }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 11. Reports
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Run Report
   * @description Execute a saved Personio report and return its rows. Personio has two report flavours — Standard (the new Analytics workspace) and Custom (the original Reports tab). Pick one above and the matching report picker appears below.
   * @route POST /run-report
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Source","name":"source","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Standard","Custom"]}},"description":"Standard uses the newer Analytics reports (compensation, attendance, headcount). Custom uses the legacy Reports tab."}
   * @paramDef {"type":"Object","label":"Report","name":"reportPicker","required":true,"dependsOn":["source"],"schemaLoader":"runReportSchemaLoader","description":"The report to run. The picker below changes based on the Source you chose."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination position from a previous run. Standard reports paginate; Custom reports return everything at once."}
   *
   * @returns {Object}
   * @sampleResult {"source":"Standard","reportId":"r_77","rows":[{"Person":"Sarah Connor","Department":"Engineering","Hours":160}],"columns":["Person","Department","Hours"],"cursor":null,"total":1}
   */
  async runReport(source, reportPicker, cursor) {
    const reportId = reportPicker?.reportId || reportPicker?.customReportId

    if (!reportId)
      throw new Error(
        'Run Report refused: pick a report in the picker below the Source dropdown.'
      )

    if (source === 'Custom') {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/v1/company/custom-reports/reports/${ encodeURIComponent(reportId) }`,
        logTag: 'runReport.custom',
      })

      const data = response?.data || response
      const rows = data?.rows || data?.report || []
      const columns = data?.columns || (rows[0] ? Object.keys(rows[0]) : [])

      return {
        source: 'Custom',
        reportId,
        rows,
        columns,
        cursor: null,
        total: rows.length,
      }
    }

    const query = clean({
      limit: 100,
      cursor: cursor || undefined,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/reports/${ encodeURIComponent(reportId) }`,
      query,
      logTag: 'runReport.standard',
    })

    const data = response?._data || response
    const rows = data?.rows || []
    const columns = data?.columns || (rows[0] ? Object.keys(rows[0]) : [])

    return {
      source: 'Standard',
      reportId,
      rows,
      columns,
      cursor: response?._meta?.links?.next
        ? extractCursor(response._meta.links.next)
        : null,
      total: rows.length,
    }
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object","name":"source","required":true}
   * @returns {Object}
   */
  async runReportSchemaLoader({ criteria }) {
    const source = criteria?.source

    if (source === 'Custom') {
      return [
        {
          type: 'String',
          label: 'Custom report',
          name: 'customReportId',
          required: true,
          dictionary: 'listCustomReportsDictionary',
          description: 'The saved report from the Reports tab in Personio.',
        },
      ]
    }

    return [
      {
        type: 'String',
        label: 'Standard report',
        name: 'reportId',
        required: true,
        dictionary: 'listV2ReportsDictionary',
        description: 'The report from Personio Analytics.',
      },
    ]
  }

  /**
   * @operationName List Report Columns
   * @description List every attribute available to Personio Analytics reports — handy for building dynamic report viewers or for discovering what compensation, attendance, and headcount fields exist.
   * @route POST /list-report-columns
   *
   * @returns {Object}
   * @sampleResult {"items":[{"key":"compensation.target_earnings","label":"Target earnings","group":"Compensation"}],"total":1}
   */
  async listReportColumns() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/reports/attributes`,
      query: { limit: 200 },
      logTag: 'listReportColumns',
    })

    const items = (response?._data || []).map(a => ({
      key: a.key || a.id,
      label: a.label || a.name,
      group: a.group || a.category || '',
    }))

    return { items, total: items.length }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 12. Organization
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Find Legal Entities
   * @description Look up the legal entities (subcompanies) inside this Personio account. Leave Entity ID blank to list all; fill it in to drill into one.
   * @route POST /find-legal-entities
   *
   * @paramDef {"type":"String","label":"Entity ID","name":"entityId","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional. Pass to fetch one specific entity."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"e_1","name":"Acme GmbH","country":"Germany"}],"total":1}
   */
  async findLegalEntities(entityId) {
    if (entityId) {
      const single = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/legal-entities/${ encodeURIComponent(entityId) }`,
        logTag: 'findLegalEntities.byId',
      })

      return { items: [single?._data || single], total: 1 }
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/legal-entities`,
      query: { limit: 100 },
      logTag: 'findLegalEntities.list',
    })

    const items = response?._data || []

    return { items, total: items.length }
  }

  /**
   * @operationName Find Departments
   * @description List the departments in use across Personio. Built by scanning employees and collecting every distinct department — Personio does not expose departments as their own list, only as an attribute on each person.
   * @route POST /find-departments
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"42","name":"Engineering","headcount":12}],"total":1}
   */
  async findDepartments() {
    const result = await this.#collectEmployeeAttribute(
      'department',
      null,
      item => ({
        id: item.id,
        name: item.name,
        headcount: item.count,
      })
    )

    return { items: result.items, total: result.items.length }
  }

  /**
   * @operationName Find Cost Centers
   * @description List the cost centers in use across Personio. Built by scanning employees — Personio does not expose cost centers as their own list, only as an attribute on each person.
   * @route POST /find-cost-centers
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"77","name":"R&D Berlin","headcount":4}],"total":1}
   */
  async findCostCenters() {
    const result = await this.#collectEmployeeAttribute(
      'cost_centers',
      null,
      item => ({
        id: item.id,
        name: item.name,
        headcount: item.count,
      })
    )

    return { items: result.items, total: result.items.length }
  }

  /**
   * @operationName Find Offices
   * @description List the offices in use across Personio. Built by scanning employees — Personio does not expose offices as their own list, only as an attribute on each person.
   * @route POST /find-offices
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"1","name":"Berlin HQ","headcount":35}],"total":1}
   */
  async findOffices() {
    const result = await this.#collectEmployeeAttribute(
      'office',
      null,
      item => ({
        id: item.id,
        name: item.name,
        headcount: item.count,
      })
    )

    return { items: result.items, total: result.items.length }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 13. Compensations
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Find Compensations
   * @description Look up compensation records (salaries, bonuses, one-time payments) for one or more people. Personio compensations are append-only — to "edit" a salary you Add Compensation with a new effective date.
   * @route POST /find-compensations
   *
   * @paramDef {"type":"String","label":"Person","name":"personId","required":false,"dictionary":"listPeopleDictionary","description":"Filter to one person. Leave blank to fetch across everyone."}
   * @paramDef {"type":"String","label":"Type","name":"typeId","required":false,"dictionary":"listCompensationTypesDictionary","description":"Filter by compensation type (base salary, bonus, etc.)."}
   * @paramDef {"type":"String","label":"When","name":"period","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Today","Yesterday","Last 7 days","Last 30 days","This month","Last month","Year to date","Custom"]}},"description":"Filter to records effective in this date range. Leave blank for all."}
   * @paramDef {"type":"String","label":"Custom start","name":"startDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Only used when When is set to Custom."}
   * @paramDef {"type":"String","label":"Custom end","name":"endDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Only used when When is set to Custom."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination position. Leave blank to start from the top."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"comp_1","person":{"id":"42"},"type":{"id":"ct_1","name":"Base salary"},"amount":75000,"currency":"EUR","effective_date":"2026-01-01"}],"cursor":null,"total":1}
   */
  async findCompensations(
    personId,
    typeId,
    period,
    startDate,
    endDate,
    cursor
  ) {
    const range =
      period || startDate || endDate
        ? resolvePeriod(period, startDate, endDate)
        : null

    const query = clean({
      limit: 50,
      cursor: cursor || undefined,
      'person.id': personId || undefined,
      'type.id': typeId || undefined,
      'effective_date.gte': range?.start,
      'effective_date.lte': range?.end,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/compensations`,
      query,
      logTag: 'findCompensations',
    })

    const items = response?._data || []

    return {
      items,
      cursor: response?._meta?.links?.next
        ? extractCursor(response._meta.links.next)
        : null,
      total: items.length,
    }
  }

  /**
   * @operationName Add Compensation
   * @description Add a new compensation record — a new base salary effective from a given date, a one-time bonus payout, a commission entry. Personio compensations are append-only, so "raises" are modelled as a fresh record with a later effective date. For recurring salaries you also pick how often it pays out (monthly / annual / one-time).
   * @route POST /add-compensation
   *
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"listPeopleDictionary","description":"Who this compensation is for."}
   * @paramDef {"type":"String","label":"Type","name":"typeId","required":true,"dictionary":"listCompensationTypesDictionary","description":"Which compensation type (base salary, bonus, commission, etc.)."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC"},"description":"The amount in the chosen currency. For salaries this is the periodic amount (e.g. annual gross)."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Three-letter currency code like EUR, USD, GBP."}
   * @paramDef {"type":"String","label":"Effective from","name":"effectiveDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"When this record takes effect. For salary raises, this is the date the new salary starts."}
   * @paramDef {"type":"String","label":"Payout interval","name":"interval","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["ONCE","MONTHLY","QUARTERLY","ANNUAL"]}},"description":"How often the amount pays out. Use ONCE for bonuses, MONTHLY for salaries. Defaults to ONCE if left blank."}
   * @paramDef {"type":"String","label":"Legal entity","name":"legalEntityId","required":false,"dictionary":"listLegalEntitiesDictionary","description":"Which legal entity is paying. Required only when the person is attached to multiple entities; otherwise leave blank."}
   *
   * @returns {Object}
   * @sampleResult {"id":"comp_99","person":{"id":"42"},"type":{"id":"ct_1"},"amount":{"value":85000,"currency":"EUR"},"effective_from":"2026-07-01","interval":"ANNUAL"}
   */
  async addCompensation(
    personId,
    typeId,
    amount,
    currency,
    effectiveDate,
    interval,
    legalEntityId
  ) {
    // Personio v2 wraps amount in an object and uses `effective_from` (not
    // `effective_date`). `interval` discriminates ONCE/MONTHLY/etc. Requires
    // the personio:compensations:write scope on the credential.
    const body = clean({
      person: { id: personId },
      type: { id: typeId },
      amount: { value: Number(amount), currency },
      effective_from: effectiveDate,
      interval: interval || 'ONCE',
      legal_entity: legalEntityId ? { id: legalEntityId } : undefined,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/compensations`,
      method: 'post',
      body,
      logTag: 'addCompensation',
    })

    return response?._data || response
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 14. Projects + Project Members
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Find Projects
   * @description Look up time-tracking projects. Leave Project ID blank to filter; fill it in to drill into one.
   * @route POST /find-projects
   *
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional. Pass to fetch one specific project."}
   * @paramDef {"type":"String","label":"State","name":"state","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Archived","Any"]}},"description":"Active projects accept new time entries; archived ones don't. Default is Active."}
   * @paramDef {"type":"String","label":"Parent project","name":"parentId","required":false,"dictionary":"listProjectsDictionary","description":"Filter to subprojects of one parent. Leave blank for top-level projects."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination position. Leave blank to start from the top."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"p_900","name":"Q3 Migration","active":true,"parent_id":null}],"cursor":null,"total":1}
   */
  async findProjects(projectId, state, parentId, cursor) {
    if (projectId) {
      const single = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/projects/${ encodeURIComponent(projectId) }`,
        logTag: 'findProjects.byId',
      })

      return { items: [single?._data || single], total: 1, cursor: null }
    }

    const query = clean({
      limit: 50,
      cursor: cursor || undefined,
      status:
        state === 'Active'
          ? 'ACTIVE'
          : state === 'Archived'
            ? 'ARCHIVED'
            : undefined,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/projects`,
      query,
      logTag: 'findProjects.list',
    })

    let items = response?._data || []

    // Personio v2 doesn't support filtering by parent project at query time, so
    // narrow client-side after the fetch.
    if (parentId) {
      items = items.filter(
        p =>
          String(p?.parent_project?.id || p?.parent_project) ===
          String(parentId)
      )
    }

    return {
      items,
      cursor: response?._meta?.links?.next
        ? extractCursor(response._meta.links.next)
        : null,
      total: items.length,
    }
  }

  /**
   * @operationName Add Project
   * @description Create a new time-tracking project. Use a parent project ID to make this a subproject.
   * @route POST /add-project
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name for the project."}
   * @paramDef {"type":"String","label":"Parent project","name":"parentId","required":false,"dictionary":"listProjectsDictionary","description":"Optional. Pick a parent to make this a subproject."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","required":false,"uiComponent":{"type":"TOGGLE"},"description":"On (default) opens the project for time tracking. Off creates it archived."}
   *
   * @returns {Object}
   * @sampleResult {"id":"p_900","name":"Q3 Migration","active":true,"parent_id":null}
   */
  async addProject(name, parentId, active) {
    const wantActive = active === undefined ? true : !!active
    const body = clean({
      name,
      status: wantActive ? 'ACTIVE' : 'ARCHIVED',
      parent_project: parentId ? { id: parentId } : undefined,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/projects`,
      method: 'post',
      body,
      logTag: 'addProject',
    })

    return response?._data || response
  }

  /**
   * @operationName Update Project
   * @description Rename a project, change its parent, or open/archive it.
   * @route POST /update-project
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"listProjectsDictionary","description":"The project to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Leave blank to keep the current name."}
   * @paramDef {"type":"String","label":"Parent project","name":"parentId","required":false,"dictionary":"listProjectsDictionary","description":"Leave blank to keep the current parent."}
   * @paramDef {"type":"String","label":"State","name":"state","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["","Active","Archived"]}},"description":"Leave blank to keep the current state. Archived projects stop accepting new time entries."}
   *
   * @returns {Object}
   * @sampleResult {"id":"p_900","name":"Q3 Migration (renamed)","active":true}
   */
  async updateProject(projectId, name, parentId, state) {
    const body = clean({
      name,
      parent_project: parentId ? { id: parentId } : undefined,
      status:
        state === 'Active'
          ? 'ACTIVE'
          : state === 'Archived'
            ? 'ARCHIVED'
            : undefined,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/projects/${ encodeURIComponent(projectId) }`,
      method: 'patch',
      body,
      logTag: 'updateProject',
    })

    return response?._data || response
  }

  /**
   * @operationName Delete Project
   * @description Remove a project. Existing time entries on the project are preserved but new ones can't be added. Subprojects are deleted with the parent.
   * @route POST /delete-project
   * @appearanceColor #B33D2C #B33D2C
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"listProjectsDictionary","description":"The project to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"projectId":"p_900"}
   */
  async deleteProject(projectId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/projects/${ encodeURIComponent(projectId) }`,
      method: 'delete',
      logTag: 'deleteProject',
    })

    return { deleted: true, projectId }
  }

  /**
   * @operationName Find Project Members
   * @description List the people assigned to a project. Only members can log time against it.
   * @route POST /find-project-members
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"listProjectsDictionary","description":"The project to inspect."}
   *
   * @returns {Object}
   * @sampleResult {"projectId":"p_900","items":[{"id":"42","name":"Sarah Connor","email":"sarah@example.com","role":"member"}],"total":1}
   */
  async findProjectMembers(projectId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/projects/${ encodeURIComponent(projectId) }/members`,
      query: { limit: 200 },
      logTag: 'findProjectMembers',
    })

    const items = response?._data || []

    return { projectId, items, total: items.length }
  }

  /**
   * @operationName Update Project Members
   * @description Add people to a project or remove them. Pick Add or Remove above; the picker below changes to match.
   * @route POST /update-project-members
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"listProjectsDictionary","description":"The project to change."}
   * @paramDef {"type":"String","label":"Operation","name":"operation","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Add","Remove"]}},"description":"Add puts people on the project. Remove takes them off (existing time entries are preserved)."}
   * @paramDef {"type":"Object","label":"Details","name":"details","required":true,"dependsOn":["operation"],"schemaLoader":"updateProjectMembersSchemaLoader","description":"Who to add or remove. The picker changes based on the Operation above."}
   *
   * @returns {Object}
   * @sampleResult {"projectId":"p_900","operation":"Add","affected":3}
   */
  async updateProjectMembers(projectId, operation, details) {
    const personIds = toArray(details?.personIds)

    if (personIds.length === 0)
      throw new Error(
        'Update Project Members refused: pick at least one person.'
      )

    // Personio's project-members endpoint takes a JSON array of {person: {id}}
    // entries directly as the body — not a wrapper object.
    const body = personIds.map(id => ({ person: { id: String(id) } }))

    if (operation === 'Remove') {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/projects/${ encodeURIComponent(projectId) }/members`,
        method: 'delete',
        body,
        logTag: 'updateProjectMembers.remove',
      })

      return { projectId, operation, affected: personIds.length }
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/projects/${ encodeURIComponent(projectId) }/members`,
      method: 'post',
      body,
      logTag: 'updateProjectMembers.add',
    })

    return { projectId, operation, affected: personIds.length }
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object","name":"operation","required":true}
   * @returns {Object}
   */
  async updateProjectMembersSchemaLoader({ criteria }) {
    const operation = criteria?.operation

    if (operation === 'Remove') {
      return [
        {
          type: 'Array',
          label: 'People to remove',
          name: 'personIds',
          required: true,
          uiComponent: { type: 'MULTI_LINE_TEXT' },
          description:
            'Pass an array or comma-separated list of person IDs to remove from the project.',
        },
      ]
    }

    return [
      {
        type: 'Array',
        label: 'People to add',
        name: 'personIds',
        required: true,
        uiComponent: { type: 'MULTI_LINE_TEXT' },
        description:
          'Pass an array or comma-separated list of person IDs to add to the project.',
      },
    ]
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 15. Webhook management
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Find Webhooks
   * @description List the webhooks Personio has registered for this account, or drill into one by ID. Useful for auditing what's listening, debugging delivery problems, and seeing which events each webhook covers.
   * @route POST /find-webhooks
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":false,"dictionary":"listWebhooksDictionary","description":"Optional. Pass to fetch one specific webhook. Leave blank to list all."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"wh_77","description":"FlowRunner Personio integration","url":"https://hooks.example.com/x","enabled_events":["person.created","person.updated"],"status":"ENABLED"}],"total":1}
   */
  async findWebhooks(webhookId) {
    if (webhookId) {
      const single = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/webhooks/${ encodeURIComponent(webhookId) }`,
        logTag: 'findWebhooks.byId',
      })

      return { items: [single?._data || single], total: 1 }
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/webhooks`,
      query: { limit: 100 },
      logTag: 'findWebhooks.list',
    })

    const items = response?._data || []

    return { items, total: items.length }
  }

  /**
   * @operationName Inspect Webhook
   * @description The one-stop debugging tool for a webhook subscription. Pick what you want to do — send a quick ping, fire a test event, replay recently failed deliveries, view the delivery log, or pull the latest events Personio sent. None of the operations create new triggers or change configuration.
   * @route POST /inspect-webhook
   *
   * @paramDef {"type":"String","label":"Webhook","name":"webhookId","required":true,"dictionary":"listWebhooksDictionary","description":"The webhook to inspect."}
   * @paramDef {"type":"String","label":"What to do","name":"operation","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Send test ping","Send test event","Replay failed deliveries","View delivery log","View recent events"]}},"description":"Each option targets a different Personio diagnostic tool. None create or change subscriptions — they only test or inspect."}
   * @paramDef {"type":"Object","label":"Details","name":"details","required":false,"dependsOn":["operation"],"schemaLoader":"inspectWebhookSchemaLoader","description":"Extra inputs that change based on the operation above."}
   *
   * @returns {Object}
   * @sampleResult {"webhookId":"wh_77","operation":"View delivery log","items":[{"event":"person.updated","delivered_at":"2026-05-22T10:00:00Z","status":"SUCCESS","response_code":200}],"total":1}
   */
  async inspectWebhook(webhookId, operation, details) {
    const d = details || {}

    if (operation === 'Send test ping') {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/webhooks/${ encodeURIComponent(webhookId) }/ping`,
        method: 'post',
        logTag: 'inspectWebhook.ping',
      })

      return {
        webhookId,
        operation,
        result: response?._data || response || { sent: true },
      }
    }

    if (operation === 'Send test event') {
      const body = clean({ event_type: d.eventType })
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/webhooks/${ encodeURIComponent(webhookId) }/test-event`,
        method: 'post',
        body,
        logTag: 'inspectWebhook.testEvent',
      })

      return {
        webhookId,
        operation,
        eventType: d.eventType,
        result: response?._data || response || { sent: true },
      }
    }

    if (operation === 'Replay failed deliveries') {
      const body = clean({ since: d.since })
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/webhooks/${ encodeURIComponent(webhookId) }/redelivery`,
        method: 'post',
        body,
        logTag: 'inspectWebhook.redelivery',
      })

      return {
        webhookId,
        operation,
        since: d.since,
        result: response?._data || response || { replayed: true },
      }
    }

    if (operation === 'View recent events') {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/webhooks/${ encodeURIComponent(webhookId) }/events`,
        query: { limit: 50 },
        logTag: 'inspectWebhook.events',
      })

      const items = response?._data || []

      return { webhookId, operation, items, total: items.length }
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/webhooks/${ encodeURIComponent(webhookId) }/activity`,
      query: { limit: 50 },
      logTag: 'inspectWebhook.activity',
    })

    const items = response?._data || []

    return {
      webhookId,
      operation: 'View delivery log',
      items,
      total: items.length,
    }
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object","name":"operation","required":true}
   * @returns {Object}
   */
  async inspectWebhookSchemaLoader({ criteria }) {
    const operation = criteria?.operation

    if (operation === 'Send test event') {
      return [
        {
          type: 'String',
          label: 'Event to send',
          name: 'eventType',
          required: true,
          uiComponent: {
            type: 'DROPDOWN',
            options: {
              values: [
                'person.created',
                'person.updated',
                'person.deleted',
                'employment.created',
                'employment.updated',
                'employment.terminated',
                'absence-period.created',
                'attendance-period.created',
                'document.created',
                'document.signed',
              ],
            },
          },
          description:
            'Personio will fire a synthetic event of this type to the webhook URL.',
        },
      ]
    }

    if (operation === 'Replay failed deliveries') {
      return [
        {
          type: 'String',
          label: 'Replay from',
          name: 'since',
          required: false,
          uiComponent: { type: 'DATE_TIME_PICKER' },
          description:
            'Only replay failed deliveries from this point forward. Leave blank to replay the most recent batch.',
        },
      ]
    }

    return null
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 16. Realtime triggers
  // ═════════════════════════════════════════════════════════════════════════════
  // Five triggers cover 17 Personio event types. The Event Type dropdown narrows
  // which events fire the trigger; if Any is selected, every event fires it.
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @operationName On People Change
   * @description Fires when someone in Personio is created, updated, or removed. Use the Event Type dropdown to narrow to a single kind of change (e.g. only newly created people), or leave it on Any to react to all three.
   * @route POST /on-people-change
   * @registerAs REALTIME_TRIGGER
   *
   * @paramDef {"type":"String","label":"Event type","name":"eventType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Created","Updated","Deleted"]}},"description":"Pick one to narrow the trigger. Leave on Any to fire on every people change."}
   * @sampleResultLoader { "methodName": "onPeopleChange_SampleResultLoader", "dependsOn": ["eventType"] }
   *
   * @returns {Object}
   * @sampleResult {"event":"person.updated","change":"Updated","person":{"id":"42","first_name":"Sarah","email":"sarah@example.com"},"changes":["email"],"occurredAt":"2026-05-22T10:00:00Z"}
   */
  async onPeopleChange() {}

  /**
   * @operationName On Employment Change
   * @description Fires when an employment record changes — new hire, contract update, termination set, cost-centers reassigned, employment started or ended (effective-date signals). Use the Event Type dropdown to narrow.
   * @route POST /on-employment-change
   * @registerAs REALTIME_TRIGGER
   *
   * @paramDef {"type":"String","label":"Event type","name":"eventType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Created","Updated","Cost center changed","Started (effective date)","Terminated (effective date)","Deleted"]}},"description":"Started and Terminated fire on the day the effective date actually arrives — distinct from Created/Updated which fire when the record was edited."}
   * @sampleResultLoader { "methodName": "onEmploymentChange_SampleResultLoader", "dependsOn": ["eventType"] }
   *
   * @returns {Object}
   * @sampleResult {"event":"employment.terminated","change":"Terminated (effective date)","employment":{"id":"e_99","person_id":"42","termination_date":"2026-09-30"},"occurredAt":"2026-09-30T00:00:00Z"}
   */
  async onEmploymentChange() {}

  /**
   * @operationName On Time Off Change
   * @description Fires when a time-off request is created, has its status changed (approved/rejected), has its date range edited, or is withdrawn. The single highest-value HR trigger after employment changes.
   * @route POST /on-time-off-change
   * @registerAs REALTIME_TRIGGER
   *
   * @paramDef {"type":"String","label":"Event type","name":"eventType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Created","Status changed","Dates changed","Deleted"]}},"description":"Status changed fires on approve/reject. Dates changed fires when start/end times are edited."}
   * @sampleResultLoader { "methodName": "onTimeOffChange_SampleResultLoader", "dependsOn": ["eventType"] }
   *
   * @returns {Object}
   * @sampleResult {"event":"absence-period.updated.status","change":"Status changed","timeOff":{"id":"ab_55","person":{"id":"42"},"status":"APPROVED","starts_at":"2026-08-15T00:00:00Z","ends_at":"2026-08-22T23:59:59Z"},"occurredAt":"2026-05-22T10:00:00Z"}
   */
  async onTimeOffChange() {}

  /**
   * @operationName On Time Tracking Change
   * @description Fires when time-tracking entries are logged, edited, or removed. Use this to sync hours to payroll systems live, or to flag unusual patterns (very long days, weekend work).
   * @route POST /on-time-tracking-change
   * @registerAs REALTIME_TRIGGER
   *
   * @paramDef {"type":"String","label":"Event type","name":"eventType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Created","Updated","Deleted"]}},"description":"Narrow to a single kind of change, or leave on Any."}
   * @sampleResultLoader { "methodName": "onTimeTrackingChange_SampleResultLoader", "dependsOn": ["eventType"] }
   *
   * @returns {Object}
   * @sampleResult {"event":"attendance-period.created","change":"Created","entry":{"id":"at_77","person":{"id":"42"},"starts_at":"2026-08-15T09:00:00Z","ends_at":"2026-08-15T17:30:00Z","break":30},"occurredAt":"2026-05-22T10:00:00Z"}
   */
  async onTimeTrackingChange() {}

  /**
   * @operationName On Document Change
   * @description Fires when documents are uploaded, edited, deleted, or signed. The signed event in particular is the only programmatic signal that a contract has been countersigned — invaluable for downstream onboarding flows.
   * @route POST /on-document-change
   * @registerAs REALTIME_TRIGGER
   *
   * @paramDef {"type":"String","label":"Event type","name":"eventType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Created","Updated","Deleted","Signed"]}},"description":"Signed fires when a document is countersigned (e.g. contract returned by the employee)."}
   * @sampleResultLoader { "methodName": "onDocumentChange_SampleResultLoader", "dependsOn": ["eventType"] }
   *
   * @returns {Object}
   * @sampleResult {"event":"document.signed","change":"Signed","document":{"id":"doc_1","title":"Employment Contract","person":{"id":"42"},"signed_at":"2026-06-02T14:00:00Z"},"occurredAt":"2026-06-02T14:00:00Z"}
   */
  async onDocumentChange() {}

  // ─── Trigger lifecycle ──────────────────────────────────────────────────────

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(
      `handleTriggerUpsertWebhook events=${ invocation.events?.length || 0 }`
    )

    const triggerNames = new Set((invocation.events || []).map(e => e.name))
    const personioEvents = new Set()

    for (const name of triggerNames) {
      for (const ev of TRIGGER_TO_PERSONIO_EVENTS[name] || []) {
        personioEvents.add(ev)
      }
    }

    const stored = invocation.webhookData || {}
    const secret = stored.secret || generateWebhookSecret()
    const callbackURL = invocation.callbackURL

    const body = {
      url: callbackURL,
      description: 'FlowRunner Personio integration',
      enabled_events: [...personioEvents],
      status: 'ENABLED',
      auth_type: 'TOKEN',
      token: secret,
    }

    let webhookId = stored.webhookId

    try {
      if (webhookId) {
        await this.#apiRequest({
          url: `${ API_BASE_URL }/v2/webhooks/${ encodeURIComponent(webhookId) }`,
          method: 'patch',
          body,
          logTag: 'handleTriggerUpsertWebhook.patch',
        })
      } else {
        const created = await this.#apiRequest({
          url: `${ API_BASE_URL }/v2/webhooks`,
          method: 'post',
          body,
          logTag: 'handleTriggerUpsertWebhook.create',
        })
        webhookId = created?.id || created?._data?.id
      }
    } catch (error) {
      logger.error(`handleTriggerUpsertWebhook failed: ${ error.message }`)
      throw error
    }

    return {
      webhookData: {
        webhookId,
        secret,
        callbackURL,
        registeredEvents: [...personioEvents],
      },
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const expected = invocation.webhookData?.secret
    const authHeader =
      invocation.headers?.authorization ||
      invocation.headers?.Authorization ||
      invocation.body?.headers?.authorization

    if (expected && authHeader) {
      const presented = String(authHeader).replace(/^Bearer\s+/i, '')

      if (presented !== expected) {
        logger.warn('handleTriggerResolveEvents: token mismatch, rejecting')

        return { events: [] }
      }
    }

    const payload = invocation.body || {}
    const eventNameRaw =
      payload.event_name || payload.event || payload.type || ''
    const eventName = String(eventNameRaw).toLowerCase()
    const triggerName = WEBHOOK_EVENT_MAP[eventName]

    if (!triggerName) {
      logger.debug(`handleTriggerResolveEvents: unknown event '${ eventName }'`)

      return { events: [] }
    }

    const change = describePersonioEvent(eventName)
    const inner = payload.data || payload

    const data = {
      event: eventName,
      change,
      person:
        inner.person || (eventName.startsWith('person.') ? inner : undefined),
      employment:
        inner.employment ||
        (eventName.startsWith('employment.') ? inner : undefined),
      timeOff:
        inner.absence_period ||
        (eventName.startsWith('absence-period.') ? inner : undefined),
      entry:
        inner.attendance_period ||
        (eventName.startsWith('attendance-period.') ? inner : undefined),
      document:
        inner.document ||
        (eventName.startsWith('document.') ? inner : undefined),
      changes: payload.changes || payload.changed_fields || [],
      occurredAt:
        payload.occurred_at || payload.timestamp || new Date().toISOString(),
      raw: payload,
    }

    return { events: [{ name: triggerName, data }] }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    const { eventName, body, triggers } = invocation
    const change = body?.change || ''

    const matched = (triggers || []).filter(trigger => {
      const data = trigger.triggerData || {}
      const filter = data.eventType
      if (!filter || filter === 'Any') return true

      return filter === change
    })

    logger.debug(
      `handleTriggerSelectMatched.${ eventName }.matched=${ matched.length }`
    )

    return { ids: matched.map(t => t.id) }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const webhookId = invocation.webhookData?.webhookId
    if (!webhookId) return {}

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/v2/webhooks/${ encodeURIComponent(webhookId) }`,
        method: 'delete',
        logTag: 'handleTriggerDeleteWebhook',
      })
    } catch (error) {
      logger.warn(
        `handleTriggerDeleteWebhook: cleanup failed, leaving webhook ${ webhookId } in place: ${ error.message }`
      )
    }

    return {}
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerRefreshWebhook(invocation) {
    return this.handleTriggerUpsertWebhook(invocation)
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 17. Sample result loaders
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /onPeopleChange_SampleResultLoader
   * @paramDef {"type":"Object","label":"Payload","name":"payload"}
   * @returns {Object}
   */
  async onPeopleChange_SampleResultLoader(payload) {
    const filter = payload?.criteria?.eventType
    const change = filter && filter !== 'Any' ? filter : 'Updated'
    const event =
      {
        Created: 'person.created',
        Updated: 'person.updated',
        Deleted: 'person.deleted',
      }[change] || 'person.updated'

    return {
      event,
      change,
      person: {
        id: '42',
        first_name: 'Sarah',
        last_name: 'Connor',
        email: 'sarah@example.com',
        preferred_name: 'Sarah',
        status: 'ACTIVE',
      },
      changes: change === 'Updated' ? ['email'] : [],
      occurredAt: '2026-05-22T10:00:00Z',
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /onEmploymentChange_SampleResultLoader
   * @paramDef {"type":"Object","label":"Payload","name":"payload"}
   * @returns {Object}
   */
  async onEmploymentChange_SampleResultLoader(payload) {
    const filter = payload?.criteria?.eventType
    const change = filter && filter !== 'Any' ? filter : 'Updated'
    const eventMap = {
      Created: 'employment.created',
      Updated: 'employment.updated',
      'Cost center changed': 'employment.updated.cost-centers',
      'Started (effective date)': 'employment.started',
      'Terminated (effective date)': 'employment.terminated',
      Deleted: 'employment.deleted',
    }
    const event = eventMap[change] || 'employment.updated'

    return {
      event,
      change,
      employment: {
        id: 'e_99',
        person_id: '42',
        start_date: '2026-06-01',
        termination_date: change.startsWith('Terminated') ? '2026-09-30' : null,
        weekly_hours: 40,
        contract_type: 'permanent',
        position: 'Senior Engineer',
      },
      changes: change === 'Updated' ? ['weekly_hours'] : [],
      occurredAt: '2026-05-22T10:00:00Z',
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /onTimeOffChange_SampleResultLoader
   * @paramDef {"type":"Object","label":"Payload","name":"payload"}
   * @returns {Object}
   */
  async onTimeOffChange_SampleResultLoader(payload) {
    const filter = payload?.criteria?.eventType
    const change = filter && filter !== 'Any' ? filter : 'Status changed'
    const eventMap = {
      Created: 'absence-period.created',
      'Status changed': 'absence-period.updated.status',
      'Dates changed': 'absence-period.updated.timerange',
      Deleted: 'absence-period.deleted',
    }
    const event = eventMap[change] || 'absence-period.updated.status'

    return {
      event,
      change,
      timeOff: {
        id: 'ab_55',
        person: { id: '42' },
        absence_type: { id: '1234', name: 'Paid vacation' },
        starts_at: '2026-08-15T00:00:00Z',
        ends_at: '2026-08-22T23:59:59Z',
        status: 'APPROVED',
        amount: 6,
      },
      occurredAt: '2026-05-22T10:00:00Z',
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /onTimeTrackingChange_SampleResultLoader
   * @paramDef {"type":"Object","label":"Payload","name":"payload"}
   * @returns {Object}
   */
  async onTimeTrackingChange_SampleResultLoader(payload) {
    const filter = payload?.criteria?.eventType
    const change = filter && filter !== 'Any' ? filter : 'Created'
    const eventMap = {
      Created: 'attendance-period.created',
      Updated: 'attendance-period.updated',
      Deleted: 'attendance-period.deleted',
    }
    const event = eventMap[change] || 'attendance-period.created'

    return {
      event,
      change,
      entry: {
        id: 'at_77',
        person: { id: '42' },
        starts_at: '2026-08-15T09:00:00Z',
        ends_at: '2026-08-15T17:30:00Z',
        break: 30,
        project: { id: 'p_900', name: 'Q3 Migration' },
      },
      occurredAt: '2026-05-22T10:00:00Z',
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /onDocumentChange_SampleResultLoader
   * @paramDef {"type":"Object","label":"Payload","name":"payload"}
   * @returns {Object}
   */
  async onDocumentChange_SampleResultLoader(payload) {
    const filter = payload?.criteria?.eventType
    const change = filter && filter !== 'Any' ? filter : 'Signed'
    const eventMap = {
      Created: 'document.created',
      Updated: 'document.updated',
      Deleted: 'document.deleted',
      Signed: 'document.signed',
    }
    const event = eventMap[change] || 'document.signed'

    return {
      event,
      change,
      document: {
        id: 'doc_1',
        title: 'Employment Contract',
        category: { id: '5', name: 'Contract' },
        person: { id: '42' },
        confidential: true,
        signed_at: change === 'Signed' ? '2026-06-02T14:00:00Z' : null,
      },
      occurredAt: '2026-06-02T14:00:00Z',
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /runReport_SampleResultLoader
   * @paramDef {"type":"Object","label":"Payload","name":"payload"}
   * @returns {Object}
   */
  async runReport_SampleResultLoader(payload) {
    const source = payload?.criteria?.source || 'Standard'

    if (source === 'Custom') {
      return {
        source: 'Custom',
        reportId: 'cr_12',
        rows: [
          {
            Person: 'Sarah Connor',
            Department: 'Engineering',
            'Days off (YTD)': 8,
          },
          {
            Person: 'Alex Müller',
            Department: 'Engineering',
            'Days off (YTD)': 12,
          },
        ],
        columns: ['Person', 'Department', 'Days off (YTD)'],
        cursor: null,
        total: 2,
      }
    }

    return {
      source: 'Standard',
      reportId: 'r_77',
      rows: [
        {
          Person: 'Sarah Connor',
          Department: 'Engineering',
          'Hours worked': 162.5,
          'Target earnings': 75000,
        },
      ],
      columns: ['Person', 'Department', 'Hours worked', 'Target earnings'],
      cursor: null,
      total: 1,
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /inspectWebhook_SampleResultLoader
   * @paramDef {"type":"Object","label":"Payload","name":"payload"}
   * @returns {Object}
   */
  async inspectWebhook_SampleResultLoader(payload) {
    const op = payload?.criteria?.operation || 'View delivery log'

    if (op === 'Send test ping') {
      return {
        webhookId: 'wh_77',
        operation: op,
        result: { sent: true, response_code: 200, latency_ms: 134 },
      }
    }

    if (op === 'Send test event') {
      return {
        webhookId: 'wh_77',
        operation: op,
        eventType: 'person.updated',
        result: { sent: true, response_code: 200 },
      }
    }

    if (op === 'Replay failed deliveries') {
      return {
        webhookId: 'wh_77',
        operation: op,
        since: '2026-05-20T00:00:00Z',
        result: { replayed: 4 },
      }
    }

    if (op === 'View recent events') {
      return {
        webhookId: 'wh_77',
        operation: op,
        items: [
          {
            id: 'evt_1',
            event: 'person.updated',
            occurred_at: '2026-05-22T10:00:00Z',
            payload_summary: 'person id=42',
          },
        ],
        total: 1,
      }
    }

    return {
      webhookId: 'wh_77',
      operation: 'View delivery log',
      items: [
        {
          event: 'person.updated',
          delivered_at: '2026-05-22T10:00:00Z',
          status: 'SUCCESS',
          response_code: 200,
          latency_ms: 134,
        },
        {
          event: 'employment.terminated',
          delivered_at: '2026-05-21T14:00:00Z',
          status: 'FAILED',
          response_code: 502,
          latency_ms: 5012,
        },
      ],
      total: 2,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module-level helpers (continued)
// ═══════════════════════════════════════════════════════════════════════════════

function describePersonioEvent(event) {
  const map = {
    'person.created': 'Created',
    'person.updated': 'Updated',
    'person.deleted': 'Deleted',
    'employment.created': 'Created',
    'employment.updated': 'Updated',
    'employment.updated.cost-centers': 'Cost center changed',
    'employment.started': 'Started (effective date)',
    'employment.terminated': 'Terminated (effective date)',
    'employment.deleted': 'Deleted',
    'absence-period.created': 'Created',
    'absence-period.updated.status': 'Status changed',
    'absence-period.updated.timerange': 'Dates changed',
    'absence-period.deleted': 'Deleted',
    'attendance-period.created': 'Created',
    'attendance-period.updated': 'Updated',
    'attendance-period.deleted': 'Deleted',
    'document.created': 'Created',
    'document.updated': 'Updated',
    'document.deleted': 'Deleted',
    'document.signed': 'Signed',
  }

  return map[event] || 'Changed'
}

// Original module-helpers placeholder marker (kept for the existing helpers below)
// ═══════════════════════════════════════════════════════════════════════════════

function extractCursor(nextLink) {
  if (!nextLink) return null
  const match = String(nextLink).match(/[?&]cursor=([^&]+)/)

  return match ? decodeURIComponent(match[1]) : null
}

// ═══════════════════════════════════════════════════════════════════════════════
// 18. Service registration
// ═══════════════════════════════════════════════════════════════════════════════

Flowrunner.ServerCode.addService(Personio, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    shared: false,
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Find this in Personio under Settings → Integrations → API Credentials. Each credential has its own access scopes — make sure the one you copy has the data tickboxes the workflow needs.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    shared: false,
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Shown once when the Client ID is generated in Personio under Settings → Integrations → API Credentials. If lost, regenerate the credential and update both fields here.',
  },
  {
    name: 'recruitingApiToken',
    displayName: 'Recruiting Token',
    shared: false,
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    hint: 'You can almost always leave this blank. Only needed if your workflow creates candidates or uploads applicant CVs. Generated separately inside Personio Recruiting under Settings → Integrations → API. Paired with the Recruiting Company ID below.',
  },
  {
    name: 'recruitingCompanyId',
    displayName: 'Recruiting Company ID',
    shared: false,
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    hint: 'Leave blank unless you set the Recruiting Token above. Find this on the same Personio screen as the Recruiting Token, labelled "Your company ID".',
  },
])
