'use strict'

const SERVICE_NAME = 'Qdrant'

const logger = {
  info: (...args) => console.log(`[${ SERVICE_NAME } Service] info:`, ...args),
  debug: (...args) => console.log(`[${ SERVICE_NAME } Service] debug:`, ...args),
  error: (...args) => console.log(`[${ SERVICE_NAME } Service] error:`, ...args),
  warn: (...args) => console.log(`[${ SERVICE_NAME } Service] warn:`, ...args),
}

const DISTANCE_METRICS = {
  'Cosine': 'Cosine',
  'Euclidean': 'Euclid',
  'Dot Product': 'Dot',
  'Manhattan': 'Manhattan',
}

/**
 * @integrationName Qdrant
 * @integrationIcon /icon.png
 */
class Qdrant {
  /**
   * @param {Object} config
   * @param {String} config.url
   * @param {String} [config.apiKey]
   */
  constructor(config) {
    this.url = (config.url || '').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  /**
   * All Qdrant REST calls go through here. Qdrant wraps every response as
   * {status, time, result} — this helper unwraps and returns `result`.
   *
   * @param {Object} options
   * @param {String} options.path - Path relative to the instance URL (e.g. /collections)
   * @param {String} [options.method] - HTTP method (get, post, put, delete)
   * @param {Object} [options.body] - Request body
   * @param {Object} [options.query] - Query parameters
   * @param {String} options.logTag - Tag for logging
   * @returns {Promise<any>}
   */
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.url }${ path }`

    try {
      const headers = { 'Content-Type': 'application/json' }

      if (this.apiKey) {
        headers['api-key'] = this.apiKey
      }

      logger.debug(`${ logTag } - api request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method](url).set(headers).query(query || {})
      const response = body !== undefined ? await request.send(body) : await request

      return response?.result !== undefined ? response.result : response
    } catch (error) {
      const message = error.body?.status?.error || error.body?.message || error.message

      logger.error(`${ logTag } - api request failed: ${ message }`)

      throw new Error(`Qdrant API error: ${ message }`)
    }
  }

  /**
   * Maps a friendly dropdown label to the Qdrant API value.
   */
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * Qdrant point IDs are either unsigned integers or UUID strings.
   * Numeric strings coming from the UI are converted to numbers.
   */
  #normalizePointId(id) {
    if (typeof id === 'string' && /^\d+$/.test(id.trim())) {
      return Number(id.trim())
    }

    return id
  }

  /**
   * Builds the {points} or {filter} selector used by delete/payload operations.
   */
  #buildPointsSelector(pointIds, filter, logTag) {
    if (Array.isArray(pointIds) && pointIds.length > 0) {
      return { points: pointIds.map(id => this.#normalizePointId(id)) }
    }

    if (filter && Object.keys(filter).length > 0) {
      return { filter }
    }

    throw new Error(`${ logTag }: either "Point IDs" or "Filter" must be provided`)
  }

  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Collection
   * @category Collections
   * @description Creates a new vector collection with the given vector size and distance metric. For advanced setups (named vectors, sparse vectors, quantization, HNSW tuning, sharding), provide an Advanced Configuration object that is merged into the request body and overrides the basic settings.
   * @route POST /create-collection
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"description":"Name of the collection to create. Must be unique within the Qdrant instance."}
   * @paramDef {"type":"Number","label":"Vector Size","name":"vectorSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Dimensionality of the vectors stored in the collection (e.g. 1536 for OpenAI text-embedding-3-small). Required unless vectors are fully defined in Advanced Configuration."}
   * @paramDef {"type":"String","label":"Distance Metric","name":"distance","uiComponent":{"type":"DROPDOWN","options":{"values":["Cosine","Euclidean","Dot Product","Manhattan"]}},"defaultValue":"Cosine","description":"Similarity metric used to compare vectors. Cosine is the most common choice for text embeddings."}
   * @paramDef {"type":"Boolean","label":"Store Payload On Disk","name":"onDiskPayload","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"If enabled, point payloads are stored on disk instead of in RAM. Reduces memory usage for large payloads at a small latency cost."}
   * @paramDef {"type":"Object","label":"Advanced Configuration","name":"advancedConfig","required":false,"description":"Optional raw Qdrant collection configuration merged into the request body. Use it for named vectors (e.g. {\"vectors\":{\"text\":{\"size\":768,\"distance\":\"Cosine\"}}}), sparse vectors, quantization_config, hnsw_config, replication and sharding settings. Keys here override the basic settings above."}
   * @returns {Boolean}
   * @sampleResult true
   */
  async createCollection(collectionName, vectorSize, distance, onDiskPayload, advancedConfig) {
    const body = {}

    if (vectorSize) {
      body.vectors = {
        size: vectorSize,
        distance: this.#resolveChoice(distance, DISTANCE_METRICS) || 'Cosine',
      }
    }

    if (onDiskPayload !== undefined && onDiskPayload !== null) {
      body.on_disk_payload = onDiskPayload
    }

    if (advancedConfig && Object.keys(advancedConfig).length > 0) {
      Object.assign(body, advancedConfig)
    }

    if (!body.vectors && !body.sparse_vectors) {
      throw new Error('createCollection: provide "Vector Size" or define vectors in "Advanced Configuration"')
    }

    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }`,
      method: 'put',
      body,
      logTag: 'createCollection',
    })
  }

  /**
   * @operationName List Collections
   * @category Collections
   * @description Retrieves the names of all collections that exist in the Qdrant instance.
   * @route GET /list-collections
   * @returns {Object}
   * @sampleResult {"collections":[{"name":"documents"},{"name":"products"}]}
   */
  async listCollections() {
    return this.#apiRequest({
      path: '/collections',
      method: 'get',
      logTag: 'listCollections',
    })
  }

  /**
   * @operationName Get Collection
   * @category Collections
   * @description Retrieves detailed information about a collection, including its status, vector configuration, points count, indexed vectors count and optimizer state.
   * @route GET /get-collection
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Name of the collection to inspect."}
   * @returns {Object}
   * @sampleResult {"status":"green","optimizer_status":"ok","points_count":12005,"indexed_vectors_count":11800,"segments_count":4,"config":{"params":{"vectors":{"size":1536,"distance":"Cosine"},"shard_number":1,"on_disk_payload":true}}}
   */
  async getCollection(collectionName) {
    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }`,
      method: 'get',
      logTag: 'getCollection',
    })
  }

  /**
   * @operationName Delete Collection
   * @category Collections
   * @description Permanently deletes a collection and all points stored in it. This action cannot be undone.
   * @route DELETE /delete-collection
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Name of the collection to delete."}
   * @returns {Boolean}
   * @sampleResult true
   */
  async deleteCollection(collectionName) {
    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }`,
      method: 'delete',
      logTag: 'deleteCollection',
    })
  }

  /**
   * @operationName Check Collection Exists
   * @category Collections
   * @description Checks whether a collection with the given name exists in the Qdrant instance. Returns an object with an "exists" boolean.
   * @route GET /collection-exists
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"description":"Name of the collection to check."}
   * @returns {Object}
   * @sampleResult {"exists":true}
   */
  async collectionExists(collectionName) {
    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }/exists`,
      method: 'get',
      logTag: 'collectionExists',
    })
  }

  // ---------------------------------------------------------------------------
  // Points
  // ---------------------------------------------------------------------------

  /**
   * @operationName Upsert Points
   * @category Points
   * @description Inserts new points or updates existing ones (matched by ID) in a collection. Each point is an object with "id" (unsigned integer or UUID string), "vector" (array of numbers, or an object of named vectors) and an optional "payload" object with arbitrary metadata. The operation waits for changes to be applied before returning.
   * @route PUT /upsert-points
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to upsert points into."}
   * @paramDef {"type":"Array<Object>","label":"Points","name":"points","required":true,"description":"Points to insert or update, e.g. [{\"id\":1,\"vector\":[0.05,0.61,0.76],\"payload\":{\"city\":\"Berlin\"}}]. For named vectors use {\"vector\":{\"text\":[...]}}."}
   * @returns {Object}
   * @sampleResult {"operation_id":42,"status":"completed"}
   */
  async upsertPoints(collectionName, points) {
    const normalizedPoints = (points || []).map(point => ({
      ...point,
      id: this.#normalizePointId(point.id),
    }))

    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }/points`,
      method: 'put',
      query: { wait: 'true' },
      body: { points: normalizedPoints },
      logTag: 'upsertPoints',
    })
  }

  /**
   * @operationName Get Points
   * @category Points
   * @description Retrieves specific points from a collection by their IDs, optionally including stored payloads and vectors.
   * @route POST /get-points
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to retrieve points from."}
   * @paramDef {"type":"Array<String>","label":"Point IDs","name":"pointIds","required":true,"description":"IDs of the points to retrieve. Numeric strings are treated as integer IDs; other strings must be UUIDs."}
   * @paramDef {"type":"Boolean","label":"Include Payload","name":"withPayload","required":false,"defaultValue":true,"uiComponent":{"type":"CHECKBOX"},"description":"Include point payloads in the response. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Include Vectors","name":"withVector","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Include point vectors in the response. Defaults to false."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"payload":{"city":"Berlin"},"vector":[0.05,0.61,0.76]}]
   */
  async getPoints(collectionName, pointIds, withPayload, withVector) {
    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }/points`,
      method: 'post',
      body: {
        ids: (pointIds || []).map(id => this.#normalizePointId(id)),
        with_payload: withPayload !== false,
        with_vector: withVector === true,
      },
      logTag: 'getPoints',
    })
  }

  /**
   * @operationName Delete Points
   * @category Points
   * @description Deletes points from a collection either by an explicit list of point IDs or by a Qdrant filter that selects the points to remove. Provide exactly one of the two selectors. The operation waits for changes to be applied before returning.
   * @route POST /delete-points
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to delete points from."}
   * @paramDef {"type":"Array<String>","label":"Point IDs","name":"pointIds","required":false,"description":"IDs of the points to delete. Numeric strings are treated as integer IDs. Leave empty when deleting by filter."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":false,"description":"Qdrant filter selecting the points to delete, e.g. {\"must\":[{\"key\":\"city\",\"match\":{\"value\":\"Berlin\"}}]}. Used when Point IDs is empty."}
   * @returns {Object}
   * @sampleResult {"operation_id":43,"status":"completed"}
   */
  async deletePoints(collectionName, pointIds, filter) {
    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }/points/delete`,
      method: 'post',
      query: { wait: 'true' },
      body: this.#buildPointsSelector(pointIds, filter, 'deletePoints'),
      logTag: 'deletePoints',
    })
  }

  /**
   * @operationName Query Points
   * @category Points
   * @description Searches a collection using Qdrant's universal Query API — the primary similarity-search operation. Query by a raw embedding vector, or by an existing point ID to find its nearest neighbors. Supports payload filtering, score thresholds, pagination and named vectors. Returns scored points ordered by similarity.
   * @route POST /query-points
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to search in."}
   * @paramDef {"type":"Array<Number>","label":"Query Vector","name":"queryVector","required":false,"description":"Embedding vector to search with, e.g. [0.2,0.1,0.9,0.7]. Its dimensionality must match the collection's vector size. Leave empty when searching by Point ID."}
   * @paramDef {"type":"String","label":"Query Point ID","name":"queryPointId","required":false,"description":"ID of an existing point to use as the query — Qdrant finds its nearest neighbors. Used when Query Vector is empty."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":false,"description":"Qdrant filter applied to candidate points, e.g. {\"must\":[{\"key\":\"category\",\"match\":{\"value\":\"news\"}}]}."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of points to return. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Score Threshold","name":"scoreThreshold","required":false,"description":"Only return points with a similarity score better than this threshold."}
   * @paramDef {"type":"String","label":"Vector Name","name":"using","required":false,"description":"Name of the vector to use when the collection has multiple named vectors. Leave empty to use the default vector."}
   * @paramDef {"type":"Boolean","label":"Include Payload","name":"withPayload","required":false,"defaultValue":true,"uiComponent":{"type":"CHECKBOX"},"description":"Include point payloads in the response. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Include Vectors","name":"withVector","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Include point vectors in the response. Defaults to false."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of top results to skip, for pagination. Defaults to 0."}
   * @returns {Object}
   * @sampleResult {"points":[{"id":42,"version":3,"score":0.987,"payload":{"city":"Berlin"}},{"id":7,"version":3,"score":0.912,"payload":{"city":"Munich"}}]}
   */
  async queryPoints(
    collectionName,
    queryVector,
    queryPointId,
    filter,
    limit,
    scoreThreshold,
    using,
    withPayload,
    withVector,
    offset
  ) {
    let query

    if (Array.isArray(queryVector) && queryVector.length > 0) {
      query = queryVector
    } else if (queryPointId !== undefined && queryPointId !== null && queryPointId !== '') {
      query = this.#normalizePointId(queryPointId)
    } else {
      throw new Error('queryPoints: either "Query Vector" or "Query Point ID" must be provided')
    }

    const body = {
      query,
      with_payload: withPayload !== false,
      with_vector: withVector === true,
    }

    if (filter && Object.keys(filter).length > 0) body.filter = filter
    if (limit) body.limit = limit
    if (offset) body.offset = offset
    if (scoreThreshold !== undefined && scoreThreshold !== null) body.score_threshold = scoreThreshold
    if (using) body.using = using

    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }/points/query`,
      method: 'post',
      body,
      logTag: 'queryPoints',
    })
  }

  /**
   * @operationName Batch Query Points
   * @category Points
   * @description Executes multiple similarity-search queries against a collection in a single request. Each search is a full Qdrant query object (query, filter, limit, using, with_payload, etc.). Returns one result set per search, in the same order.
   * @route POST /batch-query-points
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to search in."}
   * @paramDef {"type":"Array<Object>","label":"Searches","name":"searches","required":true,"description":"Query objects to execute, e.g. [{\"query\":[0.2,0.1,0.9],\"limit\":3,\"with_payload\":true},{\"query\":[0.5,0.3,0.2],\"limit\":3,\"filter\":{\"must\":[{\"key\":\"city\",\"match\":{\"value\":\"Berlin\"}}]}}]."}
   * @returns {Array<Object>}
   * @sampleResult [{"points":[{"id":1,"score":0.98,"payload":{"city":"Berlin"}}]},{"points":[{"id":5,"score":0.91,"payload":{"city":"Berlin"}}]}]
   */
  async batchQueryPoints(collectionName, searches) {
    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }/points/query/batch`,
      method: 'post',
      body: { searches: searches || [] },
      logTag: 'batchQueryPoints',
    })
  }

  /**
   * @operationName Scroll Points
   * @category Points
   * @description Iterates through all points in a collection that match an optional filter, without similarity scoring. Returns a page of points plus a "next_page_offset" point ID to pass as Offset for the next page (null when there are no more results).
   * @route POST /scroll-points
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to scroll through."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":false,"description":"Qdrant filter selecting which points to return, e.g. {\"must\":[{\"key\":\"color\",\"match\":{\"value\":\"red\"}}]}."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of points to return per page. Defaults to 10."}
   * @paramDef {"type":"String","label":"Offset","name":"offset","required":false,"description":"Point ID to start from — pass the \"next_page_offset\" value from the previous page."}
   * @paramDef {"type":"Boolean","label":"Include Payload","name":"withPayload","required":false,"defaultValue":true,"uiComponent":{"type":"CHECKBOX"},"description":"Include point payloads in the response. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Include Vectors","name":"withVector","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Include point vectors in the response. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"points":[{"id":1,"payload":{"color":"red"}},{"id":2,"payload":{"color":"red"}}],"next_page_offset":3}
   */
  async scrollPoints(collectionName, filter, limit, offset, withPayload, withVector) {
    const body = {
      with_payload: withPayload !== false,
      with_vector: withVector === true,
    }

    if (filter && Object.keys(filter).length > 0) body.filter = filter
    if (limit) body.limit = limit

    if (offset !== undefined && offset !== null && offset !== '') {
      body.offset = this.#normalizePointId(offset)
    }

    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }/points/scroll`,
      method: 'post',
      body,
      logTag: 'scrollPoints',
    })
  }

  /**
   * @operationName Count Points
   * @category Points
   * @description Counts the points in a collection, optionally restricted to those matching a filter. Exact counting is precise but slower; approximate counting uses indexed data for faster results on large collections.
   * @route POST /count-points
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to count points in."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":false,"description":"Qdrant filter selecting which points to count. Leave empty to count all points."}
   * @paramDef {"type":"Boolean","label":"Exact Count","name":"exact","required":false,"defaultValue":true,"uiComponent":{"type":"CHECKBOX"},"description":"If enabled (default), returns the exact count. Disable for a faster approximate count."}
   * @returns {Object}
   * @sampleResult {"count":12005}
   */
  async countPoints(collectionName, filter, exact) {
    const body = { exact: exact !== false }

    if (filter && Object.keys(filter).length > 0) body.filter = filter

    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }/points/count`,
      method: 'post',
      body,
      logTag: 'countPoints',
    })
  }

  // ---------------------------------------------------------------------------
  // Payload
  // ---------------------------------------------------------------------------

  /**
   * @operationName Set Payload
   * @category Payload
   * @description Sets (merges) payload fields on selected points — existing keys not present in the new payload are kept. Select points by an explicit list of IDs or by a filter; provide exactly one selector. The operation waits for changes to be applied before returning.
   * @route POST /set-payload
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection containing the points."}
   * @paramDef {"type":"Object","label":"Payload","name":"payload","required":true,"description":"Payload fields to set, e.g. {\"status\":\"processed\",\"score\":0.9}."}
   * @paramDef {"type":"Array<String>","label":"Point IDs","name":"pointIds","required":false,"description":"IDs of the points to update. Numeric strings are treated as integer IDs. Leave empty when selecting by filter."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":false,"description":"Qdrant filter selecting the points to update. Used when Point IDs is empty."}
   * @returns {Object}
   * @sampleResult {"operation_id":44,"status":"completed"}
   */
  async setPayload(collectionName, payload, pointIds, filter) {
    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }/points/payload`,
      method: 'post',
      query: { wait: 'true' },
      body: { payload, ...this.#buildPointsSelector(pointIds, filter, 'setPayload') },
      logTag: 'setPayload',
    })
  }

  /**
   * @operationName Overwrite Payload
   * @category Payload
   * @description Replaces the entire payload of selected points with the provided object — all previously stored payload fields are removed. Select points by an explicit list of IDs or by a filter; provide exactly one selector. The operation waits for changes to be applied before returning.
   * @route PUT /overwrite-payload
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection containing the points."}
   * @paramDef {"type":"Object","label":"Payload","name":"payload","required":true,"description":"New payload that fully replaces the existing one, e.g. {\"status\":\"archived\"}."}
   * @paramDef {"type":"Array<String>","label":"Point IDs","name":"pointIds","required":false,"description":"IDs of the points to update. Numeric strings are treated as integer IDs. Leave empty when selecting by filter."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":false,"description":"Qdrant filter selecting the points to update. Used when Point IDs is empty."}
   * @returns {Object}
   * @sampleResult {"operation_id":45,"status":"completed"}
   */
  async overwritePayload(collectionName, payload, pointIds, filter) {
    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }/points/payload`,
      method: 'put',
      query: { wait: 'true' },
      body: { payload, ...this.#buildPointsSelector(pointIds, filter, 'overwritePayload') },
      logTag: 'overwritePayload',
    })
  }

  /**
   * @operationName Delete Payload Keys
   * @category Payload
   * @description Removes specific payload fields from selected points; other payload fields and the vectors are kept. Select points by an explicit list of IDs or by a filter; provide exactly one selector. The operation waits for changes to be applied before returning.
   * @route POST /delete-payload-keys
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection containing the points."}
   * @paramDef {"type":"Array<String>","label":"Payload Keys","name":"keys","required":true,"description":"Names of the payload fields to remove, e.g. [\"color\",\"price\"]."}
   * @paramDef {"type":"Array<String>","label":"Point IDs","name":"pointIds","required":false,"description":"IDs of the points to update. Numeric strings are treated as integer IDs. Leave empty when selecting by filter."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":false,"description":"Qdrant filter selecting the points to update. Used when Point IDs is empty."}
   * @returns {Object}
   * @sampleResult {"operation_id":46,"status":"completed"}
   */
  async deletePayloadKeys(collectionName, keys, pointIds, filter) {
    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }/points/payload/delete`,
      method: 'post',
      query: { wait: 'true' },
      body: { keys: keys || [], ...this.#buildPointsSelector(pointIds, filter, 'deletePayloadKeys') },
      logTag: 'deletePayloadKeys',
    })
  }

  /**
   * @operationName Clear Payload
   * @category Payload
   * @description Removes the entire payload from selected points; the vectors are kept. Select points by an explicit list of IDs or by a filter; provide exactly one selector. The operation waits for changes to be applied before returning.
   * @route POST /clear-payload
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection containing the points."}
   * @paramDef {"type":"Array<String>","label":"Point IDs","name":"pointIds","required":false,"description":"IDs of the points to clear. Numeric strings are treated as integer IDs. Leave empty when selecting by filter."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":false,"description":"Qdrant filter selecting the points to clear. Used when Point IDs is empty."}
   * @returns {Object}
   * @sampleResult {"operation_id":47,"status":"completed"}
   */
  async clearPayload(collectionName, pointIds, filter) {
    return this.#apiRequest({
      path: `/collections/${ encodeURIComponent(collectionName) }/points/payload/clear`,
      method: 'post',
      query: { wait: 'true' },
      body: this.#buildPointsSelector(pointIds, filter, 'clearPayload'),
      logTag: 'clearPayload',
    })
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
   * @description Lists collections in the Qdrant instance for selection in dependent parameters.
   * @route POST /get-collections-dictionary
   * @paramDef {"type":"getCollectionsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"documents","value":"documents"},{"label":"products","value":"products"}],"cursor":null}
   */
  async getCollectionsDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({
      path: '/collections',
      method: 'get',
      logTag: 'getCollectionsDictionary',
    })

    let collections = result?.collections || []

    if (search) {
      const needle = search.toLowerCase()

      collections = collections.filter(collection => collection.name.toLowerCase().includes(needle))
    }

    return {
      items: collections.map(collection => ({ label: collection.name, value: collection.name })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(Qdrant, [
  {
    name: 'url',
    displayName: 'Instance URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Base URL of your Qdrant instance, e.g. https://xyz-example.eu-central.aws.cloud.qdrant.io:6333 for Qdrant Cloud or http://your-host:6333 for self-hosted.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Qdrant API key. Required for Qdrant Cloud (Data Access Control page); optional for self-hosted instances running without authentication.',
  },
])

module.exports = Qdrant
