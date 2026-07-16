const logger = {
  info: (...args) => console.log('[Azure AI Search] info:', ...args),
  debug: (...args) => console.log('[Azure AI Search] debug:', ...args),
  error: (...args) => console.log('[Azure AI Search] error:', ...args),
  warn: (...args) => console.log('[Azure AI Search] warn:', ...args),
}

const DEFAULT_API_VERSION = '2024-07-01'

function clean(obj) {
  if (!obj || typeof obj !== 'object') {
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
 * @integrationName Azure AI Search
 * @integrationIcon /icon.svg
 */
class AzureAiSearchService {
  constructor(config) {
    this.serviceName = config.serviceName
    this.apiKey = config.apiKey
    this.apiVersion = config.apiVersion || DEFAULT_API_VERSION
    this.baseUrl = `https://${ config.serviceName }.search.windows.net`
  }

  #url(path) {
    const separator = path.includes('?') ? '&' : '?'

    return `${ this.baseUrl }${ path }${ separator }api-version=${ this.apiVersion }`
  }

  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = this.#url(path)

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const azureError = error.body?.error
      const message = azureError?.message || error.body?.message || error.message
      const code = azureError?.code

      logger.error(`${ logTag } - failed${ code ? ` (${ code })` : '' }: ${ message }`)

      throw new Error(`Azure AI Search API error${ code ? ` [${ code }]` : '' }: ${ message }`)
    }
  }

  // ==========================================================================
  // Indexes
  // ==========================================================================

  /**
   * @operationName Create Index
   * @category Indexes
   * @description Creates or updates a search index by name (PUT is idempotent - it creates the index if absent or updates it if present). Provide the field definitions (name, type, and attributes such as key, searchable, filterable, sortable, facetable, retrievable). Vector fields additionally require dimensions and a vectorSearchProfile. Optionally pass a vectorSearch configuration (algorithms and profiles) and a semantic configuration. Field and configuration objects are passed through to the Azure REST API unchanged, so any supported property is accepted.
   * @route PUT /indexes
   * @paramDef {"type":"String","label":"Index Name","name":"name","required":true,"description":"Name of the index to create or update. Lowercase letters, digits, and dashes; must start with a letter."}
   * @paramDef {"type":"Array<Object>","label":"Fields","name":"fields","required":true,"description":"Field schema array. Each field: {name, type (e.g. Edm.String, Edm.Int32, Edm.Boolean, Collection(Edm.Single)), key, searchable, filterable, sortable, facetable, retrievable}. Vector fields also need dimensions and vectorSearchProfile."}
   * @paramDef {"type":"Object","label":"Vector Search Config","name":"vectorSearch","description":"Optional vectorSearch configuration object with algorithms and profiles for vector/hybrid search. Passed through unchanged."}
   * @paramDef {"type":"Object","label":"Semantic Config","name":"semantic","description":"Optional semantic configuration object (semantic ranker) with configurations. Passed through unchanged."}
   * @returns {Object}
   * @sampleResult {"name":"hotels","fields":[{"name":"id","type":"Edm.String","key":true},{"name":"description","type":"Edm.String","searchable":true}],"@odata.etag":"\"0x8D...\""}
   */
  async createIndex(name, fields, vectorSearch, semantic) {
    const logTag = '[createIndex]'

    const body = clean({
      name,
      fields,
      vectorSearch,
      semantic,
    })

    return await this.#apiRequest({
      logTag,
      path: `/indexes/${ encodeURIComponent(name) }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName List Indexes
   * @category Indexes
   * @description Lists all search indexes defined on the search service, including their fields and configuration. Use the optional select parameter to return only specific index properties (e.g. just names).
   * @route GET /indexes
   * @paramDef {"type":"String","label":"Select","name":"select","description":"Optional comma-separated list of index properties to return (e.g. 'name' to return only index names)."}
   * @returns {Object}
   * @sampleResult {"value":[{"name":"hotels","fields":[{"name":"id","type":"Edm.String","key":true}]},{"name":"products"}]}
   */
  async listIndexes(select) {
    const logTag = '[listIndexes]'

    return await this.#apiRequest({
      logTag,
      path: '/indexes',
      method: 'get',
      query: { $select: select },
    })
  }

  /**
   * @operationName Get Index
   * @category Indexes
   * @description Retrieves the full definition of a single search index by name, including its fields, analyzers, scoring profiles, vector search, and semantic configuration.
   * @route GET /indexes/get
   * @paramDef {"type":"String","label":"Index Name","name":"name","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to retrieve."}
   * @returns {Object}
   * @sampleResult {"name":"hotels","fields":[{"name":"id","type":"Edm.String","key":true},{"name":"description","type":"Edm.String","searchable":true}],"@odata.etag":"\"0x8D...\""}
   */
  async getIndex(name) {
    const logTag = '[getIndex]'

    return await this.#apiRequest({
      logTag,
      path: `/indexes/${ encodeURIComponent(name) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete Index
   * @category Indexes
   * @description Permanently deletes a search index and all of its documents by name. This action cannot be undone. Returns an empty confirmation object on success.
   * @route DELETE /indexes
   * @paramDef {"type":"String","label":"Index Name","name":"name","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to delete. All documents in the index are permanently removed."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"name":"hotels"}
   */
  async deleteIndex(name) {
    const logTag = '[deleteIndex]'

    await this.#apiRequest({
      logTag,
      path: `/indexes/${ encodeURIComponent(name) }`,
      method: 'delete',
    })

    return { deleted: true, name }
  }

  /**
   * @operationName Get Index Statistics
   * @category Indexes
   * @description Returns storage and document statistics for an index, including the current document count and total storage size in bytes. Counts can lag recent indexing operations by a few seconds.
   * @route GET /indexes/stats
   * @paramDef {"type":"String","label":"Index Name","name":"name","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to get statistics for."}
   * @returns {Object}
   * @sampleResult {"documentCount":1024,"storageSize":5242880,"vectorIndexSize":1048576}
   */
  async getIndexStatistics(name) {
    const logTag = '[getIndexStatistics]'

    return await this.#apiRequest({
      logTag,
      path: `/indexes/${ encodeURIComponent(name) }/stats`,
      method: 'get',
    })
  }

  // ==========================================================================
  // Documents
  // ==========================================================================

  /**
   * @operationName Search Documents
   * @category Documents
   * @description The flagship query operation. Runs keyword, vector, or hybrid search against an index and returns matching documents ranked by an @search.score. Supports full-text search (simple or Lucene full syntax), OData filtering, field selection, sorting, faceting, hit highlighting, and paging. For vector or hybrid search, pass vectorQueries (each with a vector or text, k, and target vector fields). For semantic ranking, set Query Type to semantic and provide a semantic configuration name.
   * @route POST /indexes/docs/search
   * @paramDef {"type":"String","label":"Index Name","name":"name","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to search."}
   * @paramDef {"type":"String","label":"Search Text","name":"search","description":"Full-text query. Use '*' or leave empty to match all documents (e.g. for pure vector or filter-only queries)."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"OData $filter expression to restrict results, e.g. \"category eq 'books' and price lt 20\"."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of documents to return (default 50)."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of documents to skip for paging (max 100000)."}
   * @paramDef {"type":"String","label":"Select","name":"select","description":"Comma-separated list of fields to include in each result (e.g. 'id,name,price')."}
   * @paramDef {"type":"String","label":"Order By","name":"orderby","description":"Comma-separated OData $orderby clause, e.g. 'price asc, rating desc' or 'search.score() desc'."}
   * @paramDef {"type":"Array<String>","label":"Facets","name":"facets","description":"Facet expressions to compute, e.g. ['category', 'price,interval:10']. Each faceted field must be facetable."}
   * @paramDef {"type":"String","label":"Search Fields","name":"searchFields","description":"Comma-separated list of searchable fields to scope full-text search to (e.g. 'title,description')."}
   * @paramDef {"type":"String","label":"Query Type","name":"queryType","uiComponent":{"type":"DROPDOWN","options":{"values":["Simple","Full","Semantic"]}},"description":"Query parser: Simple (default keyword syntax), Full (Lucene syntax), or Semantic (semantic ranking - requires a semantic configuration)."}
   * @paramDef {"type":"Array<Object>","label":"Vector Queries","name":"vectorQueries","description":"Vector query array for vector or hybrid search. Each: {kind:'vector', vector:[...], fields:'myVectorField', k:10} or {kind:'text', text:'...', fields:'...', k:10}. Combine with Search Text for hybrid search."}
   * @paramDef {"type":"String","label":"Semantic Configuration","name":"semanticConfiguration","description":"Name of the semantic configuration to use (required when Query Type is Semantic)."}
   * @paramDef {"type":"String","label":"Highlight","name":"highlight","description":"Comma-separated list of fields to return hit highlights for (e.g. 'description,title')."}
   * @returns {Object}
   * @sampleResult {"@odata.count":2,"value":[{"@search.score":1.53,"id":"1","name":"Fairmont","description":"Luxury hotel"},{"@search.score":0.92,"id":"2","name":"Roach Motel"}]}
   */
  async searchDocuments(name, search, filter, top, skip, select, orderby, facets, searchFields, queryType, vectorQueries, semanticConfiguration, highlight) {
    const logTag = '[searchDocuments]'

    const body = clean({
      search: search || undefined,
      filter,
      top,
      skip,
      select,
      orderby,
      facets: facets && facets.length ? facets : undefined,
      searchFields,
      queryType: this.#resolveChoice(queryType, { Simple: 'simple', Full: 'full', Semantic: 'semantic' }),
      vectorQueries: vectorQueries && vectorQueries.length ? vectorQueries : undefined,
      semanticConfiguration,
      highlight,
      count: true,
    })

    return await this.#apiRequest({
      logTag,
      path: `/indexes/${ encodeURIComponent(name) }/docs/search`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Index Documents
   * @category Documents
   * @description Uploads, merges, or deletes documents in an index in a single batch (up to 1000 documents or 16 MB per request). Each entry combines a @search.action verb with the document fields. Use upload to add or fully replace a document, merge to update specific fields of an existing document, mergeOrUpload to update if present or insert if not, and delete (only the key field is required) to remove a document.
   * @route POST /indexes/docs/index
   * @paramDef {"type":"String","label":"Index Name","name":"name","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to modify."}
   * @paramDef {"type":"Array<Object>","label":"Documents","name":"value","required":true,"description":"Array of document actions. Each object contains a '@search.action' property (one of: upload, merge, mergeOrUpload, delete) plus the document fields, including the key field. For delete, only the key field is required."}
   * @returns {Object}
   * @sampleResult {"value":[{"key":"1","status":true,"errorMessage":null,"statusCode":200},{"key":"2","status":true,"errorMessage":null,"statusCode":201}]}
   */
  async indexDocuments(name, value) {
    const logTag = '[indexDocuments]'

    return await this.#apiRequest({
      logTag,
      path: `/indexes/${ encodeURIComponent(name) }/docs/index`,
      method: 'post',
      body: { value },
    })
  }

  /**
   * @operationName Get Document
   * @category Documents
   * @description Retrieves a single document from an index by its key value. Optionally restrict the returned fields with select. Returns 404 if no document with the given key exists.
   * @route GET /indexes/docs
   * @paramDef {"type":"String","label":"Index Name","name":"name","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index."}
   * @paramDef {"type":"String","label":"Document Key","name":"key","required":true,"description":"The key value of the document to retrieve."}
   * @paramDef {"type":"String","label":"Select","name":"select","description":"Optional comma-separated list of fields to return (e.g. 'id,name,price')."}
   * @returns {Object}
   * @sampleResult {"id":"1","name":"Fairmont","description":"Luxury hotel","category":"Luxury"}
   */
  async getDocument(name, key, select) {
    const logTag = '[getDocument]'

    return await this.#apiRequest({
      logTag,
      path: `/indexes/${ encodeURIComponent(name) }/docs/${ encodeURIComponent(key) }`,
      method: 'get',
      query: { $select: select },
    })
  }

  /**
   * @operationName Count Documents
   * @category Documents
   * @description Returns the current number of documents in an index as a number. This count can lag recent indexing operations by a few seconds.
   * @route GET /indexes/docs/count
   * @paramDef {"type":"String","label":"Index Name","name":"name","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to count documents in."}
   * @returns {Object}
   * @sampleResult {"count":1024}
   */
  async countDocuments(name) {
    const logTag = '[countDocuments]'

    const count = await this.#apiRequest({
      logTag,
      path: `/indexes/${ encodeURIComponent(name) }/docs/$count`,
      method: 'get',
    })

    return { count: typeof count === 'number' ? count : Number(count) }
  }

  /**
   * @operationName Suggest
   * @category Documents
   * @description Returns type-ahead suggestions matching a partial query against a configured suggester on the index. Ideal for search-as-you-type experiences. Requires a suggester to be defined on the index. Optionally filter, scope search fields, limit results, and enable fuzzy matching.
   * @route POST /indexes/docs/suggest
   * @paramDef {"type":"String","label":"Index Name","name":"name","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to query."}
   * @paramDef {"type":"String","label":"Search Text","name":"search","required":true,"description":"The partial search text to get suggestions for (minimum 1 character)."}
   * @paramDef {"type":"String","label":"Suggester Name","name":"suggesterName","required":true,"description":"Name of the suggester defined on the index to use."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional OData $filter expression to restrict suggestions."}
   * @paramDef {"type":"String","label":"Select","name":"select","description":"Optional comma-separated list of fields to return with each suggestion."}
   * @paramDef {"type":"String","label":"Search Fields","name":"searchFields","description":"Optional comma-separated list of fields to search for suggestions (must be covered by the suggester)."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of suggestions to return (1-100, default 5)."}
   * @paramDef {"type":"Boolean","label":"Fuzzy","name":"fuzzy","uiComponent":{"type":"TOGGLE"},"description":"When true, allows suggestions even with a small typo in the search text. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"value":[{"@search.text":"Luxury hotel","id":"1"},{"@search.text":"Luxury suites","id":"5"}]}
   */
  async suggest(name, search, suggesterName, filter, select, searchFields, top, fuzzy) {
    const logTag = '[suggest]'

    const body = clean({
      search,
      suggesterName,
      filter,
      select,
      searchFields,
      top,
      fuzzy: fuzzy === true ? true : undefined,
    })

    return await this.#apiRequest({
      logTag,
      path: `/indexes/${ encodeURIComponent(name) }/docs/suggest`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Autocomplete
   * @category Documents
   * @description Returns completed terms (auto-completions) for a partial query against a configured suggester on the index. Unlike Suggest, it returns completed query terms rather than matching documents. Requires a suggester on the index. The auto-complete mode controls whether one or two terms are completed.
   * @route POST /indexes/docs/autocomplete
   * @paramDef {"type":"String","label":"Index Name","name":"name","required":true,"dictionary":"getIndexesDictionary","description":"Name of the index to query."}
   * @paramDef {"type":"String","label":"Search Text","name":"search","required":true,"description":"The incomplete term to auto-complete (minimum 1 character)."}
   * @paramDef {"type":"String","label":"Suggester Name","name":"suggesterName","required":true,"description":"Name of the suggester defined on the index to use."}
   * @paramDef {"type":"String","label":"Autocomplete Mode","name":"autocompleteMode","uiComponent":{"type":"DROPDOWN","options":{"values":["One Term","Two Terms","One Term With Context"]}},"description":"Completion mode: One Term completes a single term; Two Terms completes bi-grams; One Term With Context completes the last term using the preceding text. Defaults to One Term."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional OData $filter expression to restrict the source documents."}
   * @paramDef {"type":"String","label":"Search Fields","name":"searchFields","description":"Optional comma-separated list of fields to search (must be covered by the suggester)."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of completions to return (1-100, default 5)."}
   * @paramDef {"type":"Boolean","label":"Fuzzy","name":"fuzzy","uiComponent":{"type":"TOGGLE"},"description":"When true, allows completions even with a small typo. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"value":[{"text":"luxury","queryPlusText":"luxury"},{"text":"luxurious","queryPlusText":"luxurious"}]}
   */
  async autocomplete(name, search, suggesterName, autocompleteMode, filter, searchFields, top, fuzzy) {
    const logTag = '[autocomplete]'

    const body = clean({
      search,
      suggesterName,
      autocompleteMode: this.#resolveChoice(autocompleteMode, {
        'One Term': 'oneTerm',
        'Two Terms': 'twoTerms',
        'One Term With Context': 'oneTermWithContext',
      }),
      filter,
      searchFields,
      top,
      fuzzy: fuzzy === true ? true : undefined,
    })

    return await this.#apiRequest({
      logTag,
      path: `/indexes/${ encodeURIComponent(name) }/docs/autocomplete`,
      method: 'post',
      body,
    })
  }

  // ==========================================================================
  // Indexers
  // ==========================================================================

  /**
   * @operationName List Indexers
   * @category Indexers
   * @description Lists all indexers defined on the search service. Indexers automate the pull-model ingestion of documents from a data source into a target index. Use the optional select parameter to return only specific properties.
   * @route GET /indexers
   * @paramDef {"type":"String","label":"Select","name":"select","description":"Optional comma-separated list of indexer properties to return (e.g. 'name')."}
   * @returns {Object}
   * @sampleResult {"value":[{"name":"blob-indexer","dataSourceName":"blob-ds","targetIndexName":"docs"}]}
   */
  async listIndexers(select) {
    const logTag = '[listIndexers]'

    return await this.#apiRequest({
      logTag,
      path: '/indexers',
      method: 'get',
      query: { $select: select },
    })
  }

  /**
   * @operationName Run Indexer
   * @category Indexers
   * @description Triggers an on-demand run of an indexer, which reads from its data source and updates the target index. Returns an empty confirmation object on success (HTTP 202 Accepted). Use Get Indexer Status to monitor progress and results.
   * @route POST /indexers/run
   * @paramDef {"type":"String","label":"Indexer Name","name":"name","required":true,"description":"Name of the indexer to run on demand."}
   * @returns {Object}
   * @sampleResult {"started":true,"name":"blob-indexer"}
   */
  async runIndexer(name) {
    const logTag = '[runIndexer]'

    await this.#apiRequest({
      logTag,
      path: `/indexers/${ encodeURIComponent(name) }/run`,
      method: 'post',
    })

    return { started: true, name }
  }

  /**
   * @operationName Get Indexer Status
   * @category Indexers
   * @description Returns the current status and execution history of an indexer, including whether it is running, the last run's result (success, items processed, failures), and any error messages. Use this to monitor an indexer triggered with Run Indexer.
   * @route GET /indexers/status
   * @paramDef {"type":"String","label":"Indexer Name","name":"name","required":true,"description":"Name of the indexer to get status for."}
   * @returns {Object}
   * @sampleResult {"status":"running","lastResult":{"status":"success","itemsProcessed":120,"itemsFailed":0,"startTime":"2024-07-01T10:00:00Z","endTime":"2024-07-01T10:01:12Z"},"executionHistory":[]}
   */
  async getIndexerStatus(name) {
    const logTag = '[getIndexerStatus]'

    return await this.#apiRequest({
      logTag,
      path: `/indexers/${ encodeURIComponent(name) }/status`,
      method: 'get',
    })
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ==========================================================================
  // Dictionaries
  // ==========================================================================

  /**
   * @typedef {Object} getIndexesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter index names by substring match."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Azure returns all indexes in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Indexes Dictionary
   * @description Provides a selectable list of index names on the search service for use in index-scoped operations such as Search Documents, Get Index, and Index Documents.
   * @route POST /get-indexes-dictionary
   * @paramDef {"type":"getIndexesDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string used to filter index names."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"hotels","value":"hotels","note":"Index"},{"label":"products","value":"products","note":"Index"}],"cursor":null}
   */
  async getIndexesDictionary(payload) {
    const logTag = '[getIndexesDictionary]'
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag,
      path: '/indexes',
      method: 'get',
      query: { $select: 'name' },
    })

    const indexes = response?.value || []
    const term = (search || '').toLowerCase()

    const items = indexes
      .map(index => index.name)
      .filter(name => !term || name.toLowerCase().includes(term))
      .map(name => ({ label: name, value: name, note: 'Index' }))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(AzureAiSearchService, [
  {
    name: 'serviceName',
    displayName: 'Search Service Name',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your search service name from the endpoint https://{serviceName}.search.windows.net (just the {serviceName} part).',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Azure portal -> your Search service -> Keys. Use an admin key for writes (create/index/delete) or a query key for read-only search operations.',
  },
  {
    name: 'apiVersion',
    displayName: 'API Version',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    defaultValue: DEFAULT_API_VERSION,
    shared: false,
    hint: `The Azure AI Search REST api-version. Defaults to ${ DEFAULT_API_VERSION } (current GA). Only change if you need a specific API version.`,
  },
])
