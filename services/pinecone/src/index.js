'use strict'

const CONTROL_PLANE_BASE_URL = 'https://api.pinecone.io'
const API_VERSION = '2025-10'

const DEFAULT_NAMESPACE = '__default__'
const DEFAULT_EMBEDDING_MODEL = 'multilingual-e5-large'
const DEFAULT_RERANK_MODEL = 'bge-reranker-v2-m3'

const METRIC_MAP = {
  'Cosine': 'cosine',
  'Euclidean': 'euclidean',
  'Dot Product': 'dotproduct',
}

const CLOUD_MAP = {
  'AWS': 'aws',
  'GCP': 'gcp',
  'Azure': 'azure',
}

const INPUT_TYPE_MAP = {
  'Query': 'query',
  'Passage': 'passage',
}

const DELETION_PROTECTION_MAP = {
  'Enabled': 'enabled',
  'Disabled': 'disabled',
}

const logger = {
  info: (...args) => console.log('[Pinecone] info:', ...args),
  debug: (...args) => console.log('[Pinecone] debug:', ...args),
  error: (...args) => console.log('[Pinecone] error:', ...args),
  warn: (...args) => console.log('[Pinecone] warn:', ...args),
}

/**
 * @integrationName Pinecone
 * @integrationIcon /icon.png
 */
class PineconeService {
  #indexHosts = {}

  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, headers, logTag }) {
    try {
      logger.debug(`${ logTag } - api request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Api-Key': this.apiKey,
          'X-Pinecone-API-Version': API_VERSION,
          'Content-Type': 'application/json',
          ...(headers || {}),
        })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.message || error.body?.message || error.message

      logger.error(`${ logTag } - api request failed: ${ message }`)

      throw new Error(`Pinecone API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #indexHost(indexName) {
    if (!indexName) {
      throw new Error('Index Name is required.')
    }

    if (!this.#indexHosts[indexName]) {
      const index = await this.#apiRequest({
        url: `${ CONTROL_PLANE_BASE_URL }/indexes/${ encodeURIComponent(indexName) }`,
        method: 'get',
        logTag: 'indexHost',
      })

      if (!index?.host) {
        throw new Error(`Unable to resolve the data-plane host for index "${ indexName }".`)
      }

      this.#indexHosts[indexName] = `https://${ index.host }`
    }

    return this.#indexHosts[indexName]
  }

  // ---------------------------------------------------------------------------
  // Indexes (control plane)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Index
   * @category Indexes
   * @description Creates a new serverless index with an explicit vector dimension and similarity metric. The index is created in the specified cloud provider and region. Optionally enables deletion protection and attaches custom tags. Index creation is asynchronous — use Describe Index to check when the index status becomes ready.
   * @route POST /create-index
   * @paramDef {"type":"String","label":"Index Name","name":"name","required":true,"description":"Name of the index to create. Must be lowercase alphanumeric with hyphens, up to 45 characters, and unique within the project."}
   * @paramDef {"type":"Number","label":"Dimension","name":"dimension","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Dimension of the vectors stored in the index (e.g. 1536 for OpenAI text-embedding-3-small, 1024 for multilingual-e5-large)."}
   * @paramDef {"type":"String","label":"Metric","name":"metric","defaultValue":"Cosine","uiComponent":{"type":"DROPDOWN","options":{"values":["Cosine","Euclidean","Dot Product"]}},"description":"Distance metric used for similarity search. Defaults to Cosine."}
   * @paramDef {"type":"String","label":"Cloud","name":"cloud","required":true,"defaultValue":"AWS","uiComponent":{"type":"DROPDOWN","options":{"values":["AWS","GCP","Azure"]}},"description":"Public cloud provider where the serverless index is hosted."}
   * @paramDef {"type":"String","label":"Region","name":"region","required":true,"description":"Cloud region for the index (e.g. us-east-1 for AWS, us-central1 for GCP, eastus2 for Azure)."}
   * @paramDef {"type":"Boolean","label":"Deletion Protection","name":"deletionProtection","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the index cannot be deleted until protection is turned off via Configure Index."}
   * @paramDef {"type":"Object","label":"Tags","name":"tags","description":"Optional custom tags as flat key-value string pairs (e.g. {\"environment\":\"production\"})."}
   * @returns {Object}
   * @sampleResult {"name":"docs-index","dimension":1536,"metric":"cosine","host":"docs-index-abc123.svc.aped-4627-b74a.pinecone.io","status":{"ready":false,"state":"Initializing"},"spec":{"serverless":{"cloud":"aws","region":"us-east-1"}},"deletion_protection":"disabled","vector_type":"dense"}
   */
  async createIndex(name, dimension, metric, cloud, region, deletionProtection, tags) {
    const body = {
      name,
      dimension: Number(dimension),
      metric: this.#resolveChoice(metric, METRIC_MAP) || 'cosine',
      spec: {
        serverless: {
          cloud: this.#resolveChoice(cloud, CLOUD_MAP),
          region,
        },
      },
    }

    if (deletionProtection !== undefined && deletionProtection !== null) {
      body.deletion_protection = deletionProtection ? 'enabled' : 'disabled'
    }

    if (tags && Object.keys(tags).length > 0) {
      body.tags = tags
    }

    return this.#apiRequest({
      url: `${ CONTROL_PLANE_BASE_URL }/indexes`,
      method: 'post',
      body,
      logTag: 'createIndex',
    })
  }

  /**
   * @operationName Create Index for Model
   * @category Indexes
   * @description Creates a serverless index with integrated embedding. Records upserted as raw text are automatically embedded with the specified hosted model (e.g. multilingual-e5-large, llama-text-embed-v2), so no external embedding step is needed. The field map tells Pinecone which record field contains the text to embed. Use Upsert Records and Search Records with indexes created this way.
   * @route POST /create-index-for-model
   * @paramDef {"type":"String","label":"Index Name","name":"name","required":true,"description":"Name of the index to create. Must be lowercase alphanumeric with hyphens, up to 45 characters, and unique within the project."}
   * @paramDef {"type":"String","label":"Cloud","name":"cloud","required":true,"defaultValue":"AWS","uiComponent":{"type":"DROPDOWN","options":{"values":["AWS","GCP","Azure"]}},"description":"Public cloud provider where the serverless index is hosted."}
   * @paramDef {"type":"String","label":"Region","name":"region","required":true,"description":"Cloud region for the index (e.g. us-east-1 for AWS, us-central1 for GCP, eastus2 for Azure)."}
   * @paramDef {"type":"String","label":"Embedding Model","name":"embedModel","required":true,"defaultValue":"multilingual-e5-large","description":"Hosted embedding model integrated with the index (e.g. multilingual-e5-large, llama-text-embed-v2, pinecone-sparse-english-v0)."}
   * @paramDef {"type":"String","label":"Text Field","name":"textField","required":true,"defaultValue":"text","description":"Name of the record field that holds the text to embed (mapped to the model input, e.g. \"chunk_text\")."}
   * @paramDef {"type":"String","label":"Metric","name":"metric","uiComponent":{"type":"DROPDOWN","options":{"values":["Cosine","Euclidean","Dot Product"]}},"description":"Optional distance metric override. If omitted, the model's default metric is used."}
   * @paramDef {"type":"Object","label":"Additional Embed Config","name":"embedConfig","description":"Optional additional embed settings passed through to the API, such as read_parameters and write_parameters (e.g. {\"write_parameters\":{\"input_type\":\"passage\"}})."}
   * @returns {Object}
   * @sampleResult {"name":"docs-integrated","dimension":1024,"metric":"cosine","host":"docs-integrated-abc123.svc.aped-4627-b74a.pinecone.io","status":{"ready":false,"state":"Initializing"},"embed":{"model":"multilingual-e5-large","field_map":{"text":"chunk_text"}},"spec":{"serverless":{"cloud":"aws","region":"us-east-1"}},"vector_type":"dense"}
   */
  async createIndexForModel(name, cloud, region, embedModel, textField, metric, embedConfig) {
    const embed = {
      model: embedModel || DEFAULT_EMBEDDING_MODEL,
      field_map: { text: textField || 'text' },
      ...(embedConfig || {}),
    }

    const resolvedMetric = this.#resolveChoice(metric, METRIC_MAP)

    if (resolvedMetric) {
      embed.metric = resolvedMetric
    }

    return this.#apiRequest({
      url: `${ CONTROL_PLANE_BASE_URL }/indexes/create-for-model`,
      method: 'post',
      body: {
        name,
        cloud: this.#resolveChoice(cloud, CLOUD_MAP),
        region,
        embed,
      },
      logTag: 'createIndexForModel',
    })
  }

  /**
   * @operationName List Indexes
   * @category Indexes
   * @description Retrieves all indexes in the project, including each index's name, dimension, metric, data-plane host, status and spec.
   * @route GET /list-indexes
   * @returns {Object}
   * @sampleResult {"indexes":[{"name":"docs-index","dimension":1536,"metric":"cosine","host":"docs-index-abc123.svc.aped-4627-b74a.pinecone.io","status":{"ready":true,"state":"Ready"},"spec":{"serverless":{"cloud":"aws","region":"us-east-1"}},"deletion_protection":"disabled","vector_type":"dense"}]}
   */
  async listIndexes() {
    return this.#apiRequest({
      url: `${ CONTROL_PLANE_BASE_URL }/indexes`,
      method: 'get',
      logTag: 'listIndexes',
    })
  }

  /**
   * @operationName Describe Index
   * @category Indexes
   * @description Retrieves the full configuration and current status of an index, including its data-plane host, dimension, metric, spec, deletion protection setting and tags. Check status.ready to determine whether a newly created index is available.
   * @route GET /describe-index
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to describe."}
   * @returns {Object}
   * @sampleResult {"name":"docs-index","dimension":1536,"metric":"cosine","host":"docs-index-abc123.svc.aped-4627-b74a.pinecone.io","status":{"ready":true,"state":"Ready"},"spec":{"serverless":{"cloud":"aws","region":"us-east-1"}},"deletion_protection":"disabled","tags":{"environment":"production"},"vector_type":"dense"}
   */
  async describeIndex(indexName) {
    return this.#apiRequest({
      url: `${ CONTROL_PLANE_BASE_URL }/indexes/${ encodeURIComponent(indexName) }`,
      method: 'get',
      logTag: 'describeIndex',
    })
  }

  /**
   * @operationName Configure Index
   * @category Indexes
   * @description Updates the configuration of an existing index. Supports toggling deletion protection and replacing custom tags. To remove a tag, set its value to an empty string.
   * @route PATCH /configure-index
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to configure."}
   * @paramDef {"type":"String","label":"Deletion Protection","name":"deletionProtection","uiComponent":{"type":"DROPDOWN","options":{"values":["Enabled","Disabled"]}},"description":"When enabled, the index cannot be deleted. Leave empty to keep the current setting."}
   * @paramDef {"type":"Object","label":"Tags","name":"tags","description":"Custom tags to set as flat key-value string pairs. Set a tag's value to an empty string to remove it. Leave empty to keep current tags."}
   * @returns {Object}
   * @sampleResult {"name":"docs-index","dimension":1536,"metric":"cosine","host":"docs-index-abc123.svc.aped-4627-b74a.pinecone.io","status":{"ready":true,"state":"Ready"},"spec":{"serverless":{"cloud":"aws","region":"us-east-1"}},"deletion_protection":"enabled","tags":{"environment":"production"},"vector_type":"dense"}
   */
  async configureIndex(indexName, deletionProtection, tags) {
    const body = {}

    const resolvedProtection = this.#resolveChoice(deletionProtection, DELETION_PROTECTION_MAP)

    if (resolvedProtection) {
      body.deletion_protection = resolvedProtection
    }

    if (tags && Object.keys(tags).length > 0) {
      body.tags = tags
    }

    if (Object.keys(body).length === 0) {
      throw new Error('Configure Index requires at least one of Deletion Protection or Tags.')
    }

    return this.#apiRequest({
      url: `${ CONTROL_PLANE_BASE_URL }/indexes/${ encodeURIComponent(indexName) }`,
      method: 'patch',
      body,
      logTag: 'configureIndex',
    })
  }

  /**
   * @operationName Delete Index
   * @category Indexes
   * @description Permanently deletes an index and all of its data. This action cannot be undone. Fails if deletion protection is enabled on the index — disable it first via Configure Index.
   * @route DELETE /delete-index
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"indexName":"docs-index"}
   */
  async deleteIndex(indexName) {
    await this.#apiRequest({
      url: `${ CONTROL_PLANE_BASE_URL }/indexes/${ encodeURIComponent(indexName) }`,
      method: 'delete',
      logTag: 'deleteIndex',
    })

    delete this.#indexHosts[indexName]

    return { success: true, indexName }
  }

  // ---------------------------------------------------------------------------
  // Vectors (data plane)
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} VectorRecord
   * @paramDef {"type":"String","label":"ID","name":"id","required":true,"description":"Unique vector ID within the namespace."}
   * @paramDef {"type":"Array<Number>","label":"Values","name":"values","required":true,"description":"Dense vector values. Length must match the index dimension."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Optional flat metadata object (strings, numbers, booleans, or lists of strings) attached to the vector for filtering."}
   * @paramDef {"type":"Object","label":"Sparse Values","name":"sparseValues","description":"Optional sparse vector data as {\"indices\":[Number],\"values\":[Number]} for hybrid search indexes."}
   */

  /**
   * @operationName Upsert Vectors
   * @category Vectors
   * @description Writes vectors into a namespace of an index. If a vector ID already exists, its values and metadata are overwritten. Up to 1000 vectors (2MB max) per request. Upserts are eventually consistent — use Describe Index Stats to confirm freshness.
   * @route POST /upsert-vectors
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the target index."}
   * @paramDef {"type":"Array<VectorRecord>","label":"Vectors","name":"vectors","required":true,"description":"Vectors to upsert. Each entry needs an id and values matching the index dimension; metadata and sparseValues are optional."}
   * @paramDef {"type":"String","label":"Namespace","name":"namespace","dictionary":"getNamespacesDictionary","dependsOn":["indexName"],"description":"Namespace to write into. Defaults to the index's default namespace."}
   * @returns {Object}
   * @sampleResult {"upsertedCount":3}
   */
  async upsertVectors(indexName, vectors, namespace) {
    if (!Array.isArray(vectors) || vectors.length === 0) {
      throw new Error('Vectors must be a non-empty array.')
    }

    const host = await this.#indexHost(indexName)

    return this.#apiRequest({
      url: `${ host }/vectors/upsert`,
      method: 'post',
      body: {
        vectors,
        ...(namespace ? { namespace } : {}),
      },
      logTag: 'upsertVectors',
    })
  }

  /**
   * @operationName Query Vectors
   * @category Vectors
   * @description Searches a namespace for the vectors most similar to a query vector or to an existing vector referenced by ID. Provide either Query Vector values or a Vector ID (not both). Supports metadata filtering and returns up to Top K matches with similarity scores.
   * @route POST /query-vectors
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to query."}
   * @paramDef {"type":"Array<Number>","label":"Query Vector","name":"vector","description":"Dense query vector values. Length must match the index dimension. Mutually exclusive with Vector ID."}
   * @paramDef {"type":"String","label":"Vector ID","name":"id","description":"ID of an existing vector to use as the query. Mutually exclusive with Query Vector."}
   * @paramDef {"type":"Number","label":"Top K","name":"topK","defaultValue":10,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of most similar results to return (max 10000). Defaults to 10."}
   * @paramDef {"type":"Object","label":"Metadata Filter","name":"filter","description":"Optional metadata filter using Pinecone's MongoDB-style operators (e.g. {\"genre\":{\"$eq\":\"drama\"}})."}
   * @paramDef {"type":"Boolean","label":"Include Metadata","name":"includeMetadata","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether to include each match's metadata in the response. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Include Values","name":"includeValues","uiComponent":{"type":"TOGGLE"},"description":"Whether to include each match's vector values in the response. Defaults to false."}
   * @paramDef {"type":"String","label":"Namespace","name":"namespace","dictionary":"getNamespacesDictionary","dependsOn":["indexName"],"description":"Namespace to query. Defaults to the index's default namespace."}
   * @returns {Object}
   * @sampleResult {"matches":[{"id":"doc-1","score":0.92,"metadata":{"title":"Getting Started"}}],"namespace":"__default__","usage":{"readUnits":5}}
   */
  async queryVectors(indexName, vector, id, topK, filter, includeMetadata, includeValues, namespace) {
    const hasVector = Array.isArray(vector) && vector.length > 0

    if (!hasVector && !id) {
      throw new Error('Provide either Query Vector values or a Vector ID.')
    }

    if (hasVector && id) {
      throw new Error('Provide either Query Vector values or a Vector ID, not both.')
    }

    const host = await this.#indexHost(indexName)

    const body = {
      topK: topK !== undefined && topK !== null && topK !== '' ? Number(topK) : 10,
      includeMetadata: includeMetadata !== false,
      includeValues: includeValues === true,
    }

    if (hasVector) {
      body.vector = vector.map(Number)
    } else {
      body.id = id
    }

    if (filter && Object.keys(filter).length > 0) {
      body.filter = filter
    }

    if (namespace) {
      body.namespace = namespace
    }

    return this.#apiRequest({
      url: `${ host }/query`,
      method: 'post',
      body,
      logTag: 'queryVectors',
    })
  }

  /**
   * @operationName Fetch Vectors
   * @category Vectors
   * @description Looks up vectors by ID from a namespace and returns their values and metadata. Up to 100 IDs per request.
   * @route GET /fetch-vectors
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to fetch from."}
   * @paramDef {"type":"Array<String>","label":"Vector IDs","name":"ids","required":true,"description":"IDs of the vectors to fetch (up to 100)."}
   * @paramDef {"type":"String","label":"Namespace","name":"namespace","dictionary":"getNamespacesDictionary","dependsOn":["indexName"],"description":"Namespace to fetch from. Defaults to the index's default namespace."}
   * @returns {Object}
   * @sampleResult {"vectors":{"doc-1":{"id":"doc-1","values":[0.12,0.34],"metadata":{"title":"Getting Started"}}},"namespace":"__default__","usage":{"readUnits":1}}
   */
  async fetchVectors(indexName, ids, namespace) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('Vector IDs must be a non-empty array.')
    }

    const host = await this.#indexHost(indexName)

    return this.#apiRequest({
      url: `${ host }/vectors/fetch`,
      method: 'get',
      query: {
        ids,
        ...(namespace ? { namespace } : {}),
      },
      logTag: 'fetchVectors',
    })
  }

  /**
   * @operationName Update Vector
   * @category Vectors
   * @description Updates an existing vector by ID in a namespace. Can replace the vector values and/or merge new metadata fields into the existing metadata (setMetadata performs a shallow merge; fields not mentioned are preserved).
   * @route POST /update-vector
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index containing the vector."}
   * @paramDef {"type":"String","label":"Vector ID","name":"id","required":true,"description":"ID of the vector to update."}
   * @paramDef {"type":"Array<Number>","label":"New Values","name":"values","description":"Optional replacement vector values. Length must match the index dimension."}
   * @paramDef {"type":"Object","label":"Set Metadata","name":"setMetadata","description":"Optional metadata fields to set on the vector. Merged with existing metadata; listed fields are overwritten."}
   * @paramDef {"type":"String","label":"Namespace","name":"namespace","dictionary":"getNamespacesDictionary","dependsOn":["indexName"],"description":"Namespace containing the vector. Defaults to the index's default namespace."}
   * @returns {Object}
   * @sampleResult {"success":true,"id":"doc-1"}
   */
  async updateVector(indexName, id, values, setMetadata, namespace) {
    const hasValues = Array.isArray(values) && values.length > 0
    const hasMetadata = setMetadata && Object.keys(setMetadata).length > 0

    if (!hasValues && !hasMetadata) {
      throw new Error('Provide New Values and/or Set Metadata to update the vector.')
    }

    const host = await this.#indexHost(indexName)

    await this.#apiRequest({
      url: `${ host }/vectors/update`,
      method: 'post',
      body: {
        id,
        ...(hasValues ? { values: values.map(Number) } : {}),
        ...(hasMetadata ? { setMetadata } : {}),
        ...(namespace ? { namespace } : {}),
      },
      logTag: 'updateVector',
    })

    return { success: true, id }
  }

  /**
   * @operationName Delete Vectors
   * @category Vectors
   * @description Deletes vectors from a namespace by explicit IDs, by metadata filter, or all vectors in the namespace when Delete All is enabled. Exactly one selection method should be used per request. Deleting by filter is only supported on indexes that allow metadata-filtered deletes.
   * @route DELETE /delete-vectors
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to delete from."}
   * @paramDef {"type":"Array<String>","label":"Vector IDs","name":"ids","description":"IDs of the vectors to delete (up to 1000). Leave empty when using Delete All or a Metadata Filter."}
   * @paramDef {"type":"Boolean","label":"Delete All","name":"deleteAll","uiComponent":{"type":"TOGGLE"},"description":"When enabled, deletes ALL vectors in the namespace. Use with caution."}
   * @paramDef {"type":"Object","label":"Metadata Filter","name":"filter","description":"Optional metadata filter selecting the vectors to delete (e.g. {\"genre\":{\"$eq\":\"drama\"}})."}
   * @paramDef {"type":"String","label":"Namespace","name":"namespace","dictionary":"getNamespacesDictionary","dependsOn":["indexName"],"description":"Namespace to delete from. Defaults to the index's default namespace."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteVectors(indexName, ids, deleteAll, filter, namespace) {
    const hasIds = Array.isArray(ids) && ids.length > 0
    const hasFilter = filter && Object.keys(filter).length > 0

    if (!hasIds && !deleteAll && !hasFilter) {
      throw new Error('Provide Vector IDs, a Metadata Filter, or enable Delete All.')
    }

    const host = await this.#indexHost(indexName)

    await this.#apiRequest({
      url: `${ host }/vectors/delete`,
      method: 'post',
      body: {
        ...(hasIds ? { ids } : {}),
        ...(deleteAll === true ? { deleteAll: true } : {}),
        ...(hasFilter ? { filter } : {}),
        ...(namespace ? { namespace } : {}),
      },
      logTag: 'deleteVectors',
    })

    return { success: true }
  }

  /**
   * @operationName List Vector IDs
   * @category Vectors
   * @description Lists the IDs of vectors in a namespace of a serverless index, optionally filtered by an ID prefix. Results are paginated — pass the returned pagination token to fetch the next page. Useful for iterating over hierarchical IDs like "doc1#chunk1".
   * @route GET /list-vector-ids
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the serverless index to list from."}
   * @paramDef {"type":"String","label":"ID Prefix","name":"prefix","description":"Optional prefix to filter vector IDs (e.g. \"doc1#\" to list all chunks of doc1)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of IDs to return per page (max 100). Defaults to 100."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","description":"Token from a previous response's pagination.next to continue listing."}
   * @paramDef {"type":"String","label":"Namespace","name":"namespace","dictionary":"getNamespacesDictionary","dependsOn":["indexName"],"description":"Namespace to list from. Defaults to the index's default namespace."}
   * @returns {Object}
   * @sampleResult {"vectors":[{"id":"doc1#chunk1"},{"id":"doc1#chunk2"}],"pagination":{"next":"Tm90aGluZyB0byBzZWUgaGVyZQo="},"namespace":"__default__","usage":{"readUnits":1}}
   */
  async listVectorIds(indexName, prefix, limit, paginationToken, namespace) {
    const host = await this.#indexHost(indexName)

    const query = {}

    if (prefix) query.prefix = prefix
    if (limit !== undefined && limit !== null && limit !== '') query.limit = Number(limit)
    if (paginationToken) query.paginationToken = paginationToken
    if (namespace) query.namespace = namespace

    return this.#apiRequest({
      url: `${ host }/vectors/list`,
      method: 'get',
      query,
      logTag: 'listVectorIds',
    })
  }

  /**
   * @operationName Describe Index Stats
   * @category Vectors
   * @description Returns statistics about the contents of an index, including the total vector count, index fullness, dimension, and a per-namespace breakdown of vector counts. An optional metadata filter restricts the stats to matching vectors (not supported on serverless indexes).
   * @route POST /describe-index-stats
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to inspect."}
   * @paramDef {"type":"Object","label":"Metadata Filter","name":"filter","description":"Optional metadata filter to compute stats for matching vectors only. Not supported on serverless indexes."}
   * @returns {Object}
   * @sampleResult {"namespaces":{"__default__":{"vectorCount":1500},"products":{"vectorCount":320}},"dimension":1536,"indexFullness":0,"totalVectorCount":1820}
   */
  async describeIndexStats(indexName, filter) {
    const host = await this.#indexHost(indexName)

    const body = filter && Object.keys(filter).length > 0 ? { filter } : {}

    return this.#apiRequest({
      url: `${ host }/describe_index_stats`,
      method: 'post',
      body,
      logTag: 'describeIndexStats',
    })
  }

  // ---------------------------------------------------------------------------
  // Records (integrated embedding)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Upsert Records
   * @category Records
   * @description Writes text records into a namespace of an index with integrated embedding. Each record's text field (as configured in the index field map, e.g. "text" or "chunk_text") is automatically embedded by the index's hosted model — no separate embedding step required. Each record must include an "_id" (or "id") field; all other fields are stored as metadata. Only supported on indexes created via Create Index for Model.
   * @route POST /upsert-records
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the target index. Must have integrated embedding configured."}
   * @paramDef {"type":"Array<Object>","label":"Records","name":"records","required":true,"description":"Records to upsert. Each needs \"_id\" (or \"id\") and the text field configured in the index field map (e.g. {\"_id\":\"doc-1\",\"text\":\"Pinecone is a vector database\",\"category\":\"docs\"})."}
   * @paramDef {"type":"String","label":"Namespace","name":"namespace","dictionary":"getNamespacesDictionary","dependsOn":["indexName"],"description":"Namespace to write into. Defaults to the index's default namespace (__default__)."}
   * @returns {Object}
   * @sampleResult {"success":true,"upsertedCount":2,"namespace":"__default__"}
   */
  async upsertRecords(indexName, records, namespace) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Records must be a non-empty array.')
    }

    const host = await this.#indexHost(indexName)
    const targetNamespace = namespace || DEFAULT_NAMESPACE
    const ndjson = records.map(record => JSON.stringify(record)).join('\n')

    await this.#apiRequest({
      url: `${ host }/records/namespaces/${ encodeURIComponent(targetNamespace) }/upsert`,
      method: 'post',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body: ndjson,
      logTag: 'upsertRecords',
    })

    return { success: true, upsertedCount: records.length, namespace: targetNamespace }
  }

  /**
   * @operationName Search Records
   * @category Records
   * @description Performs a semantic text search over a namespace of an index with integrated embedding. The query text is embedded automatically and matched against stored records. Optionally reranks the initial results with a hosted reranking model (e.g. bge-reranker-v2-m3, pinecone-rerank-v0) for higher relevance. Only supported on indexes created via Create Index for Model.
   * @route POST /search-records
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to search. Must have integrated embedding configured."}
   * @paramDef {"type":"String","label":"Query Text","name":"queryText","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Natural-language query text. It is embedded automatically with the index's integrated model."}
   * @paramDef {"type":"Number","label":"Top K","name":"topK","defaultValue":10,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to return. Defaults to 10."}
   * @paramDef {"type":"Object","label":"Metadata Filter","name":"filter","description":"Optional metadata filter using Pinecone's MongoDB-style operators (e.g. {\"category\":{\"$eq\":\"docs\"}})."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Optional list of record fields to include in each hit (e.g. [\"text\",\"category\"]). By default all fields are returned."}
   * @paramDef {"type":"String","label":"Rerank Model","name":"rerankModel","description":"Optional hosted reranking model to rerank the initial results (e.g. bge-reranker-v2-m3, pinecone-rerank-v0, cohere-rerank-3.5). Leave empty to skip reranking."}
   * @paramDef {"type":"Number","label":"Rerank Top N","name":"rerankTopN","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of reranked results to return. Must be less than or equal to Top K. Defaults to Top K."}
   * @paramDef {"type":"Array<String>","label":"Rank Fields","name":"rankFields","description":"Record fields the reranker should evaluate (e.g. [\"text\"]). Defaults to the index's mapped text field when reranking is enabled."}
   * @paramDef {"type":"String","label":"Namespace","name":"namespace","dictionary":"getNamespacesDictionary","dependsOn":["indexName"],"description":"Namespace to search. Defaults to the index's default namespace (__default__)."}
   * @returns {Object}
   * @sampleResult {"result":{"hits":[{"_id":"doc-1","_score":0.87,"fields":{"text":"Pinecone is a vector database","category":"docs"}}]},"usage":{"readUnits":5,"embedTotalTokens":9}}
   */
  async searchRecords(indexName, queryText, topK, filter, fields, rerankModel, rerankTopN, rankFields, namespace) {
    if (!queryText) {
      throw new Error('Query Text is required.')
    }

    const host = await this.#indexHost(indexName)
    const targetNamespace = namespace || DEFAULT_NAMESPACE
    const resolvedTopK = topK !== undefined && topK !== null && topK !== '' ? Number(topK) : 10

    const body = {
      query: {
        top_k: resolvedTopK,
        inputs: { text: queryText },
      },
    }

    if (filter && Object.keys(filter).length > 0) {
      body.query.filter = filter
    }

    if (Array.isArray(fields) && fields.length > 0) {
      body.fields = fields
    }

    if (rerankModel) {
      body.rerank = {
        model: rerankModel,
        top_n: rerankTopN !== undefined && rerankTopN !== null && rerankTopN !== ''
          ? Number(rerankTopN)
          : resolvedTopK,
      }

      if (Array.isArray(rankFields) && rankFields.length > 0) {
        body.rerank.rank_fields = rankFields
      }
    }

    return this.#apiRequest({
      url: `${ host }/records/namespaces/${ encodeURIComponent(targetNamespace) }/search`,
      method: 'post',
      body,
      logTag: 'searchRecords',
    })
  }

  // ---------------------------------------------------------------------------
  // Namespaces
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Namespaces
   * @category Namespaces
   * @description Lists the namespaces in a serverless index along with each namespace's record count. Results are paginated in sorted order — pass the returned pagination token to fetch the next page.
   * @route GET /list-namespaces
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the serverless index."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of namespaces to return per page. Defaults to 100."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","description":"Token from a previous response's pagination.next to continue listing."}
   * @returns {Object}
   * @sampleResult {"namespaces":[{"name":"__default__","record_count":1500},{"name":"products","record_count":320}],"pagination":{"next":"Tm90aGluZyB0byBzZWUgaGVyZQo="}}
   */
  async listNamespaces(indexName, limit, paginationToken) {
    const host = await this.#indexHost(indexName)

    const query = {}

    if (limit !== undefined && limit !== null && limit !== '') query.limit = Number(limit)
    if (paginationToken) query.paginationToken = paginationToken

    return this.#apiRequest({
      url: `${ host }/namespaces`,
      method: 'get',
      query,
      logTag: 'listNamespaces',
    })
  }

  /**
   * @operationName Delete Namespace
   * @category Namespaces
   * @description Permanently deletes a namespace from a serverless index, including all vectors it contains. This action cannot be undone.
   * @route DELETE /delete-namespace
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"dictionary":"getIndexesDictionary","description":"Name of the serverless index containing the namespace."}
   * @paramDef {"type":"String","label":"Namespace","name":"namespace","required":true,"dictionary":"getNamespacesDictionary","dependsOn":["indexName"],"description":"Name of the namespace to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"namespace":"products"}
   */
  async deleteNamespace(indexName, namespace) {
    if (!namespace) {
      throw new Error('Namespace is required.')
    }

    const host = await this.#indexHost(indexName)

    await this.#apiRequest({
      url: `${ host }/namespaces/${ encodeURIComponent(namespace) }`,
      method: 'delete',
      logTag: 'deleteNamespace',
    })

    return { success: true, namespace }
  }

  // ---------------------------------------------------------------------------
  // Inference (control plane)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Embeddings
   * @category Inference
   * @description Generates vector embeddings for input texts using a Pinecone-hosted embedding model (e.g. multilingual-e5-large, llama-text-embed-v2). Set Input Type to Passage when embedding documents for storage and to Query when embedding search queries. Up to 96 inputs per request for most models.
   * @route POST /create-embeddings
   * @paramDef {"type":"String","label":"Model","name":"model","defaultValue":"multilingual-e5-large","description":"Hosted embedding model to use (e.g. multilingual-e5-large, llama-text-embed-v2, pinecone-sparse-english-v0). Defaults to multilingual-e5-large."}
   * @paramDef {"type":"Array<String>","label":"Inputs","name":"inputs","required":true,"description":"Texts to embed."}
   * @paramDef {"type":"String","label":"Input Type","name":"inputType","defaultValue":"Passage","uiComponent":{"type":"DROPDOWN","options":{"values":["Query","Passage"]}},"description":"How the model treats the inputs: Passage for documents being stored, Query for search queries. Defaults to Passage."}
   * @paramDef {"type":"String","label":"Truncate","name":"truncate","defaultValue":"End","uiComponent":{"type":"DROPDOWN","options":{"values":["End","None"]}},"description":"How to handle inputs longer than the model's context: End truncates the end of the text, None returns an error for oversized inputs. Defaults to End."}
   * @returns {Object}
   * @sampleResult {"model":"multilingual-e5-large","vector_type":"dense","data":[{"values":[0.0123,-0.0456],"vector_type":"dense"}],"usage":{"total_tokens":18}}
   */
  async createEmbeddings(model, inputs, inputType, truncate) {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new Error('Inputs must be a non-empty array of texts.')
    }

    return this.#apiRequest({
      url: `${ CONTROL_PLANE_BASE_URL }/embed`,
      method: 'post',
      body: {
        model: model || DEFAULT_EMBEDDING_MODEL,
        inputs: inputs.map(text => ({ text: String(text) })),
        parameters: {
          input_type: this.#resolveChoice(inputType, INPUT_TYPE_MAP) || 'passage',
          truncate: this.#resolveChoice(truncate, { 'End': 'END', 'None': 'NONE' }) || 'END',
        },
      },
      logTag: 'createEmbeddings',
    })
  }

  /**
   * @operationName Rerank Documents
   * @category Inference
   * @description Reranks a list of documents by relevance to a query using a Pinecone-hosted reranking model (e.g. bge-reranker-v2-m3, pinecone-rerank-v0, cohere-rerank-3.5). Returns documents ordered by relevance score. Accepts plain strings or objects with a text field (use Rank Fields to point at custom field names).
   * @route POST /rerank-documents
   * @paramDef {"type":"String","label":"Model","name":"model","defaultValue":"bge-reranker-v2-m3","description":"Hosted reranking model to use (e.g. bge-reranker-v2-m3, pinecone-rerank-v0, cohere-rerank-3.5). Defaults to bge-reranker-v2-m3."}
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The search query to rank the documents against."}
   * @paramDef {"type":"Array<Object>","label":"Documents","name":"documents","required":true,"description":"Documents to rerank. Each is an object with a \"text\" field by default (e.g. {\"id\":\"doc-1\",\"text\":\"...\"}); plain strings are also accepted and wrapped automatically."}
   * @paramDef {"type":"Number","label":"Top N","name":"topN","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of top-ranked documents to return. Defaults to all documents."}
   * @paramDef {"type":"Array<String>","label":"Rank Fields","name":"rankFields","description":"Document fields the model should evaluate (e.g. [\"text\"]). Defaults to [\"text\"]."}
   * @paramDef {"type":"Boolean","label":"Return Documents","name":"returnDocuments","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether to include the document contents in the results. Defaults to true."}
   * @returns {Object}
   * @sampleResult {"model":"bge-reranker-v2-m3","data":[{"index":1,"score":0.93,"document":{"id":"doc-2","text":"Pinecone is a vector database"}}],"usage":{"rerank_units":1}}
   */
  async rerankDocuments(model, query, documents, topN, rankFields, returnDocuments) {
    if (!Array.isArray(documents) || documents.length === 0) {
      throw new Error('Documents must be a non-empty array.')
    }

    const normalizedDocuments = documents.map(doc =>
      typeof doc === 'string' ? { text: doc } : doc
    )

    const body = {
      model: model || DEFAULT_RERANK_MODEL,
      query,
      documents: normalizedDocuments,
      return_documents: returnDocuments !== false,
    }

    if (topN !== undefined && topN !== null && topN !== '') {
      body.top_n = Number(topN)
    }

    if (Array.isArray(rankFields) && rankFields.length > 0) {
      body.rank_fields = rankFields
    }

    return this.#apiRequest({
      url: `${ CONTROL_PLANE_BASE_URL }/rerank`,
      method: 'post',
      body,
      logTag: 'rerankDocuments',
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getIndexesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter indexes by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the index list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Indexes Dictionary
   * @description Provides a searchable list of the project's indexes for dynamic parameter selection.
   * @route POST /get-indexes-dictionary
   * @paramDef {"type":"getIndexesDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string for filtering indexes."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"docs-index","value":"docs-index","note":"1536d · cosine · Ready"}],"cursor":null}
   */
  async getIndexesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ CONTROL_PLANE_BASE_URL }/indexes`,
      method: 'get',
      logTag: 'getIndexesDictionary',
    })

    let indexes = response?.indexes || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      indexes = indexes.filter(index => index.name.toLowerCase().includes(searchLower))
    }

    return {
      items: indexes
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(index => ({
          label: index.name,
          value: index.name,
          note: [
            index.dimension && `${ index.dimension }d`,
            index.metric,
            index.status?.state,
          ].filter(Boolean).join(' · '),
        })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getNamespacesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":true,"description":"Name of the index whose namespaces should be listed."}
   */

  /**
   * @typedef {Object} getNamespacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter namespaces by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token from a previous page of namespaces."}
   * @paramDef {"type":"getNamespacesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Criteria containing the index name."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Namespaces Dictionary
   * @description Provides a searchable, paginated list of namespaces in the selected index for dynamic parameter selection. Requires an index name in the criteria.
   * @route POST /get-namespaces-dictionary
   * @paramDef {"type":"getNamespacesDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string, pagination cursor and the index name criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"__default__","value":"__default__","note":"1500 records"}],"cursor":null}
   */
  async getNamespacesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const indexName = criteria?.indexName

    if (!indexName) {
      return { items: [], cursor: null }
    }

    const host = await this.#indexHost(indexName)

    const query = { limit: 100 }

    if (cursor) {
      query.paginationToken = cursor
    }

    const response = await this.#apiRequest({
      url: `${ host }/namespaces`,
      method: 'get',
      query,
      logTag: 'getNamespacesDictionary',
    })

    let namespaces = response?.namespaces || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      namespaces = namespaces.filter(ns => ns.name.toLowerCase().includes(searchLower))
    }

    return {
      items: namespaces.map(ns => ({
        label: ns.name,
        value: ns.name,
        note: ns.record_count !== undefined ? `${ ns.record_count } records` : undefined,
      })),
      cursor: response?.pagination?.next || null,
    }
  }
}

Flowrunner.ServerCode.addService(PineconeService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Pinecone API key. Create one in the Pinecone console under API Keys (https://app.pinecone.io).',
  },
])
