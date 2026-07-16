const crypto = require('crypto')

const logger = {
  info: (...args) => console.log('[Azure Cosmos DB] info:', ...args),
  debug: (...args) => console.log('[Azure Cosmos DB] debug:', ...args),
  error: (...args) => console.log('[Azure Cosmos DB] error:', ...args),
  warn: (...args) => console.log('[Azure Cosmos DB] warn:', ...args),
}

// REST API version. Kept fixed so the signing contract and header behavior are stable.
const API_VERSION = '2018-12-31'

/**
 * Builds the master-key authorization token for a Cosmos DB REST request.
 *
 * The string-to-sign is exactly:  `${verb}\n${resourceType}\n${resourceId}\n${date}\n\n`
 * where verb / resourceType / date are lowercased and resourceId keeps its original casing
 * (resource names are case sensitive). The HMAC-SHA256 uses the master key base64-decoded as
 * the secret, and the final `type=master&ver=1.0&sig=...` string is URL-encoded.
 *
 * @param {String} masterKey  base64-encoded account key
 * @param {String} verb       HTTP verb (get/post/put/delete)
 * @param {String} resourceType  dbs | colls | docs | sprocs | udfs | triggers | offers
 * @param {String} resourceId    resource link (no leading/trailing slash) or "" for a top-level feed
 * @param {String} date          RFC1123 date, same value sent in x-ms-date
 * @returns {String} URL-encoded authorization header value
 */
function buildAuthToken(masterKey, verb, resourceType, resourceId, date) {
  const text =
    `${ (verb || '').toLowerCase() }\n` +
    `${ (resourceType || '').toLowerCase() }\n` +
    `${ resourceId || '' }\n` +
    `${ (date || '').toLowerCase() }\n` +
    '\n'

  const sig = crypto
    .createHmac('sha256', Buffer.from(masterKey, 'base64'))
    .update(text, 'utf8')
    .digest('base64')

  return encodeURIComponent(`type=master&ver=1.0&sig=${ sig }`)
}

/**
 * @integrationName Azure Cosmos DB
 * @integrationIcon /icon.svg
 */
class AzureCosmosDB {
  constructor(config) {
    // Strip any trailing slash so resource links join cleanly onto the base.
    this.accountEndpoint = String(config.accountEndpoint || '').replace(/\/+$/, '')
    this.masterKey = config.masterKey
  }

  // ==========================================================================
  //  CORE — signing + every external call goes through #apiRequest
  // ==========================================================================

  /**
   * Derives the (resourceType, resourceId) pair the signing algorithm needs from a resource path.
   *
   * `pathSegments` is the ordered list of segments after the account endpoint, e.g.
   * ['dbs','mydb','colls','mycoll','docs','doc1']. The resourceType is the last *type* segment
   * (dbs/colls/docs/...). When `isFeed` is true the operation targets a feed (list/create/query),
   * so the resourceId is the PARENT link (everything up to and including the last id before the
   * trailing type segment); otherwise it is the item's own full link.
   *
   * @param {Array<String>} pathSegments
   * @param {Boolean} isFeed
   * @returns {Object} { resourceType, resourceId, path }
   */
  #resourceInfo(pathSegments, isFeed) {
    const path = `/${ pathSegments.join('/') }`

    if (isFeed) {
      // Trailing segment is the type keyword (dbs/colls/docs/...); parent link is everything before it.
      const resourceType = pathSegments[pathSegments.length - 1]
      const parent = pathSegments.slice(0, -1)

      return { resourceType, resourceId: parent.join('/'), path }
    }

    // Item operation: link is the full path; type is the segment two before the id.
    // e.g. dbs/mydb -> type 'dbs'; dbs/mydb/colls/mycoll/docs/doc1 -> type 'docs'.
    const resourceType = pathSegments[pathSegments.length - 2]

    return { resourceType, resourceId: pathSegments.join('/'), path }
  }

  /**
   * Executes a signed Cosmos DB REST call and returns { body, headers }.
   *
   * @param {Object} opts
   * @param {String} opts.method        http verb (get/post/put/delete)
   * @param {Array<String>} opts.segments  path segments after the endpoint
   * @param {Boolean} opts.isFeed       true for list/create/query (parent-link signing)
   * @param {Object} [opts.body]        JSON body
   * @param {Object} [opts.headers]     extra headers (partition key, query flags, paging)
   * @param {String} [opts.contentType] override Content-Type (query uses application/query+json)
   * @param {String} opts.logTag
   * @returns {Object} { body, headers }
   */
  async #apiRequest({ method, segments, isFeed, body, headers, contentType, logTag }) {
    if (!this.accountEndpoint) {
      throw new Error('Account Endpoint is not configured — set your Cosmos DB account URI (e.g. https://myaccount.documents.azure.com:443).')
    }

    if (!this.masterKey) {
      throw new Error('Master Key is not configured — set your Cosmos DB primary (or read-only) key.')
    }

    const { resourceType, resourceId, path } = this.#resourceInfo(segments, isFeed)
    const date = new Date().toUTCString()
    const url = `${ this.accountEndpoint }${ path }`

    const requestHeaders = {
      Authorization: buildAuthToken(this.masterKey, method, resourceType, resourceId, date),
      'x-ms-date': date,
      'x-ms-version': API_VERSION,
      'Content-Type': contentType || 'application/json',
      Accept: 'application/json',
      ...(headers || {}),
    }

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ path } [type=${ resourceType } id=${ resourceId || '(root)' }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(requestHeaders)
        .unwrapBody(false)

      const response = body !== undefined ? await request.send(body) : await request

      return { body: response?.body, headers: response?.headers || {} }
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.statusCode || error?.body?.status
    // Cosmos returns { code, message } in the body; message often embeds a nested JSON blob.
    const code = error?.body?.code
    const message = error?.body?.message || error?.message || 'Unknown error'
    const retryAfter = error?.headers?.['x-ms-retry-after-ms']

    let detail = `Azure Cosmos DB API error${ status ? ` (${ status })` : '' }`

    if (code) detail += ` [${ code }]`
    detail += `: ${ message }`
    if (status === 429 && retryAfter) detail += ` — retry after ${ retryAfter }ms`

    logger.error(`${ logTag } failed — ${ detail }`)

    throw new Error(detail)
  }

  // Only expose defined header values (undefined values must not be sent).
  #headers(map) {
    const out = {}

    for (const key in map) {
      if (map[key] !== undefined && map[key] !== null && map[key] !== '') out[key] = map[key]
    }

    return out
  }

  // Normalizes a user-supplied partition key value into the JSON-array string Cosmos expects.
  #partitionKeyHeader(partitionKeyValue) {
    if (partitionKeyValue === undefined || partitionKeyValue === null || partitionKeyValue === '') return undefined

    // Accept either a raw scalar ("abc") or an already-serialized array string ('["abc"]').
    if (typeof partitionKeyValue === 'string') {
      const trimmed = partitionKeyValue.trim()

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed
    }

    return JSON.stringify([partitionKeyValue])
  }

  // ==========================================================================
  //  DATABASES
  // ==========================================================================

  /**
   * @operationName List Databases
   * @category Databases
   * @description Lists all databases in the Cosmos DB account. Returns the Databases array along with a count. Uses the SQL (Core) API.
   * @route GET /databases
   * @returns {Object}
   * @sampleResult {"_rid":"","Databases":[{"id":"mydb","_rid":"1KtjAA==","_self":"dbs/1KtjAA==/","_ts":1459216480}],"_count":1}
   */
  async listDatabases() {
    const { body } = await this.#apiRequest({ method: 'get', segments: ['dbs'], isFeed: true, logTag: 'listDatabases' })

    return body
  }

  /**
   * @operationName Get Database
   * @category Databases
   * @description Retrieves a single database resource by its id, including system-generated metadata (_rid, _self, _ts).
   * @route GET /databases/get
   * @paramDef {"type":"String","label":"Database","name":"database","required":true,"dictionary":"getDatabasesDictionary","description":"The id of the database to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"mydb","_rid":"1KtjAA==","_self":"dbs/1KtjAA==/","_ts":1459216480,"_colls":"colls/","_users":"users/"}
   */
  async getDatabase(database) {
    if (!database) throw new Error('database is required.')

    const { body } = await this.#apiRequest({ method: 'get', segments: ['dbs', database], isFeed: false, logTag: 'getDatabase' })

    return body
  }

  /**
   * @operationName Create Database
   * @category Databases
   * @description Creates a new database in the account. The database id must be unique; a 409 conflict is returned if it already exists.
   * @route POST /databases
   * @paramDef {"type":"String","label":"Database Id","name":"databaseId","required":true,"description":"The id for the new database. Must be unique within the account."}
   * @returns {Object}
   * @sampleResult {"id":"mydb","_rid":"1KtjAA==","_self":"dbs/1KtjAA==/","_ts":1459216480}
   */
  async createDatabase(databaseId) {
    if (!databaseId) throw new Error('databaseId is required.')

    const { body } = await this.#apiRequest({
      method: 'post',
      segments: ['dbs'],
      isFeed: true,
      body: { id: databaseId },
      logTag: 'createDatabase',
    })

    return body
  }

  /**
   * @operationName Delete Database
   * @category Databases
   * @description Permanently deletes a database and all containers, documents, and other resources within it. This action cannot be undone.
   * @route DELETE /databases
   * @paramDef {"type":"String","label":"Database","name":"database","required":true,"dictionary":"getDatabasesDictionary","description":"The id of the database to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"database":"mydb"}
   */
  async deleteDatabase(database) {
    if (!database) throw new Error('database is required.')

    await this.#apiRequest({ method: 'delete', segments: ['dbs', database], isFeed: false, logTag: 'deleteDatabase' })

    return { deleted: true, database }
  }

  // ==========================================================================
  //  CONTAINERS (collections)
  // ==========================================================================

  /**
   * @operationName List Containers
   * @category Containers
   * @description Lists all containers (collections) in a database, including their partition key definition and indexing policy.
   * @route GET /containers
   * @paramDef {"type":"String","label":"Database","name":"database","required":true,"dictionary":"getDatabasesDictionary","description":"The id of the database whose containers to list."}
   * @returns {Object}
   * @sampleResult {"_rid":"1KtjAA==","DocumentCollections":[{"id":"mycoll","partitionKey":{"paths":["/pk"],"kind":"Hash"},"_rid":"1KtjAImkcgw=","_ts":1459216480}],"_count":1}
   */
  async listContainers(database) {
    if (!database) throw new Error('database is required.')

    const { body } = await this.#apiRequest({
      method: 'get',
      segments: ['dbs', database, 'colls'],
      isFeed: true,
      logTag: 'listContainers',
    })

    return body
  }

  /**
   * @operationName Get Container
   * @category Containers
   * @description Retrieves a single container (collection) by id, including its partition key paths, indexing policy, and system metadata.
   * @route GET /containers/get
   * @paramDef {"type":"String","label":"Database","name":"database","required":true,"dictionary":"getDatabasesDictionary","description":"The id of the database containing the container."}
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"dictionary":"getContainersDictionary","description":"The id of the container to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"mycoll","partitionKey":{"paths":["/pk"],"kind":"Hash","version":2},"_rid":"1KtjAImkcgw=","_ts":1459216480}
   */
  async getContainer(database, container) {
    if (!database) throw new Error('database is required.')
    if (!container) throw new Error('container is required.')

    const { body } = await this.#apiRequest({
      method: 'get',
      segments: ['dbs', database, 'colls', container],
      isFeed: false,
      logTag: 'getContainer',
    })

    return body
  }

  /**
   * @operationName Create Container
   * @category Containers
   * @description Creates a new container (collection) in a database with a hash partition key. Provide the partition key path (e.g. /pk); the container id must be unique within the database.
   * @route POST /containers
   * @paramDef {"type":"String","label":"Database","name":"database","required":true,"dictionary":"getDatabasesDictionary","description":"The id of the database to create the container in."}
   * @paramDef {"type":"String","label":"Container Id","name":"containerId","required":true,"description":"The id for the new container. Must be unique within the database."}
   * @paramDef {"type":"String","label":"Partition Key Path","name":"partitionKeyPath","required":true,"description":"The partition key property path, starting with a slash (e.g. /pk or /customerId)."}
   * @returns {Object}
   * @sampleResult {"id":"mycoll","partitionKey":{"paths":["/pk"],"kind":"Hash","version":2},"_rid":"1KtjAImkcgw=","_ts":1459216480}
   */
  async createContainer(database, containerId, partitionKeyPath) {
    if (!database) throw new Error('database is required.')
    if (!containerId) throw new Error('containerId is required.')
    if (!partitionKeyPath) throw new Error('partitionKeyPath is required.')

    const path = partitionKeyPath.startsWith('/') ? partitionKeyPath : `/${ partitionKeyPath }`

    const { body } = await this.#apiRequest({
      method: 'post',
      segments: ['dbs', database, 'colls'],
      isFeed: true,
      body: { id: containerId, partitionKey: { paths: [path], kind: 'Hash', version: 2 } },
      logTag: 'createContainer',
    })

    return body
  }

  /**
   * @operationName Delete Container
   * @category Containers
   * @description Permanently deletes a container (collection) and all documents within it. This action cannot be undone.
   * @route DELETE /containers
   * @paramDef {"type":"String","label":"Database","name":"database","required":true,"dictionary":"getDatabasesDictionary","description":"The id of the database containing the container."}
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"dictionary":"getContainersDictionary","description":"The id of the container to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"database":"mydb","container":"mycoll"}
   */
  async deleteContainer(database, container) {
    if (!database) throw new Error('database is required.')
    if (!container) throw new Error('container is required.')

    await this.#apiRequest({
      method: 'delete',
      segments: ['dbs', database, 'colls', container],
      isFeed: false,
      logTag: 'deleteContainer',
    })

    return { deleted: true, database, container }
  }

  // ==========================================================================
  //  DOCUMENTS (items)
  // ==========================================================================

  /**
   * @operationName Query Documents
   * @category Documents
   * @description Runs a parameterized SQL query against a container and returns matching documents. Supply parameters as an array of {name,value} objects (names begin with @). Cross-partition execution is enabled, so queries are not required to filter on the partition key. Note that gateway-served queries do not support ORDER BY, TOP, OFFSET/LIMIT, aggregates, DISTINCT, or GROUP BY.
   * @route POST /documents/query
   * @paramDef {"type":"String","label":"Database","name":"database","required":true,"dictionary":"getDatabasesDictionary","description":"The id of the database to query."}
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"dictionary":"getContainersDictionary","description":"The id of the container to query."}
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SQL query, e.g. SELECT * FROM c WHERE c.status = @status."}
   * @paramDef {"type":"Array<Object>","label":"Parameters","name":"parameters","required":false,"description":"Query parameters as objects, e.g. [{\"name\":\"@status\",\"value\":\"active\"}]. Names must begin with @."}
   * @paramDef {"type":"Number","label":"Max Item Count","name":"maxItemCount","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum documents to return per page (1-1000, default 100)."}
   * @paramDef {"type":"String","label":"Continuation Token","name":"continuationToken","required":false,"description":"Pass the continuationToken returned by a previous call to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"documents":[{"id":"1","status":"active"}],"count":1,"continuationToken":null}
   */
  async queryDocuments(database, container, query, parameters, maxItemCount, continuationToken) {
    if (!database) throw new Error('database is required.')
    if (!container) throw new Error('container is required.')
    if (!query) throw new Error('query is required.')

    const { body, headers } = await this.#apiRequest({
      method: 'post',
      segments: ['dbs', database, 'colls', container, 'docs'],
      isFeed: true,
      contentType: 'application/query+json',
      headers: this.#headers({
        'x-ms-documentdb-isquery': 'true',
        'x-ms-documentdb-query-enablecrosspartition': 'true',
        'x-ms-max-item-count': maxItemCount !== undefined && maxItemCount !== null ? String(maxItemCount) : undefined,
        'x-ms-continuation': continuationToken,
      }),
      body: { query, parameters: Array.isArray(parameters) ? parameters : [] },
      logTag: 'queryDocuments',
    })

    return {
      documents: body?.Documents || [],
      count: body?._count ?? (body?.Documents ? body.Documents.length : 0),
      continuationToken: headers['x-ms-continuation'] || null,
    }
  }

  /**
   * @operationName List Documents
   * @category Documents
   * @description Reads documents from a container as a feed (no query). Supports paging via Max Item Count and the returned continuation token. To fetch the next page, pass the returned continuationToken back in.
   * @route GET /documents
   * @paramDef {"type":"String","label":"Database","name":"database","required":true,"dictionary":"getDatabasesDictionary","description":"The id of the database to read from."}
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"dictionary":"getContainersDictionary","description":"The id of the container to read from."}
   * @paramDef {"type":"Number","label":"Max Item Count","name":"maxItemCount","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum documents to return per page (default 100)."}
   * @paramDef {"type":"String","label":"Continuation Token","name":"continuationToken","required":false,"description":"Pass the continuationToken returned by a previous call to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"documents":[{"id":"1","pk":"a"}],"count":1,"continuationToken":null}
   */
  async listDocuments(database, container, maxItemCount, continuationToken) {
    if (!database) throw new Error('database is required.')
    if (!container) throw new Error('container is required.')

    const { body, headers } = await this.#apiRequest({
      method: 'get',
      segments: ['dbs', database, 'colls', container, 'docs'],
      isFeed: true,
      headers: this.#headers({
        'x-ms-max-item-count': maxItemCount !== undefined && maxItemCount !== null ? String(maxItemCount) : undefined,
        'x-ms-continuation': continuationToken,
      }),
      logTag: 'listDocuments',
    })

    return {
      documents: body?.Documents || [],
      count: body?._count ?? (body?.Documents ? body.Documents.length : 0),
      continuationToken: headers['x-ms-continuation'] || null,
    }
  }

  /**
   * @operationName Get Document
   * @category Documents
   * @description Retrieves a single document by its id. The partition key value of the document is required to route the read to the correct partition.
   * @route GET /documents/get
   * @paramDef {"type":"String","label":"Database","name":"database","required":true,"dictionary":"getDatabasesDictionary","description":"The id of the database containing the document."}
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"dictionary":"getContainersDictionary","description":"The id of the container containing the document."}
   * @paramDef {"type":"String","label":"Document Id","name":"documentId","required":true,"description":"The id of the document to retrieve."}
   * @paramDef {"type":"String","label":"Partition Key Value","name":"partitionKeyValue","required":true,"description":"The value of the document's partition key (e.g. the value of its /pk property)."}
   * @returns {Object}
   * @sampleResult {"id":"1","pk":"a","name":"Item","_rid":"1KtjAImkcgwBAAAAAAAAAA==","_ts":1459218509}
   */
  async getDocument(database, container, documentId, partitionKeyValue) {
    if (!database) throw new Error('database is required.')
    if (!container) throw new Error('container is required.')
    if (!documentId) throw new Error('documentId is required.')

    const { body } = await this.#apiRequest({
      method: 'get',
      segments: ['dbs', database, 'colls', container, 'docs', documentId],
      isFeed: false,
      headers: this.#headers({ 'x-ms-documentdb-partitionkey': this.#partitionKeyHeader(partitionKeyValue) }),
      logTag: 'getDocument',
    })

    return body
  }

  /**
   * @operationName Create Document
   * @category Documents
   * @description Creates a new document in a container. The document must include an id and the partition key property. A 409 conflict is returned if a document with the same id already exists in that partition. Provide the partition key value so the write is routed correctly.
   * @route POST /documents
   * @paramDef {"type":"String","label":"Database","name":"database","required":true,"dictionary":"getDatabasesDictionary","description":"The id of the database to write to."}
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"dictionary":"getContainersDictionary","description":"The id of the container to write to."}
   * @paramDef {"type":"Object","label":"Document","name":"document","required":true,"description":"The document to store as plain JSON. Should include an id and the container's partition key property."}
   * @paramDef {"type":"String","label":"Partition Key Value","name":"partitionKeyValue","required":true,"description":"The partition key value of the document (the value of its partition key property)."}
   * @returns {Object}
   * @sampleResult {"id":"1","pk":"a","name":"Item","_rid":"1KtjAImkcgwBAAAAAAAAAA==","_ts":1459218509}
   */
  async createDocument(database, container, document, partitionKeyValue) {
    if (!database) throw new Error('database is required.')
    if (!container) throw new Error('container is required.')
    if (!document || typeof document !== 'object') throw new Error('document (plain JSON object) is required.')

    const { body } = await this.#apiRequest({
      method: 'post',
      segments: ['dbs', database, 'colls', container, 'docs'],
      isFeed: true,
      headers: this.#headers({ 'x-ms-documentdb-partitionkey': this.#partitionKeyHeader(partitionKeyValue) }),
      body: document,
      logTag: 'createDocument',
    })

    return body
  }

  /**
   * @operationName Upsert Document
   * @category Documents
   * @description Creates a document, or fully replaces it if a document with the same id already exists in the partition. Equivalent to Create Document but with upsert enabled, so it never returns a 409 conflict.
   * @route POST /documents/upsert
   * @paramDef {"type":"String","label":"Database","name":"database","required":true,"dictionary":"getDatabasesDictionary","description":"The id of the database to write to."}
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"dictionary":"getContainersDictionary","description":"The id of the container to write to."}
   * @paramDef {"type":"Object","label":"Document","name":"document","required":true,"description":"The document to create or replace as plain JSON. Should include an id and the container's partition key property."}
   * @paramDef {"type":"String","label":"Partition Key Value","name":"partitionKeyValue","required":true,"description":"The partition key value of the document (the value of its partition key property)."}
   * @returns {Object}
   * @sampleResult {"id":"1","pk":"a","name":"Item","_rid":"1KtjAImkcgwBAAAAAAAAAA==","_ts":1459218509}
   */
  async upsertDocument(database, container, document, partitionKeyValue) {
    if (!database) throw new Error('database is required.')
    if (!container) throw new Error('container is required.')
    if (!document || typeof document !== 'object') throw new Error('document (plain JSON object) is required.')

    const { body } = await this.#apiRequest({
      method: 'post',
      segments: ['dbs', database, 'colls', container, 'docs'],
      isFeed: true,
      headers: this.#headers({
        'x-ms-documentdb-partitionkey': this.#partitionKeyHeader(partitionKeyValue),
        'x-ms-documentdb-is-upsert': 'true',
      }),
      body: document,
      logTag: 'upsertDocument',
    })

    return body
  }

  /**
   * @operationName Replace Document
   * @category Documents
   * @description Replaces the entire contents of an existing document identified by its id. The replacement body must include the same id, and the partition key value must match the existing document.
   * @route PUT /documents
   * @paramDef {"type":"String","label":"Database","name":"database","required":true,"dictionary":"getDatabasesDictionary","description":"The id of the database containing the document."}
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"dictionary":"getContainersDictionary","description":"The id of the container containing the document."}
   * @paramDef {"type":"String","label":"Document Id","name":"documentId","required":true,"description":"The id of the document to replace."}
   * @paramDef {"type":"Object","label":"Document","name":"document","required":true,"description":"The full replacement document as plain JSON. Must include the same id and partition key property."}
   * @paramDef {"type":"String","label":"Partition Key Value","name":"partitionKeyValue","required":true,"description":"The partition key value of the document (must match the existing document)."}
   * @returns {Object}
   * @sampleResult {"id":"1","pk":"a","name":"Updated","_rid":"1KtjAImkcgwBAAAAAAAAAA==","_ts":1459218600}
   */
  async replaceDocument(database, container, documentId, document, partitionKeyValue) {
    if (!database) throw new Error('database is required.')
    if (!container) throw new Error('container is required.')
    if (!documentId) throw new Error('documentId is required.')
    if (!document || typeof document !== 'object') throw new Error('document (plain JSON object) is required.')

    const { body } = await this.#apiRequest({
      method: 'put',
      segments: ['dbs', database, 'colls', container, 'docs', documentId],
      isFeed: false,
      headers: this.#headers({ 'x-ms-documentdb-partitionkey': this.#partitionKeyHeader(partitionKeyValue) }),
      body: document,
      logTag: 'replaceDocument',
    })

    return body
  }

  /**
   * @operationName Delete Document
   * @category Documents
   * @description Permanently deletes a single document by its id. The partition key value is required to route the delete to the correct partition. This action cannot be undone.
   * @route DELETE /documents
   * @paramDef {"type":"String","label":"Database","name":"database","required":true,"dictionary":"getDatabasesDictionary","description":"The id of the database containing the document."}
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"dictionary":"getContainersDictionary","description":"The id of the container containing the document."}
   * @paramDef {"type":"String","label":"Document Id","name":"documentId","required":true,"description":"The id of the document to delete."}
   * @paramDef {"type":"String","label":"Partition Key Value","name":"partitionKeyValue","required":true,"description":"The value of the document's partition key (e.g. the value of its /pk property)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"documentId":"1"}
   */
  async deleteDocument(database, container, documentId, partitionKeyValue) {
    if (!database) throw new Error('database is required.')
    if (!container) throw new Error('container is required.')
    if (!documentId) throw new Error('documentId is required.')

    await this.#apiRequest({
      method: 'delete',
      segments: ['dbs', database, 'colls', container, 'docs', documentId],
      isFeed: false,
      headers: this.#headers({ 'x-ms-documentdb-partitionkey': this.#partitionKeyHeader(partitionKeyValue) }),
      logTag: 'deleteDocument',
    })

    return { deleted: true, documentId }
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================

  /**
   * @typedef {Object} getDatabasesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional case-insensitive text filter on the database id."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; databases are returned in a single feed)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Databases Dictionary
   * @category Databases
   * @description Lists databases in the account for selection in dependent parameters.
   * @route POST /get-databases-dictionary
   * @paramDef {"type":"getDatabasesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"mydb","value":"mydb","note":"Database"}]}
   */
  async getDatabasesDictionary(payload) {
    const { search } = payload || {}

    const body = await this.listDatabases()
    let databases = body?.Databases || []

    if (search) {
      const term = String(search).toLowerCase()

      databases = databases.filter(db => String(db.id).toLowerCase().includes(term))
    }

    return { items: databases.map(db => ({ label: db.id, value: db.id, note: 'Database' })) }
  }

  /**
   * @typedef {Object} getContainersDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Database","name":"database","description":"The id of the database whose containers to list."}
   */

  /**
   * @typedef {Object} getContainersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional case-insensitive text filter on the container id."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; containers are returned in a single feed)."}
   * @paramDef {"type":"getContainersDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent selection; requires the chosen database."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Containers Dictionary
   * @category Containers
   * @description Lists containers in the selected database for selection in dependent parameters. Depends on the database parameter.
   * @route POST /get-containers-dictionary
   * @paramDef {"type":"getContainersDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and the parent database (via criteria)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"mycoll","value":"mycoll","note":"Container"}]}
   */
  async getContainersDictionary(payload) {
    const { search, criteria } = payload || {}
    const database = criteria?.database

    if (!database) return { items: [] }

    const body = await this.listContainers(database)
    let containers = body?.DocumentCollections || []

    if (search) {
      const term = String(search).toLowerCase()

      containers = containers.filter(c => String(c.id).toLowerCase().includes(term))
    }

    return { items: containers.map(c => ({ label: c.id, value: c.id, note: 'Container' })) }
  }
}

Flowrunner.ServerCode.addService(AzureCosmosDB, [
  {
    name: 'accountEndpoint',
    displayName: 'Account Endpoint',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Cosmos DB account URI, e.g. https://myaccount.documents.azure.com:443 (strip any trailing slash).',
  },
  {
    name: 'masterKey',
    displayName: 'Master Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Cosmos DB → Settings → Keys → Primary Key (or a read-only key).',
  },
])
