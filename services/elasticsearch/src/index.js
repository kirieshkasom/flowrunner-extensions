const logger = {
  info: (...args) => console.log('[Elasticsearch] info:', ...args),
  debug: (...args) => console.log('[Elasticsearch] debug:', ...args),
  error: (...args) => console.log('[Elasticsearch] error:', ...args),
  warn: (...args) => console.log('[Elasticsearch] warn:', ...args),
}

/**
 * Removes undefined/null/empty values from a flat object so we do not send
 * empty query parameters or empty body fields to Elasticsearch.
 */
function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Elasticsearch
 * @integrationIcon /icon.svg
 */
class ElasticsearchService {
  constructor(config) {
    this.serverUrl = (config.serverUrl || '').replace(/\/+$/, '')
    this.apiKey = config.apiKey
    this.username = config.username
    this.password = config.password
  }

  /**
   * Builds the auth header, preferring API key, then HTTP Basic, then none.
   */
  #authHeaders() {
    if (this.apiKey) {
      return { 'Authorization': `ApiKey ${ this.apiKey }` }
    }

    if (this.username || this.password) {
      const token = Buffer.from(`${ this.username || '' }:${ this.password || '' }`).toString('base64')

      return { 'Authorization': `Basic ${ token }` }
    }

    return {}
  }

  /**
   * Single request helper. All Elasticsearch calls go through here.
   * `rawBody` sends a pre-serialized string (used for NDJSON bulk uploads);
   * otherwise `body` is sent as JSON. `contentType` overrides the default.
   */
  async #apiRequest({ path, method = 'get', body, rawBody, query, contentType, logTag }) {
    const url = `${ this.serverUrl }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          ...this.#authHeaders(),
          'Content-Type': contentType || 'application/json',
        })
        .query(clean(query) || {})

      if (rawBody !== undefined) {
        return await request.send(rawBody)
      }

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const esError = error.body?.error
      const reason = (esError && (esError.reason || esError.type)) ||
        error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))
      const status = error.body?.status || error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status }): ${ reason }`)

      throw new Error(`Elasticsearch API error${ status ? ` [${ status }]` : '' }: ${ reason }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Documents
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @operationName Index Document
   * @category Documents
   * @description Indexes (creates or replaces) a JSON document in an index. If a Document ID is provided, the document is created or fully replaced at that ID using PUT /{index}/_doc/{id}; if omitted, Elasticsearch auto-generates an ID via POST /{index}/_doc. The index is created automatically if it does not exist. Use the Refresh option to control search visibility.
   * @route POST /index-document
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"dictionary":"getIndicesDictionary","description":"Name of the target index. Created automatically if it does not exist."}
   * @paramDef {"type":"Object","label":"Document","name":"document","required":true,"description":"The JSON document to index, as a set of field/value pairs."}
   * @paramDef {"type":"String","label":"Document ID","name":"id","description":"Optional document _id. If provided, an existing document at this ID is fully replaced. If omitted, Elasticsearch generates a random ID."}
   * @paramDef {"type":"String","label":"Refresh","name":"refresh","uiComponent":{"type":"DROPDOWN","options":{"values":["No Refresh","Refresh Now","Wait For Refresh"]}},"description":"Controls when the change becomes visible to search. Refresh Now forces an immediate refresh (expensive); Wait For Refresh blocks until the next scheduled refresh. Defaults to No Refresh."}
   *
   * @returns {Object}
   * @sampleResult {"_index":"products","_id":"1","_version":1,"result":"created","_shards":{"total":2,"successful":1,"failed":0},"_seq_no":0,"_primary_term":1}
   */
  async indexDocument(index, document, id, refresh) {
    const logTag = '[indexDocument]'
    const refreshValue = this.#resolveChoice(refresh, {
      'No Refresh': 'false',
      'Refresh Now': 'true',
      'Wait For Refresh': 'wait_for',
    })

    const hasId = id !== undefined && id !== null && id !== ''

    return await this.#apiRequest({
      logTag,
      path: hasId
        ? `/${ encodeURIComponent(index) }/_doc/${ encodeURIComponent(id) }`
        : `/${ encodeURIComponent(index) }/_doc`,
      method: hasId ? 'put' : 'post',
      body: document,
      query: { refresh: refreshValue },
    })
  }

  /**
   * @operationName Get Document
   * @category Documents
   * @description Retrieves a single document by its ID from an index using GET /{index}/_doc/{id}. Returns the document source along with its version and metadata. If the document does not exist, an Elasticsearch error is surfaced.
   * @route GET /get-document
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"dictionary":"getIndicesDictionary","description":"Name of the index containing the document."}
   * @paramDef {"type":"String","label":"Document ID","name":"id","required":true,"description":"The _id of the document to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"_index":"products","_id":"1","_version":1,"_seq_no":0,"_primary_term":1,"found":true,"_source":{"name":"Widget","price":9.99}}
   */
  async getDocument(index, id) {
    const logTag = '[getDocument]'

    return await this.#apiRequest({
      logTag,
      path: `/${ encodeURIComponent(index) }/_doc/${ encodeURIComponent(id) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Document
   * @category Documents
   * @description Partially updates a document by ID using POST /{index}/_update/{id}. Provide either a partial document (merged into the existing document) or a script for scripted updates. Optionally set Upsert to index the document if it does not yet exist.
   * @route POST /update-document
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"dictionary":"getIndicesDictionary","description":"Name of the index containing the document."}
   * @paramDef {"type":"String","label":"Document ID","name":"id","required":true,"description":"The _id of the document to update."}
   * @paramDef {"type":"Object","label":"Partial Document","name":"doc","description":"Partial document with the fields to merge into the existing document. Provide this or a Script."}
   * @paramDef {"type":"Object","label":"Script","name":"script","description":"A scripted update object, e.g. {\"source\":\"ctx._source.count += params.n\",\"params\":{\"n\":1}}. Provide this or a Partial Document."}
   * @paramDef {"type":"Object","label":"Upsert","name":"upsert","description":"Document to index if no document currently exists at this ID. Optional."}
   * @paramDef {"type":"String","label":"Refresh","name":"refresh","uiComponent":{"type":"DROPDOWN","options":{"values":["No Refresh","Refresh Now","Wait For Refresh"]}},"description":"Controls when the change becomes visible to search. Defaults to No Refresh."}
   *
   * @returns {Object}
   * @sampleResult {"_index":"products","_id":"1","_version":2,"result":"updated","_shards":{"total":2,"successful":1,"failed":0},"_seq_no":1,"_primary_term":1}
   */
  async updateDocument(index, id, doc, script, upsert, refresh) {
    const logTag = '[updateDocument]'
    const refreshValue = this.#resolveChoice(refresh, {
      'No Refresh': 'false',
      'Refresh Now': 'true',
      'Wait For Refresh': 'wait_for',
    })

    const body = clean({ doc, script, upsert })

    return await this.#apiRequest({
      logTag,
      path: `/${ encodeURIComponent(index) }/_update/${ encodeURIComponent(id) }`,
      method: 'post',
      body,
      query: { refresh: refreshValue },
    })
  }

  /**
   * @operationName Delete Document
   * @category Documents
   * @description Deletes a single document by its ID from an index using DELETE /{index}/_doc/{id}. Returns the delete result and version metadata.
   * @route DELETE /delete-document
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"dictionary":"getIndicesDictionary","description":"Name of the index containing the document."}
   * @paramDef {"type":"String","label":"Document ID","name":"id","required":true,"description":"The _id of the document to delete."}
   * @paramDef {"type":"String","label":"Refresh","name":"refresh","uiComponent":{"type":"DROPDOWN","options":{"values":["No Refresh","Refresh Now","Wait For Refresh"]}},"description":"Controls when the change becomes visible to search. Defaults to No Refresh."}
   *
   * @returns {Object}
   * @sampleResult {"_index":"products","_id":"1","_version":2,"result":"deleted","_shards":{"total":2,"successful":1,"failed":0},"_seq_no":2,"_primary_term":1}
   */
  async deleteDocument(index, id, refresh) {
    const logTag = '[deleteDocument]'
    const refreshValue = this.#resolveChoice(refresh, {
      'No Refresh': 'false',
      'Refresh Now': 'true',
      'Wait For Refresh': 'wait_for',
    })

    return await this.#apiRequest({
      logTag,
      path: `/${ encodeURIComponent(index) }/_doc/${ encodeURIComponent(id) }`,
      method: 'delete',
      query: { refresh: refreshValue },
    })
  }

  /**
   * @operationName Bulk
   * @category Documents
   * @description Performs multiple index, create, update, and delete operations in a single request using the _bulk API. Provide an array of operation objects; each is converted into the required NDJSON action/source line pairs and sent with Content-Type application/x-ndjson. Each operation must include an "action" of index, create, update, or delete plus "_index"/"_id" metadata; index, create, and update operations also require a "source" (or "doc"/"script" for update). If a default Index is provided, operations may omit their own _index.
   * @route POST /bulk
   *
   * @paramDef {"type":"String","label":"Default Index","name":"index","dictionary":"getIndicesDictionary","description":"Optional default index applied to operations that omit their own _index. Sent as POST /{index}/_bulk when set."}
   * @paramDef {"type":"Array<Object>","label":"Operations","name":"operations","required":true,"description":"Array of operation objects. Each: {\"action\":\"index|create|update|delete\",\"_index\":\"...\",\"_id\":\"...\",\"source\":{...}}. For update use \"doc\" and/or \"script\" instead of source; delete needs no source."}
   * @paramDef {"type":"String","label":"Refresh","name":"refresh","uiComponent":{"type":"DROPDOWN","options":{"values":["No Refresh","Refresh Now","Wait For Refresh"]}},"description":"Controls when the changes become visible to search. Defaults to No Refresh."}
   *
   * @returns {Object}
   * @sampleResult {"took":30,"errors":false,"items":[{"index":{"_index":"products","_id":"1","_version":1,"result":"created","status":201}},{"delete":{"_index":"products","_id":"2","status":404,"result":"not_found"}}]}
   */
  async bulk(index, operations, refresh) {
    const logTag = '[bulk]'

    if (!Array.isArray(operations) || operations.length === 0) {
      throw new Error('Elasticsearch API error: Operations must be a non-empty array.')
    }

    const refreshValue = this.#resolveChoice(refresh, {
      'No Refresh': 'false',
      'Refresh Now': 'true',
      'Wait For Refresh': 'wait_for',
    })

    const validActions = ['index', 'create', 'update', 'delete']
    const lines = []

    for (const op of operations) {
      const action = (op.action || '').toLowerCase()

      if (!validActions.includes(action)) {
        throw new Error(`Elasticsearch API error: Invalid bulk action "${ op.action }". Use index, create, update, or delete.`)
      }

      const meta = clean({ _index: op._index, _id: op._id })

      lines.push(JSON.stringify({ [action]: meta }))

      if (action === 'delete') {
        continue
      }

      if (action === 'update') {
        const updateBody = clean({ doc: op.doc, script: op.script, upsert: op.upsert })

        lines.push(JSON.stringify(updateBody))
      } else {
        // index / create
        lines.push(JSON.stringify(op.source ?? {}))
      }
    }

    const ndjson = `${ lines.join('\n') }\n`
    const hasIndex = index !== undefined && index !== null && index !== ''

    return await this.#apiRequest({
      logTag,
      path: hasIndex ? `/${ encodeURIComponent(index) }/_bulk` : '/_bulk',
      method: 'post',
      rawBody: ndjson,
      contentType: 'application/x-ndjson',
      query: { refresh: refreshValue },
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Search
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @operationName Search
   * @category Search
   * @description Runs a search against one or more indices using the Query DSL via POST /{index}/_search. Supply a query object plus optional paging (size, from), sort, aggregations, and _source filtering. Returns matching hits, total counts, and any aggregation results.
   * @route POST /search
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"dictionary":"getIndicesDictionary","description":"Index or comma-separated indices to search. Use _all or a wildcard to search across indices."}
   * @paramDef {"type":"Object","label":"Query","name":"query","description":"Query DSL object, e.g. {\"match\":{\"title\":\"widget\"}}. Omit to match all documents."}
   * @paramDef {"type":"Number","label":"Size","name":"size","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of hits to return (default 10)."}
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Starting offset for pagination (default 0)."}
   * @paramDef {"type":"Array<Object>","label":"Sort","name":"sort","description":"Sort specification, e.g. [{\"price\":\"desc\"}] or [\"_score\"]."}
   * @paramDef {"type":"Object","label":"Aggregations","name":"aggs","description":"Aggregations object, e.g. {\"avg_price\":{\"avg\":{\"field\":\"price\"}}}."}
   * @paramDef {"type":"Object","label":"Source Filter","name":"source","description":"_source filtering: true/false, a field list, or an includes/excludes object controlling which fields are returned."}
   *
   * @returns {Object}
   * @sampleResult {"took":5,"timed_out":false,"_shards":{"total":1,"successful":1,"skipped":0,"failed":0},"hits":{"total":{"value":1,"relation":"eq"},"max_score":1.2,"hits":[{"_index":"products","_id":"1","_score":1.2,"_source":{"name":"Widget","price":9.99}}]}}
   */
  async search(index, query, size, from, sort, aggs, source) {
    const logTag = '[search]'

    const body = clean({
      query,
      size,
      from,
      sort,
      aggs,
      _source: source,
    })

    return await this.#apiRequest({
      logTag,
      path: `/${ encodeURIComponent(index) }/_search`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Count
   * @category Search
   * @description Counts documents matching a query in one or more indices using POST /{index}/_count. Provide a Query DSL object, or omit it to count all documents. Returns the total count and per-shard information.
   * @route POST /count
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"dictionary":"getIndicesDictionary","description":"Index or comma-separated indices to count. Use _all or a wildcard for multiple indices."}
   * @paramDef {"type":"Object","label":"Query","name":"query","description":"Query DSL object to match. Omit to count all documents."}
   *
   * @returns {Object}
   * @sampleResult {"count":42,"_shards":{"total":1,"successful":1,"skipped":0,"failed":0}}
   */
  async count(index, query) {
    const logTag = '[count]'

    const body = clean({ query })

    return await this.#apiRequest({
      logTag,
      path: `/${ encodeURIComponent(index) }/_count`,
      method: 'post',
      body,
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Query By
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @operationName Delete By Query
   * @category Query By
   * @description Deletes all documents matching a query in an index using POST /{index}/_delete_by_query. Provide a Query DSL object; you may cap the number of deletions with Max Docs. Returns the number of deleted documents and batch statistics.
   * @route POST /delete-by-query
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"dictionary":"getIndicesDictionary","description":"Index or comma-separated indices to delete from."}
   * @paramDef {"type":"Object","label":"Query","name":"query","required":true,"description":"Query DSL object selecting the documents to delete, e.g. {\"match\":{\"status\":\"archived\"}}."}
   * @paramDef {"type":"Number","label":"Max Docs","name":"maxDocs","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional maximum number of documents to delete."}
   * @paramDef {"type":"String","label":"Refresh","name":"refresh","uiComponent":{"type":"DROPDOWN","options":{"values":["No Refresh","Refresh Now"]}},"description":"Refresh Now refreshes affected shards after the operation so deletions are immediately visible. Defaults to No Refresh."}
   *
   * @returns {Object}
   * @sampleResult {"took":147,"timed_out":false,"total":3,"deleted":3,"batches":1,"version_conflicts":0,"noops":0,"failures":[]}
   */
  async deleteByQuery(index, query, maxDocs, refresh) {
    const logTag = '[deleteByQuery]'
    const refreshValue = this.#resolveChoice(refresh, {
      'No Refresh': 'false',
      'Refresh Now': 'true',
    })

    const body = clean({ query, max_docs: maxDocs })

    return await this.#apiRequest({
      logTag,
      path: `/${ encodeURIComponent(index) }/_delete_by_query`,
      method: 'post',
      body,
      query: { refresh: refreshValue },
    })
  }

  /**
   * @operationName Update By Query
   * @category Query By
   * @description Updates all documents matching a query in an index using POST /{index}/_update_by_query, applying an optional script to each match. Without a script it simply reindexes matches (useful to pick up mapping changes). Provide a Query DSL object to select documents. Returns the number of updated documents and batch statistics.
   * @route POST /update-by-query
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"dictionary":"getIndicesDictionary","description":"Index or comma-separated indices to update."}
   * @paramDef {"type":"Object","label":"Query","name":"query","description":"Query DSL object selecting the documents to update. Omit to match all documents."}
   * @paramDef {"type":"Object","label":"Script","name":"script","description":"Script applied to each matched document, e.g. {\"source\":\"ctx._source.count++\",\"lang\":\"painless\"}. Omit to reindex matches in place."}
   * @paramDef {"type":"Number","label":"Max Docs","name":"maxDocs","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional maximum number of documents to update."}
   * @paramDef {"type":"String","label":"Refresh","name":"refresh","uiComponent":{"type":"DROPDOWN","options":{"values":["No Refresh","Refresh Now"]}},"description":"Refresh Now refreshes affected shards after the operation so updates are immediately visible. Defaults to No Refresh."}
   *
   * @returns {Object}
   * @sampleResult {"took":210,"timed_out":false,"total":5,"updated":5,"deleted":0,"batches":1,"version_conflicts":0,"noops":0,"retries":{"bulk":0,"search":0},"failures":[]}
   */
  async updateByQuery(index, query, script, maxDocs, refresh) {
    const logTag = '[updateByQuery]'
    const refreshValue = this.#resolveChoice(refresh, {
      'No Refresh': 'false',
      'Refresh Now': 'true',
    })

    const body = clean({ query, script, max_docs: maxDocs })

    return await this.#apiRequest({
      logTag,
      path: `/${ encodeURIComponent(index) }/_update_by_query`,
      method: 'post',
      body,
      query: { refresh: refreshValue },
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Indices
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @operationName Create Index
   * @category Indices
   * @description Creates a new index using PUT /{index}, optionally with index settings (shards, replicas, analysis) and field mappings. Fails if the index already exists.
   * @route PUT /create-index
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"description":"Name of the index to create. Must be lowercase and cannot contain spaces or the characters \\ / * ? \" < > | ,."}
   * @paramDef {"type":"Object","label":"Settings","name":"settings","description":"Index settings object, e.g. {\"number_of_shards\":1,\"number_of_replicas\":1}."}
   * @paramDef {"type":"Object","label":"Mappings","name":"mappings","description":"Field mappings object, e.g. {\"properties\":{\"name\":{\"type\":\"text\"},\"price\":{\"type\":\"float\"}}}."}
   *
   * @returns {Object}
   * @sampleResult {"acknowledged":true,"shards_acknowledged":true,"index":"products"}
   */
  async createIndex(index, settings, mappings) {
    const logTag = '[createIndex]'

    const body = clean({ settings, mappings })

    return await this.#apiRequest({
      logTag,
      path: `/${ encodeURIComponent(index) }`,
      method: 'put',
      body: Object.keys(body).length ? body : undefined,
    })
  }

  /**
   * @operationName Delete Index
   * @category Indices
   * @description Deletes an index and all of its documents using DELETE /{index}. This is irreversible. A comma-separated list or wildcard may be supplied to delete multiple indices.
   * @route DELETE /delete-index
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"dictionary":"getIndicesDictionary","description":"Name of the index to delete. Accepts a comma-separated list or wildcard."}
   *
   * @returns {Object}
   * @sampleResult {"acknowledged":true}
   */
  async deleteIndex(index) {
    const logTag = '[deleteIndex]'

    return await this.#apiRequest({
      logTag,
      path: `/${ encodeURIComponent(index) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Index Exists
   * @category Indices
   * @description Checks whether an index exists using a HEAD /{index} request. Returns {"exists":true} for a 200 response and {"exists":false} for a 404, so it never throws for a missing index.
   * @route GET /index-exists
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"description":"Name of the index to check for existence."}
   *
   * @returns {Object}
   * @sampleResult {"exists":true}
   */
  async indexExists(index) {
    const logTag = '[indexExists]'

    try {
      await this.#apiRequest({
        logTag,
        path: `/${ encodeURIComponent(index) }`,
        method: 'head',
      })

      return { exists: true }
    } catch (error) {
      const status = error.status || error.statusCode
      const is404 = status === 404 || (typeof error.message === 'string' && error.message.includes('[404]'))

      if (is404) {
        return { exists: false }
      }

      throw error
    }
  }

  /**
   * @operationName Get Mapping
   * @category Indices
   * @description Retrieves the field mappings for an index using GET /{index}/_mapping. Returns the mapping definition (field names and types) for the index.
   * @route GET /get-mapping
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"dictionary":"getIndicesDictionary","description":"Name of the index whose mapping to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"products":{"mappings":{"properties":{"name":{"type":"text"},"price":{"type":"float"}}}}}
   */
  async getMapping(index) {
    const logTag = '[getMapping]'

    return await this.#apiRequest({
      logTag,
      path: `/${ encodeURIComponent(index) }/_mapping`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Index
   * @category Indices
   * @description Retrieves full information about an index using GET /{index}, including its aliases, mappings, and settings.
   * @route GET /get-index
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"dictionary":"getIndicesDictionary","description":"Name of the index to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"products":{"aliases":{},"mappings":{"properties":{"name":{"type":"text"}}},"settings":{"index":{"number_of_shards":"1","number_of_replicas":"1","provided_name":"products"}}}}
   */
  async getIndex(index) {
    const logTag = '[getIndex]'

    return await this.#apiRequest({
      logTag,
      path: `/${ encodeURIComponent(index) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Refresh Index
   * @category Indices
   * @description Refreshes one or more indices using POST /{index}/_refresh, making recent changes available for search. Useful after bulk indexing when you need documents to become immediately searchable.
   * @route POST /refresh-index
   *
   * @paramDef {"type":"String","label":"Index","name":"index","required":true,"dictionary":"getIndicesDictionary","description":"Index or comma-separated indices to refresh. Use _all to refresh all indices."}
   *
   * @returns {Object}
   * @sampleResult {"_shards":{"total":2,"successful":1,"failed":0}}
   */
  async refreshIndex(index) {
    const logTag = '[refreshIndex]'

    return await this.#apiRequest({
      logTag,
      path: `/${ encodeURIComponent(index) }/_refresh`,
      method: 'post',
    })
  }

  /**
   * @operationName List Indices
   * @category Indices
   * @description Lists all indices in the cluster using GET /_cat/indices?format=json. Returns an array of index summaries including health, status, document count, and store size.
   * @route GET /list-indices
   *
   * @returns {Array<Object>}
   * @sampleResult [{"health":"green","status":"open","index":"products","uuid":"abc123","pri":"1","rep":"1","docs.count":"42","docs.deleted":"0","store.size":"12.3kb","pri.store.size":"12.3kb"}]
   */
  async listIndices() {
    const logTag = '[listIndices]'

    return await this.#apiRequest({
      logTag,
      path: '/_cat/indices',
      method: 'get',
      query: { format: 'json' },
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cluster
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @operationName Cluster Health
   * @category Cluster
   * @description Returns the health of the cluster using GET /_cluster/health, including overall status (green/yellow/red), node counts, and shard allocation. A convenient way to verify connectivity and credentials.
   * @route GET /cluster-health
   *
   * @returns {Object}
   * @sampleResult {"cluster_name":"my-cluster","status":"green","timed_out":false,"number_of_nodes":1,"number_of_data_nodes":1,"active_primary_shards":5,"active_shards":5,"relocating_shards":0,"initializing_shards":0,"unassigned_shards":0,"active_shards_percent_as_number":100.0}
   */
  async clusterHealth() {
    const logTag = '[clusterHealth]'

    return await this.#apiRequest({
      logTag,
      path: '/_cluster/health',
      method: 'get',
    })
  }

  /**
   * @operationName Info
   * @category Cluster
   * @description Returns basic cluster information from the root endpoint GET /, including the cluster name, node name, and Elasticsearch version. Useful as a lightweight connection and authentication check.
   * @route GET /info
   *
   * @returns {Object}
   * @sampleResult {"name":"node-1","cluster_name":"my-cluster","cluster_uuid":"abc123","version":{"number":"8.13.0","build_flavor":"default","lucene_version":"9.10.0"},"tagline":"You Know, for Search"}
   */
  async info() {
    const logTag = '[info]'

    return await this.#apiRequest({
      logTag,
      path: '/',
      method: 'get',
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Dictionaries
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} getIndicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter index names by substring."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. _cat/indices returns all indices in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Indices Dictionary
   * @description Provides a selectable list of indices in the cluster (from GET /_cat/indices) for choosing an index in other operations. The option value is the index name. User indices are listed before system indices (those starting with a dot).
   * @route POST /get-indices-dictionary
   * @paramDef {"type":"getIndicesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string used to filter index names."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"products","value":"products","note":"open - green - 42 docs"}],"cursor":null}
   */
  async getIndicesDictionary(payload) {
    const logTag = '[getIndicesDictionary]'
    const { search } = payload || {}

    const rows = await this.#apiRequest({
      logTag,
      path: '/_cat/indices',
      method: 'get',
      query: { format: 'json', h: 'index,status,health,docs.count', s: 'index:asc' },
    })

    const list = Array.isArray(rows) ? rows : []
    const term = (search || '').toLowerCase()

    const filtered = list
      .filter(row => row.index && (!term || row.index.toLowerCase().includes(term)))
      .sort((a, b) => {
        const aSystem = a.index.startsWith('.') ? 1 : 0
        const bSystem = b.index.startsWith('.') ? 1 : 0

        if (aSystem !== bSystem) {
          return aSystem - bSystem
        }

        return a.index.localeCompare(b.index)
      })

    return {
      items: filtered.map(row => {
        const noteParts = [row.status, row.health, row['docs.count'] !== undefined ? `${ row['docs.count'] } docs` : null].filter(Boolean)

        return {
          label: row.index,
          value: row.index,
          note: noteParts.join(' - ') || undefined,
        }
      }),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(ElasticsearchService, [
  {
    name: 'serverUrl',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Elasticsearch endpoint, e.g. https://myhost:9200 or an Elastic Cloud URL. Strip any trailing slash.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'An Elasticsearch API key. When set, requests use Authorization: ApiKey <key>. Takes precedence over Username/Password.',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Username for HTTP Basic authentication. Used only when no API Key is set.',
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Password for HTTP Basic authentication. Used together with Username when no API Key is set.',
  },
])
