'use strict'

const SERVICE_NAME = 'Chroma'

const logger = {
  info: (...args) => console.log(`[${ SERVICE_NAME } Service] info:`, ...args),
  debug: (...args) => console.log(`[${ SERVICE_NAME } Service] debug:`, ...args),
  error: (...args) => console.log(`[${ SERVICE_NAME } Service] error:`, ...args),
  warn: (...args) => console.log(`[${ SERVICE_NAME } Service] warn:`, ...args),
}

const DEFAULT_TENANT = 'default_tenant'
const DEFAULT_DATABASE = 'default_database'

// Matches a Chroma collection UUID (v4-style) so we can skip the name->id lookup.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * @integrationName Chroma
 * @integrationIcon /icon.png
 */
class Chroma {
  /**
   * @param {Object} config
   * @param {String} config.baseUrl
   * @param {String} [config.apiKey]
   * @param {String} [config.tenant]
   * @param {String} [config.database]
   */
  constructor(config) {
    this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '')
    this.apiKey = config.apiKey
    this.tenant = config.tenant || DEFAULT_TENANT
    this.database = config.database || DEFAULT_DATABASE
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Base path for all collection endpoints within the configured tenant/database.
   */
  #collectionsBasePath() {
    return `/api/v2/tenants/${ encodeURIComponent(this.tenant) }` +
      `/databases/${ encodeURIComponent(this.database) }/collections`
  }

  /**
   * All Chroma v2 REST calls go through here. Chroma returns the response body
   * directly; errors come back as {error: 'type', message: '...'}.
   *
   * @param {Object} options
   * @param {String} options.path - Path relative to the instance base URL.
   * @param {String} [options.method] - HTTP method (get, post, put, delete).
   * @param {Object} [options.body] - Request body.
   * @param {Object} [options.query] - Query parameters.
   * @param {String} options.logTag - Tag for logging.
   * @returns {any}
   */
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      const headers = { 'Content-Type': 'application/json' }

      if (this.apiKey) {
        headers['x-chroma-token'] = this.apiKey
      }

      logger.debug(`${ logTag } - api request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method](url).set(headers).query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error
        ? `${ error.body.error }: ${ error.body.message || '' }`.trim()
        : error.body?.message || error.message

      logger.error(`${ logTag } - api request failed: ${ message }`)

      throw new Error(`Chroma API error: ${ message }`)
    }
  }

  /**
   * Resolves a collection name to its UUID (required by all data operations).
   * If the value already looks like a UUID it is returned unchanged; otherwise
   * the collection is looked up by name via the get-collection endpoint.
   */
  async #resolveCollectionId(collection, logTag) {
    if (!collection) {
      throw new Error(`${ logTag }: a collection name or id is required`)
    }

    if (UUID_REGEX.test(collection)) {
      return collection
    }

    const found = await this.#apiRequest({
      path: `${ this.#collectionsBasePath() }/${ encodeURIComponent(collection) }`,
      method: 'get',
      logTag: `${ logTag } (resolve id)`,
    })

    if (!found?.id) {
      throw new Error(`${ logTag }: could not resolve id for collection "${ collection }"`)
    }

    return found.id
  }

  /**
   * Builds the shared "include" array from a records-view flag set.
   * Chroma include tokens: "documents", "embeddings", "metadatas", "distances", "uris".
   */
  #buildInclude(include) {
    return Array.isArray(include) && include.length > 0 ? include : undefined
  }

  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Collection
   * @category Collections
   * @description Creates a new collection in the configured tenant and database. Optionally attach arbitrary metadata and an advanced configuration object (e.g. HNSW index settings or an embedding function descriptor). Returns the created collection, including its UUID "id" which is required by all record/data operations (Add, Query, Get, etc.).
   * @route POST /create-collection
   * @paramDef {"type":"String","label":"Collection Name","name":"name","required":true,"description":"Unique name of the collection to create within the tenant/database."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional key/value metadata attached to the collection, e.g. {\"description\":\"product docs\",\"hnsw:space\":\"cosine\"}."}
   * @paramDef {"type":"Object","label":"Configuration","name":"configuration","required":false,"description":"Optional advanced collection configuration merged into the request body, e.g. HNSW index parameters {\"hnsw\":{\"space\":\"cosine\",\"ef_construction\":100}} or an embedding function descriptor."}
   * @paramDef {"type":"Boolean","label":"Get Or Create","name":"getOrCreate","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"If enabled and a collection with this name already exists, it is returned instead of raising an error. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"id":"1f8e1b2c-4a3d-4e5f-9a0b-1c2d3e4f5a6b","name":"products","metadata":{"description":"product docs"},"tenant":"default_tenant","database":"default_database"}
   */
  async createCollection(name, metadata, configuration, getOrCreate) {
    const body = { name }

    if (metadata && Object.keys(metadata).length > 0) {
      body.metadata = metadata
    }

    if (configuration && Object.keys(configuration).length > 0) {
      body.configuration = configuration
    }

    if (getOrCreate !== undefined && getOrCreate !== null) {
      body.get_or_create = getOrCreate === true
    }

    return this.#apiRequest({
      path: this.#collectionsBasePath(),
      method: 'post',
      body,
      logTag: 'createCollection',
    })
  }

  /**
   * @operationName List Collections
   * @category Collections
   * @description Lists the collections in the configured tenant and database. Each entry includes the collection UUID "id", "name", "metadata" and "configuration". Supports limit/offset pagination.
   * @route GET /list-collections
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of collections to return. Leave empty for the server default."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of collections to skip, for pagination. Defaults to 0."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":"1f8e1b2c-4a3d-4e5f-9a0b-1c2d3e4f5a6b","name":"products","metadata":{"description":"product docs"},"tenant":"default_tenant","database":"default_database"}]
   */
  async listCollections(limit, offset) {
    const query = {}

    if (limit) query.limit = limit
    if (offset) query.offset = offset

    return this.#apiRequest({
      path: this.#collectionsBasePath(),
      method: 'get',
      query,
      logTag: 'listCollections',
    })
  }

  /**
   * @operationName Get Collection
   * @category Collections
   * @description Retrieves a single collection by its name or UUID, returning its UUID "id", "name", "metadata" and "configuration". The Chroma v2 endpoint resolves either a name or an id. Use this to obtain a collection's id before running record/data operations.
   * @route GET /get-collection
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"Name (or UUID) of the collection to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"1f8e1b2c-4a3d-4e5f-9a0b-1c2d3e4f5a6b","name":"products","metadata":{"description":"product docs"},"tenant":"default_tenant","database":"default_database"}
   */
  async getCollection(collection) {
    return this.#apiRequest({
      path: `${ this.#collectionsBasePath() }/${ encodeURIComponent(collection) }`,
      method: 'get',
      logTag: 'getCollection',
    })
  }

  /**
   * @operationName Delete Collection
   * @category Collections
   * @description Permanently deletes a collection and all records stored in it, identified by name. This action cannot be undone.
   * @route DELETE /delete-collection
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"Name of the collection to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteCollection(collection) {
    const result = await this.#apiRequest({
      path: `${ this.#collectionsBasePath() }/${ encodeURIComponent(collection) }`,
      method: 'delete',
      logTag: 'deleteCollection',
    })

    return result || { success: true }
  }

  /**
   * @operationName Count Collections
   * @category Collections
   * @description Returns the total number of collections in the configured tenant and database.
   * @route GET /count-collections
   * @returns {Object}
   * @sampleResult {"count":7}
   */
  async countCollections() {
    const count = await this.#apiRequest({
      path: `${ this.#collectionsBasePath() }_count`,
      method: 'get',
      logTag: 'countCollections',
    })

    return typeof count === 'number' ? { count } : count
  }

  // ---------------------------------------------------------------------------
  // Records / Embeddings (data operations — use the collection UUID)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Add Records
   * @category Records
   * @description Adds records (embeddings) to a collection. Provide record IDs plus at least one of: embeddings (arrays of numbers), documents (raw text, embedded by the collection's embedding function) and metadatas (per-record metadata objects). All provided arrays must align by index. The collection is looked up by name or UUID.
   * @route POST /add-records
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"Name (or UUID) of the collection to add records to."}
   * @paramDef {"type":"Array<String>","label":"IDs","name":"ids","required":true,"description":"Unique record IDs, e.g. [\"doc1\",\"doc2\"]. Positionally aligned with the other arrays."}
   * @paramDef {"type":"Array<Array<Number>>","label":"Embeddings","name":"embeddings","required":false,"description":"Embedding vectors, one per ID, e.g. [[0.1,0.2,0.3],[0.4,0.5,0.6]]. Optional if Documents are supplied and the collection has an embedding function."}
   * @paramDef {"type":"Array<Object>","label":"Metadatas","name":"metadatas","required":false,"description":"Per-record metadata objects, one per ID, e.g. [{\"source\":\"web\"},{\"source\":\"pdf\"}]."}
   * @paramDef {"type":"Array<String>","label":"Documents","name":"documents","required":false,"description":"Raw document text, one per ID. Embedded automatically when the collection has an embedding function."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async addRecords(collection, ids, embeddings, metadatas, documents) {
    return this.#writeRecords('add', collection, ids, embeddings, metadatas, documents, 'addRecords')
  }

  /**
   * @operationName Upsert Records
   * @category Records
   * @description Inserts new records or updates existing ones (matched by ID) in a collection. Provide record IDs plus embeddings, documents and/or metadatas, positionally aligned. The collection is looked up by name or UUID.
   * @route POST /upsert-records
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"Name (or UUID) of the collection to upsert records into."}
   * @paramDef {"type":"Array<String>","label":"IDs","name":"ids","required":true,"description":"Record IDs to insert or update, e.g. [\"doc1\",\"doc2\"]. Positionally aligned with the other arrays."}
   * @paramDef {"type":"Array<Array<Number>>","label":"Embeddings","name":"embeddings","required":false,"description":"Embedding vectors, one per ID. Optional if Documents are supplied and the collection has an embedding function."}
   * @paramDef {"type":"Array<Object>","label":"Metadatas","name":"metadatas","required":false,"description":"Per-record metadata objects, one per ID."}
   * @paramDef {"type":"Array<String>","label":"Documents","name":"documents","required":false,"description":"Raw document text, one per ID. Embedded automatically when the collection has an embedding function."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async upsertRecords(collection, ids, embeddings, metadatas, documents) {
    return this.#writeRecords('upsert', collection, ids, embeddings, metadatas, documents, 'upsertRecords')
  }

  /**
   * @operationName Update Records
   * @category Records
   * @description Updates existing records in a collection (matched by ID). Only the provided fields (embeddings, documents, metadatas) are changed; omitted fields are left as-is. IDs that do not exist are ignored. The collection is looked up by name or UUID.
   * @route POST /update-records
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"Name (or UUID) of the collection to update records in."}
   * @paramDef {"type":"Array<String>","label":"IDs","name":"ids","required":true,"description":"IDs of the records to update, e.g. [\"doc1\",\"doc2\"]. Positionally aligned with the other arrays."}
   * @paramDef {"type":"Array<Array<Number>>","label":"Embeddings","name":"embeddings","required":false,"description":"Replacement embedding vectors, one per ID. Leave empty to keep existing embeddings."}
   * @paramDef {"type":"Array<Object>","label":"Metadatas","name":"metadatas","required":false,"description":"Replacement metadata objects, one per ID. Leave empty to keep existing metadata."}
   * @paramDef {"type":"Array<String>","label":"Documents","name":"documents","required":false,"description":"Replacement document text, one per ID. Leave empty to keep existing documents."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateRecords(collection, ids, embeddings, metadatas, documents) {
    return this.#writeRecords('update', collection, ids, embeddings, metadatas, documents, 'updateRecords')
  }

  /**
   * Shared implementation for add/upsert/update record writes.
   */
  async #writeRecords(op, collection, ids, embeddings, metadatas, documents, logTag) {
    const collectionId = await this.#resolveCollectionId(collection, logTag)

    const body = { ids: ids || [] }

    if (Array.isArray(embeddings) && embeddings.length > 0) body.embeddings = embeddings
    if (Array.isArray(metadatas) && metadatas.length > 0) body.metadatas = metadatas
    if (Array.isArray(documents) && documents.length > 0) body.documents = documents

    const result = await this.#apiRequest({
      path: `${ this.#collectionsBasePath() }/${ collectionId }/${ op }`,
      method: 'post',
      body,
      logTag,
    })

    return result || { success: true }
  }

  /**
   * @operationName Query Records
   * @category Records
   * @description Runs a nearest-neighbor similarity search against a collection using one or more query embeddings. Returns the closest records per query, optionally with their documents, metadatas and distances. Supports metadata filtering ("where"), document content filtering ("where_document") and control over which fields are returned ("include"). The collection is looked up by name or UUID.
   * @route POST /query-records
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"Name (or UUID) of the collection to search."}
   * @paramDef {"type":"Array<Array<Number>>","label":"Query Embeddings","name":"queryEmbeddings","required":true,"description":"One or more query vectors, e.g. [[0.1,0.2,0.3]]. Each must match the collection's embedding dimensionality. Results are returned per query."}
   * @paramDef {"type":"Number","label":"Number Of Results","name":"nResults","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of nearest neighbors to return per query. Defaults to 10."}
   * @paramDef {"type":"Object","label":"Metadata Filter","name":"where","required":false,"description":"Metadata filter applied to candidate records, e.g. {\"source\":\"web\"} or {\"price\":{\"$gt\":10}}."}
   * @paramDef {"type":"Object","label":"Document Filter","name":"whereDocument","required":false,"description":"Full-text document filter, e.g. {\"$contains\":\"invoice\"}."}
   * @paramDef {"type":"Array<String>","label":"Include","name":"include","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["documents","embeddings","metadatas","distances","uris"]}},"description":"Which fields to return for each result. Defaults to documents, metadatas and distances."}
   * @returns {Object}
   * @sampleResult {"ids":[["doc1","doc2"]],"distances":[[0.12,0.34]],"documents":[["first doc","second doc"]],"metadatas":[[{"source":"web"},{"source":"pdf"}]]}
   */
  async queryRecords(collection, queryEmbeddings, nResults, where, whereDocument, include) {
    const collectionId = await this.#resolveCollectionId(collection, 'queryRecords')

    const body = { query_embeddings: queryEmbeddings || [] }

    if (nResults) body.n_results = nResults
    if (where && Object.keys(where).length > 0) body.where = where
    if (whereDocument && Object.keys(whereDocument).length > 0) body.where_document = whereDocument

    const includeValue = this.#buildInclude(include)

    if (includeValue) body.include = includeValue

    return this.#apiRequest({
      path: `${ this.#collectionsBasePath() }/${ collectionId }/query`,
      method: 'post',
      body,
      logTag: 'queryRecords',
    })
  }

  /**
   * @operationName Get Records
   * @category Records
   * @description Retrieves records from a collection by explicit IDs and/or by metadata and document filters, without similarity scoring. Supports pagination (limit/offset) and control over which fields are returned ("include"). The collection is looked up by name or UUID.
   * @route POST /get-records
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"Name (or UUID) of the collection to read from."}
   * @paramDef {"type":"Array<String>","label":"IDs","name":"ids","required":false,"description":"Specific record IDs to fetch, e.g. [\"doc1\",\"doc2\"]. Leave empty to select purely by filter."}
   * @paramDef {"type":"Object","label":"Metadata Filter","name":"where","required":false,"description":"Metadata filter selecting records, e.g. {\"source\":\"web\"} or {\"price\":{\"$gt\":10}}."}
   * @paramDef {"type":"Object","label":"Document Filter","name":"whereDocument","required":false,"description":"Full-text document filter, e.g. {\"$contains\":\"invoice\"}."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return. Leave empty for all matching records."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of matching records to skip, for pagination. Defaults to 0."}
   * @paramDef {"type":"Array<String>","label":"Include","name":"include","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["documents","embeddings","metadatas","uris"]}},"description":"Which fields to return for each record. Defaults to documents and metadatas."}
   * @returns {Object}
   * @sampleResult {"ids":["doc1","doc2"],"documents":["first doc","second doc"],"metadatas":[{"source":"web"},{"source":"pdf"}]}
   */
  async getRecords(collection, ids, where, whereDocument, limit, offset, include) {
    const collectionId = await this.#resolveCollectionId(collection, 'getRecords')

    const body = {}

    if (Array.isArray(ids) && ids.length > 0) body.ids = ids
    if (where && Object.keys(where).length > 0) body.where = where
    if (whereDocument && Object.keys(whereDocument).length > 0) body.where_document = whereDocument
    if (limit) body.limit = limit
    if (offset) body.offset = offset

    const includeValue = this.#buildInclude(include)

    if (includeValue) body.include = includeValue

    return this.#apiRequest({
      path: `${ this.#collectionsBasePath() }/${ collectionId }/get`,
      method: 'post',
      body,
      logTag: 'getRecords',
    })
  }

  /**
   * @operationName Count Records
   * @category Records
   * @description Returns the total number of records stored in a collection. The collection is looked up by name or UUID.
   * @route GET /count-records
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"Name (or UUID) of the collection to count records in."}
   * @returns {Object}
   * @sampleResult {"count":128}
   */
  async countRecords(collection) {
    const collectionId = await this.#resolveCollectionId(collection, 'countRecords')

    const count = await this.#apiRequest({
      path: `${ this.#collectionsBasePath() }/${ collectionId }/count`,
      method: 'get',
      logTag: 'countRecords',
    })

    return typeof count === 'number' ? { count } : count
  }

  /**
   * @operationName Delete Records
   * @category Records
   * @description Deletes records from a collection by explicit IDs and/or by metadata and document filters. Provide at least one selector. The collection is looked up by name or UUID.
   * @route POST /delete-records
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"Name (or UUID) of the collection to delete records from."}
   * @paramDef {"type":"Array<String>","label":"IDs","name":"ids","required":false,"description":"Specific record IDs to delete, e.g. [\"doc1\",\"doc2\"]. Leave empty to delete purely by filter."}
   * @paramDef {"type":"Object","label":"Metadata Filter","name":"where","required":false,"description":"Metadata filter selecting records to delete, e.g. {\"source\":\"web\"}."}
   * @paramDef {"type":"Object","label":"Document Filter","name":"whereDocument","required":false,"description":"Full-text document filter selecting records to delete, e.g. {\"$contains\":\"draft\"}."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteRecords(collection, ids, where, whereDocument) {
    const collectionId = await this.#resolveCollectionId(collection, 'deleteRecords')

    const body = {}

    if (Array.isArray(ids) && ids.length > 0) body.ids = ids
    if (where && Object.keys(where).length > 0) body.where = where
    if (whereDocument && Object.keys(whereDocument).length > 0) body.where_document = whereDocument

    if (Object.keys(body).length === 0) {
      throw new Error('deleteRecords: provide "IDs", "Metadata Filter" or "Document Filter"')
    }

    const result = await this.#apiRequest({
      path: `${ this.#collectionsBasePath() }/${ collectionId }/delete`,
      method: 'post',
      body,
      logTag: 'deleteRecords',
    })

    return result || { success: true }
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getCollectionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter collections by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (not used — all collections are returned at once)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Collections Dictionary
   * @description Lists collections in the configured tenant and database for selection in dependent parameters. The option label is the collection name and the value is its UUID id.
   * @route POST /get-collections-dictionary
   * @paramDef {"type":"getCollectionsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"products","value":"1f8e1b2c-4a3d-4e5f-9a0b-1c2d3e4f5a6b","note":"1f8e1b2c-4a3d-4e5f-9a0b-1c2d3e4f5a6b"}],"cursor":null}
   */
  async getCollectionsDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({
      path: this.#collectionsBasePath(),
      method: 'get',
      logTag: 'getCollectionsDictionary',
    })

    let collections = Array.isArray(result) ? result : (result?.collections || [])

    if (search) {
      const needle = search.toLowerCase()

      collections = collections.filter(collection => (collection.name || '').toLowerCase().includes(needle))
    }

    return {
      items: collections.map(collection => ({
        label: collection.name,
        value: collection.id,
        note: collection.id,
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(Chroma, [
  {
    name: 'baseUrl',
    displayName: 'Base URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Chroma base URL. Use https://api.trychroma.com for Chroma Cloud or http://your-host:8000 for self-hosted. Strip any trailing slash.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Chroma Cloud API key, sent as the x-chroma-token header. Leave empty for self-hosted instances running without authentication.',
  },
  {
    name: 'tenant',
    displayName: 'Tenant',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: DEFAULT_TENANT,
    hint: 'Chroma tenant. Defaults to "default_tenant" for self-hosted. For Chroma Cloud, use your tenant id (a UUID from the dashboard).',
  },
  {
    name: 'database',
    displayName: 'Database',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: DEFAULT_DATABASE,
    hint: 'Chroma database name within the tenant. Defaults to "default_database".',
  },
])

module.exports = Chroma
