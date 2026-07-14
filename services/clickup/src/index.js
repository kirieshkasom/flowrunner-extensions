'use strict'

const crypto = require('crypto')

const OAUTH_BASE_URL = 'https://app.clickup.com/api'
const API_BASE_URL = 'https://api.clickup.com/api/v2'

// Plain-English guidance for the failures a user actually hits, keyed by HTTP status. The raw
// ClickUp error code stays in the log line; the user only ever sees the friendly hint.
const ERROR_HINTS = {
  400: 'ClickUp rejected the request - check the values you entered and try again.',
  401: 'ClickUp authentication failed - reconnect the ClickUp account.',
  403: 'ClickUp denied access - reconnect the account or check its permissions for this workspace.',
  404: 'Not found in ClickUp - the ID may be wrong; use the matching "Get ..." action to pick a valid one.',
  429: 'ClickUp rate limit reached - wait a moment and try again.',
}

const SERVER_ERROR_HINT = 'ClickUp is temporarily unavailable - try again shortly.'

// Polling: overlap the query window so a task that becomes queryable minutes after its timestamp
// is not missed, and de-duplicate that overlap against a bounded set of recently seen tasks.
const POLL_OVERLAP_MS = 15 * 60 * 1000
const MAX_SEEN_IDS = 5000

// DROPDOWN friendly-label -> API-value maps. The UI shows the labels; #resolveChoice maps the
// selected label back to the value ClickUp expects before it goes into a request.
const TASK_ORDER_BY_MAP = {
  'Date Created': 'created',
  'Date Updated': 'updated',
  'Due Date': 'due_date',
  'Task ID': 'id',
}

const TASK_PRIORITY_MAP = {
  Urgent: '1',
  High: '2',
  Normal: '3',
  Low: '4',
}

const logger = {
  info: (...args) => console.log('[ClickUp Service] info:', ...args),
  debug: (...args) => console.log('[ClickUp Service] debug:', ...args),
  error: (...args) => console.log('[ClickUp Service] error:', ...args),
  warn: (...args) => console.log('[ClickUp Service] warn:', ...args),
}

class ResponseError extends Error {
  constructor(message, httpStatusCode, data) {
    super(message)

    this.message = message
    this.httpStatusCode = httpStatusCode
    this.data = data
  }

  toJSON() {
    return {
      message: this.message,
      httpStatusCode: this.httpStatusCode,
      data: this.data,
    }
  }
}

function searchFilter(list, props, searchString) {
  const needle = String(searchString).toLowerCase()

  return list.filter(item => props.some(prop => {
    const value = item[prop]

    return value != null && String(value).toLowerCase().includes(needle)
  }))
}

// Lowercase every header key so inbound webhook lookups are case-insensitive.
function lowerKeys(headers) {
  const out = {}

  for (const key of Object.keys(headers || {})) {
    out[String(key).toLowerCase()] = headers[key]
  }

  return out
}

// Constant-time comparison of two hex signature strings (length mismatch fails fast).
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))

  if (bufA.length !== bufB.length) return false

  return crypto.timingSafeEqual(bufA, bufB)
}

/**
 * @requireOAuth
 * @integrationName ClickUp
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class ClickUp {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .set({ 'Content-Type': 'application/json' })
        .query(query)

      if (body !== undefined) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      throw this.#toResponseError(error, logTag)
    }
  }

  // Shared with requests that can't go through #apiRequest (e.g. the multipart attachment
  // upload, which needs .form() instead of .send()) so every call maps errors the same way.
  #toResponseError(error, logTag) {
    const errBody = error.body
    const status = error.status
    let apiMessage = error.message
    let ecode

    if (errBody) {
      if (typeof errBody === 'object') {
        ecode = errBody.ECODE
        apiMessage = errBody.err || errBody.error || ecode || JSON.stringify(errBody)
      } else {
        apiMessage = String(errBody)
      }
    }

    logger.error(`${ logTag } - error [status=${ status }${ ecode ? ` ecode=${ ecode }` : '' }]: ${ apiMessage }`)

    const hint = ERROR_HINTS[status] || (status >= 500 ? SERVER_ERROR_HINT : null)
    const userMessage = hint ? `${ hint } (${ apiMessage })` : apiMessage

    return new ResponseError(`[ClickUpError]: ${ userMessage }`, status, errBody)
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: accessToken || this.request.headers['oauth-access-token'],
    }
  }

  // Maps a friendly DROPDOWN label to the API value via the given mapping; passes through
  // unknown/empty values unchanged so free-form input still works.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ============================== OAUTH SYSTEM METHODS ==============================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')

    return `${ OAUTH_BASE_URL }?${ params.toString() }`
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    let codeExchangeResponse = {}

    try {
      codeExchangeResponse = await Flowrunner.Request.post(`${ API_BASE_URL }/oauth/token`)
        .set({ 'Content-Type': 'application/json' })
        .send({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code: callbackObject.code,
        })

      logger.debug('[executeCallback] codeExchangeResponse received')
    } catch (error) {
      logger.error(`[executeCallback] codeExchangeResponse error: ${ error.message }`)

      return {}
    }

    const accessToken = codeExchangeResponse.access_token

    let userInfo = {}

    try {
      const response = await Flowrunner.Request.get(`${ API_BASE_URL }/user`)
        .set({ Authorization: accessToken })

      userInfo = response.user || {}
      logger.debug(`[executeCallback] userInfo received: id=${ userInfo.id }`)
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ error.message }`)
    }

    return {
      token: accessToken,
      expirationInSeconds: 60 * 60 * 24 * 365 * 10, // ClickUp tokens do not expire; arbitrary long expiry
      connectionIdentityName: userInfo.email || userInfo.username || 'ClickUp Account',
      connectionIdentityImageURL: userInfo.profilePicture || null,
      overwrite: true,
      userData: userInfo,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    // ClickUp access tokens do not expire and there is no refresh flow.
    // Return the existing token unchanged with a long synthetic expiry.
    return {
      token: this.request.headers['oauth-access-token'] || refreshToken,
      expirationInSeconds: 60 * 60 * 24 * 365 * 10,
    }
  }

  // ============================== DICTIONARY HELPERS ==============================

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

  // ============================== DICTIONARIES ==============================

  /**
   * @typedef {Object} getWorkspacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter workspaces by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Not used for workspaces but included for consistency."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Workspaces Dictionary
   * @description Provides a searchable list of ClickUp workspaces (teams) the authenticated user belongs to. Used for dynamic workspace selection in other actions.
   * @route POST /get-workspaces-dictionary
   * @paramDef {"type":"getWorkspacesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering workspaces."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"My Workspace","value":"123456","note":"ID: 123456"}]}
   */
  async getWorkspacesDictionary(payload) {
    const { search } = payload || {}

    const { teams } = await this.#apiRequest({
      logTag: 'getWorkspacesDictionary',
      url: `${ API_BASE_URL }/team`,
    })

    const filtered = search ? searchFilter(teams || [], ['name', 'id'], search) : (teams || [])

    return {
      items: filtered.map(({ id, name }) => ({
        label: name || '[empty]',
        value: id,
        note: `ID: ${ id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getSpacesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"description":"Identifier of the ClickUp workspace whose spaces will be listed."}
   */

  /**
   * @typedef {Object} getSpacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter spaces by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getSpacesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required workspace identifier used to scope the spaces lookup."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Spaces Dictionary
   * @description Provides a searchable list of spaces inside a given ClickUp workspace. Used for dynamic space selection in other actions.
   * @route POST /get-spaces-dictionary
   * @paramDef {"type":"getSpacesDictionary__payload","label":"Payload","name":"payload","description":"Contains workspace identifier and optional search string for retrieving and filtering spaces."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Marketing","value":"7890","note":"ID: 7890"}]}
   */
  async getSpacesDictionary(payload) {
    const { search, criteria } = payload || {}
    const workspaceId = criteria?.workspaceId

    const { spaces } = await this.#apiRequest({
      logTag: 'getSpacesDictionary',
      url: `${ API_BASE_URL }/team/${ workspaceId }/space`,
      query: { archived: false },
    })

    const filtered = search ? searchFilter(spaces || [], ['name', 'id'], search) : (spaces || [])

    return {
      items: filtered.map(({ id, name }) => ({
        label: name || '[empty]',
        value: id,
        note: `ID: ${ id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getFoldersDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"description":"Identifier of the ClickUp space whose folders will be listed."}
   */

  /**
   * @typedef {Object} getFoldersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter folders by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getFoldersDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required space identifier used to scope the folders lookup."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Folders Dictionary
   * @description Provides a searchable list of folders inside a given ClickUp space. Used for dynamic folder selection in other actions.
   * @route POST /get-folders-dictionary
   * @paramDef {"type":"getFoldersDictionary__payload","label":"Payload","name":"payload","description":"Contains space identifier and optional search string for retrieving and filtering folders."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Q1 Projects","value":"4567","note":"ID: 4567"}]}
   */
  async getFoldersDictionary(payload) {
    const { search, criteria } = payload || {}
    const spaceId = criteria?.spaceId

    const { folders } = await this.#apiRequest({
      logTag: 'getFoldersDictionary',
      url: `${ API_BASE_URL }/space/${ spaceId }/folder`,
      query: { archived: false },
    })

    const filtered = search ? searchFilter(folders || [], ['name', 'id'], search) : (folders || [])

    return {
      items: filtered.map(({ id, name }) => ({
        label: name || '[empty]',
        value: id,
        note: `ID: ${ id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getListsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"description":"Identifier of the ClickUp space whose lists will be enumerated."}
   * @paramDef {"type":"String","label":"Folder ID","name":"folderId","description":"Optional folder identifier. When provided, lists inside this folder are returned; when omitted, folderless lists in the space are returned."}
   */

  /**
   * @typedef {Object} getListsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter lists by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getListsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the space and optional folder used to scope the lists lookup."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lists Dictionary
   * @description Provides a searchable list of ClickUp lists for a given space. When a folder ID is provided, lists inside that folder are returned; otherwise folderless lists in the space are returned.
   * @route POST /get-lists-dictionary
   * @paramDef {"type":"getListsDictionary__payload","label":"Payload","name":"payload","description":"Contains space identifier, optional folder identifier, and optional search string for retrieving and filtering lists."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Backlog","value":"901234","note":"ID: 901234"}]}
   */
  async getListsDictionary(payload) {
    const { search, criteria } = payload || {}
    const spaceId = criteria?.spaceId
    const folderId = criteria?.folderId

    let lists

    if (folderId) {
      const res = await this.#apiRequest({
        logTag: 'getListsDictionary',
        url: `${ API_BASE_URL }/folder/${ folderId }/list`,
        query: { archived: false },
      })

      lists = (res?.lists || []).map(l => ({ id: l.id, name: l.name }))
    } else {
      // No folder chosen: merge the space's folderless lists with the lists nested inside every
      // folder of the space, so the picker shows every list, not just the folderless ones.
      const [folderless, folderContainer] = await Promise.all([
        this.#apiRequest({
          logTag: 'getListsDictionary',
          url: `${ API_BASE_URL }/space/${ spaceId }/list`,
          query: { archived: false },
        }),
        this.#apiRequest({
          logTag: 'getListsDictionary',
          url: `${ API_BASE_URL }/space/${ spaceId }/folder`,
          query: { archived: false },
        }),
      ])

      const direct = (folderless?.lists || []).map(l => ({ id: l.id, name: l.name }))
      const nested = (folderContainer?.folders || []).flatMap(folder =>
        (folder.lists || []).map(l => ({ id: l.id, name: l.name, folderName: folder.name })))

      lists = [...direct, ...nested]
    }

    const filtered = search ? searchFilter(lists, ['name', 'id'], search) : lists

    return {
      items: filtered.map(({ id, name, folderName }) => ({
        label: folderName ? `${ name || '[empty]' } (${ folderName })` : (name || '[empty]'),
        value: id,
        note: `ID: ${ id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getChecklistsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"Identifier of the ClickUp task whose checklists will be listed."}
   */

  /**
   * @typedef {Object} getChecklistsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter checklists by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getChecklistsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required task identifier used to load the task's checklists."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Checklists Dictionary
   * @description Provides a searchable list of the checklists that already exist on a given ClickUp task. Used for dynamic checklist selection when adding checklist items.
   * @route POST /get-checklists-dictionary
   * @paramDef {"type":"getChecklistsDictionary__payload","label":"Payload","name":"payload","description":"Contains task identifier and optional search string for retrieving and filtering the task's checklists."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Definition of done","value":"checklist_abc","note":"ID: checklist_abc"}]}
   */
  async getChecklistsDictionary(payload) {
    const { search, criteria } = payload || {}
    const taskId = criteria?.taskId

    const task = await this.#apiRequest({
      logTag: 'getChecklistsDictionary',
      url: `${ API_BASE_URL }/task/${ taskId }`,
    })

    const checklists = task?.checklists || []
    const filtered = search ? searchFilter(checklists, ['name', 'id'], search) : checklists

    return {
      items: filtered.map(({ id, name }) => ({
        label: name || '[empty]',
        value: id,
        note: `ID: ${ id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getMembersDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"description":"Identifier of the ClickUp workspace whose members will be listed."}
   */

  /**
   * @typedef {Object} getMembersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter members by username or email. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getMembersDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required workspace identifier used to scope the members lookup."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Members Dictionary
   * @description Provides a searchable list of members of a given ClickUp workspace. Used for dynamic assignee selection when creating or updating tasks.
   * @route POST /get-members-dictionary
   * @paramDef {"type":"getMembersDictionary__payload","label":"Payload","name":"payload","description":"Contains workspace identifier and optional search string for retrieving and filtering workspace members."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Jane Doe (jane@example.com)","value":"81234","note":"ID: 81234"}]}
   */
  async getMembersDictionary(payload) {
    const { search, criteria } = payload || {}
    const workspaceId = criteria?.workspaceId

    const { teams } = await this.#apiRequest({
      logTag: 'getMembersDictionary',
      url: `${ API_BASE_URL }/team`,
    })

    const team = (teams || []).find(t => String(t.id) === String(workspaceId))
    const members = (team?.members || []).map(m => m.user || m).filter(Boolean)

    const filtered = search ? searchFilter(members, ['username', 'email'], search) : members

    return {
      items: filtered.map(({ id, username, email }) => ({
        label: username ? `${ username }${ email ? ` (${ email })` : '' }` : (email || `User ${ id }`),
        value: String(id),
        note: `ID: ${ id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getTasksDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"description":"Identifier of the ClickUp list whose tasks will be enumerated."}
   */

  /**
   * @typedef {Object} getTasksDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tasks by name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor representing the page index. Page size is fixed by the ClickUp API at 100 tasks per page."}
   * @paramDef {"type":"getTasksDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required list identifier used to scope the tasks lookup."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tasks Dictionary
   * @description Provides a paginated, searchable list of tasks within a given ClickUp list. Used for dynamic task selection in update, delete, comment, and time-tracking actions.
   * @route POST /get-tasks-dictionary
   * @paramDef {"type":"getTasksDictionary__payload","label":"Payload","name":"payload","description":"Contains list identifier, optional search string, and pagination cursor for retrieving and filtering tasks."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Write product spec","value":"abc123","note":"ID: abc123"}],"cursor":"1"}
   */
  async getTasksDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const listId = criteria?.listId
    const page = cursor ? Number(cursor) : 0

    const { tasks, last_page: lastPage } = await this.#apiRequest({
      logTag: 'getTasksDictionary',
      url: `${ API_BASE_URL }/list/${ listId }/task`,
      query: { archived: false, page, include_closed: true },
    })

    const filtered = search ? searchFilter(tasks || [], ['name', 'id'], search) : (tasks || [])

    return {
      items: filtered.map(({ id, name }) => ({
        label: name || '[empty]',
        value: id,
        note: `ID: ${ id }`,
      })),
      cursor: lastPage ? null : String(page + 1),
    }
  }

  /**
   * @typedef {Object} getStatusesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"description":"Identifier of the ClickUp list whose available statuses will be listed."}
   */

  /**
   * @typedef {Object} getStatusesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter statuses by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getStatusesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required list identifier used to load the available statuses."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Statuses Dictionary
   * @description Provides the list of task statuses configured on a given ClickUp list. Used for dynamic status selection when creating or updating tasks.
   * @route POST /get-statuses-dictionary
   * @paramDef {"type":"getStatusesDictionary__payload","label":"Payload","name":"payload","description":"Contains list identifier and optional search string for retrieving and filtering statuses."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"in progress","value":"in progress","note":"Order: 1"}]}
   */
  async getStatusesDictionary(payload) {
    const { search, criteria } = payload || {}
    const listId = criteria?.listId

    const list = await this.#apiRequest({
      logTag: 'getStatusesDictionary',
      url: `${ API_BASE_URL }/list/${ listId }`,
    })

    const statuses = list?.statuses || []
    const filtered = search ? searchFilter(statuses, ['status'], search) : statuses

    return {
      items: filtered.map(({ status, orderindex }) => ({
        label: status,
        value: status,
        note: `Order: ${ orderindex }`,
      })),
    }
  }

  /**
   * @typedef {Object} getCustomFieldsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"description":"Identifier of the ClickUp list whose custom fields will be listed."}
   */

  /**
   * @typedef {Object} getCustomFieldsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter custom fields by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getCustomFieldsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required list identifier used to load the list's custom fields."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Custom Fields Dictionary
   * @description Provides a searchable list of the custom fields configured on a given ClickUp list. Used for dynamic field selection when setting or clearing a task's custom field value.
   * @route POST /get-custom-fields-dictionary
   * @paramDef {"type":"getCustomFieldsDictionary__payload","label":"Payload","name":"payload","description":"Contains list identifier and optional search string for retrieving and filtering the list's custom fields."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Text Field","value":"5dc86497-098d-4bb0-87d6-cf28e43812e7","note":"Type: text"}]}
   */
  async getCustomFieldsDictionary(payload) {
    const { search, criteria } = payload || {}
    const listId = criteria?.listId

    const fields = await this.#fetchListCustomFields(listId)
    const filtered = search ? searchFilter(fields, ['name', 'id'], search) : fields

    return {
      items: filtered.map(({ id, name, type }) => ({
        label: name || '[empty]',
        value: id,
        note: `Type: ${ type }`,
      })),
    }
  }

  /**
   * @typedef {Object} getSpaceTagsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"description":"Identifier of the ClickUp space whose tags will be listed."}
   */

  /**
   * @typedef {Object} getSpaceTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tags by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getSpaceTagsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required space identifier used to load the space's tags."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Space Tags Dictionary
   * @description Provides a searchable list of the tags available in a given ClickUp space. Used for dynamic tag selection when adding or removing a task tag.
   * @route POST /get-space-tags-dictionary
   * @paramDef {"type":"getSpaceTagsDictionary__payload","label":"Payload","name":"payload","description":"Contains space identifier and optional search string for retrieving and filtering the space's tags."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"urgent","value":"urgent","note":"Tag"}]}
   */
  async getSpaceTagsDictionary(payload) {
    const { search, criteria } = payload || {}
    const spaceId = criteria?.spaceId

    const { tags } = await this.#apiRequest({
      logTag: 'getSpaceTagsDictionary',
      url: `${ API_BASE_URL }/space/${ spaceId }/tag`,
    })

    const filtered = search ? searchFilter(tags || [], ['name'], search) : (tags || [])

    return {
      items: filtered.map(({ name }) => ({
        label: name,
        value: name,
        note: 'Tag',
      })),
    }
  }

  // ============================== WORKSPACES ==============================

  /**
   * @operationName Get Workspaces
   * @description Retrieves all ClickUp workspaces (teams) accessible by the authenticated user, including basic workspace metadata such as name, color, avatar, and members. Use this to discover the workspaces your integration can operate on.
   * @category Workspaces
   * @route POST /getWorkspaces
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @returns {Object} An object containing an array of workspaces (teams) the authenticated user belongs to.
   * @sampleResult {"teams":[{"id":"123456","name":"My Workspace","color":"#7B68EE","avatar":null,"members":[{"user":{"id":81234,"username":"Jane Doe","email":"jane@example.com"}}]}]}
   */
  async getWorkspaces() {
    return this.#apiRequest({
      logTag: 'getWorkspaces',
      url: `${ API_BASE_URL }/team`,
    })
  }

  // ============================== SPACES ==============================
  // Spaces are top-level administrative containers that workspace admins set up in ClickUp's own
  // settings. This extension reads them and operates within existing spaces rather than creating,
  // renaming, or deleting them.

  /**
   * @operationName Get Spaces
   * @description Retrieves all spaces inside a given ClickUp workspace, optionally including archived spaces. Spaces are top-level containers used to organize folders and lists.
   * @category Spaces
   * @route POST /getSpaces
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace whose spaces will be retrieved."}
   * @paramDef {"type":"Boolean","label":"Archived","name":"archived","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes archived spaces in the result. Defaults to false."}
   * @returns {Object} An object containing an array of spaces in the specified workspace.
   * @sampleResult {"spaces":[{"id":"7890","name":"Marketing","private":false,"statuses":[{"status":"to do","color":"#d3d3d3","orderindex":0}]}]}
   */
  async getSpaces(workspaceId, archived) {
    return this.#apiRequest({
      logTag: 'getSpaces',
      url: `${ API_BASE_URL }/team/${ workspaceId }/space`,
      query: { archived: Boolean(archived) },
    })
  }

  /**
   * @operationName Get Space
   * @description Retrieves the full configuration of a single ClickUp space including its statuses, features, and privacy settings. Use to inspect a space before performing operations on its folders or lists.
   * @category Spaces
   * @route POST /getSpace
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the space."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space to retrieve."}
   * @returns {Object} The space configuration object.
   * @sampleResult {"id":"7890","name":"Marketing","private":false,"statuses":[{"status":"to do","color":"#d3d3d3","orderindex":0,"type":"open"}],"features":{"due_dates":{"enabled":true}}}
   */
  async getSpace(workspaceId, spaceId) {
    return this.#apiRequest({
      logTag: 'getSpace',
      url: `${ API_BASE_URL }/space/${ spaceId }`,
    })
  }

  // ============================== FOLDERS ==============================

  /**
   * @operationName Get Folders
   * @description Retrieves all folders inside a given ClickUp space, optionally including archived folders. Folders group related lists within a space.
   * @category Folders
   * @route POST /getFolders
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the space."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the ClickUp space whose folders will be retrieved."}
   * @paramDef {"type":"Boolean","label":"Archived","name":"archived","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes archived folders in the result. Defaults to false."}
   * @returns {Object} An object containing an array of folders in the specified space.
   * @sampleResult {"folders":[{"id":"4567","name":"Q1 Projects","orderindex":0,"hidden":false,"task_count":"12"}]}
   */
  async getFolders(workspaceId, spaceId, archived) {
    return this.#apiRequest({
      logTag: 'getFolders',
      url: `${ API_BASE_URL }/space/${ spaceId }/folder`,
      query: { archived: Boolean(archived) },
    })
  }

  /**
   * @operationName Create Folder
   * @description Creates a new folder inside the specified ClickUp space. Folders group related lists and help organize work within a space.
   * @category Folders
   * @route POST /createFolder
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the space."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the ClickUp space where the new folder will be created."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the new folder."}
   * @returns {Object} The newly created folder object.
   * @sampleResult {"id":"4567","name":"Q1 Projects","orderindex":0,"hidden":false,"task_count":"0","lists":[]}
   */
  async createFolder(workspaceId, spaceId, name) {
    return this.#apiRequest({
      logTag: 'createFolder',
      url: `${ API_BASE_URL }/space/${ spaceId }/folder`,
      method: 'post',
      body: { name },
    })
  }

  /**
   * @operationName Delete Folder
   * @description Permanently deletes a folder from a ClickUp space. This action cannot be undone and will remove all lists and tasks contained within the folder.
   * @category Folders
   * @route POST /deleteFolder
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the folder."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the folder."}
   * @paramDef {"type":"String","label":"Folder ID","name":"folderId","required":true,"dictionary":"getFoldersDictionary","dependsOn":["spaceId"],"description":"Identifier of the folder to delete."}
   * @returns {Object} An empty object on success.
   * @sampleResult {}
   */
  async deleteFolder(workspaceId, spaceId, folderId) {
    return this.#apiRequest({
      logTag: 'deleteFolder',
      url: `${ API_BASE_URL }/folder/${ folderId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Update Folder
   * @description Renames an existing folder in a ClickUp space. Use to keep folder names in sync with an external system or project template.
   * @category Folders
   * @route POST /updateFolder
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the folder."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the folder."}
   * @paramDef {"type":"String","label":"Folder ID","name":"folderId","required":true,"dictionary":"getFoldersDictionary","dependsOn":["spaceId"],"description":"Identifier of the folder to rename."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"New display name for the folder."}
   * @returns {Object} The updated folder object.
   * @sampleResult {"id":"4567","name":"Q1 Projects (renamed)","orderindex":0,"hidden":false,"task_count":"12","lists":[]}
   */
  async updateFolder(workspaceId, spaceId, folderId, name) {
    return this.#apiRequest({
      logTag: 'updateFolder',
      url: `${ API_BASE_URL }/folder/${ folderId }`,
      method: 'put',
      body: { name },
    })
  }

  // ============================== LISTS ==============================

  /**
   * @operationName Get Lists
   * @description Retrieves all lists inside a folder, or all folderless lists in a space when no folder is specified. Lists are the containers that hold tasks in ClickUp.
   * @category Lists
   * @route POST /getLists
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the space."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the lists to retrieve."}
   * @paramDef {"type":"String","label":"Folder ID","name":"folderId","dictionary":"getFoldersDictionary","dependsOn":["spaceId"],"description":"Optional folder identifier. When provided, returns lists inside this folder; otherwise returns folderless lists in the space."}
   * @paramDef {"type":"Boolean","label":"Archived","name":"archived","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes archived lists in the result. Defaults to false."}
   * @returns {Object} An object containing an array of lists.
   * @sampleResult {"lists":[{"id":"901234","name":"Backlog","orderindex":0,"task_count":17,"folder":{"id":"4567","name":"Q1 Projects","hidden":false,"access":true}}]}
   */
  async getLists(workspaceId, spaceId, folderId, archived) {
    const url = folderId
      ? `${ API_BASE_URL }/folder/${ folderId }/list`
      : `${ API_BASE_URL }/space/${ spaceId }/list`

    return this.#apiRequest({
      logTag: 'getLists',
      url,
      query: { archived: Boolean(archived) },
    })
  }

  /**
   * @operationName Create List
   * @description Creates a new list inside either a folder or directly in a space (folderless). Lists hold tasks and define their available statuses.
   * @category Lists
   * @route POST /createList
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the space."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space where the list will live."}
   * @paramDef {"type":"String","label":"Folder ID","name":"folderId","dictionary":"getFoldersDictionary","dependsOn":["spaceId"],"description":"Optional folder identifier. When provided, the list is created inside the folder; otherwise it becomes a folderless list in the space."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the new list."}
   * @paramDef {"type":"String","label":"Content","name":"content","description":"Optional description shown on the list."}
   * @returns {Object} The newly created list object.
   * @sampleResult {"id":"901234","name":"Backlog","orderindex":1,"content":"Tasks waiting to be picked up","status":null,"priority":null,"task_count":0}
   */
  async createList(workspaceId, spaceId, folderId, name, content) {
    const url = folderId
      ? `${ API_BASE_URL }/folder/${ folderId }/list`
      : `${ API_BASE_URL }/space/${ spaceId }/list`

    const body = { name }

    if (content) body.content = content

    return this.#apiRequest({
      logTag: 'createList',
      url,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get List
   * @description Retrieves details of a single ClickUp list, including its name, content, statuses, and task count. Use to inspect list configuration before creating tasks.
   * @category Lists
   * @route POST /getList
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the space."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the list."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list to retrieve."}
   * @returns {Object} The list configuration object.
   * @sampleResult {"id":"901234","name":"Backlog","orderindex":0,"content":"","status":null,"priority":null,"assignee":null,"task_count":17,"due_date":null,"start_date":null,"folder":{"id":"4567","name":"Q1 Projects"},"space":{"id":"7890","name":"Marketing"},"statuses":[{"status":"to do","orderindex":0,"color":"#d3d3d3","type":"open"}]}
   */
  async getList(workspaceId, spaceId, listId) {
    return this.#apiRequest({
      logTag: 'getList',
      url: `${ API_BASE_URL }/list/${ listId }`,
    })
  }

  /**
   * @operationName Delete List
   * @description Permanently deletes a list and all of its tasks from ClickUp. This action cannot be undone.
   * @category Lists
   * @route POST /deleteList
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the list."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the list."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list to delete."}
   * @returns {Object} An empty object on success.
   * @sampleResult {}
   */
  async deleteList(workspaceId, spaceId, listId) {
    return this.#apiRequest({
      logTag: 'deleteList',
      url: `${ API_BASE_URL }/list/${ listId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Update List
   * @description Updates an existing ClickUp list's name and/or description. Only the fields you provide are changed. Use to keep list details in sync with an external system.
   * @category Lists
   * @route POST /updateList
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the list."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the list."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"New display name for the list."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional new description shown on the list."}
   * @returns {Object} The updated list object.
   * @sampleResult {"id":"901234","name":"Backlog (renamed)","orderindex":1,"content":"Updated description","status":null,"priority":null,"task_count":17}
   */
  async updateList(workspaceId, spaceId, listId, name, content) {
    const body = { name }

    if (content != null && content !== '') body.content = content

    return this.#apiRequest({
      logTag: 'updateList',
      url: `${ API_BASE_URL }/list/${ listId }`,
      method: 'put',
      body,
    })
  }

  // ============================== TASKS ==============================

  /**
   * @operationName Get Tasks
   * @description Retrieves a paginated set of tasks (up to 100 per page) from a ClickUp list, with optional filters for status, archived state, completion, ordering, and due-date range. Ideal for syncing or processing tasks in bulk.
   * @category Tasks
   * @route POST /getTasks
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the list."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the list."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list whose tasks will be retrieved."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page index. Each page contains up to 100 tasks. Defaults to 0."}
   * @paramDef {"type":"Boolean","label":"Archived","name":"archived","uiComponent":{"type":"TOGGLE"},"description":"When enabled, returns archived tasks instead of active ones. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Include Closed","name":"includeClosed","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes tasks in closed statuses. Defaults to false."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Date Created","Date Updated","Due Date","Task ID"]}},"description":"Field used to sort the returned tasks."}
   * @paramDef {"type":"Boolean","label":"Include Subtasks","name":"subtasks","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes subtasks in the returned list alongside their parent tasks. Defaults to false (ClickUp's own default)."}
   * @returns {Object} An object containing an array of tasks and pagination metadata.
   * @sampleResult {"tasks":[{"id":"abc123","name":"Write product spec","status":{"status":"in progress","color":"#4286f4","type":"custom"},"date_created":"1700000000000","date_updated":"1700001000000","creator":{"id":81234,"username":"Jane Doe"},"assignees":[],"list":{"id":"901234"},"parent":null}],"last_page":true}
   */
  async getTasks(workspaceId, spaceId, listId, page, archived, includeClosed, orderBy, subtasks) {
    const query = {
      page: Number(page) || 0,
      archived: Boolean(archived),
      include_closed: Boolean(includeClosed),
    }

    if (orderBy) query.order_by = this.#resolveChoice(orderBy, TASK_ORDER_BY_MAP)
    if (subtasks != null) query.subtasks = Boolean(subtasks)

    return this.#apiRequest({
      logTag: 'getTasks',
      url: `${ API_BASE_URL }/list/${ listId }/task`,
      query,
    })
  }

  /**
   * @operationName Get Task
   * @description Retrieves the full details of a single ClickUp task by its ID, optionally including subtasks and Markdown-formatted description. Use this to read up-to-date task state before acting on it.
   * @category Tasks
   * @route POST /getTask
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the task."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the task."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Identifier of the task to retrieve."}
   * @paramDef {"type":"Boolean","label":"Include Subtasks","name":"includeSubtasks","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes the task's subtasks in the response. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Markdown Description","name":"markdownDescription","uiComponent":{"type":"TOGGLE"},"description":"When enabled, returns the task description in Markdown format. Defaults to false."}
   * @returns {Object} The task object including assignees, status, dates, and custom field values.
   * @sampleResult {"id":"abc123","name":"Write product spec","text_content":"Initial draft","description":"Initial draft","status":{"status":"in progress","color":"#4286f4","type":"custom"},"date_created":"1700000000000","date_updated":"1700001000000","creator":{"id":81234,"username":"Jane Doe","email":"jane@example.com"},"assignees":[],"watchers":[],"checklists":[],"tags":[],"priority":null,"due_date":null,"start_date":null,"list":{"id":"901234","name":"Backlog"},"folder":{"id":"4567","name":"Q1 Projects"},"space":{"id":"7890"},"url":"https://app.clickup.com/t/abc123"}
   */
  async getTask(workspaceId, spaceId, listId, taskId, includeSubtasks, markdownDescription) {
    return this.#apiRequest({
      logTag: 'getTask',
      url: `${ API_BASE_URL }/task/${ taskId }`,
      query: {
        include_subtasks: Boolean(includeSubtasks),
        include_markdown_description: Boolean(markdownDescription),
      },
    })
  }

  /**
   * @operationName Create Task
   * @description Creates a new task inside a ClickUp list with optional description, status, priority, due date, assignees, and tags. Set Parent Task ID to create this as a subtask of an existing task in the same list. Returns the full created task object including its generated ID and URL.
   * @category Tasks
   * @route POST /createTask
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the list."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the list."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list where the task will be created."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Title of the new task."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional task description (plain text or Markdown)."}
   * @paramDef {"type":"String","label":"Status","name":"status","dictionary":"getStatusesDictionary","dependsOn":["listId"],"description":"Optional status to assign to the task. Must match an available status on the list."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Urgent","High","Normal","Low"]}},"description":"Optional priority level. Leave empty for no priority."}
   * @paramDef {"type":"Number","label":"Due Date","name":"dueDate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional due date as a Unix timestamp in milliseconds."}
   * @paramDef {"type":"Array<String>","label":"Assignees","name":"assignees","description":"Optional array of ClickUp user IDs to assign to the task. Each entry must be a member of the workspace."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Optional array of tag names to attach to the task."}
   * @paramDef {"type":"String","label":"Parent Task ID","name":"parent","dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Optional identifier of an existing task in the SAME list to create this task as a subtask of. Leave empty to create a top-level task."}
   * @paramDef {"type":"Boolean","label":"Notify All","name":"notifyAll","uiComponent":{"type":"TOGGLE"},"description":"When enabled, notifies all task watchers about the creation. Defaults to false."}
   * @returns {Object} The newly created task object.
   * @sampleResult {"id":"abc123","name":"Write product spec","status":{"status":"to do","color":"#d3d3d3","type":"open"},"date_created":"1700000000000","creator":{"id":81234,"username":"Jane Doe"},"assignees":[],"tags":[],"priority":null,"due_date":null,"list":{"id":"901234"},"url":"https://app.clickup.com/t/abc123"}
   */
  async createTask(workspaceId, spaceId, listId, name, description, status, priority, dueDate, assignees, tags, parent, notifyAll) {
    const body = { name }

    if (description) body.description = description
    if (status) body.status = status
    if (priority != null && priority !== '') body.priority = Number(this.#resolveChoice(priority, TASK_PRIORITY_MAP))
    if (dueDate != null && dueDate !== '') body.due_date = Number(dueDate)
    if (Array.isArray(assignees) && assignees.length) body.assignees = assignees.map(Number)
    if (Array.isArray(tags) && tags.length) body.tags = tags
    if (parent) body.parent = parent
    if (notifyAll != null) body.notify_all = Boolean(notifyAll)

    return this.#apiRequest({
      logTag: 'createTask',
      url: `${ API_BASE_URL }/list/${ listId }/task`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Task
   * @description Updates editable fields of a ClickUp task such as name, description, status, priority, due date, time estimate, archive flag, and assignee additions/removals. Only provided fields are modified.
   * @category Tasks
   * @route POST /updateTask
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the task."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the task."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Identifier of the task to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional new name for the task."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional new description for the task. Pass an empty string to clear it."}
   * @paramDef {"type":"String","label":"Status","name":"status","dictionary":"getStatusesDictionary","dependsOn":["listId"],"description":"Optional new status. Must match an available status on the list."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Urgent","High","Normal","Low"]}},"description":"Optional new priority level."}
   * @paramDef {"type":"Number","label":"Due Date","name":"dueDate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional new due date as a Unix timestamp in milliseconds."}
   * @paramDef {"type":"Boolean","label":"Archived","name":"archived","uiComponent":{"type":"TOGGLE"},"description":"When enabled, archives the task; when disabled and currently archived, unarchives it."}
   * @paramDef {"type":"Array<String>","label":"Add Assignees","name":"addAssignees","description":"Optional array of ClickUp user IDs to add as assignees."}
   * @paramDef {"type":"Array<String>","label":"Remove Assignees","name":"removeAssignees","description":"Optional array of ClickUp user IDs to remove from assignees."}
   * @paramDef {"type":"Number","label":"Time Estimate","name":"timeEstimate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional time estimate for the task in milliseconds."}
   * @returns {Object} The updated task object.
   * @sampleResult {"id":"abc123","name":"Write product spec v2","status":{"status":"in progress","color":"#4286f4","type":"custom"},"date_updated":"1700002000000","priority":{"priority":"high","color":"#FFCC00"},"due_date":"1700500000000","time_estimate":3600000,"assignees":[{"id":81234,"username":"Jane Doe"}],"url":"https://app.clickup.com/t/abc123"}
   */
  async updateTask(workspaceId, spaceId, listId, taskId, name, description, status, priority, dueDate, archived, addAssignees, removeAssignees, timeEstimate) {
    const body = {}

    if (name) body.name = name
    if (description != null && description !== undefined) body.description = description
    if (status) body.status = status
    if (priority != null && priority !== '') body.priority = Number(this.#resolveChoice(priority, TASK_PRIORITY_MAP))
    if (dueDate != null && dueDate !== '') body.due_date = Number(dueDate)
    if (timeEstimate != null && timeEstimate !== '') body.time_estimate = Number(timeEstimate)
    if (archived != null) body.archived = Boolean(archived)

    const add = Array.isArray(addAssignees) ? addAssignees.map(Number) : []
    const rem = Array.isArray(removeAssignees) ? removeAssignees.map(Number) : []

    if (add.length || rem.length) {
      body.assignees = { add, rem }
    }

    return this.#apiRequest({
      logTag: 'updateTask',
      url: `${ API_BASE_URL }/task/${ taskId }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete Task
   * @description Permanently deletes a ClickUp task by its ID. This action cannot be undone and removes all comments, attachments, and time tracking entries associated with the task.
   * @category Tasks
   * @route POST /deleteTask
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the task."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the task."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Identifier of the task to delete."}
   * @returns {Object} An empty object on success.
   * @sampleResult {}
   */
  async deleteTask(workspaceId, spaceId, listId, taskId) {
    return this.#apiRequest({
      logTag: 'deleteTask',
      url: `${ API_BASE_URL }/task/${ taskId }`,
      method: 'delete',
    })
  }

  // ============================== COMMENTS ==============================

  /**
   * @operationName Get Task Comments
   * @description Retrieves comments on a ClickUp task in reverse chronological order (newest first). Returns up to 25 comments per request; use the start parameter for pagination.
   * @category Comments
   * @route POST /getTaskComments
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the task."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the task."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Identifier of the task whose comments will be retrieved."}
   * @returns {Object} An object containing an array of comments on the task.
   * @sampleResult {"comments":[{"id":"45678","comment":[{"text":"Looks good"}],"comment_text":"Looks good","user":{"id":81234,"username":"Jane Doe","email":"jane@example.com"},"resolved":false,"date":"1700001500000"}]}
   */
  async getTaskComments(workspaceId, spaceId, listId, taskId) {
    return this.#apiRequest({
      logTag: 'getTaskComments',
      url: `${ API_BASE_URL }/task/${ taskId }/comment`,
    })
  }

  /**
   * @operationName Create Task Comment
   * @description Creates a new comment on a ClickUp task with optional assignee and notification settings. Useful for AI agents to log progress, ask questions, or notify team members.
   * @category Comments
   * @route POST /createTaskComment
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the task."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the task."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Identifier of the task that will receive the comment."}
   * @paramDef {"type":"String","label":"Comment Text","name":"commentText","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Body of the comment. Plain text or Markdown."}
   * @paramDef {"type":"String","label":"Assignee","name":"assignee","dictionary":"getMembersDictionary","dependsOn":["workspaceId"],"description":"Optional identifier of a workspace member to assign the comment to."}
   * @paramDef {"type":"Boolean","label":"Notify All","name":"notifyAll","uiComponent":{"type":"TOGGLE"},"description":"When enabled, notifies all watchers about the new comment. Defaults to false."}
   * @returns {Object} The newly created comment object.
   * @sampleResult {"id":"45678","hist_id":"hist_abc","date":1700002500000}
   */
  async createTaskComment(workspaceId, spaceId, listId, taskId, commentText, assignee, notifyAll) {
    const body = {
      comment_text: commentText,
      notify_all: Boolean(notifyAll),
    }

    if (assignee) body.assignee = Number(assignee)

    return this.#apiRequest({
      logTag: 'createTaskComment',
      url: `${ API_BASE_URL }/task/${ taskId }/comment`,
      method: 'post',
      body,
    })
  }

  // ============================== CHECKLISTS ==============================

  /**
   * @operationName Create Checklist
   * @description Adds a new checklist to a ClickUp task. Checklists let you track sub-steps within a task without creating full subtasks.
   * @category Checklists
   * @route POST /createChecklist
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the task."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the task."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Identifier of the task that will receive the checklist."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the checklist."}
   * @returns {Object} The newly created checklist object.
   * @sampleResult {"checklist":{"id":"checklist_abc","task_id":"abc123","name":"Definition of done","orderindex":0,"resolved":0,"unresolved":0,"items":[]}}
   */
  async createChecklist(workspaceId, spaceId, listId, taskId, name) {
    return this.#apiRequest({
      logTag: 'createChecklist',
      url: `${ API_BASE_URL }/task/${ taskId }/checklist`,
      method: 'post',
      body: { name },
    })
  }

  /**
   * @operationName Create Checklist Item
   * @description Adds an item to an existing checklist on a ClickUp task. Optionally assigns the item to a workspace member.
   * @category Checklists
   * @route POST /createChecklistItem
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the task."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the task."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Identifier of the task that owns the checklist."}
   * @paramDef {"type":"String","label":"Checklist ID","name":"checklistId","required":true,"dictionary":"getChecklistsDictionary","dependsOn":["taskId"],"description":"Identifier of the checklist on the task that will receive the new item."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the new checklist item."}
   * @paramDef {"type":"String","label":"Assignee","name":"assignee","dictionary":"getMembersDictionary","dependsOn":["workspaceId"],"description":"Optional identifier of a workspace member to assign the item to."}
   * @returns {Object} The updated checklist object including the new item.
   * @sampleResult {"checklist":{"id":"checklist_abc","name":"Definition of done","items":[{"id":"item_xyz","name":"Write tests","resolved":false,"assignee":null}]}}
   */
  async createChecklistItem(workspaceId, spaceId, listId, taskId, checklistId, name, assignee) {
    const body = { name }

    if (assignee) body.assignee = Number(assignee)

    return this.#apiRequest({
      logTag: 'createChecklistItem',
      url: `${ API_BASE_URL }/checklist/${ checklistId }/checklist_item`,
      method: 'post',
      body,
    })
  }

  // ============================== TIME TRACKING ==============================

  /**
   * @operationName Get Time Entries
   * @description Retrieves time entries for a ClickUp workspace within a given date range. By default returns the last 30 days for the authenticated user. Useful for time-reporting and analytics workflows.
   * @category Time Tracking
   * @route POST /getTimeEntries
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace whose time entries will be retrieved."}
   * @paramDef {"type":"Number","label":"Start Date","name":"startDate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional Unix timestamp in milliseconds for the start of the date range."}
   * @paramDef {"type":"Number","label":"End Date","name":"endDate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional Unix timestamp in milliseconds for the end of the date range."}
   * @paramDef {"type":"String","label":"Assignee","name":"assignee","dictionary":"getMembersDictionary","dependsOn":["workspaceId"],"description":"Optional workspace member identifier. Required to view another user's entries (Owners/Admins only)."}
   * @returns {Object} An object containing an array of time entries.
   * @sampleResult {"data":[{"id":"time_1","task":{"id":"abc123","name":"Write product spec"},"wid":"123456","user":{"id":81234,"username":"Jane Doe"},"billable":false,"start":"1700000000000","end":"1700001000000","duration":"1000000","description":"Drafting","tags":[]}]}
   */
  async getTimeEntries(workspaceId, startDate, endDate, assignee) {
    const query = {}

    if (startDate != null && startDate !== '') query.start_date = Number(startDate)
    if (endDate != null && endDate !== '') query.end_date = Number(endDate)
    if (assignee) query.assignee = Number(assignee)

    return this.#apiRequest({
      logTag: 'getTimeEntries',
      url: `${ API_BASE_URL }/team/${ workspaceId }/time_entries`,
      query,
    })
  }

  /**
   * @operationName Create Time Entry
   * @description Logs a new time entry against a ClickUp task. Supports billable flag, custom description, and tags. Useful for AI agents that need to record time spent on automated work.
   * @category Time Tracking
   * @route POST /createTimeEntry
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace where the time entry will be created."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the task."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Identifier of the task the time entry will be associated with."}
   * @paramDef {"type":"Number","label":"Start","name":"start","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Start time of the entry as a Unix timestamp in milliseconds."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Duration of the entry in milliseconds (must be positive)."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description of the work performed."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"TOGGLE"},"description":"When enabled, marks the time entry as billable. Defaults to false."}
   * @returns {Object} The newly created time entry object.
   * @sampleResult {"data":{"id":"time_1","task":{"id":"abc123"},"wid":"123456","user":{"id":81234,"username":"Jane Doe"},"billable":false,"start":1700000000000,"duration":1000000,"description":"Drafting"}}
   */
  async createTimeEntry(workspaceId, spaceId, listId, taskId, start, duration, description, billable) {
    const body = {
      tid: taskId,
      start: Number(start),
      duration: Number(duration),
      billable: Boolean(billable),
    }

    if (description) body.description = description

    return this.#apiRequest({
      logTag: 'createTimeEntry',
      url: `${ API_BASE_URL }/team/${ workspaceId }/time_entries`,
      method: 'post',
      body,
    })
  }

  // ============================== CUSTOM FIELDS ==============================
  // Custom field DEFINITIONS are authored in ClickUp's own UI - this extension reads them and
  // sets/clears VALUES on tasks, which is the full documented third-party surface.

  // Shared read used by getListCustomFields, getCustomFieldsDictionary, and the value schema
  // loader below. ClickUp's exact response wrapper is not confirmed by its docs, so this reads
  // defensively: a bare array of fields, or an object with a top-level "fields" array.
  async #fetchListCustomFields(listId) {
    const response = await this.#apiRequest({
      logTag: 'getListCustomFields',
      url: `${ API_BASE_URL }/list/${ listId }/field`,
    })

    return Array.isArray(response) ? response : (response?.fields || [])
  }

  /**
   * @operationName Get List Custom Fields
   * @description Retrieves the custom fields configured on a ClickUp list, including each field's ID, name, type, and type-specific configuration (such as dropdown options). Use this to see which fields are available before setting a task's custom field value.
   * @category Custom Fields
   * @route POST /getListCustomFields
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the list."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the list."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list whose custom fields will be retrieved."}
   * @returns {Object} An object containing an array of the list's custom field definitions.
   * @sampleResult {"fields":[{"id":"5dc86497-098d-4bb0-87d6-cf28e43812e7","name":"Text Field","type":"text","type_config":{},"date_created":"1577378759142","hide_from_guests":false}]}
   */
  async getListCustomFields(workspaceId, spaceId, listId) {
    const fields = await this.#fetchListCustomFields(listId)

    return { fields }
  }

  /**
   * @operationName Set Task Custom Field Value
   * @description Sets or replaces the value of a custom field on a ClickUp task. Pick a Field ID first - the Value form below adapts to that field's type (text, number, dropdown, date, and so on).
   * @category Custom Fields
   * @route POST /setTaskCustomFieldValue
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the task."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the task."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list that contains the task and owns the custom field being set."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Identifier of the task whose custom field value will be set."}
   * @paramDef {"type":"String","label":"Field ID","name":"fieldId","required":true,"dictionary":"getCustomFieldsDictionary","dependsOn":["listId"],"description":"Identifier (UUID) of the custom field to set. Pick from the list's available custom fields."}
   * @paramDef {"type":"Object","label":"Value","name":"value","required":true,"schemaLoader":"createCustomFieldValueSchema","dependsOn":["listId","fieldId"],"description":"The value to set. Its shape depends on the selected field's type (text, number, dropdown option, date, currency, checkbox, URL, email, phone, or assignee add/remove) - the form below adapts automatically once a Field ID is chosen."}
   * @returns {Object} An empty object on success (ClickUp does not document a response body for this call).
   * @sampleResult {}
   */
  async setTaskCustomFieldValue(workspaceId, spaceId, listId, taskId, fieldId, value) {
    const picked = value || {}

    // Every field type but "users" nests the picked value under a "value" sub-field (see the
    // schema loader below); "users" instead picks "add"/"rem" directly, matching ClickUp's own
    // {"value":{"add":[...],"rem":[...]}} body shape for that type.
    let body

    if ('value' in picked) {
      let fieldValue = picked.value

      // The dropdown option schema-loads plain option NAMES (schema-loaded dropdowns submit the
      // displayed string verbatim - there is no label->value resolution step downstream), but
      // ClickUp's API expects the option's id as the value, so resolve name -> id here.
      const field = (await this.#fetchListCustomFields(listId)).find(f => f.id === fieldId)

      if (field?.type === 'drop_down' && typeof fieldValue === 'string') {
        const option = (field.type_config?.options || []).find(o => o.name === fieldValue)

        if (option) fieldValue = option.id
      }

      body = { value: fieldValue }
    } else {
      body = { value: { add: picked.add || [], rem: picked.rem || [] } }
    }

    return this.#apiRequest({
      logTag: 'setTaskCustomFieldValue',
      url: `${ API_BASE_URL }/task/${ taskId }/field/${ fieldId }`,
      method: 'post',
      body,
    })
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object","name":"criteria","required":true}
   * @returns {Array}
   */
  async createCustomFieldValueSchema({ criteria }) {
    const { listId, fieldId } = criteria || {}

    if (!listId || !fieldId) {
      return null
    }

    let field

    try {
      const fields = await this.#fetchListCustomFields(listId)

      field = fields.find(f => f.id === fieldId)
    } catch (error) {
      logger.error(`[createCustomFieldValueSchema] Error: ${ error.message }`)

      return null
    }

    if (!field) {
      return null
    }

    switch (field.type) {
      case 'text':
      case 'short_text':
      case 'url':
      case 'email':
      case 'phone':
        return [
          { type: 'String', label: 'Value', name: 'value', required: true, description: 'The value to set.' },
        ]

      case 'number':
      case 'currency':
      case 'emoji':
        return [
          { type: 'Number', label: 'Value', name: 'value', required: true, uiComponent: { type: 'NUMERIC_STEPPER' }, description: 'The numeric value to set.' },
        ]

      case 'checkbox':
        return [
          { type: 'Boolean', label: 'Value', name: 'value', required: true, uiComponent: { type: 'TOGGLE' }, description: 'Checked (true) or unchecked (false).' },
        ]

      case 'date':
        // Matches this extension's existing convention for every other date param (dueDate,
        // startDate, etc.): Number + NUMERIC_STEPPER, never DATE_PICKER.
        return [
          { type: 'Number', label: 'Value', name: 'value', required: true, uiComponent: { type: 'NUMERIC_STEPPER' }, description: 'Unix timestamp in milliseconds.' },
        ]

      case 'drop_down': {
        // Schema-loaded dropdowns submit the displayed string verbatim (no label->value
        // resolution step downstream), so this emits plain option names; setTaskCustomFieldValue
        // resolves the chosen name back to ClickUp's option id before sending the request.
        const labels = (field.type_config?.options || []).map(o => o.name)

        return [
          { type: 'String', label: 'Value', name: 'value', required: true, uiComponent: { type: 'DROPDOWN', options: { values: labels } }, description: 'Selected option.' },
        ]
      }

      case 'labels':
        return [
          { type: 'Array<String>', label: 'Value', name: 'value', required: true, description: 'Label option IDs to set (replaces the full set). Pick from the field\'s configured label options.' },
        ]

      case 'users':
        // Mirrors updateTask's existing addAssignees/removeAssignees precedent.
        return [
          { type: 'Array<String>', label: 'Add User IDs', name: 'add', description: 'ClickUp user IDs to add to this field.' },
          { type: 'Array<String>', label: 'Remove User IDs', name: 'rem', description: 'ClickUp user IDs to remove from this field.' },
        ]

      default:
        // tasks (relationship), manual_progress, automatic_progress, location, and any
        // unrecognized type: ClickUp's docs show no value shape for these, so this field renders
        // no writable sub-form. Still readable via Get List Custom Fields.
        return null
    }
  }

  /**
   * @operationName Remove Task Custom Field Value
   * @description Clears the value of a custom field on a ClickUp task. This does not delete the field itself, only the value stored on this task.
   * @category Custom Fields
   * @route POST /removeTaskCustomFieldValue
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the task."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the task."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Identifier of the task whose custom field value will be cleared."}
   * @paramDef {"type":"String","label":"Field ID","name":"fieldId","required":true,"dictionary":"getCustomFieldsDictionary","dependsOn":["listId"],"description":"Identifier (UUID) of the custom field to clear."}
   * @returns {Object} An empty object on success.
   * @sampleResult {}
   */
  async removeTaskCustomFieldValue(workspaceId, spaceId, listId, taskId, fieldId) {
    return this.#apiRequest({
      logTag: 'removeTaskCustomFieldValue',
      url: `${ API_BASE_URL }/task/${ taskId }/field/${ fieldId }`,
      method: 'delete',
    })
  }

  // ============================== ATTACHMENTS ==============================

  /**
   * @operationName Create Task Attachment
   * @description Uploads a file to a ClickUp task as an attachment. The file is downloaded from FlowRunner file storage and re-uploaded to ClickUp server-side, since ClickUp cannot fetch cloud-hosted files directly.
   * @category Attachments
   * @route POST /createTaskAttachment
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the task."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the task."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Identifier of the task that will receive the attachment."}
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"URL of the file to upload from FlowRunner file storage. ClickUp cannot fetch cloud-hosted files directly, so this URL is downloaded server-side and re-uploaded."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name for the uploaded attachment."}
   * @returns {Object} ClickUp's response for the created attachment.
   * @sampleResult {}
   */
  async createTaskAttachment(workspaceId, spaceId, listId, taskId, fileUrl, fileName) {
    try {
      const fileData = await Flowrunner.Request.get(fileUrl).setEncoding(null)

      // Platform-native multipart upload: .form() drives its own getHeaders()/getLength() -
      // never set Content-Type manually.
      const formData = new Flowrunner.Request.FormData()

      formData.append('attachment', fileData, { filename: fileName })

      return await Flowrunner.Request.post(`${ API_BASE_URL }/task/${ taskId }/attachment`)
        .set(this.#getAccessTokenHeader())
        .form(formData)
    } catch (error) {
      throw this.#toResponseError(error, 'createTaskAttachment')
    }
  }

  // ============================== TAGS ==============================

  /**
   * @operationName Get Space Tags
   * @description Retrieves the tags available in a ClickUp space. Use this to see which tag names can be attached to or removed from a task.
   * @category Tags
   * @route POST /getSpaceTags
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the space."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space whose tags will be retrieved."}
   * @returns {Object} An object containing an array of the space's tags.
   * @sampleResult {"tags":[{"name":"urgent"}]}
   */
  async getSpaceTags(workspaceId, spaceId) {
    return this.#apiRequest({
      logTag: 'getSpaceTags',
      url: `${ API_BASE_URL }/space/${ spaceId }/tag`,
    })
  }

  /**
   * @operationName Add Task Tag
   * @description Attaches an existing space tag to a ClickUp task. The tag must already exist in the task's space; use Get Space Tags to see what's available.
   * @category Tags
   * @route POST /addTaskTag
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the task."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the task and owns the tag."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Identifier of the task that will receive the tag."}
   * @paramDef {"type":"String","label":"Tag Name","name":"tagName","required":true,"dictionary":"getSpaceTagsDictionary","dependsOn":["spaceId"],"description":"Name of the existing space tag to attach to the task. Pick from the space's tags."}
   * @returns {Object} An empty object on success.
   * @sampleResult {}
   */
  async addTaskTag(workspaceId, spaceId, listId, taskId, tagName) {
    return this.#apiRequest({
      logTag: 'addTaskTag',
      url: `${ API_BASE_URL }/task/${ taskId }/tag/${ encodeURIComponent(tagName) }`,
      method: 'post',
    })
  }

  /**
   * @operationName Remove Task Tag
   * @description Removes a tag from a ClickUp task. This does not delete the tag from the space, only its attachment to this task.
   * @category Tags
   * @route POST /removeTaskTag
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the task."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the task."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["listId"],"description":"Identifier of the task to remove the tag from."}
   * @paramDef {"type":"String","label":"Tag Name","name":"tagName","required":true,"dictionary":"getSpaceTagsDictionary","dependsOn":["spaceId"],"description":"Name of the tag to remove from the task."}
   * @returns {Object} An empty object on success.
   * @sampleResult {}
   */
  async removeTaskTag(workspaceId, spaceId, listId, taskId, tagName) {
    return this.#apiRequest({
      logTag: 'removeTaskTag',
      url: `${ API_BASE_URL }/task/${ taskId }/tag/${ encodeURIComponent(tagName) }`,
      method: 'delete',
    })
  }

  // ============================== REALTIME TRIGGERS ==============================
  // Native ClickUp webhooks - a near-instant alternative to the polling triggers below. Both
  // kinds coexist on this service; onTaskDeleted has no polling counterpart at all since a
  // deleted task simply disappears from every list query.

  /**
   * @operationName On Task Created
   * @description Fires the moment a task is created in a ClickUp list, delivered by a native ClickUp webhook (near-instant, unlike the polling "On New Task" trigger which checks on an interval).
   * @category Tasks
   * @registerAs REALTIME_TRIGGER
   * @route POST /onTaskCreated
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the list."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the list to monitor."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list to monitor for newly created tasks (via a native ClickUp webhook - near-instant, unlike the polling \"On New Task\" trigger)."}
   * @returns {Object} The full created task object.
   * @sampleResult {"id":"abc123","name":"Write product spec","status":{"status":"to do","color":"#d3d3d3","type":"open"},"date_created":"1700000000000","creator":{"id":81234,"username":"Jane Doe"},"assignees":[],"list":{"id":"901234"},"url":"https://app.clickup.com/t/abc123"}
   */
  async onTaskCreated() {}

  /**
   * @operationName On Task Updated
   * @description Fires the moment a task is updated in a ClickUp list, delivered by a native ClickUp webhook (near-instant, unlike the polling "On Updated Task" trigger which checks on an interval). Carries ClickUp's own raw change history for the update, unmodified, so a flow can branch on the before/after values itself.
   * @category Tasks
   * @registerAs REALTIME_TRIGGER
   * @route POST /onTaskUpdated
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the list."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the list to monitor."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list to monitor for task updates (via a native ClickUp webhook - near-instant, unlike the polling \"On Updated Task\" trigger)."}
   * @returns {Object} The full updated task object plus the raw change history for this update.
   * @sampleResult {"id":"abc123","name":"Write product spec","status":{"status":"in progress","color":"#4286f4","type":"custom"},"date_updated":"1700002000000","url":"https://app.clickup.com/t/abc123","historyItems":[{"id":"8a2f82db-7718-4fdb-9493-4849e67f009d","type":6,"date":"1642740510345","before":"old value","after":"new value"}]}
   */
  async onTaskUpdated() {}

  /**
   * @operationName On Task Deleted
   * @description Fires the moment a task is deleted from a ClickUp list, delivered by a native ClickUp webhook. Polling cannot detect deletions - a deleted task no longer appears in any list query - so this trigger exists only as a webhook.
   * @category Tasks
   * @registerAs REALTIME_TRIGGER
   * @route POST /onTaskDeleted
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the list."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the list to monitor."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list to monitor for task deletions. Polling cannot detect deletions, so this trigger exists only as a native webhook."}
   * @returns {Object} The ID of the deleted task and when the deletion was received.
   * @sampleResult {"taskId":"abc123","deletedAt":"2024-03-15T14:30:00.000Z"}
   */
  async onTaskDeleted() {}

  // Resolves which subscribed list a webhook delivery belongs to by matching the delivered
  // webhook_id against the stored {listId: {webhookId, secret}} map. Called independently from
  // both handleTriggerResolveEvents (to find the right secret) and handleTriggerSelectMatched (to
  // know which list-scoped subscribers this delivery is for), instead of passing it between them.
  #resolveWebhookListId(invocation) {
    const body = this.#parseWebhookBody(invocation)
    const webhookId = body?.webhook_id
    const webhookData = invocation.webhookData || {}

    const entry = Object.entries(webhookData).find(([, v]) => v?.webhookId === webhookId)

    return entry ? entry[0] : null
  }

  #parseWebhookBody(invocation) {
    if (invocation.body && typeof invocation.body === 'object') {
      return invocation.body
    }

    if (typeof invocation.body === 'string') {
      try {
        return JSON.parse(invocation.body)
      } catch (error) {
        return null
      }
    }

    return null
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    const stored = invocation.webhookData || {}
    const callbackUrl = invocation.callbackUrl || invocation.callbackURL

    // ClickUp requires one location specifier per webhook (list_id here), unlike a single global
    // webhook - so this tracks a {listId: {webhookId, secret}} map, one webhook per subscribed list.
    const requested = new Map()

    for (const event of (invocation.events || [])) {
      const { listId, workspaceId } = event.triggerData || {}

      if (listId) requested.set(listId, workspaceId)
    }

    const webhookData = {}

    for (const [listId, workspaceId] of requested) {
      if (stored[listId]) {
        webhookData[listId] = stored[listId]
        continue
      }

      const created = await this.#apiRequest({
        logTag: 'handleTriggerUpsertWebhook',
        url: `${ API_BASE_URL }/team/${ workspaceId }/webhook`,
        method: 'post',
        body: {
          endpoint: callbackUrl,
          events: ['taskCreated', 'taskUpdated', 'taskDeleted'],
          list_id: listId,
        },
      })

      webhookData[listId] = { webhookId: created?.id, secret: created?.secret }
    }

    // A list no longer requested lost its last subscriber - best-effort remove its webhook.
    for (const [listId, entry] of Object.entries(stored)) {
      if (!requested.has(listId) && entry?.webhookId) {
        try {
          await this.#apiRequest({
            logTag: 'handleTriggerUpsertWebhook.cleanup',
            url: `${ API_BASE_URL }/webhook/${ entry.webhookId }`,
            method: 'delete',
          })
        } catch (error) {
          logger.warn(`[handleTriggerUpsertWebhook] cleanup failed, leaving webhook ${ entry.webhookId }: ${ error.message }`)
        }
      }
    }

    return { webhookData }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const headers = lowerKeys(invocation.headers || invocation.httpHeaders || {})
    const signature = headers['x-signature']
    const rawBody =
      invocation.rawBody ||
      invocation.bodyString ||
      (typeof invocation.body === 'string' ? invocation.body : null)

    const listId = this.#resolveWebhookListId(invocation)
    const secret = listId ? invocation.webhookData?.[listId]?.secret : null

    // A delivery MUST prove itself: HMAC-SHA256 over the raw body string (never a re-stringified
    // parsed object), keyed with the webhook's own secret, compared in constant time.
    if (!listId || !secret || !signature || !rawBody) {
      logger.warn('[handleTriggerResolveEvents] missing signature, body, or unknown webhook - rejecting')

      return { events: [] }
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')

    if (!safeEqual(expected, signature)) {
      logger.warn('[handleTriggerResolveEvents] signature mismatch - rejecting')

      return { events: [] }
    }

    const body = this.#parseWebhookBody(invocation) || {}

    if (body.event === 'taskDeleted') {
      return {
        events: [{
          name: 'onTaskDeleted',
          data: { taskId: body.task_id, deletedAt: new Date().toISOString() },
        }],
      }
    }

    if (body.event === 'taskCreated' || body.event === 'taskUpdated') {
      let task

      try {
        task = await this.#apiRequest({
          logTag: 'handleTriggerResolveEvents',
          url: `${ API_BASE_URL }/task/${ body.task_id }`,
        })
      } catch (error) {
        logger.error(`[handleTriggerResolveEvents] failed to fetch task ${ body.task_id }: ${ error.message }`)

        return { events: [] }
      }

      if (body.event === 'taskCreated') {
        return { events: [{ name: 'onTaskCreated', data: task }] }
      }

      // history_items has no documented type-code legend - pass it through verbatim rather than
      // inventing a "changed field" interpretation.
      return {
        events: [{
          name: 'onTaskUpdated',
          data: { ...task, historyItems: body.history_items || [] },
        }],
      }
    }

    // This webhook only ever subscribes to the 3 events above; any other name is defensive.
    return { events: [] }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    const listId = this.#resolveWebhookListId(invocation)

    if (!listId) {
      return { ids: [] }
    }

    const ids = (invocation.triggers || [])
      .filter(t => t.data?.listId === listId)
      .map(t => t.id)

    return { ids }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const webhookData = invocation.webhookData || {}

    for (const entry of Object.values(webhookData)) {
      if (!entry?.webhookId) continue

      try {
        await this.#apiRequest({
          logTag: 'handleTriggerDeleteWebhook',
          url: `${ API_BASE_URL }/webhook/${ entry.webhookId }`,
          method: 'delete',
        })
      } catch (error) {
        logger.warn(`[handleTriggerDeleteWebhook] cleanup failed, leaving webhook ${ entry.webhookId }: ${ error.message }`)
      }
    }

    return {}
  }

  // ============================== POLLING TRIGGERS ==============================

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On New Task
   * @description Continuously monitors a ClickUp list for newly created tasks using configurable polling intervals. Triggers downstream workflows when fresh tasks are added. Polling interval can be customized (minimum 30 seconds).
   * @category Tasks
   * @registerAs POLLING_TRIGGER
   * @route POST /onNewTask
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the list."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the list to monitor."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list to monitor for new tasks."}
   * @returns {Object} A newly created task in the monitored list.
   * @sampleResult {"id":"abc123","name":"Write product spec","status":{"status":"to do","color":"#d3d3d3","type":"open"},"date_created":"1700000000000","creator":{"id":81234,"username":"Jane Doe"},"assignees":[],"list":{"id":"901234"},"url":"https://app.clickup.com/t/abc123"}
   */
  async onNewTask(invocation) {
    const { listId } = invocation.triggerData
    const state = invocation.state || {}

    if (invocation.learningMode) {
      const newest = await this.#getNewestTask(listId, 'created')

      return { events: newest ? [newest] : [], state: null }
    }

    // First cycle: seed the watermark from the single newest task and emit nothing, so the very
    // first poll never dumps the whole backlog of existing tasks.
    if (state.since == null) {
      const newest = await this.#getNewestTask(listId, 'created')
      const since = newest ? Number(newest.date_created) : Date.now()

      return { events: [], state: { since, seenIds: newest ? [newest.id] : [] } }
    }

    const now = Date.now()
    const tasks = await this.#getRecentTasks(listId, 'created', state.since - POLL_OVERLAP_MS)

    const seen = new Set(state.seenIds || [])
    const events = tasks.filter(t => !seen.has(t.id))
    const seenIds = [...tasks.map(t => t.id), ...(state.seenIds || [])].slice(0, MAX_SEEN_IDS)

    return { events, state: { since: now, seenIds } }
  }

  /**
   * @operationName On Updated Task
   * @description Continuously monitors a ClickUp list for tasks that were recently updated. Triggers downstream workflows whenever a task's content or status changes. Polling interval can be customized (minimum 30 seconds).
   * @category Tasks
   * @registerAs POLLING_TRIGGER
   * @route POST /onUpdatedTask
   * @appearanceColor #7B68EE #4DC3FF
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Identifier of the ClickUp workspace that contains the list."}
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","dependsOn":["workspaceId"],"description":"Identifier of the space that contains the list to monitor."}
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["spaceId"],"description":"Identifier of the list to monitor for updated tasks."}
   * @returns {Object} A task whose date_updated has changed since the previous poll.
   * @sampleResult {"id":"abc123","name":"Write product spec","status":{"status":"in progress","color":"#4286f4","type":"custom"},"date_created":"1700000000000","date_updated":"1700002000000","creator":{"id":81234,"username":"Jane Doe"},"assignees":[],"list":{"id":"901234"},"url":"https://app.clickup.com/t/abc123"}
   */
  async onUpdatedTask(invocation) {
    const { listId } = invocation.triggerData
    const state = invocation.state || {}

    if (invocation.learningMode) {
      const newest = await this.#getNewestTask(listId, 'updated')

      return { events: newest ? [newest] : [], state: null }
    }

    // First cycle: seed the watermark and emit nothing. A task is keyed by id+date_updated so a
    // later edit of the same task (a new date_updated) is treated as a fresh event.
    if (state.since == null) {
      const newest = await this.#getNewestTask(listId, 'updated')
      const since = newest ? Number(newest.date_updated) : Date.now()

      return { events: [], state: { since, seenKeys: newest ? [`${ newest.id }:${ newest.date_updated }`] : [] } }
    }

    const now = Date.now()
    const tasks = await this.#getRecentTasks(listId, 'updated', state.since - POLL_OVERLAP_MS)

    const seen = new Set(state.seenKeys || [])
    const events = tasks.filter(t => !seen.has(`${ t.id }:${ t.date_updated }`))
    const seenKeys = [...tasks.map(t => `${ t.id }:${ t.date_updated }`), ...(state.seenKeys || [])].slice(0, MAX_SEEN_IDS)

    return { events, state: { since: now, seenKeys } }
  }

  // The single newest task in a list, used to seed a trigger's watermark on its first cycle.
  async #getNewestTask(listId, dateField) {
    const result = await this.#apiRequest({
      logTag: `getNewestTask_${ dateField }`,
      url: `${ API_BASE_URL }/list/${ listId }/task`,
      query: {
        archived: false,
        page: 0,
        order_by: dateField,
        reverse: true,
        include_closed: true,
      },
    })

    return (result?.tasks || [])[0] || null
  }

  // Every task in a list at or after `sinceMs`, ordered ascending, walking ClickUp's own pages
  // until it reports the last one - so no task past the first page is ever dropped. Callers pass a
  // watermark already widened by POLL_OVERLAP_MS and de-duplicate the overlap themselves.
  async #getRecentTasks(listId, dateField, sinceMs) {
    const filterKey = dateField === 'updated' ? 'date_updated_gt' : 'date_created_gt'
    const collected = []
    let page = 0

    for (;;) {
      const result = await this.#apiRequest({
        logTag: `getRecentTasks_${ dateField }`,
        url: `${ API_BASE_URL }/list/${ listId }/task`,
        query: {
          archived: false,
          page,
          order_by: dateField,
          reverse: false,
          include_closed: true,
          [filterKey]: sinceMs,
        },
      })

      const batch = result?.tasks || []

      collected.push(...batch)

      // ClickUp sets last_page=false while more pages remain; any other value (true / absent) or an
      // empty page ends the walk.
      if (result?.last_page !== false || batch.length === 0) {
        break
      }

      page++
    }

    return collected
  }
}

Flowrunner.ServerCode.addService(ClickUp, [
  {
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientId',
    hint: 'Your OAuth 2.0 Client ID from the ClickUp app settings (https://app.clickup.com/settings/apps).',
  },
  {
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientSecret',
    hint: 'Your OAuth 2.0 Client Secret from the ClickUp app settings. Required for secure token exchange.',
  },
])
