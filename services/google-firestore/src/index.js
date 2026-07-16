'use strict'

const crypto = require('node:crypto')

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DATASTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'
const TOKEN_LIFETIME_SECONDS = 3600
const TOKEN_REFRESH_MARGIN_MS = 60000

const DEFAULT_DATABASE_ID = '(default)'

const OPERATOR_MAP = {
  '==': 'EQUAL',
  '!=': 'NOT_EQUAL',
  '<': 'LESS_THAN',
  '<=': 'LESS_THAN_OR_EQUAL',
  '>': 'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL',
  'array-contains': 'ARRAY_CONTAINS',
  'in': 'IN',
}

const AGGREGATION_MAP = {
  'Count': 'count',
  'Sum': 'sum',
  'Average': 'avg',
}

const DIRECTION_MAP = {
  'Ascending': 'ASCENDING',
  'Descending': 'DESCENDING',
}

// Firestore wire-format value keys. A plain object containing exactly one of
// these keys is treated as an explicit, pre-encoded Firestore value and is
// passed through verbatim (escape hatch for timestamps, geo points, etc.).
const WIRE_VALUE_KEYS = new Set([
  'nullValue', 'booleanValue', 'integerValue', 'doubleValue', 'timestampValue',
  'stringValue', 'bytesValue', 'referenceValue', 'geoPointValue', 'arrayValue', 'mapValue',
])

const logger = {
  info: (...args) => console.log('[Google Firestore] info:', ...args),
  debug: (...args) => console.log('[Google Firestore] debug:', ...args),
  error: (...args) => console.log('[Google Firestore] error:', ...args),
  warn: (...args) => console.log('[Google Firestore] warn:', ...args),
}

// ============================================================================
//  TYPEDEFS
// ============================================================================

/**
 * @typedef {Object} QueryCondition
 * @paramDef {"type":"String","label":"Field","name":"field","required":true,"description":"The document field to filter on. Use dot notation for nested map fields, e.g. 'address.city'."}
 * @paramDef {"type":"String","label":"Operator","name":"op","required":true,"defaultValue":"==","uiComponent":{"type":"DROPDOWN","options":{"values":["==","!=","<","<=",">",">=","array-contains","in"]}},"description":"Comparison operator. 'array-contains' matches documents whose array field contains the value; 'in' matches documents whose field equals any element of a JSON array value (max 30 elements)."}
 * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The value to compare against, as JSON: 42 is a number, true a boolean, \"text\" or bare text a string, [\"a\",\"b\"] an array (required for the 'in' operator). Non-JSON input is treated as a plain string."}
 */

/**
 * @typedef {Object} getCollectionsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter collection IDs."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for the next page of results."}
 */

/**
 * @integrationName Google Firestore
 * @integrationIcon /icon.svg
 */
class GoogleFirestore {
  constructor(config) {
    this.serviceAccountKeyRaw = config.serviceAccountKey
    this.configuredProjectId = config.projectId
    this.databaseId = (config.databaseId || '').trim() || DEFAULT_DATABASE_ID

    this.accessToken = null
    this.accessTokenExpiresAt = 0
  }

  // --------------------------------------------------------------------------
  //  Service-account authentication (signed JWT -> access token)
  // --------------------------------------------------------------------------

  #getServiceAccountKey() {
    if (this.serviceAccountKey) {
      return this.serviceAccountKey
    }

    if (!this.serviceAccountKeyRaw) {
      throw new Error('Service account key is not configured')
    }

    let key

    try {
      key = JSON.parse(this.serviceAccountKeyRaw)
    } catch (error) {
      throw new Error('Service account key is not valid JSON. Paste the full contents of the JSON key file downloaded from the Firebase or Google Cloud console.')
    }

    if (!key.client_email || !key.private_key) {
      throw new Error('Service account key is missing "client_email" or "private_key". Make sure you pasted the complete JSON key file.')
    }

    // Recover real newlines if the key was pasted with escaped "\n" sequences.
    if (!key.private_key.includes('\n')) {
      key.private_key = key.private_key.replace(/\\n/g, '\n')
    }

    this.serviceAccountKey = key

    return key
  }

  #getProjectId() {
    return this.configuredProjectId?.trim() || this.#getServiceAccountKey().project_id
  }

  #databaseUrl() {
    const project = this.#getProjectId()

    if (!project) {
      throw new Error('Project ID could not be determined. Set the Project ID config item or use a key file containing "project_id".')
    }

    return `https://firestore.googleapis.com/v1/projects/${ encodeURIComponent(project) }/databases/${ encodeURIComponent(this.databaseId) }`
  }

  #documentsUrl() {
    return `${ this.#databaseUrl() }/documents`
  }

  #base64UrlEncode(input) {
    const base64 = Buffer.isBuffer(input) ? input.toString('base64') : Buffer.from(input).toString('base64')

    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  #buildSignedJwt(key) {
    const nowSeconds = Math.floor(Date.now() / 1000)

    const header = this.#base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = this.#base64UrlEncode(JSON.stringify({
      iss: key.client_email,
      scope: DATASTORE_SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
    }))

    const signingInput = `${ header }.${ claims }`
    const signatureBase64 = crypto.createSign('RSA-SHA256').update(signingInput).sign(key.private_key, 'base64')
    const signature = signatureBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    return `${ signingInput }.${ signature }`
  }

  async #getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.accessToken
    }

    const key = this.#getServiceAccountKey()

    logger.debug(`requesting access token for ${ key.client_email }`)

    let jwt

    try {
      jwt = this.#buildSignedJwt(key)
    } catch (error) {
      throw new Error(`Failed to sign the service account JWT: ${ error.message }. Check that "private_key" in the key file is intact.`)
    }

    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    })

    let response

    try {
      response = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())
    } catch (error) {
      const message = error.body?.error_description || error.body?.error || error.message

      throw new Error(`Failed to obtain an access token from Google: ${ message }`)
    }

    if (!response.access_token) {
      throw new Error('Google token endpoint did not return an access token')
    }

    this.accessToken = response.access_token
    this.accessTokenExpiresAt = Date.now() + (response.expires_in || TOKEN_LIFETIME_SECONDS) * 1000

    return this.accessToken
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    const accessToken = await this.#getAccessToken()

    try {
      logger.debug(`${ logTag } - api request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method](url)
        .set({ 'Authorization': `Bearer ${ accessToken }`, 'Content-Type': 'application/json' })
        .query(this.#compactObject(query))

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const googleError = error.body?.error
      const status = googleError?.status
      const message = googleError?.message || error.body?.message || error.message || 'API request failed'

      logger.error(`${ logTag } - error: ${ message }${ status ? ` (status: ${ status })` : '' }`)

      throw new Error(`Firestore API error: ${ message }${ status ? ` (status: ${ status })` : '' }`)
    }
  }

  #compactObject(object) {
    const result = {}

    for (const [key, value] of Object.entries(object || {})) {
      if (value !== undefined && value !== null && value !== '') {
        result[key] = value
      }
    }

    return result
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // --------------------------------------------------------------------------
  //  Path helpers
  // --------------------------------------------------------------------------

  #normalizePath(path) {
    return String(path || '').trim().replace(/^\/+|\/+$/g, '')
  }

  #encodePath(path) {
    return this.#normalizePath(path).split('/').map(segment => encodeURIComponent(segment)).join('/')
  }

  #documentResourceName(path) {
    const project = this.#getProjectId()

    return `projects/${ project }/databases/${ this.databaseId }/documents/${ this.#normalizePath(path) }`
  }

  #relativePathFromName(name) {
    const match = String(name || '').match(/\/documents\/(.+)$/)

    return match ? match[1] : name
  }

  #escapeFieldPath(fieldPath) {
    return String(fieldPath)
      .split('.')
      .map(segment => /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)
        ? segment
        : `\`${ segment.replace(/\\/g, '\\\\').replace(/`/g, '\\`') }\``)
      .join('.')
  }

  // --------------------------------------------------------------------------
  //  Value conversion: plain JSON <-> Firestore wire format
  // --------------------------------------------------------------------------

  #toFirestoreValue(value) {
    if (value === null || value === undefined) {
      return { nullValue: null }
    }

    if (typeof value === 'boolean') {
      return { booleanValue: value }
    }

    if (typeof value === 'number') {
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
    }

    if (typeof value === 'string') {
      return { stringValue: value }
    }

    if (Array.isArray(value)) {
      return { arrayValue: { values: value.map(item => this.#toFirestoreValue(item)) } }
    }

    if (typeof value === 'object') {
      // Explicit wire-format escape hatch, e.g. {"timestampValue":"2026-01-01T00:00:00Z"}
      // or {"geoPointValue":{"latitude":48.85,"longitude":2.35}}.
      const keys = Object.keys(value)

      if (keys.length === 1 && WIRE_VALUE_KEYS.has(keys[0])) {
        return keys[0] === 'integerValue' ? { integerValue: String(value.integerValue) } : value
      }

      return { mapValue: { fields: this.#toFirestoreFields(value) } }
    }

    return { stringValue: String(value) }
  }

  #toFirestoreFields(plainObject) {
    const fields = {}

    for (const [key, value] of Object.entries(plainObject || {})) {
      fields[key] = this.#toFirestoreValue(value)
    }

    return fields
  }

  #fromFirestoreValue(value) {
    if (value === null || value === undefined || 'nullValue' in value) {
      return null
    }

    if ('booleanValue' in value) {
      return value.booleanValue
    }

    if ('integerValue' in value) {
      const num = Number(value.integerValue)

      return Number.isSafeInteger(num) ? num : value.integerValue
    }

    if ('doubleValue' in value) {
      return value.doubleValue
    }

    if ('timestampValue' in value) {
      return value.timestampValue
    }

    if ('stringValue' in value) {
      return value.stringValue
    }

    if ('bytesValue' in value) {
      return value.bytesValue
    }

    if ('referenceValue' in value) {
      return value.referenceValue
    }

    if ('geoPointValue' in value) {
      return {
        latitude: value.geoPointValue.latitude ?? 0,
        longitude: value.geoPointValue.longitude ?? 0,
      }
    }

    if ('arrayValue' in value) {
      return (value.arrayValue.values || []).map(item => this.#fromFirestoreValue(item))
    }

    if ('mapValue' in value) {
      return this.#fromFirestoreFields(value.mapValue.fields)
    }

    return null
  }

  #fromFirestoreFields(fields) {
    const result = {}

    for (const [key, value] of Object.entries(fields || {})) {
      result[key] = this.#fromFirestoreValue(value)
    }

    return result
  }

  #documentToPlain(document) {
    const path = this.#relativePathFromName(document.name)

    return {
      id: path.split('/').pop(),
      path,
      name: document.name,
      createTime: document.createTime || null,
      updateTime: document.updateTime || null,
      data: this.#fromFirestoreFields(document.fields),
    }
  }

  // --------------------------------------------------------------------------
  //  Query helpers
  // --------------------------------------------------------------------------

  #parseConditionValue(value) {
    if (typeof value !== 'string') {
      return value
    }

    const trimmed = value.trim()

    if (!trimmed) {
      return value
    }

    try {
      return JSON.parse(trimmed)
    } catch (error) {
      return value
    }
  }

  #buildWhereFilter(conditions) {
    if (!conditions || !conditions.length) {
      return undefined
    }

    const filters = conditions.map(condition => {
      const op = this.#resolveChoice(condition.op, OPERATOR_MAP)

      if (!condition.field || !op) {
        throw new Error('Each condition requires a "field" and a valid "op"')
      }

      return {
        fieldFilter: {
          field: { fieldPath: this.#escapeFieldPath(condition.field) },
          op,
          value: this.#toFirestoreValue(this.#parseConditionValue(condition.value)),
        },
      }
    })

    return filters.length === 1
      ? filters[0]
      : { compositeFilter: { op: 'AND', filters } }
  }

  #buildStructuredQuery(collectionId, conditions, orderByField, orderByDirection, limit, allDescendants) {
    const structuredQuery = {
      from: [this.#compactObject({ collectionId, allDescendants: allDescendants || undefined })],
    }

    const where = this.#buildWhereFilter(conditions)

    if (where) {
      structuredQuery.where = where
    }

    if (orderByField) {
      structuredQuery.orderBy = [{
        field: { fieldPath: this.#escapeFieldPath(orderByField) },
        direction: this.#resolveChoice(orderByDirection, DIRECTION_MAP) || 'ASCENDING',
      }]
    }

    if (limit !== undefined && limit !== null) {
      structuredQuery.limit = limit
    }

    return structuredQuery
  }

  #queryParentUrl(parentDocumentPath) {
    const parent = this.#normalizePath(parentDocumentPath)

    return parent ? `${ this.#documentsUrl() }/${ this.#encodePath(parent) }` : this.#documentsUrl()
  }

  // ==========================================================================
  //  DOCUMENTS
  // ==========================================================================

  /**
   * @operationName Create Document
   * @category Documents
   * @description Creates a new document in a collection from a plain JSON object — values are converted to Firestore's typed wire format automatically (whole numbers become integers, other numbers doubles, plus booleans, strings, nulls, nested objects as maps, and arrays). If Document ID is omitted, Firestore generates a random ID. The collection path may target a subcollection, e.g. 'users/abc/orders'. Fails if a document with the given ID already exists.
   * @route POST /create-document
   *
   * @paramDef {"type":"String","label":"Collection Path","name":"collectionPath","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to create the document in. Pick a root collection or type a path, including subcollection paths like 'users/abc/orders'."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"The document's fields as plain JSON, e.g. {\"name\":\"Alice\",\"age\":30,\"address\":{\"city\":\"Paris\"}}. To store a Firestore timestamp, geo point, or reference, use an explicit wire value like {\"timestampValue\":\"2026-01-01T00:00:00Z\"}."}
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","description":"Optional ID for the new document. When omitted, Firestore assigns an auto-generated ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"aB3dE5fG","path":"users/aB3dE5fG","name":"projects/my-project/databases/(default)/documents/users/aB3dE5fG","createTime":"2026-07-01T12:00:00.000000Z","updateTime":"2026-07-01T12:00:00.000000Z","data":{"name":"Alice","age":30,"active":true}}
   */
  async createDocument(collectionPath, data, documentId) {
    const response = await this.#apiRequest({
      url: `${ this.#documentsUrl() }/${ this.#encodePath(collectionPath) }`,
      method: 'post',
      query: { documentId },
      body: { fields: this.#toFirestoreFields(data) },
      logTag: 'createDocument',
    })

    return this.#documentToPlain(response)
  }

  /**
   * @operationName Get Document
   * @category Documents
   * @description Retrieves a single document by its path and returns its fields as plain JSON (Firestore's typed wire format is converted automatically; integers become numbers, timestamps become ISO 8601 strings, maps become nested objects). Also returns the document's ID, full resource name, and create/update timestamps. Fails if the document does not exist.
   * @route GET /get-document
   *
   * @paramDef {"type":"String","label":"Document Path","name":"documentPath","required":true,"description":"The document's path relative to the database root, e.g. 'users/abc' or a subcollection document like 'users/abc/orders/o123'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc","path":"users/abc","name":"projects/my-project/databases/(default)/documents/users/abc","createTime":"2026-07-01T12:00:00.000000Z","updateTime":"2026-07-02T08:30:00.000000Z","data":{"name":"Alice","age":30,"address":{"city":"Paris"}}}
   */
  async getDocument(documentPath) {
    const response = await this.#apiRequest({
      url: `${ this.#documentsUrl() }/${ this.#encodePath(documentPath) }`,
      logTag: 'getDocument',
    })

    return this.#documentToPlain(response)
  }

  /**
   * @operationName Update Document
   * @category Documents
   * @description Merges plain JSON data into a document: only the top-level fields present in Data are written (an update mask is built from its keys), all other fields are left untouched. Values are converted to Firestore's typed wire format automatically. Setting a field to null stores an explicit null. By default the document is created if it does not exist; enable Must Exist to fail instead. Returns the full updated document.
   * @route PATCH /update-document
   *
   * @paramDef {"type":"String","label":"Document Path","name":"documentPath","required":true,"description":"The document's path relative to the database root, e.g. 'users/abc' or 'users/abc/orders/o123'."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"The fields to set, as plain JSON, e.g. {\"age\":31,\"active\":false}. Only these top-level fields are modified; a nested object replaces the entire map field it targets."}
   * @paramDef {"type":"Boolean","label":"Must Exist","name":"mustExist","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the update fails if the document does not exist. When disabled (default), a missing document is created with the given fields."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc","path":"users/abc","name":"projects/my-project/databases/(default)/documents/users/abc","createTime":"2026-07-01T12:00:00.000000Z","updateTime":"2026-07-03T09:15:00.000000Z","data":{"name":"Alice","age":31,"active":false}}
   */
  async updateDocument(documentPath, data, mustExist) {
    if (!data || !Object.keys(data).length) {
      throw new Error('Data must contain at least one field to update')
    }

    const params = new URLSearchParams()

    for (const key of Object.keys(data)) {
      params.append('updateMask.fieldPaths', this.#escapeFieldPath(key))
    }

    if (mustExist) {
      params.append('currentDocument.exists', 'true')
    }

    const response = await this.#apiRequest({
      url: `${ this.#documentsUrl() }/${ this.#encodePath(documentPath) }?${ params.toString() }`,
      method: 'patch',
      body: { fields: this.#toFirestoreFields(data) },
      logTag: 'updateDocument',
    })

    return this.#documentToPlain(response)
  }

  /**
   * @operationName Delete Document
   * @category Documents
   * @description Permanently deletes a document by its path. THIS CANNOT BE UNDONE. Deleting a document does NOT delete its subcollections — documents under 'users/abc/orders' remain after 'users/abc' is deleted. By default the operation succeeds even if the document does not exist; enable Must Exist to fail in that case.
   * @route DELETE /delete-document
   *
   * @paramDef {"type":"String","label":"Document Path","name":"documentPath","required":true,"description":"The document's path relative to the database root, e.g. 'users/abc' or 'users/abc/orders/o123'."}
   * @paramDef {"type":"Boolean","label":"Must Exist","name":"mustExist","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the delete fails if the document does not exist. When disabled (default), deleting a missing document succeeds silently."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"path":"users/abc"}
   */
  async deleteDocument(documentPath, mustExist) {
    await this.#apiRequest({
      url: `${ this.#documentsUrl() }/${ this.#encodePath(documentPath) }`,
      method: 'delete',
      query: { 'currentDocument.exists': mustExist ? 'true' : undefined },
      logTag: 'deleteDocument',
    })

    return { success: true, path: this.#normalizePath(documentPath) }
  }

  /**
   * @operationName List Documents
   * @category Documents
   * @description Lists the documents in a collection (or subcollection) with their fields converted to plain JSON. Supports pagination via Page Size and the returned nextPageToken, and simple sorting via Order By (e.g. 'age desc, name'). For filtered reads use 'Query Documents' instead.
   * @route GET /list-documents
   *
   * @paramDef {"type":"String","label":"Collection Path","name":"collectionPath","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to list. Pick a root collection or type a path, including subcollection paths like 'users/abc/orders'."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of documents to return in this page (Firestore's default is 100, maximum 300)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous 'List Documents' call to fetch the next page."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","description":"Comma-separated fields to sort by, each optionally followed by 'desc', e.g. 'age desc, name'. Requires a matching index for most combinations."}
   *
   * @returns {Object}
   * @sampleResult {"documents":[{"id":"abc","path":"users/abc","name":"projects/my-project/databases/(default)/documents/users/abc","createTime":"2026-07-01T12:00:00.000000Z","updateTime":"2026-07-02T08:30:00.000000Z","data":{"name":"Alice","age":30}}],"nextPageToken":null}
   */
  async listDocuments(collectionPath, pageSize, pageToken, orderBy) {
    const response = await this.#apiRequest({
      url: `${ this.#documentsUrl() }/${ this.#encodePath(collectionPath) }`,
      query: { pageSize, pageToken, orderBy },
      logTag: 'listDocuments',
    })

    return {
      documents: (response.documents || []).map(document => this.#documentToPlain(document)),
      nextPageToken: response.nextPageToken || null,
    }
  }

  /**
   * @operationName Batch Get Documents
   * @category Documents
   * @description Retrieves up to several hundred documents by path in a single call. Returns the documents that exist (with fields converted to plain JSON) in 'found', and the paths of documents that do not exist in 'missing'. Paths may point at any collection or subcollection in the database.
   * @route POST /batch-get-documents
   *
   * @paramDef {"type":"Array<String>","label":"Document Paths","name":"documentPaths","required":true,"description":"The document paths to fetch, relative to the database root, e.g. [\"users/abc\",\"users/def\",\"users/abc/orders/o123\"]."}
   *
   * @returns {Object}
   * @sampleResult {"found":[{"id":"abc","path":"users/abc","name":"projects/my-project/databases/(default)/documents/users/abc","createTime":"2026-07-01T12:00:00.000000Z","updateTime":"2026-07-02T08:30:00.000000Z","data":{"name":"Alice","age":30}}],"missing":["users/def"]}
   */
  async batchGetDocuments(documentPaths) {
    if (!documentPaths || !documentPaths.length) {
      throw new Error('At least one document path is required')
    }

    const response = await this.#apiRequest({
      url: `${ this.#documentsUrl() }:batchGet`,
      method: 'post',
      body: { documents: documentPaths.map(path => this.#documentResourceName(path)) },
      logTag: 'batchGetDocuments',
    })

    const found = []
    const missing = []

    for (const entry of response || []) {
      if (entry.found) {
        found.push(this.#documentToPlain(entry.found))
      } else if (entry.missing) {
        missing.push(this.#relativePathFromName(entry.missing))
      }
    }

    return { found, missing }
  }

  // ==========================================================================
  //  QUERIES
  // ==========================================================================

  /**
   * @operationName Query Documents
   * @category Queries
   * @description Runs a structured query against a collection and returns the matching documents with their fields converted to plain JSON. Conditions filter on document fields (==, !=, <, <=, >, >=, array-contains, in) and are combined with AND. Supports sorting on a field, a result limit, and querying every collection with the given ID across the database (collection group query). Compound filters on different fields may require a composite index — Firestore's error message includes a link to create it.
   * @route POST /query-documents
   *
   * @paramDef {"type":"String","label":"Collection ID","name":"collectionId","required":true,"dictionary":"getCollectionsDictionary","description":"The ID of the collection to query, e.g. 'users' — a single segment, not a path. Combine with Parent Document Path to query a subcollection."}
   * @paramDef {"type":"Array<QueryCondition>","label":"Conditions","name":"conditions","description":"Filter conditions on document fields, combined with AND. Leave empty to return all documents in the collection."}
   * @paramDef {"type":"String","label":"Order By Field","name":"orderByField","description":"Optional field to sort the results by, e.g. 'createdAt' or a nested field like 'address.city'. Range conditions (<, <=, >, >=) must order by the filtered field first."}
   * @paramDef {"type":"String","label":"Order By Direction","name":"orderByDirection","defaultValue":"Ascending","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction, applied when Order By Field is set."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of documents to return."}
   * @paramDef {"type":"String","label":"Parent Document Path","name":"parentDocumentPath","description":"Optional parent document whose subcollection to query, e.g. 'users/abc' to query 'users/abc/{Collection ID}'. Leave empty to query a root collection."}
   * @paramDef {"type":"Boolean","label":"All Descendants","name":"allDescendants","uiComponent":{"type":"TOGGLE"},"description":"When enabled, runs a collection group query that matches every collection named Collection ID anywhere under the parent (e.g. every 'orders' subcollection). Requires a collection group index for filtered or sorted queries."}
   *
   * @returns {Object}
   * @sampleResult {"documents":[{"id":"abc","path":"users/abc","name":"projects/my-project/databases/(default)/documents/users/abc","createTime":"2026-07-01T12:00:00.000000Z","updateTime":"2026-07-02T08:30:00.000000Z","data":{"name":"Alice","age":30,"active":true}}],"count":1}
   */
  async queryDocuments(collectionId, conditions, orderByField, orderByDirection, limit, parentDocumentPath, allDescendants) {
    const response = await this.#apiRequest({
      url: `${ this.#queryParentUrl(parentDocumentPath) }:runQuery`,
      method: 'post',
      body: {
        structuredQuery: this.#buildStructuredQuery(collectionId, conditions, orderByField, orderByDirection, limit, allDescendants),
      },
      logTag: 'queryDocuments',
    })

    const documents = (response || [])
      .filter(entry => entry.document)
      .map(entry => this.#documentToPlain(entry.document))

    return { documents, count: documents.length }
  }

  /**
   * @operationName Run Aggregation Query
   * @category Queries
   * @description Computes an aggregate — Count, Sum, or Average — over the documents of a collection matching the given conditions, without reading the documents themselves (billed as index entries, far cheaper than fetching). Sum and Average require a numeric Field and skip documents where the field is missing or non-numeric; Average returns null when no documents match.
   * @route POST /run-aggregation-query
   *
   * @paramDef {"type":"String","label":"Collection ID","name":"collectionId","required":true,"dictionary":"getCollectionsDictionary","description":"The ID of the collection to aggregate over, e.g. 'orders' — a single segment, not a path. Combine with Parent Document Path for subcollections."}
   * @paramDef {"type":"String","label":"Aggregation","name":"aggregation","required":true,"defaultValue":"Count","uiComponent":{"type":"DROPDOWN","options":{"values":["Count","Sum","Average"]}},"description":"The aggregate function to compute over the matching documents."}
   * @paramDef {"type":"String","label":"Field","name":"field","description":"The numeric document field to aggregate, e.g. 'price'. Required for Sum and Average; ignored for Count."}
   * @paramDef {"type":"Array<QueryCondition>","label":"Conditions","name":"conditions","description":"Filter conditions on document fields, combined with AND. Leave empty to aggregate over the whole collection."}
   * @paramDef {"type":"String","label":"Parent Document Path","name":"parentDocumentPath","description":"Optional parent document whose subcollection to aggregate, e.g. 'users/abc'. Leave empty for a root collection."}
   * @paramDef {"type":"Boolean","label":"All Descendants","name":"allDescendants","uiComponent":{"type":"TOGGLE"},"description":"When enabled, aggregates across every collection named Collection ID anywhere under the parent (collection group query)."}
   *
   * @returns {Object}
   * @sampleResult {"aggregation":"Count","value":42,"readTime":"2026-07-03T10:00:00.000000Z"}
   */
  async runAggregationQuery(collectionId, aggregation, field, conditions, parentDocumentPath, allDescendants) {
    const aggregationKey = this.#resolveChoice(aggregation, AGGREGATION_MAP)

    if (!aggregationKey) {
      throw new Error('Aggregation must be one of: Count, Sum, Average')
    }

    if (aggregationKey !== 'count' && !field) {
      throw new Error(`The "${ aggregation }" aggregation requires a Field to aggregate`)
    }

    const aggregationSpec = aggregationKey === 'count'
      ? { count: {} }
      : { [aggregationKey]: { field: { fieldPath: this.#escapeFieldPath(field) } } }

    const response = await this.#apiRequest({
      url: `${ this.#queryParentUrl(parentDocumentPath) }:runAggregationQuery`,
      method: 'post',
      body: {
        structuredAggregationQuery: {
          structuredQuery: this.#buildStructuredQuery(collectionId, conditions, undefined, undefined, undefined, allDescendants),
          aggregations: [{ alias: 'result', ...aggregationSpec }],
        },
      },
      logTag: 'runAggregationQuery',
    })

    const entry = (response || []).find(item => item.result)

    return {
      aggregation,
      value: entry ? this.#fromFirestoreValue(entry.result.aggregateFields?.result) : null,
      readTime: entry?.readTime || null,
    }
  }

  // ==========================================================================
  //  COLLECTIONS
  // ==========================================================================

  /**
   * @operationName List Collection IDs
   * @category Collections
   * @description Lists the IDs of the collections directly under the database root, or of the subcollections directly under a given document (e.g. the subcollections of 'users/abc'). Supports pagination for documents with many subcollections.
   * @route GET /list-collection-ids
   *
   * @paramDef {"type":"String","label":"Parent Document Path","name":"parentDocumentPath","description":"Optional document whose subcollection IDs to list, e.g. 'users/abc'. Leave empty to list the database's root collections."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of collection IDs to return in this page."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous 'List Collection IDs' call to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"collectionIds":["orders","reviews","sessions"],"nextPageToken":null}
   */
  async listCollectionIds(parentDocumentPath, pageSize, pageToken) {
    const response = await this.#apiRequest({
      url: `${ this.#queryParentUrl(parentDocumentPath) }:listCollectionIds`,
      method: 'post',
      body: this.#compactObject({ pageSize, pageToken }),
      logTag: 'listCollectionIds',
    })

    return {
      collectionIds: response.collectionIds || [],
      nextPageToken: response.nextPageToken || null,
    }
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Collections Dictionary
   * @description Lists the database's root collection IDs for selection in dependent parameters.
   * @route POST /get-collections-dictionary
   * @paramDef {"type":"getCollectionsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"users","value":"users","note":""}],"cursor":null}
   */
  async getCollectionsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ this.#documentsUrl() }:listCollectionIds`,
      method: 'post',
      body: this.#compactObject({ pageSize: 300, pageToken: cursor }),
      logTag: 'getCollectionsDictionary',
    })

    const searchLower = (search || '').toLowerCase()

    const items = (response.collectionIds || [])
      .filter(collectionId => !searchLower || collectionId.toLowerCase().includes(searchLower))
      .map(collectionId => ({ label: collectionId, value: collectionId, note: '' }))

    return { items, cursor: response.nextPageToken || null }
  }

}

Flowrunner.ServerCode.addService(GoogleFirestore, [
  {
    name: 'serviceAccountKey',
    displayName: 'Service Account Key (JSON)',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.TEXT,
    required: true,
    shared: false,
    hint: 'Paste the full JSON key file of a service account with Firestore access. In the Firebase Console: Project Settings > Service accounts > Generate new private key.',
  },
  {
    name: 'projectId',
    displayName: 'Project ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Firebase / Google Cloud project ID containing the Firestore database. Defaults to the "project_id" from the service account key file.',
  },
  {
    name: 'databaseId',
    displayName: 'Database ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '(default)',
    hint: 'Firestore database ID. Leave as "(default)" unless the project uses named databases.',
  },
])
