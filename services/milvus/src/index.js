'use strict'

const SERVICE_NAME = 'Milvus'

const logger = {
  info: (...args) => console.log(`[${ SERVICE_NAME }] info:`, ...args),
  debug: (...args) => console.log(`[${ SERVICE_NAME }] debug:`, ...args),
  error: (...args) => console.log(`[${ SERVICE_NAME }] error:`, ...args),
  warn: (...args) => console.log(`[${ SERVICE_NAME }] warn:`, ...args),
}

const METRIC_TYPES = {
  'Cosine': 'COSINE',
  'L2': 'L2',
  'Inner Product': 'IP',
}

/**
 * @integrationName Milvus
 * @integrationIcon /icon.png
 */
class Milvus {
  constructor(config) {
    this.endpoint = (config.clusterEndpoint || '').replace(/\/+$/, '')
    this.token = config.token
  }

  /**
   * All Milvus REST v2 calls go through here. Milvus wraps every response as
   * {code, data, message} where code 0 means success. This helper unwraps and
   * returns `data`; on a non-zero code (or transport error) it throws with the
   * API message.
   */
  async #apiRequest({ path, body, logTag }) {
    const url = `${ this.endpoint }/v2/vectordb${ path }`

    try {
      logger.debug(`${ logTag } - api request: [POST::${ url }]`)

      const response = await Flowrunner.Request.post(url)
        .set({
          'Authorization': `Bearer ${ this.token }`,
          'Content-Type': 'application/json',
        })
        .send(body || {})

      if (response && typeof response.code === 'number' && response.code !== 0) {
        throw new Error(`${ response.message || 'Request failed' } (code ${ response.code })`)
      }

      return response?.data !== undefined ? response.data : response
    } catch (error) {
      const message = error.body?.message || error.message
      const code = error.body?.code

      logger.error(`${ logTag } - api request failed: ${ message }`)

      throw new Error(`Milvus API error: ${ message }${ code !== undefined ? ` (code ${ code })` : '' }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Collection
   * @category Collections
   * @description Creates a new collection. In quick-setup mode, supply a Dimension and Metric Type to auto-generate a schema with an auto-generated primary key and a single float-vector field. For full control, provide a custom Schema object (fields definition) and optionally override the primary/vector field names, ID type and auto-ID behavior. A collection must be loaded before it can be searched or queried.
   * @route POST /collections/create
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"description":"Name of the collection to create. Must be unique within the database and start with a letter or underscore."}
   * @paramDef {"type":"Number","label":"Dimension","name":"dimension","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Vector dimensionality for quick-setup mode (e.g. 1536 for OpenAI text-embedding-3-small). Required unless a custom Schema is provided."}
   * @paramDef {"type":"String","label":"Metric Type","name":"metricType","defaultValue":"Cosine","uiComponent":{"type":"DROPDOWN","options":{"values":["Cosine","L2","Inner Product"]}},"description":"Distance metric used for similarity search. Defaults to Cosine."}
   * @paramDef {"type":"String","label":"ID Type","name":"idType","uiComponent":{"type":"DROPDOWN","options":{"values":["Int64","VarChar"]}},"description":"Data type of the auto-generated primary key in quick-setup mode. Defaults to Int64."}
   * @paramDef {"type":"Boolean","label":"Auto ID","name":"autoId","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Milvus generates primary key values automatically on insert. Defaults to false."}
   * @paramDef {"type":"String","label":"Primary Field Name","name":"primaryFieldName","description":"Name of the primary key field in quick-setup mode. Defaults to \"id\"."}
   * @paramDef {"type":"String","label":"Vector Field Name","name":"vectorFieldName","description":"Name of the vector field in quick-setup mode. Defaults to \"vector\"."}
   * @paramDef {"type":"Object","label":"Schema","name":"schema","description":"Optional custom schema defining fields explicitly, e.g. {\"fields\":[{\"fieldName\":\"id\",\"dataType\":\"Int64\",\"isPrimary\":true},{\"fieldName\":\"vector\",\"dataType\":\"FloatVector\",\"elementTypeParams\":{\"dim\":768}}]}. Overrides the quick-setup Dimension when supplied."}
   * @returns {Object}
   * @sampleResult {}
   */
  async createCollection(collectionName, dimension, metricType, idType, autoId, primaryFieldName, vectorFieldName, schema) {
    const hasSchema = schema && Object.keys(schema).length > 0
    const hasDimension = dimension !== undefined && dimension !== null && dimension !== ''

    if (!hasSchema && !hasDimension) {
      throw new Error('createCollection: provide a "Dimension" (quick setup) or a custom "Schema".')
    }

    const body = { collectionName }

    if (hasSchema) {
      body.schema = schema
    } else {
      body.dimension = Number(dimension)
    }

    if (metricType) {
      body.metricType = this.#resolveChoice(metricType, METRIC_TYPES) || 'COSINE'
    }

    if (idType) {
      body.idType = idType
    }

    if (autoId !== undefined && autoId !== null) {
      body.autoID = autoId === true
    }

    if (primaryFieldName) {
      body.primaryFieldName = primaryFieldName
    }

    if (vectorFieldName) {
      body.vectorFieldName = vectorFieldName
    }

    return this.#apiRequest({
      path: '/collections/create',
      body,
      logTag: 'createCollection',
    })
  }

  /**
   * @operationName List Collections
   * @category Collections
   * @description Retrieves the names of all collections in the current database.
   * @route POST /collections/list
   * @returns {Array<String>}
   * @sampleResult ["documents","products"]
   */
  async listCollections() {
    return this.#apiRequest({
      path: '/collections/list',
      body: {},
      logTag: 'listCollections',
    })
  }

  /**
   * @operationName Describe Collection
   * @category Collections
   * @description Retrieves the full definition of a collection, including its schema (fields and data types), configured indexes, load status, aliases and consistency level.
   * @route POST /collections/describe
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Name of the collection to describe."}
   * @returns {Object}
   * @sampleResult {"collectionName":"documents","description":"","autoId":false,"fields":[{"name":"id","type":"Int64","primaryKey":true},{"name":"vector","type":"FloatVector","params":{"dim":768}}],"indexes":[{"fieldName":"vector","indexName":"vector","metricType":"COSINE"}],"load":"LoadStateLoaded","consistencyLevel":"Bounded"}
   */
  async describeCollection(collectionName) {
    return this.#apiRequest({
      path: '/collections/describe',
      body: { collectionName },
      logTag: 'describeCollection',
    })
  }

  /**
   * @operationName Drop Collection
   * @category Collections
   * @description Permanently deletes a collection along with all entities and indexes it contains. This action cannot be undone.
   * @route POST /collections/drop
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Name of the collection to drop."}
   * @returns {Object}
   * @sampleResult {}
   */
  async dropCollection(collectionName) {
    return this.#apiRequest({
      path: '/collections/drop',
      body: { collectionName },
      logTag: 'dropCollection',
    })
  }

  /**
   * @operationName Has Collection
   * @category Collections
   * @description Checks whether a collection with the given name exists in the current database. Returns an object with a "has" boolean.
   * @route POST /collections/has
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"description":"Name of the collection to check for existence."}
   * @returns {Object}
   * @sampleResult {"has":true}
   */
  async hasCollection(collectionName) {
    return this.#apiRequest({
      path: '/collections/has',
      body: { collectionName },
      logTag: 'hasCollection',
    })
  }

  /**
   * @operationName Get Collection Stats
   * @category Collections
   * @description Retrieves statistics for a collection, most notably its total entity (row) count.
   * @route POST /collections/get_stats
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Name of the collection to get statistics for."}
   * @returns {Object}
   * @sampleResult {"rowCount":12005}
   */
  async getCollectionStats(collectionName) {
    return this.#apiRequest({
      path: '/collections/get_stats',
      body: { collectionName },
      logTag: 'getCollectionStats',
    })
  }

  /**
   * @operationName Load Collection
   * @category Collections
   * @description Loads a collection (and its index) into memory so it can serve search and query requests. A collection must be loaded before Search or Query will return results. Loading is asynchronous; large collections may take time to become fully loaded.
   * @route POST /collections/load
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Name of the collection to load into memory."}
   * @returns {Object}
   * @sampleResult {}
   */
  async loadCollection(collectionName) {
    return this.#apiRequest({
      path: '/collections/load',
      body: { collectionName },
      logTag: 'loadCollection',
    })
  }

  /**
   * @operationName Release Collection
   * @category Collections
   * @description Releases a collection from memory to free resources. Once released, the collection can no longer serve search or query requests until it is loaded again.
   * @route POST /collections/release
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Name of the collection to release from memory."}
   * @returns {Object}
   * @sampleResult {}
   */
  async releaseCollection(collectionName) {
    return this.#apiRequest({
      path: '/collections/release',
      body: { collectionName },
      logTag: 'releaseCollection',
    })
  }

  // ---------------------------------------------------------------------------
  // Entities (data)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Insert Entities
   * @category Entities
   * @description Inserts one or more entities (rows) into a collection. Each entity is an object whose keys match the collection's field names, e.g. {"id":1,"vector":[0.1,0.2,...],"title":"Doc"}. Omit the primary key when the collection uses auto-ID. Returns the count of inserted rows and their primary keys.
   * @route POST /entities/insert
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to insert entities into."}
   * @paramDef {"type":"Array<Object>","label":"Data","name":"data","required":true,"description":"Entities to insert. Each object's keys must match the collection's fields, e.g. [{\"id\":1,\"vector\":[0.1,0.2,0.3],\"title\":\"Doc\"}]."}
   * @paramDef {"type":"String","label":"Partition Name","name":"partitionName","description":"Optional partition to insert into. Defaults to the collection's default partition."}
   * @returns {Object}
   * @sampleResult {"insertCount":2,"insertIds":[1,2]}
   */
  async insertEntities(collectionName, data, partitionName) {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('insertEntities: "Data" must be a non-empty array of entities.')
    }

    const body = { collectionName, data }

    if (partitionName) {
      body.partitionName = partitionName
    }

    return this.#apiRequest({
      path: '/entities/insert',
      body,
      logTag: 'insertEntities',
    })
  }

  /**
   * @operationName Upsert Entities
   * @category Entities
   * @description Inserts new entities or replaces existing ones matched by primary key in a collection. Each entity is an object whose keys match the collection's field names. Use this to write data idempotently without checking for existence first.
   * @route POST /entities/upsert
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to upsert entities into."}
   * @paramDef {"type":"Array<Object>","label":"Data","name":"data","required":true,"description":"Entities to upsert. Each object's keys must match the collection's fields, e.g. [{\"id\":1,\"vector\":[0.1,0.2,0.3],\"title\":\"Doc\"}]."}
   * @paramDef {"type":"String","label":"Partition Name","name":"partitionName","description":"Optional partition to upsert into. Defaults to the collection's default partition."}
   * @returns {Object}
   * @sampleResult {"upsertCount":2,"upsertIds":[1,2]}
   */
  async upsertEntities(collectionName, data, partitionName) {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('upsertEntities: "Data" must be a non-empty array of entities.')
    }

    const body = { collectionName, data }

    if (partitionName) {
      body.partitionName = partitionName
    }

    return this.#apiRequest({
      path: '/entities/upsert',
      body,
      logTag: 'upsertEntities',
    })
  }

  /**
   * @operationName Delete Entities
   * @category Entities
   * @description Deletes entities from a collection by an explicit list of primary key IDs or by a boolean filter expression. Provide exactly one selector. Filter expressions use Milvus syntax, e.g. "color in [\"red\",\"green\"]" or "id > 100".
   * @route POST /entities/delete
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to delete entities from."}
   * @paramDef {"type":"Array<String>","label":"IDs","name":"ids","description":"Primary key values of the entities to delete, e.g. [1,2,3] or [\"a\",\"b\"]. Leave empty when deleting by Filter."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Boolean filter expression selecting entities to delete, e.g. \"color in [\\\"red\\\"]\". Used when IDs is empty."}
   * @paramDef {"type":"String","label":"Partition Name","name":"partitionName","description":"Optional partition to delete from. Defaults to searching all partitions."}
   * @returns {Object}
   * @sampleResult {}
   */
  async deleteEntities(collectionName, ids, filter, partitionName) {
    const hasIds = Array.isArray(ids) && ids.length > 0
    const hasFilter = filter !== undefined && filter !== null && String(filter).trim() !== ''

    if (!hasIds && !hasFilter) {
      throw new Error('deleteEntities: provide either "IDs" or a "Filter" expression.')
    }

    const body = { collectionName }

    if (hasIds) {
      body.filter = `${ this.#primaryFieldPlaceholder() } in [${ ids.map(id => this.#literal(id)).join(',') }]`
    } else {
      body.filter = filter
    }

    if (partitionName) {
      body.partitionName = partitionName
    }

    return this.#apiRequest({
      path: '/entities/delete',
      body,
      logTag: 'deleteEntities',
    })
  }

  /**
   * @operationName Search Entities
   * @category Entities
   * @description Performs a vector similarity search — the primary nearest-neighbor operation. Supply one or more query vectors and Milvus returns the closest entities ranked by distance/similarity. Supports scalar filtering, output field selection, pagination via offset, and per-request search parameters (metric type and index params like nprobe/ef). The collection must be loaded first (use Load Collection).
   * @route POST /entities/search
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to search in. Must be loaded into memory."}
   * @paramDef {"type":"Array<Object>","label":"Query Vectors","name":"data","required":true,"description":"One or more query vectors as arrays of numbers, e.g. [[0.1,0.2,0.3]]. Each vector's dimensionality must match the collection's vector field."}
   * @paramDef {"type":"String","label":"Vector Field","name":"annsField","description":"Name of the vector field to search against. Defaults to the collection's single vector field; required when the collection has multiple vector fields."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","defaultValue":10,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of nearest results to return per query vector (top K). Defaults to 10."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional boolean filter expression applied before the vector search, e.g. \"category == \\\"news\\\" and year > 2020\"."}
   * @paramDef {"type":"Array<String>","label":"Output Fields","name":"outputFields","description":"Scalar fields to return with each result, e.g. [\"title\",\"category\"]. Leave empty to return only IDs and distances."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of top results to skip, for pagination. Defaults to 0."}
   * @paramDef {"type":"Object","label":"Search Params","name":"searchParams","description":"Optional per-request search tuning, e.g. {\"metricType\":\"COSINE\",\"params\":{\"nprobe\":10,\"radius\":0.8,\"range_filter\":1.0}}."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":42,"distance":0.98,"title":"Berlin"},{"id":7,"distance":0.91,"title":"Munich"}]
   */
  async searchEntities(collectionName, data, annsField, limit, filter, outputFields, offset, searchParams) {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('searchEntities: "Query Vectors" must be a non-empty array of vectors.')
    }

    const body = {
      collectionName,
      data,
      limit: limit !== undefined && limit !== null && limit !== '' ? Number(limit) : 10,
    }

    if (annsField) {
      body.annsField = annsField
    }

    if (filter !== undefined && filter !== null && String(filter).trim() !== '') {
      body.filter = filter
    }

    if (Array.isArray(outputFields) && outputFields.length > 0) {
      body.outputFields = outputFields
    }

    if (offset !== undefined && offset !== null && offset !== '') {
      body.offset = Number(offset)
    }

    if (searchParams && Object.keys(searchParams).length > 0) {
      body.searchParams = searchParams
    }

    return this.#apiRequest({
      path: '/entities/search',
      body,
      logTag: 'searchEntities',
    })
  }

  /**
   * @operationName Query Entities
   * @category Entities
   * @description Retrieves entities that match a scalar boolean filter expression, without vector similarity. Use it to fetch rows by metadata, e.g. "color == \"red\" and price < 100". Supports selecting output fields and limiting the number of rows. The collection must be loaded first.
   * @route POST /entities/query
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to query. Must be loaded into memory."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","required":true,"description":"Boolean filter expression selecting entities, e.g. \"color == \\\"red\\\" and price < 100\"."}
   * @paramDef {"type":"Array<String>","label":"Output Fields","name":"outputFields","description":"Fields to return for each matching entity, e.g. [\"id\",\"title\"]. Leave empty for default fields."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of entities to return. Leave empty for the server default."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of matching entities to skip, for pagination. Defaults to 0."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"color":"red","price":42},{"id":5,"color":"red","price":80}]
   */
  async queryEntities(collectionName, filter, outputFields, limit, offset) {
    if (filter === undefined || filter === null || String(filter).trim() === '') {
      throw new Error('queryEntities: a "Filter" expression is required.')
    }

    const body = { collectionName, filter }

    if (Array.isArray(outputFields) && outputFields.length > 0) {
      body.outputFields = outputFields
    }

    if (limit !== undefined && limit !== null && limit !== '') {
      body.limit = Number(limit)
    }

    if (offset !== undefined && offset !== null && offset !== '') {
      body.offset = Number(offset)
    }

    return this.#apiRequest({
      path: '/entities/query',
      body,
      logTag: 'queryEntities',
    })
  }

  /**
   * @operationName Get Entities
   * @category Entities
   * @description Retrieves entities from a collection by their primary key IDs. Optionally restricts the returned fields. The collection must be loaded first.
   * @route POST /entities/get
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to retrieve entities from. Must be loaded into memory."}
   * @paramDef {"type":"Array<String>","label":"IDs","name":"id","required":true,"description":"Primary key values of the entities to retrieve, e.g. [1,2,3] or [\"a\",\"b\"]."}
   * @paramDef {"type":"Array<String>","label":"Output Fields","name":"outputFields","description":"Fields to return for each entity, e.g. [\"id\",\"title\",\"vector\"]. Leave empty for default fields."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"title":"Berlin","vector":[0.1,0.2,0.3]}]
   */
  async getEntities(collectionName, id, outputFields) {
    if (!Array.isArray(id) || id.length === 0) {
      throw new Error('getEntities: "IDs" must be a non-empty array.')
    }

    const body = { collectionName, id }

    if (Array.isArray(outputFields) && outputFields.length > 0) {
      body.outputFields = outputFields
    }

    return this.#apiRequest({
      path: '/entities/get',
      body,
      logTag: 'getEntities',
    })
  }

  // ---------------------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Index
   * @category Indexes
   * @description Creates one or more indexes on fields of a collection. Each index entry names the target field, the index type (e.g. AUTOINDEX, IVF_FLAT, HNSW) and, for vector fields, the distance metric. Building an index accelerates vector search and scalar filtering.
   * @route POST /indexes/create
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to create the index on."}
   * @paramDef {"type":"Array<Object>","label":"Index Params","name":"indexParams","required":true,"description":"Index definitions, e.g. [{\"fieldName\":\"vector\",\"indexName\":\"vector_index\",\"indexType\":\"AUTOINDEX\",\"metricType\":\"COSINE\",\"params\":{\"nlist\":1024}}]."}
   * @returns {Object}
   * @sampleResult {}
   */
  async createIndex(collectionName, indexParams) {
    if (!Array.isArray(indexParams) || indexParams.length === 0) {
      throw new Error('createIndex: "Index Params" must be a non-empty array.')
    }

    return this.#apiRequest({
      path: '/indexes/create',
      body: { collectionName, indexParams },
      logTag: 'createIndex',
    })
  }

  /**
   * @operationName Describe Index
   * @category Indexes
   * @description Retrieves the configuration and build state of a specific index on a collection, including its index type, metric type, parameters and indexed-rows count.
   * @route POST /indexes/describe
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection the index belongs to."}
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"description":"Name of the index to describe (often the same as the indexed field name)."}
   * @returns {Array<Object>}
   * @sampleResult [{"fieldName":"vector","indexName":"vector_index","indexType":"AUTOINDEX","metricType":"COSINE","indexState":"Finished","totalRows":12005,"indexedRows":12005}]
   */
  async describeIndex(collectionName, indexName) {
    return this.#apiRequest({
      path: '/indexes/describe',
      body: { collectionName, indexName },
      logTag: 'describeIndex',
    })
  }

  /**
   * @operationName List Indexes
   * @category Indexes
   * @description Retrieves the names of all indexes defined on a collection.
   * @route POST /indexes/list
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to list indexes for."}
   * @returns {Array<String>}
   * @sampleResult ["vector_index"]
   */
  async listIndexes(collectionName) {
    return this.#apiRequest({
      path: '/indexes/list',
      body: { collectionName },
      logTag: 'listIndexes',
    })
  }

  /**
   * @operationName Drop Index
   * @category Indexes
   * @description Permanently deletes an index from a collection. The collection must be released from memory before an index can be dropped.
   * @route POST /indexes/drop
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection the index belongs to."}
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"description":"Name of the index to drop."}
   * @returns {Object}
   * @sampleResult {}
   */
  async dropIndex(collectionName, indexName) {
    return this.#apiRequest({
      path: '/indexes/drop',
      body: { collectionName, indexName },
      logTag: 'dropIndex',
    })
  }

  // ---------------------------------------------------------------------------
  // Partitions
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Partitions
   * @category Partitions
   * @description Retrieves the names of all partitions within a collection.
   * @route POST /partitions/list
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to list partitions for."}
   * @returns {Array<String>}
   * @sampleResult ["_default","2024"]
   */
  async listPartitions(collectionName) {
    return this.#apiRequest({
      path: '/partitions/list',
      body: { collectionName },
      logTag: 'listPartitions',
    })
  }

  /**
   * @operationName Create Partition
   * @category Partitions
   * @description Creates a new partition within a collection. Partitions let you group entities so that searches and inserts can be scoped to a subset of the data for better performance.
   * @route POST /partitions/create
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to create the partition in."}
   * @paramDef {"type":"String","label":"Partition Name","name":"partitionName","required":true,"description":"Name of the partition to create. Must be unique within the collection."}
   * @returns {Object}
   * @sampleResult {}
   */
  async createPartition(collectionName, partitionName) {
    return this.#apiRequest({
      path: '/partitions/create',
      body: { collectionName, partitionName },
      logTag: 'createPartition',
    })
  }

  /**
   * @operationName Drop Partition
   * @category Partitions
   * @description Permanently deletes a partition and all entities it contains from a collection. The partition must be released from memory before it can be dropped. This action cannot be undone.
   * @route POST /partitions/drop
   * @paramDef {"type":"String","label":"Collection Name","name":"collectionName","required":true,"dictionary":"getCollectionsDictionary","description":"Collection the partition belongs to."}
   * @paramDef {"type":"String","label":"Partition Name","name":"partitionName","required":true,"description":"Name of the partition to drop."}
   * @returns {Object}
   * @sampleResult {}
   */
  async dropPartition(collectionName, partitionName) {
    return this.#apiRequest({
      path: '/partitions/drop',
      body: { collectionName, partitionName },
      logTag: 'dropPartition',
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
   * @description Lists collections in the current database for selection in dependent parameters.
   * @route POST /get-collections-dictionary
   * @paramDef {"type":"getCollectionsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"documents","value":"documents"},{"label":"products","value":"products"}],"cursor":null}
   */
  async getCollectionsDictionary(payload) {
    const { search } = payload || {}

    const data = await this.#apiRequest({
      path: '/collections/list',
      body: {},
      logTag: 'getCollectionsDictionary',
    })

    let collections = Array.isArray(data) ? data : []

    if (search?.trim()) {
      const needle = search.toLowerCase()

      collections = collections.filter(name => String(name).toLowerCase().includes(needle))
    }

    return {
      items: collections
        .sort((a, b) => String(a).localeCompare(String(b)))
        .map(name => ({ label: name, value: name })),
      cursor: null,
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  #primaryFieldPlaceholder() {
    // Milvus delete-by-id is expressed as a filter on the primary key. The
    // default primary field name is "id" in quick-setup collections.
    return 'id'
  }

  #literal(value) {
    return typeof value === 'number' ? String(value) : `"${ String(value).replace(/"/g, '\\"') }"`
  }
}

Flowrunner.ServerCode.addService(Milvus, [
  {
    name: 'clusterEndpoint',
    displayName: 'Cluster Endpoint',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Zilliz Cloud cluster public endpoint (e.g. https://in03-xxxx.serverless.gcp-us-west1.cloud.zilliz.com) or a self-hosted Milvus REST endpoint (e.g. http://your-host:19530). Any trailing slash is stripped automatically.',
  },
  {
    name: 'token',
    displayName: 'Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Zilliz Cloud API key, or a "username:password" pair for a self-hosted Milvus instance. Sent as a Bearer token.',
  },
])
