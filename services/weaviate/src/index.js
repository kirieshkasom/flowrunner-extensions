'use strict'

const logger = {
  info: (...args) => console.log('[Weaviate] info:', ...args),
  debug: (...args) => console.log('[Weaviate] debug:', ...args),
  error: (...args) => console.log('[Weaviate] error:', ...args),
  warn: (...args) => console.log('[Weaviate] warn:', ...args),
}

// GraphQL keys whose string values are enums and must be emitted without quotes.
const GRAPHQL_ENUM_KEYS = new Set(['operator'])

// Property data types that cannot be selected as plain GraphQL scalar fields.
const NON_SCALAR_DATA_TYPES = new Set(['object', 'object[]', 'geoCoordinates', 'phoneNumber', 'blob'])

/**
 * @integrationName Weaviate
 * @integrationIcon /icon.png
 */
class Weaviate {
  /**
   * @param {Object} config
   * @param {String} config.url
   * @param {String} [config.apiKey]
   * @param {String} [config.inferenceApiKeys]
   */
  constructor(config) {
    this.url = (config.url || '').replace(/\/+$/, '')
    this.baseUrl = `${ this.url }/v1`
    this.apiKey = config.apiKey

    this.inferenceHeaders = {}

    if (config.inferenceApiKeys) {
      try {
        this.inferenceHeaders = JSON.parse(config.inferenceApiKeys)
      } catch (error) {
        throw new Error(
          'Invalid "Inference API Keys" configuration: must be a JSON object of header name/value pairs, ' +
          'e.g. {"X-OpenAI-Api-Key":"sk-..."}'
        )
      }
    }
  }

  /**
   * @param {Object} options
   * @param {String} options.url - Absolute URL
   * @param {String} [options.method] - HTTP method (get, post, put, patch, delete)
   * @param {Object} [options.body] - Request body
   * @param {Object} [options.query] - Query parameters
   * @param {String} options.logTag - Tag for logging
   * @returns {Promise<any>}
   */
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...this.inferenceHeaders,
      }

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${ this.apiKey }`
      }

      logger.debug(`${ logTag } - api request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method](url)
        .set(headers)
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.[0]?.message ||
        error.body?.message ||
        error.message ||
        'API request failed'

      logger.error(`${ logTag } - api request failed: ${ message }`)

      throw new Error(`Weaviate API error: ${ message }`)
    }
  }

  /**
   * Executes a GraphQL query and returns the "data" payload.
   * GraphQL can respond with HTTP 200 while still carrying errors — those are surfaced as thrown errors.
   */
  async #graphql(query, logTag) {
    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/graphql`,
      method: 'post',
      body: { query },
      logTag,
    })

    if (Array.isArray(response.errors) && response.errors.length) {
      const message = response.errors.map(item => item.message).join('; ')

      logger.error(`${ logTag } - graphql errors: ${ message }`)

      throw new Error(`Weaviate GraphQL error: ${ message }`)
    }

    return response.data || {}
  }

  /**
   * Serializes a plain JSON value into GraphQL argument syntax.
   * Object keys are emitted unquoted; string values of enum keys (e.g. "operator") are emitted unquoted.
   */
  #gqlSerialize(value, key) {
    if (value === null || value === undefined) {
      return 'null'
    }

    if (Array.isArray(value)) {
      return `[${ value.map(item => this.#gqlSerialize(item, key)).join(', ') }]`
    }

    if (typeof value === 'object') {
      const fields = Object.entries(value)
        .filter(([, fieldValue]) => fieldValue !== undefined)
        .map(([fieldKey, fieldValue]) => `${ fieldKey }: ${ this.#gqlSerialize(fieldValue, fieldKey) }`)

      return `{ ${ fields.join(', ') } }`
    }

    if (typeof value === 'string' && GRAPHQL_ENUM_KEYS.has(key)) {
      return value
    }

    return JSON.stringify(value)
  }

  /**
   * Resolves the list of properties to select in a GraphQL Get/search query.
   * Falls back to all scalar properties from the collection schema when none are provided.
   */
  async #resolveReturnProperties(className, returnProperties, logTag) {
    if (Array.isArray(returnProperties) && returnProperties.length) {
      return returnProperties
    }

    const schema = await this.#apiRequest({
      url: `${ this.baseUrl }/schema/${ encodeURIComponent(className) }`,
      method: 'get',
      logTag: `${ logTag }:resolveProperties`,
    })

    const properties = (schema.properties || [])
      .filter(property => {
        const dataType = property.dataType?.[0] || ''

        // Cross-references use capitalized collection names as data types and need sub-selections.
        return dataType && dataType[0] === dataType[0].toLowerCase() && !NON_SCALAR_DATA_TYPES.has(dataType)
      })
      .map(property => property.name)

    if (!properties.length) {
      throw new Error(
        `Collection "${ className }" has no scalar properties to return automatically. ` +
        'Specify the "Return Properties" parameter explicitly.'
      )
    }

    return properties
  }

  /**
   * Builds and executes a GraphQL Get search, returning the unwrapped result array for the collection.
   */
  async #runGetSearch({ className, clauses, limit, where, returnProperties, additionalFields, logTag }) {
    if (!className) {
      throw new Error('Collection name is required')
    }

    const args = []

    for (const [name, clause] of Object.entries(clauses || {})) {
      if (clause !== undefined) {
        args.push(`${ name }: ${ this.#gqlSerialize(clause, name) }`)
      }
    }

    if (where) {
      args.push(`where: ${ this.#gqlSerialize(where, 'where') }`)
    }

    if (limit !== undefined && limit !== null && limit !== '') {
      args.push(`limit: ${ Number(limit) }`)
    }

    const properties = await this.#resolveReturnProperties(className, returnProperties, logTag)
    const fields = [...properties]

    if (additionalFields.length) {
      fields.push(`_additional { ${ additionalFields.join(' ') } }`)
    }

    const argsBlock = args.length ? `(${ args.join(', ') })` : ''
    const query = `{ Get { ${ className }${ argsBlock } { ${ fields.join(' ') } } } }`

    const data = await this.#graphql(query, logTag)

    return data.Get?.[className] || []
  }

  #buildAdditionalFields({ includeId, includeVector, extraFields = [] }) {
    const fields = []

    if (includeId !== false) {
      fields.push('id')
    }

    fields.push(...extraFields)

    if (includeVector) {
      fields.push('vector')
    }

    return fields
  }

  // ==========================================================================
  // Collections
  // ==========================================================================

  /**
   * @operationName Create Collection
   * @category Collections
   * @description Creates a new collection (class) in the Weaviate schema. Optionally define a vectorizer module, typed properties, and advanced configuration (e.g. vectorIndexConfig, moduleConfig, replicationConfig) merged into the request body. If no properties are provided, Weaviate adds them automatically via auto-schema when objects are inserted.
   * @route POST /create-collection
   * @paramDef {"type":"String","label":"Collection Name","name":"className","required":true,"description":"Name of the collection to create. Must start with an uppercase letter (e.g. Article)."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Human-readable description of the collection."}
   * @paramDef {"type":"String","label":"Vectorizer","name":"vectorizer","description":"Vectorizer module for the collection, e.g. text2vec-openai, text2vec-cohere, text2vec-huggingface, or none to supply your own vectors. Omit to use the server default."}
   * @paramDef {"type":"Array<Object>","label":"Properties","name":"properties","description":"Property definitions passed through to Weaviate, e.g. [{\"name\":\"title\",\"dataType\":[\"text\"]},{\"name\":\"wordCount\",\"dataType\":[\"int\"]}]."}
   * @paramDef {"type":"Object","label":"Advanced Configuration","name":"advancedConfig","description":"Additional collection settings merged into the request body, e.g. {\"vectorIndexConfig\":{\"distance\":\"cosine\"},\"moduleConfig\":{\"text2vec-openai\":{\"model\":\"text-embedding-3-small\"}}}."}
   * @returns {Object}
   * @sampleResult {"class":"Article","description":"News articles","vectorizer":"text2vec-openai","properties":[{"name":"title","dataType":["text"]}]}
   */
  async createCollection(className, description, vectorizer, properties, advancedConfig) {
    const body = {
      class: className,
      ...(advancedConfig || {}),
    }

    if (description) {
      body.description = description
    }

    if (vectorizer) {
      body.vectorizer = vectorizer
    }

    if (Array.isArray(properties) && properties.length) {
      body.properties = properties
    }

    return this.#apiRequest({
      url: `${ this.baseUrl }/schema`,
      method: 'post',
      body,
      logTag: 'createCollection',
    })
  }

  /**
   * @operationName List Collections
   * @category Collections
   * @description Retrieves the full Weaviate schema, including every collection (class) with its properties, vectorizer, and module configuration.
   * @route GET /list-collections
   * @returns {Object}
   * @sampleResult {"classes":[{"class":"Article","description":"News articles","vectorizer":"text2vec-openai","properties":[{"name":"title","dataType":["text"]}]}]}
   */
  async listCollections() {
    return this.#apiRequest({
      url: `${ this.baseUrl }/schema`,
      method: 'get',
      logTag: 'listCollections',
    })
  }

  /**
   * @operationName Get Collection
   * @category Collections
   * @description Retrieves the schema definition of a single collection (class), including its properties, vectorizer, and index configuration.
   * @route GET /get-collection
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Name of the collection to retrieve."}
   * @returns {Object}
   * @sampleResult {"class":"Article","description":"News articles","vectorizer":"text2vec-openai","properties":[{"name":"title","dataType":["text"]}],"vectorIndexType":"hnsw"}
   */
  async getCollection(className) {
    return this.#apiRequest({
      url: `${ this.baseUrl }/schema/${ encodeURIComponent(className) }`,
      method: 'get',
      logTag: 'getCollection',
    })
  }

  /**
   * @operationName Delete Collection
   * @category Collections
   * @description Permanently deletes a collection (class) from the schema, including ALL objects stored in it. This action cannot be undone.
   * @route DELETE /delete-collection
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Name of the collection to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"className":"Article"}
   */
  async deleteCollection(className) {
    await this.#apiRequest({
      url: `${ this.baseUrl }/schema/${ encodeURIComponent(className) }`,
      method: 'delete',
      logTag: 'deleteCollection',
    })

    return { success: true, className }
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  /**
   * @operationName Create Object
   * @category Objects
   * @description Creates a single data object in a collection. If the collection uses a vectorizer module, the vector is generated automatically; otherwise supply the vector explicitly. Optionally provide a UUID to control the object ID (otherwise Weaviate generates one).
   * @route POST /create-object
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to create the object in."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"Object properties as key/value pairs, e.g. {\"title\":\"Hello\",\"wordCount\":120}."}
   * @paramDef {"type":"String","label":"Object ID","name":"id","description":"Optional UUID for the object. Weaviate generates one when omitted."}
   * @paramDef {"type":"Array<Number>","label":"Vector","name":"vector","description":"Optional embedding vector. Required when the collection has no vectorizer (vectorizer: none)."}
   * @returns {Object}
   * @sampleResult {"id":"df48b9f6-ba48-470c-bf6a-57657cb07390","class":"Article","properties":{"title":"Hello"},"creationTimeUnix":1720000000000}
   */
  async createObject(className, properties, id, vector) {
    const body = {
      class: className,
      properties: properties || {},
    }

    if (id) {
      body.id = id
    }

    if (Array.isArray(vector) && vector.length) {
      body.vector = vector.map(Number)
    }

    return this.#apiRequest({
      url: `${ this.baseUrl }/objects`,
      method: 'post',
      body,
      logTag: 'createObject',
    })
  }

  /**
   * @operationName Get Object
   * @category Objects
   * @description Retrieves a single data object by its collection and UUID, optionally including its stored embedding vector.
   * @route GET /get-object
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Collection the object belongs to."}
   * @paramDef {"type":"String","label":"Object ID","name":"id","required":true,"description":"UUID of the object to retrieve."}
   * @paramDef {"type":"Boolean","label":"Include Vector","name":"includeVector","uiComponent":{"type":"CHECKBOX"},"description":"Include the object's embedding vector in the response."}
   * @returns {Object}
   * @sampleResult {"id":"df48b9f6-ba48-470c-bf6a-57657cb07390","class":"Article","properties":{"title":"Hello"},"creationTimeUnix":1720000000000,"lastUpdateTimeUnix":1720000000000}
   */
  async getObject(className, id, includeVector) {
    return this.#apiRequest({
      url: `${ this.baseUrl }/objects/${ encodeURIComponent(className) }/${ encodeURIComponent(id) }`,
      method: 'get',
      query: includeVector ? { include: 'vector' } : undefined,
      logTag: 'getObject',
    })
  }

  /**
   * @operationName Update Object (Merge)
   * @category Objects
   * @description Partially updates an existing object by merging the provided properties into it (HTTP PATCH). Properties not included in the request keep their current values. If the collection uses a vectorizer, the vector is re-computed when affected text changes.
   * @route PATCH /update-object
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Collection the object belongs to."}
   * @paramDef {"type":"String","label":"Object ID","name":"id","required":true,"description":"UUID of the object to update."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"Properties to merge into the object, e.g. {\"title\":\"Updated title\"}."}
   * @paramDef {"type":"Array<Number>","label":"Vector","name":"vector","description":"Optional new embedding vector to store with the object."}
   * @returns {Object}
   * @sampleResult {"success":true,"id":"df48b9f6-ba48-470c-bf6a-57657cb07390"}
   */
  async updateObject(className, id, properties, vector) {
    const body = {
      class: className,
      properties: properties || {},
    }

    if (Array.isArray(vector) && vector.length) {
      body.vector = vector.map(Number)
    }

    await this.#apiRequest({
      url: `${ this.baseUrl }/objects/${ encodeURIComponent(className) }/${ encodeURIComponent(id) }`,
      method: 'patch',
      body,
      logTag: 'updateObject',
    })

    return { success: true, id }
  }

  /**
   * @operationName Replace Object
   * @category Objects
   * @description Replaces an existing object entirely (HTTP PUT). All previous properties are discarded and replaced with the provided ones. Use "Update Object (Merge)" to change only specific properties.
   * @route PUT /replace-object
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Collection the object belongs to."}
   * @paramDef {"type":"String","label":"Object ID","name":"id","required":true,"description":"UUID of the object to replace."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"Complete new set of properties for the object. Any property not listed here is removed."}
   * @paramDef {"type":"Array<Number>","label":"Vector","name":"vector","description":"Optional new embedding vector to store with the object."}
   * @returns {Object}
   * @sampleResult {"id":"df48b9f6-ba48-470c-bf6a-57657cb07390","class":"Article","properties":{"title":"Replaced"},"lastUpdateTimeUnix":1720000001000}
   */
  async replaceObject(className, id, properties, vector) {
    const body = {
      class: className,
      id,
      properties: properties || {},
    }

    if (Array.isArray(vector) && vector.length) {
      body.vector = vector.map(Number)
    }

    return this.#apiRequest({
      url: `${ this.baseUrl }/objects/${ encodeURIComponent(className) }/${ encodeURIComponent(id) }`,
      method: 'put',
      body,
      logTag: 'replaceObject',
    })
  }

  /**
   * @operationName Delete Object
   * @category Objects
   * @description Permanently deletes a single data object by its collection and UUID. This action cannot be undone.
   * @route DELETE /delete-object
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Collection the object belongs to."}
   * @paramDef {"type":"String","label":"Object ID","name":"id","required":true,"description":"UUID of the object to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"id":"df48b9f6-ba48-470c-bf6a-57657cb07390"}
   */
  async deleteObject(className, id) {
    await this.#apiRequest({
      url: `${ this.baseUrl }/objects/${ encodeURIComponent(className) }/${ encodeURIComponent(id) }`,
      method: 'delete',
      logTag: 'deleteObject',
    })

    return { success: true, id }
  }

  /**
   * @operationName List Objects
   * @category Objects
   * @description Lists data objects in a collection with cursor-based pagination. Pass the ID of the last object from the previous page as the "After" cursor to fetch the next page. The cursor requires the collection and limit to stay the same between calls.
   * @route GET /list-objects
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to list objects from."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of objects to return (server default is 25)."}
   * @paramDef {"type":"String","label":"After (Cursor)","name":"after","description":"ID of the last object from the previous page; returns objects after it."}
   * @paramDef {"type":"Boolean","label":"Include Vector","name":"includeVector","uiComponent":{"type":"CHECKBOX"},"description":"Include each object's embedding vector in the response."}
   * @returns {Object}
   * @sampleResult {"objects":[{"id":"df48b9f6-ba48-470c-bf6a-57657cb07390","class":"Article","properties":{"title":"Hello"}}],"totalResults":1}
   */
  async listObjects(className, limit, after, includeVector) {
    const query = { class: className }

    if (limit !== undefined && limit !== null && limit !== '') {
      query.limit = Number(limit)
    }

    if (after) {
      query.after = after
    }

    if (includeVector) {
      query.include = 'vector'
    }

    return this.#apiRequest({
      url: `${ this.baseUrl }/objects`,
      method: 'get',
      query,
      logTag: 'listObjects',
    })
  }

  /**
   * @operationName Batch Create Objects
   * @category Objects
   * @description Creates multiple data objects in a single batch request — much faster than creating them one by one. Each array item can be either a plain properties object (e.g. {"title":"Hello"}) or a full object shape with "properties" and optional "id" and "vector" keys. Returns per-object results including success or failure status.
   * @route POST /batch-create-objects
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to create the objects in. Applied to every object that does not specify its own class."}
   * @paramDef {"type":"Array<Object>","label":"Objects","name":"objects","required":true,"description":"Objects to create. Each item is either a plain properties object, or {\"properties\":{...},\"id\":\"uuid\",\"vector\":[...]}."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":"df48b9f6-ba48-470c-bf6a-57657cb07390","class":"Article","properties":{"title":"Hello"},"result":{"status":"SUCCESS"}}]
   */
  async batchCreateObjects(className, objects) {
    if (!Array.isArray(objects) || !objects.length) {
      throw new Error('The "Objects" parameter must be a non-empty array')
    }

    const normalized = objects.map(item => {
      const isFullShape = item && typeof item === 'object' && item.properties && typeof item.properties === 'object'
      const objectPayload = isFullShape ? { ...item } : { properties: item || {} }

      return {
        ...objectPayload,
        class: objectPayload.class || className,
      }
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/batch/objects`,
      method: 'post',
      body: { objects: normalized },
      logTag: 'batchCreateObjects',
    })
  }

  /**
   * @operationName Batch Delete Objects
   * @category Objects
   * @description Deletes all objects in a collection that match a where filter, in a single batch request. Use Dry Run to preview how many objects would be deleted without actually deleting them. Note: Weaviate limits batch deletes to 10,000 matches per call by default — repeat the call for larger deletions.
   * @route DELETE /batch-delete-objects
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to delete objects from."}
   * @paramDef {"type":"Object","label":"Where Filter","name":"where","required":true,"description":"GraphQL-style where filter selecting the objects to delete, e.g. {\"path\":[\"status\"],\"operator\":\"Equal\",\"valueText\":\"archived\"}. Nested And/Or filters are supported via \"operands\"."}
   * @paramDef {"type":"Boolean","label":"Dry Run","name":"dryRun","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, reports how many objects match without deleting anything."}
   * @returns {Object}
   * @sampleResult {"match":{"class":"Article","where":{"path":["status"],"operator":"Equal","valueText":"archived"}},"results":{"matches":3,"successful":3,"failed":0}}
   */
  async batchDeleteObjects(className, where, dryRun) {
    if (!where || typeof where !== 'object') {
      throw new Error('The "Where Filter" parameter is required for batch deletion')
    }

    const body = {
      match: {
        class: className,
        where,
      },
    }

    if (dryRun !== undefined) {
      body.dryRun = Boolean(dryRun)
    }

    return this.#apiRequest({
      url: `${ this.baseUrl }/batch/objects`,
      method: 'delete',
      body,
      logTag: 'batchDeleteObjects',
    })
  }

  // ==========================================================================
  // Search
  // ==========================================================================

  /**
   * @operationName Search (Vector)
   * @category Search
   * @description Performs a vector similarity search (nearVector) in a collection using an embedding you supply. Works with any collection, including those without a vectorizer module. Optionally restrict results with a maximum distance or minimum certainty (certainty applies to cosine distance only) and a where filter. When Return Properties is omitted, all scalar properties from the collection schema are returned.
   * @route POST /search-vector
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to search in."}
   * @paramDef {"type":"Array<Number>","label":"Vector","name":"vector","required":true,"description":"Query embedding vector. Must have the same dimensionality as the collection's vectors."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return (default 10)."}
   * @paramDef {"type":"Number","label":"Max Distance","name":"distance","description":"Only return results with a vector distance below this threshold (lower = more similar). Mutually exclusive with Min Certainty."}
   * @paramDef {"type":"Number","label":"Min Certainty","name":"certainty","description":"Only return results with certainty above this value (0-1, higher = more similar). Available for cosine distance only. Mutually exclusive with Max Distance."}
   * @paramDef {"type":"Object","label":"Where Filter","name":"where","description":"GraphQL-style where filter, e.g. {\"path\":[\"category\"],\"operator\":\"Equal\",\"valueText\":\"news\"}. Combine conditions with {\"operator\":\"And\",\"operands\":[...]}."}
   * @paramDef {"type":"Array<String>","label":"Return Properties","name":"returnProperties","description":"Property names to include in each result. Defaults to all scalar properties of the collection."}
   * @paramDef {"type":"Boolean","label":"Include ID","name":"includeId","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Include each result's UUID under _additional.id."}
   * @paramDef {"type":"Boolean","label":"Include Distance","name":"includeDistance","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Include the vector distance under _additional.distance."}
   * @paramDef {"type":"Boolean","label":"Include Vector","name":"includeVector","uiComponent":{"type":"CHECKBOX"},"description":"Include each result's embedding vector under _additional.vector."}
   * @returns {Array<Object>}
   * @sampleResult [{"title":"Hello","_additional":{"id":"df48b9f6-ba48-470c-bf6a-57657cb07390","distance":0.132}}]
   */
  async searchVector(className, vector, limit, distance, certainty, where, returnProperties, includeId, includeDistance, includeVector) {
    if (!Array.isArray(vector) || !vector.length) {
      throw new Error('The "Vector" parameter must be a non-empty array of numbers')
    }

    const nearVector = { vector: vector.map(Number) }

    if (distance !== undefined && distance !== null && distance !== '') {
      nearVector.distance = Number(distance)
    } else if (certainty !== undefined && certainty !== null && certainty !== '') {
      nearVector.certainty = Number(certainty)
    }

    return this.#runGetSearch({
      className,
      clauses: { nearVector },
      limit: limit || 10,
      where,
      returnProperties,
      additionalFields: this.#buildAdditionalFields({
        includeId,
        includeVector,
        extraFields: includeDistance !== false ? ['distance'] : [],
      }),
      logTag: 'searchVector',
    })
  }

  /**
   * @operationName Search (Text)
   * @category Search
   * @description Performs a semantic text search (nearText) in a collection. REQUIRES the collection to use a vectorizer module (e.g. text2vec-openai) — for external providers, set the module API key via the "Inference API Keys" configuration. Optionally restrict results with a maximum distance or minimum certainty and a where filter. When Return Properties is omitted, all scalar properties from the collection schema are returned.
   * @route POST /search-text
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to search in. Must have a vectorizer module configured."}
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Natural-language text to search for. Vectorized by the collection's vectorizer module."}
   * @paramDef {"type":"Array<String>","label":"Additional Concepts","name":"concepts","description":"Optional extra concepts combined with the query in the nearText clause."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return (default 10)."}
   * @paramDef {"type":"Number","label":"Max Distance","name":"distance","description":"Only return results with a vector distance below this threshold (lower = more similar). Mutually exclusive with Min Certainty."}
   * @paramDef {"type":"Number","label":"Min Certainty","name":"certainty","description":"Only return results with certainty above this value (0-1). Available for cosine distance only. Mutually exclusive with Max Distance."}
   * @paramDef {"type":"Object","label":"Where Filter","name":"where","description":"GraphQL-style where filter, e.g. {\"path\":[\"category\"],\"operator\":\"Equal\",\"valueText\":\"news\"}."}
   * @paramDef {"type":"Array<String>","label":"Return Properties","name":"returnProperties","description":"Property names to include in each result. Defaults to all scalar properties of the collection."}
   * @paramDef {"type":"Boolean","label":"Include ID","name":"includeId","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Include each result's UUID under _additional.id."}
   * @paramDef {"type":"Boolean","label":"Include Distance","name":"includeDistance","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Include the vector distance under _additional.distance."}
   * @paramDef {"type":"Boolean","label":"Include Vector","name":"includeVector","uiComponent":{"type":"CHECKBOX"},"description":"Include each result's embedding vector under _additional.vector."}
   * @returns {Array<Object>}
   * @sampleResult [{"title":"Hello","_additional":{"id":"df48b9f6-ba48-470c-bf6a-57657cb07390","distance":0.184}}]
   */
  async searchText(className, query, concepts, limit, distance, certainty, where, returnProperties, includeId, includeDistance, includeVector) {
    if (!query) {
      throw new Error('The "Query" parameter is required')
    }

    const allConcepts = [query, ...(Array.isArray(concepts) ? concepts : [])].filter(Boolean)
    const nearText = { concepts: allConcepts }

    if (distance !== undefined && distance !== null && distance !== '') {
      nearText.distance = Number(distance)
    } else if (certainty !== undefined && certainty !== null && certainty !== '') {
      nearText.certainty = Number(certainty)
    }

    return this.#runGetSearch({
      className,
      clauses: { nearText },
      limit: limit || 10,
      where,
      returnProperties,
      additionalFields: this.#buildAdditionalFields({
        includeId,
        includeVector,
        extraFields: includeDistance !== false ? ['distance'] : [],
      }),
      logTag: 'searchText',
    })
  }

  /**
   * @operationName Search (Keyword)
   * @category Search
   * @description Performs a keyword search using the BM25 ranking algorithm. Works on any collection without requiring a vectorizer. Optionally restrict the search to specific properties and filter results with a where filter. When Return Properties is omitted, all scalar properties from the collection schema are returned.
   * @route POST /search-keyword
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to search in."}
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Keyword query string ranked with BM25."}
   * @paramDef {"type":"Array<String>","label":"Search Properties","name":"properties","description":"Property names to search in. Boost a property with a caret weight, e.g. title^2. Defaults to all text properties."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return (default 10)."}
   * @paramDef {"type":"Object","label":"Where Filter","name":"where","description":"GraphQL-style where filter, e.g. {\"path\":[\"category\"],\"operator\":\"Equal\",\"valueText\":\"news\"}."}
   * @paramDef {"type":"Array<String>","label":"Return Properties","name":"returnProperties","description":"Property names to include in each result. Defaults to all scalar properties of the collection."}
   * @paramDef {"type":"Boolean","label":"Include ID","name":"includeId","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Include each result's UUID under _additional.id."}
   * @paramDef {"type":"Boolean","label":"Include Score","name":"includeScore","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Include the BM25 relevance score under _additional.score."}
   * @paramDef {"type":"Boolean","label":"Include Vector","name":"includeVector","uiComponent":{"type":"CHECKBOX"},"description":"Include each result's embedding vector under _additional.vector."}
   * @returns {Array<Object>}
   * @sampleResult [{"title":"Hello","_additional":{"id":"df48b9f6-ba48-470c-bf6a-57657cb07390","score":"2.581"}}]
   */
  async searchKeyword(className, query, properties, limit, where, returnProperties, includeId, includeScore, includeVector) {
    if (!query) {
      throw new Error('The "Query" parameter is required')
    }

    const bm25 = { query }

    if (Array.isArray(properties) && properties.length) {
      bm25.properties = properties
    }

    return this.#runGetSearch({
      className,
      clauses: { bm25 },
      limit: limit || 10,
      where,
      returnProperties,
      additionalFields: this.#buildAdditionalFields({
        includeId,
        includeVector,
        extraFields: includeScore !== false ? ['score'] : [],
      }),
      logTag: 'searchKeyword',
    })
  }

  /**
   * @operationName Search (Hybrid)
   * @category Search
   * @description Performs a hybrid search combining vector similarity and BM25 keyword ranking. Alpha controls the balance: 0 = pure keyword search, 1 = pure vector search (default 0.75). Without an explicit vector, the query text is vectorized by the collection's vectorizer module (set external module keys via the "Inference API Keys" configuration); supply a vector to use hybrid search on collections without a vectorizer. When Return Properties is omitted, all scalar properties from the collection schema are returned.
   * @route POST /search-hybrid
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to search in."}
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search text used for both the keyword and vector parts of the hybrid search."}
   * @paramDef {"type":"Number","label":"Alpha","name":"alpha","description":"Balance between keyword and vector search: 0 = pure BM25, 1 = pure vector (default 0.75)."}
   * @paramDef {"type":"Array<Number>","label":"Vector","name":"vector","description":"Optional explicit embedding vector for the vector part of the search. Required if the collection has no vectorizer."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return (default 10)."}
   * @paramDef {"type":"Object","label":"Where Filter","name":"where","description":"GraphQL-style where filter, e.g. {\"path\":[\"category\"],\"operator\":\"Equal\",\"valueText\":\"news\"}."}
   * @paramDef {"type":"Array<String>","label":"Return Properties","name":"returnProperties","description":"Property names to include in each result. Defaults to all scalar properties of the collection."}
   * @paramDef {"type":"Boolean","label":"Include ID","name":"includeId","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Include each result's UUID under _additional.id."}
   * @paramDef {"type":"Boolean","label":"Include Score","name":"includeScore","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Include the hybrid relevance score under _additional.score."}
   * @paramDef {"type":"Boolean","label":"Include Vector","name":"includeVector","uiComponent":{"type":"CHECKBOX"},"description":"Include each result's embedding vector under _additional.vector."}
   * @returns {Array<Object>}
   * @sampleResult [{"title":"Hello","_additional":{"id":"df48b9f6-ba48-470c-bf6a-57657cb07390","score":"0.879"}}]
   */
  async searchHybrid(className, query, alpha, vector, limit, where, returnProperties, includeId, includeScore, includeVector) {
    if (!query) {
      throw new Error('The "Query" parameter is required')
    }

    const hybrid = { query }

    if (alpha !== undefined && alpha !== null && alpha !== '') {
      hybrid.alpha = Number(alpha)
    }

    if (Array.isArray(vector) && vector.length) {
      hybrid.vector = vector.map(Number)
    }

    return this.#runGetSearch({
      className,
      clauses: { hybrid },
      limit: limit || 10,
      where,
      returnProperties,
      additionalFields: this.#buildAdditionalFields({
        includeId,
        includeVector,
        extraFields: includeScore !== false ? ['score'] : [],
      }),
      logTag: 'searchHybrid',
    })
  }

  /**
   * @operationName GraphQL Query (Raw)
   * @category Search
   * @description Executes an arbitrary GraphQL query against the Weaviate GraphQL endpoint — an escape hatch for advanced features not covered by the dedicated search operations (Explore, groupBy, cross-reference resolution, sort, autocut, etc.). Returns the raw "data" payload; GraphQL errors are surfaced as thrown errors even when the HTTP status is 200.
   * @route POST /graphql-query
   * @paramDef {"type":"String","label":"GraphQL Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full GraphQL query string, e.g. { Get { Article(limit: 5) { title _additional { id } } } }."}
   * @returns {Object}
   * @sampleResult {"Get":{"Article":[{"title":"Hello","_additional":{"id":"df48b9f6-ba48-470c-bf6a-57657cb07390"}}]}}
   */
  async graphqlQuery(query) {
    if (!query) {
      throw new Error('The "GraphQL Query" parameter is required')
    }

    return this.#graphql(query, 'graphqlQuery')
  }

  /**
   * @operationName Aggregate Count
   * @category Search
   * @description Counts the objects in a collection using a GraphQL Aggregate query, optionally restricted by a where filter. Useful for checking collection size or how many objects match a condition.
   * @route POST /aggregate-count
   * @paramDef {"type":"String","label":"Collection","name":"className","required":true,"dictionary":"getCollectionsDictionary","description":"Collection to count objects in."}
   * @paramDef {"type":"Object","label":"Where Filter","name":"where","description":"GraphQL-style where filter to count only matching objects, e.g. {\"path\":[\"status\"],\"operator\":\"Equal\",\"valueText\":\"published\"}."}
   * @returns {Object}
   * @sampleResult {"count":1250}
   */
  async aggregateCount(className, where) {
    const args = where ? `(where: ${ this.#gqlSerialize(where, 'where') })` : ''
    const query = `{ Aggregate { ${ className }${ args } { meta { count } } } }`

    const data = await this.#graphql(query, 'aggregateCount')
    const results = data.Aggregate?.[className] || []

    return { count: results[0]?.meta?.count ?? 0 }
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * @operationName Get Meta
   * @category Utilities
   * @description Retrieves metadata about the Weaviate instance, including the server version, hostname, and the enabled modules (vectorizers, rerankers, generative modules).
   * @route GET /get-meta
   * @returns {Object}
   * @sampleResult {"hostname":"http://[::]:8080","version":"1.30.1","modules":{"text2vec-openai":{"documentationHref":"https://platform.openai.com/docs/guides/embeddings","name":"OpenAI Module"}}}
   */
  async getMeta() {
    return this.#apiRequest({
      url: `${ this.baseUrl }/meta`,
      method: 'get',
      logTag: 'getMeta',
    })
  }

  /**
   * @operationName Check Liveness
   * @category Utilities
   * @description Checks whether the Weaviate instance is alive and ready to receive traffic via the readiness endpoint (/v1/.well-known/ready). Returns true when the instance is ready, false otherwise (unreachable or not ready).
   * @route GET /check-liveness
   * @returns {Boolean}
   * @sampleResult true
   */
  async checkLiveness() {
    try {
      await this.#apiRequest({
        url: `${ this.baseUrl }/.well-known/ready`,
        method: 'get',
        logTag: 'checkLiveness',
      })

      return true
    } catch (error) {
      logger.warn(`checkLiveness - instance not ready: ${ error.message }`)

      return false
    }
  }

  // ==========================================================================
  // Dictionaries
  // ==========================================================================

  /**
   * @typedef {Object} getCollectionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter collections by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The schema is returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Collections Dictionary
   * @description Provides a searchable list of collections (classes) from the Weaviate schema for selecting a collection in other operations.
   * @route POST /get-collections-dictionary
   * @paramDef {"type":"getCollectionsDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string used to filter collections by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Article","value":"Article","note":"News articles"}],"cursor":null}
   */
  async getCollectionsDictionary(payload) {
    const { search } = payload || {}

    const schema = await this.#apiRequest({
      url: `${ this.baseUrl }/schema`,
      method: 'get',
      logTag: 'getCollectionsDictionary',
    })

    let classes = schema.classes || []

    if (search) {
      const needle = search.toLowerCase()

      classes = classes.filter(item => item.class.toLowerCase().includes(needle))
    }

    return {
      items: classes.map(item => ({
        label: item.class,
        value: item.class,
        note: item.description || item.vectorizer || undefined,
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(Weaviate, [
  {
    name: 'url',
    displayName: 'Instance URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'REST endpoint of your Weaviate instance, e.g. https://your-cluster.weaviate.network or http://localhost:8080',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Weaviate API key, sent as an Authorization Bearer header. Leave empty for self-hosted instances with anonymous access enabled.',
  },
  {
    name: 'inferenceApiKeys',
    displayName: 'Inference API Keys',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.TEXT,
    required: false,
    shared: false,
    hint: 'Optional JSON object of vectorizer module API key headers merged into every request, e.g. {"X-OpenAI-Api-Key":"sk-...","X-Cohere-Api-Key":"..."}. Needed for Search (Text) and Search (Hybrid) on collections using external vectorizers.',
  },
])
