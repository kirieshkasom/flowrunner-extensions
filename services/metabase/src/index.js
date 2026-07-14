const logger = {
  info: (...args) => console.log('[Metabase] info:', ...args),
  debug: (...args) => console.log('[Metabase] debug:', ...args),
  error: (...args) => console.log('[Metabase] error:', ...args),
  warn: (...args) => console.log('[Metabase] warn:', ...args),
}

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
 * @integrationName Metabase
 * @integrationIcon /icon.svg
 */
class MetabaseService {
  constructor(config) {
    this.serverUrl = (config.serverUrl || '').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  #baseUrl() {
    return `${ this.serverUrl }/api`
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.#baseUrl() }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message =
        error.body?.message ||
        (typeof error.body === 'string' ? error.body : undefined) ||
        error.message ||
        'Unknown error'

      logger.error(`${ logTag } - failed (${ status || 'n/a' }): ${ message }`)

      throw new Error(`Metabase API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /* ------------------------------------------------------------------ *
   * Cards (questions)
   * ------------------------------------------------------------------ */

  /**
   * @operationName List Cards
   * @category Cards
   * @description Lists saved questions (cards) in the Metabase instance. Optionally filter the set with the "Filter" option (e.g. mine, bookmarked, archived, or by database/table). Returns each card's id, name, description, collection, display type, and metadata. Use a card id with Get Card, Run Card Query, Update Card, or Delete Card.
   * @route GET /cards
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Mine","Bookmarked","Database","Table","Recently Viewed","Popular","Archived"]}},"description":"Which set of cards to return. Defaults to all non-archived cards."}
   * @paramDef {"type":"Number","label":"Model ID","name":"modelId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Required when Filter is Database or Table: the id of that database or table to scope results to."}
   *
   * @returns {Array<Object>}
   * @sampleResult {"data":[{"id":12,"name":"Revenue by month","description":"Monthly totals","display":"line","collection_id":3,"database_id":1,"archived":false}]}
   */
  async listCards(filter, modelId) {
    const logTag = '[listCards]'
    const f = this.#resolveChoice(filter, {
      All: 'all',
      Mine: 'mine',
      Bookmarked: 'bookmarked',
      Database: 'database',
      Table: 'table',
      'Recently Viewed': 'recent',
      Popular: 'popular',
      Archived: 'archived',
    })

    const data = await this.#apiRequest({
      logTag,
      path: '/card',
      method: 'get',
      query: { f, model_id: modelId },
    })

    return { data }
  }

  /**
   * @operationName Get Card
   * @category Cards
   * @description Retrieves a single saved question (card) by its id, including its name, description, query definition (dataset_query), display type, visualization settings, collection, and result metadata.
   * @route GET /cards/get
   *
   * @paramDef {"type":"Number","label":"Card ID","name":"cardId","required":true,"dictionary":"getCardsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the card to retrieve. Search and select a card, or enter an id."}
   *
   * @returns {Object}
   * @sampleResult {"id":12,"name":"Revenue by month","description":"Monthly totals","display":"line","collection_id":3,"database_id":1,"dataset_query":{"database":1,"type":"native","native":{"query":"SELECT * FROM orders"}}}
   */
  async getCard(cardId) {
    const logTag = '[getCard]'

    return await this.#apiRequest({
      logTag,
      path: `/card/${ encodeURIComponent(cardId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Card
   * @category Cards
   * @description Creates a new saved question (card). Provide a name, the database id to run against, and a native SQL query (or a full MBQL query object). The card is saved with the given display type and optional collection and description. Returns the created card including its new id.
   * @route POST /card
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the new card."}
   * @paramDef {"type":"Number","label":"Database ID","name":"databaseId","required":true,"dictionary":"getDatabasesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the database the query runs against."}
   * @paramDef {"type":"String","label":"SQL Query","name":"sqlQuery","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Native SQL query for the card. Provide this or a Query JSON, not both."}
   * @paramDef {"type":"String","label":"Query JSON","name":"queryJson","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Advanced: a full dataset_query JSON object (native or MBQL). Overrides SQL Query when provided. Example: {\"database\":1,\"type\":\"query\",\"query\":{\"source-table\":2}}"}
   * @paramDef {"type":"String","label":"Display","name":"display","uiComponent":{"type":"DROPDOWN","options":{"values":["Table","Scalar","Line","Bar","Pie","Row","Area","Map","Pivot"]}},"description":"Visualization type for the card. Defaults to Table."}
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","dictionary":"getCollectionsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional id of the collection to save the card in. Leave empty for the root collection."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description for the card."}
   *
   * @returns {Object}
   * @sampleResult {"id":42,"name":"New question","display":"table","collection_id":3,"database_id":1,"archived":false}
   */
  async createCard(name, databaseId, sqlQuery, queryJson, display, collectionId, description) {
    const logTag = '[createCard]'

    const datasetQuery = this.#buildDatasetQuery(databaseId, sqlQuery, queryJson, logTag)

    const body = clean({
      name,
      dataset_query: datasetQuery,
      display: this.#resolveChoice(display || 'Table', {
        Table: 'table',
        Scalar: 'scalar',
        Line: 'line',
        Bar: 'bar',
        Pie: 'pie',
        Row: 'row',
        Area: 'area',
        Map: 'map',
        Pivot: 'pivot',
      }),
      visualization_settings: {},
      collection_id: collectionId,
      description,
    })

    return await this.#apiRequest({ logTag, path: '/card', method: 'post', body })
  }

  /**
   * @operationName Update Card
   * @category Cards
   * @description Updates an existing saved question (card). Only the fields you provide are changed; empty fields are left as-is. Supports renaming, changing the description, moving to another collection, updating the display type, replacing the SQL/query definition, and archiving/unarchiving.
   * @route PUT /cards/update
   *
   * @paramDef {"type":"Number","label":"Card ID","name":"cardId","required":true,"dictionary":"getCardsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the card to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New display name. Leave empty to keep the current name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description. Leave empty to keep the current description."}
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","dictionary":"getCollectionsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Move the card to this collection id. Leave empty to keep it where it is."}
   * @paramDef {"type":"String","label":"Display","name":"display","uiComponent":{"type":"DROPDOWN","options":{"values":["Table","Scalar","Line","Bar","Pie","Row","Area","Map","Pivot"]}},"description":"New visualization type. Leave empty to keep the current one."}
   * @paramDef {"type":"Number","label":"Database ID","name":"databaseId","dictionary":"getDatabasesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Required only when replacing the query via SQL Query or Query JSON: the database id the new query runs against."}
   * @paramDef {"type":"String","label":"SQL Query","name":"sqlQuery","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Replace the card's query with this native SQL. Requires Database ID. Leave empty to keep the current query."}
   * @paramDef {"type":"String","label":"Query JSON","name":"queryJson","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Advanced: replace the card's dataset_query with this full JSON object. Overrides SQL Query when provided."}
   * @paramDef {"type":"Boolean","label":"Archived","name":"archived","uiComponent":{"type":"TOGGLE"},"description":"Set true to archive the card, false to unarchive. Leave empty to keep the current state."}
   *
   * @returns {Object}
   * @sampleResult {"id":12,"name":"Revenue by month (v2)","display":"bar","collection_id":5,"archived":false}
   */
  async updateCard(cardId, name, description, collectionId, display, databaseId, sqlQuery, queryJson, archived) {
    const logTag = '[updateCard]'

    let datasetQuery

    if ((sqlQuery && String(sqlQuery).trim()) || (queryJson && String(queryJson).trim())) {
      datasetQuery = this.#buildDatasetQuery(databaseId, sqlQuery, queryJson, logTag)
    }

    const body = clean({
      name,
      description,
      collection_id: collectionId,
      display: display
        ? this.#resolveChoice(display, {
          Table: 'table',
          Scalar: 'scalar',
          Line: 'line',
          Bar: 'bar',
          Pie: 'pie',
          Row: 'row',
          Area: 'area',
          Map: 'map',
          Pivot: 'pivot',
        })
        : undefined,
      dataset_query: datasetQuery,
    })

    if (typeof archived === 'boolean') {
      body.archived = archived
    }

    return await this.#apiRequest({
      logTag,
      path: `/card/${ encodeURIComponent(cardId) }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete Card
   * @category Cards
   * @description Permanently deletes a saved question (card) by its id. This cannot be undone. To keep the card but hide it, use Update Card with Archived set to true instead.
   * @route DELETE /cards/delete
   *
   * @paramDef {"type":"Number","label":"Card ID","name":"cardId","required":true,"dictionary":"getCardsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the card to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":12}
   */
  async deleteCard(cardId) {
    const logTag = '[deleteCard]'

    await this.#apiRequest({
      logTag,
      path: `/card/${ encodeURIComponent(cardId) }`,
      method: 'delete',
    })

    return { deleted: true, id: cardId }
  }

  /**
   * @operationName Run Card Query
   * @category Cards
   * @description Runs a saved question (card) and returns its result rows. The response includes the column definitions and the data rows exactly as Metabase computes them. Optionally pass parameter values as a JSON array to fill the card's parameters.
   * @route POST /card/run-query
   *
   * @paramDef {"type":"Number","label":"Card ID","name":"cardId","required":true,"dictionary":"getCardsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the card to run."}
   * @paramDef {"type":"String","label":"Parameters JSON","name":"parametersJson","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional JSON array of parameter objects to apply to the card, e.g. [{\"type\":\"category\",\"target\":[\"variable\",[\"template-tag\",\"state\"]],\"value\":\"CA\"}]"}
   *
   * @returns {Object}
   * @sampleResult {"data":{"rows":[[1,"Widget",42]],"cols":[{"name":"id","base_type":"type/Integer"},{"name":"name","base_type":"type/Text"},{"name":"qty","base_type":"type/Integer"}]},"row_count":1,"status":"completed"}
   */
  async runCardQuery(cardId, parametersJson) {
    const logTag = '[runCardQuery]'
    const parameters = this.#parseJsonParam(parametersJson, 'Parameters JSON', logTag)

    return await this.#apiRequest({
      logTag,
      path: `/card/${ encodeURIComponent(cardId) }/query`,
      method: 'post',
      body: parameters !== undefined ? { parameters } : {},
    })
  }

  /**
   * @operationName Run Card Query Export
   * @category Cards
   * @description Runs a saved question (card) and returns its results serialized in the chosen export format. Choose JSON for structured row objects or CSV for spreadsheet-ready text. Useful when you need the full result set to hand off to another step.
   * @route POST /card/run-query-export
   *
   * @paramDef {"type":"Number","label":"Card ID","name":"cardId","required":true,"dictionary":"getCardsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the card to run."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["JSON","CSV"]}},"description":"Export format. Defaults to JSON."}
   * @paramDef {"type":"String","label":"Parameters JSON","name":"parametersJson","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional JSON array of parameter objects to apply to the card before exporting."}
   *
   * @returns {Object}
   * @sampleResult {"format":"json","data":[{"id":1,"name":"Widget","qty":42}]}
   */
  async runCardQueryExport(cardId, format, parametersJson) {
    const logTag = '[runCardQueryExport]'
    const fmt = this.#resolveChoice(format || 'JSON', { JSON: 'json', CSV: 'csv' })
    const parameters = this.#parseJsonParam(parametersJson, 'Parameters JSON', logTag)

    const data = await this.#apiRequest({
      logTag,
      path: `/card/${ encodeURIComponent(cardId) }/query/${ fmt }`,
      method: 'post',
      body: parameters !== undefined ? { parameters } : {},
    })

    return { format: fmt, data }
  }

  /* ------------------------------------------------------------------ *
   * Datasets (ad-hoc queries)
   * ------------------------------------------------------------------ */

  /**
   * @operationName Run Query
   * @category Datasets
   * @description Runs an ad-hoc query against a database without saving a card, and returns the result rows and column definitions. Provide a native SQL query, or a full MBQL query object via Query JSON for structured queries.
   * @route POST /dataset
   *
   * @paramDef {"type":"Number","label":"Database ID","name":"databaseId","required":true,"dictionary":"getDatabasesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the database to query."}
   * @paramDef {"type":"String","label":"SQL Query","name":"sqlQuery","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Native SQL query to run. Provide this or a Query JSON."}
   * @paramDef {"type":"String","label":"Query JSON","name":"queryJson","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Advanced: a full MBQL query object for the \"query\" field, e.g. {\"source-table\":2,\"limit\":10}. Overrides SQL Query when provided."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"rows":[[1,"Widget",42]],"cols":[{"name":"id"},{"name":"name"},{"name":"qty"}]},"row_count":1,"status":"completed"}
   */
  async runQuery(databaseId, sqlQuery, queryJson) {
    const logTag = '[runQuery]'
    const body = this.#buildDatasetQuery(databaseId, sqlQuery, queryJson, logTag)

    return await this.#apiRequest({ logTag, path: '/dataset', method: 'post', body })
  }

  /**
   * @operationName Export Query
   * @category Datasets
   * @description Runs an ad-hoc query against a database and returns the results serialized in the chosen export format (JSON or CSV) instead of the raw Metabase result envelope. Provide a native SQL query or a full MBQL query object.
   * @route POST /dataset/export
   *
   * @paramDef {"type":"Number","label":"Database ID","name":"databaseId","required":true,"dictionary":"getDatabasesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the database to query."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["JSON","CSV"]}},"description":"Export format. Defaults to JSON."}
   * @paramDef {"type":"String","label":"SQL Query","name":"sqlQuery","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Native SQL query to run. Provide this or a Query JSON."}
   * @paramDef {"type":"String","label":"Query JSON","name":"queryJson","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Advanced: a full MBQL query object for the \"query\" field. Overrides SQL Query when provided."}
   *
   * @returns {Object}
   * @sampleResult {"format":"csv","data":"id,name,qty\n1,Widget,42\n"}
   */
  async exportQuery(databaseId, format, sqlQuery, queryJson) {
    const logTag = '[exportQuery]'
    const fmt = this.#resolveChoice(format || 'JSON', { JSON: 'json', CSV: 'csv' })
    const datasetQuery = this.#buildDatasetQuery(databaseId, sqlQuery, queryJson, logTag)

    // The export endpoint expects the query object form-encoded under "query".
    const formData = new Flowrunner.Request.FormData()
    formData.append('query', JSON.stringify(datasetQuery))

    const url = `${ this.#baseUrl() }/dataset/${ fmt }`

    try {
      logger.debug(`${ logTag } - [POST::${ url }]`)
      const data = await Flowrunner.Request.post(url)
        .set({ 'x-api-key': this.apiKey })
        .form(formData)

      return { format: fmt, data }
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.message || (typeof error.body === 'string' ? error.body : undefined) || error.message
      logger.error(`${ logTag } - failed (${ status || 'n/a' }): ${ message }`)
      throw new Error(`Metabase API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /* ------------------------------------------------------------------ *
   * Databases
   * ------------------------------------------------------------------ */

  /**
   * @operationName List Databases
   * @category Databases
   * @description Lists the databases connected to this Metabase instance, including each database's id, name, engine, and connection metadata. Use a database id with Get Database, Get Database Metadata, Sync Schema, Run Query, or Create Card.
   * @route GET /databases
   *
   * @paramDef {"type":"Boolean","label":"Include Tables","name":"includeTables","uiComponent":{"type":"TOGGLE"},"description":"When true, include each database's tables in the response. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":1,"name":"Sample Database","engine":"h2","is_sample":true}],"total":1}
   */
  async listDatabases(includeTables) {
    const logTag = '[listDatabases]'

    return await this.#apiRequest({
      logTag,
      path: '/database',
      method: 'get',
      query: includeTables ? { include: 'tables' } : {},
    })
  }

  /**
   * @operationName Get Database
   * @category Databases
   * @description Retrieves a single database connection by its id, including its name, engine, connection details (with secrets redacted), and feature flags.
   * @route GET /databases/get
   *
   * @paramDef {"type":"Number","label":"Database ID","name":"databaseId","required":true,"dictionary":"getDatabasesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the database to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"name":"Sample Database","engine":"h2","is_sample":true,"timezone":"UTC"}
   */
  async getDatabase(databaseId) {
    const logTag = '[getDatabase]'

    return await this.#apiRequest({
      logTag,
      path: `/database/${ encodeURIComponent(databaseId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Database Metadata
   * @category Databases
   * @description Retrieves the full schema metadata for a database: its tables and, for each table, the fields with their names, base types, and semantic types. Useful for discovering what to query before building a card or ad-hoc query.
   * @route GET /databases/metadata
   *
   * @paramDef {"type":"Number","label":"Database ID","name":"databaseId","required":true,"dictionary":"getDatabasesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the database whose metadata to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"name":"Sample Database","tables":[{"id":2,"name":"orders","fields":[{"id":10,"name":"id","base_type":"type/Integer"}]}]}
   */
  async getDatabaseMetadata(databaseId) {
    const logTag = '[getDatabaseMetadata]'

    return await this.#apiRequest({
      logTag,
      path: `/database/${ encodeURIComponent(databaseId) }/metadata`,
      method: 'get',
    })
  }

  /**
   * @operationName Sync Database Schema
   * @category Databases
   * @description Triggers a schema sync for a database, prompting Metabase to re-scan the database for new, changed, or removed tables and columns. Returns immediately; the sync runs asynchronously in Metabase.
   * @route POST /database/sync-schema
   *
   * @paramDef {"type":"Number","label":"Database ID","name":"databaseId","required":true,"dictionary":"getDatabasesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the database to sync."}
   *
   * @returns {Object}
   * @sampleResult {"status":"ok"}
   */
  async syncDatabaseSchema(databaseId) {
    const logTag = '[syncDatabaseSchema]'

    return await this.#apiRequest({
      logTag,
      path: `/database/${ encodeURIComponent(databaseId) }/sync_schema`,
      method: 'post',
      body: {},
    })
  }

  /* ------------------------------------------------------------------ *
   * Collections
   * ------------------------------------------------------------------ */

  /**
   * @operationName List Collections
   * @category Collections
   * @description Lists collections (folders that organize cards and dashboards), including each collection's id, name, location, and archived state. Use a collection id with Get Collection Items or when creating/moving cards.
   * @route GET /collections
   *
   * @paramDef {"type":"Boolean","label":"Include Archived","name":"archived","uiComponent":{"type":"TOGGLE"},"description":"When true, include archived collections in the results. Defaults to false."}
   *
   * @returns {Array<Object>}
   * @sampleResult {"collections":[{"id":3,"name":"Analytics","location":"/","archived":false}]}
   */
  async listCollections(archived) {
    const logTag = '[listCollections]'

    const data = await this.#apiRequest({
      logTag,
      path: '/collection',
      method: 'get',
      query: { archived: archived ? 'true' : undefined },
    })

    return { collections: data }
  }

  /**
   * @operationName Get Collection Items
   * @category Collections
   * @description Lists the items inside a collection — cards, dashboards, sub-collections, and other objects — with their id, name, and model type. Optionally restrict to specific model types (e.g. only cards or only dashboards).
   * @route GET /collections/items
   *
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","required":true,"dictionary":"getCollectionsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the collection whose items to list."}
   * @paramDef {"type":"Array<String>","label":"Models","name":"models","uiComponent":{"type":"DROPDOWN","options":{"values":["Card","Dashboard","Dataset","Collection","Snippet","Pulse","Timeline"]}},"description":"Optional: restrict results to these item types. Leave empty for all types."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":12,"name":"Revenue by month","model":"card"}],"total":1}
   */
  async getCollectionItems(collectionId, models) {
    const logTag = '[getCollectionItems]'

    const mapping = {
      Card: 'card',
      Dashboard: 'dashboard',
      Dataset: 'dataset',
      Collection: 'collection',
      Snippet: 'snippet',
      Pulse: 'pulse',
      Timeline: 'timeline',
    }
    const mappedModels = Array.isArray(models) && models.length
      ? models.map(m => this.#resolveChoice(m, mapping))
      : undefined

    return await this.#apiRequest({
      logTag,
      path: `/collection/${ encodeURIComponent(collectionId) }/items`,
      method: 'get',
      query: { models: mappedModels },
    })
  }

  /**
   * @operationName Create Collection
   * @category Collections
   * @description Creates a new collection (folder) for organizing cards and dashboards. Provide a name, an optional description, and an optional parent collection to nest it under. Returns the created collection including its new id.
   * @route POST /collection
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the new collection."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description for the collection."}
   * @paramDef {"type":"Number","label":"Parent Collection ID","name":"parentId","dictionary":"getCollectionsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional id of the parent collection to nest this one under. Leave empty to create it at the root."}
   *
   * @returns {Object}
   * @sampleResult {"id":9,"name":"Q3 Reports","description":"Quarterly reporting","parent_id":3,"archived":false}
   */
  async createCollection(name, description, parentId) {
    const logTag = '[createCollection]'

    const body = clean({ name, description, parent_id: parentId })

    return await this.#apiRequest({ logTag, path: '/collection', method: 'post', body })
  }

  /* ------------------------------------------------------------------ *
   * Dashboards
   * ------------------------------------------------------------------ */

  /**
   * @operationName List Dashboards
   * @category Dashboards
   * @description Lists dashboards in the Metabase instance, including each dashboard's id, name, description, collection, and archived state. Use a dashboard id with Get Dashboard.
   * @route GET /dashboards
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Mine","Archived"]}},"description":"Which set of dashboards to return. Defaults to all non-archived dashboards."}
   *
   * @returns {Array<Object>}
   * @sampleResult {"data":[{"id":7,"name":"Executive Overview","collection_id":3,"archived":false}]}
   */
  async listDashboards(filter) {
    const logTag = '[listDashboards]'
    const f = this.#resolveChoice(filter, { All: undefined, Mine: 'mine', Archived: 'archived' })

    const data = await this.#apiRequest({
      logTag,
      path: '/dashboard',
      method: 'get',
      query: { f },
    })

    return { data }
  }

  /**
   * @operationName Get Dashboard
   * @category Dashboards
   * @description Retrieves a single dashboard by its id, including its name, description, parameters, and the cards (dashcards) placed on it with their layout positions.
   * @route GET /dashboards/get
   *
   * @paramDef {"type":"Number","label":"Dashboard ID","name":"dashboardId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the dashboard to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":7,"name":"Executive Overview","collection_id":3,"dashcards":[{"id":100,"card_id":12,"row":0,"col":0}]}
   */
  async getDashboard(dashboardId) {
    const logTag = '[getDashboard]'

    return await this.#apiRequest({
      logTag,
      path: `/dashboard/${ encodeURIComponent(dashboardId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Dashboard
   * @category Dashboards
   * @description Creates a new, empty dashboard. Provide a name, an optional description, and an optional collection to place it in. Add cards to it afterward in Metabase or via the dashboard cards API. Returns the created dashboard including its new id.
   * @route POST /dashboard
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the new dashboard."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description for the dashboard."}
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","dictionary":"getCollectionsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional id of the collection to place the dashboard in. Leave empty for the root collection."}
   *
   * @returns {Object}
   * @sampleResult {"id":21,"name":"Weekly KPIs","description":"Team KPIs","collection_id":3,"archived":false}
   */
  async createDashboard(name, description, collectionId) {
    const logTag = '[createDashboard]'

    const body = clean({ name, description, collection_id: collectionId })

    return await this.#apiRequest({ logTag, path: '/dashboard', method: 'post', body })
  }

  /* ------------------------------------------------------------------ *
   * Users & Health
   * ------------------------------------------------------------------ */

  /**
   * @operationName List Users
   * @category Users & Health
   * @description Lists user accounts in the Metabase instance, including each user's id, name, email, and status. Requires an admin-level API key to see all users.
   * @route GET /users
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Deactivated","All"]}},"description":"Which users to return by status. Defaults to Active."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":1,"first_name":"Admin","last_name":"User","email":"admin@example.com","is_active":true}],"total":1}
   */
  async listUsers(status) {
    const logTag = '[listUsers]'
    const query = {}

    switch (status) {
      case 'Deactivated':
        query.status = 'deactivated'
        break
      case 'All':
        query.status = 'all'
        break
      default:
        break
    }

    return await this.#apiRequest({ logTag, path: '/user', method: 'get', query })
  }

  /**
   * @operationName Get Current User
   * @category Users & Health
   * @description Returns the account associated with the configured API key, including id, name, email, and permission flags. Use this as a connection check to confirm the server URL and API key are valid.
   * @route GET /users/current
   *
   * @returns {Object}
   * @sampleResult {"id":1,"first_name":"Admin","last_name":"User","email":"admin@example.com","is_superuser":true,"common_name":"Admin User"}
   */
  async getCurrentUser() {
    const logTag = '[getCurrentUser]'

    return await this.#apiRequest({ logTag, path: '/user/current', method: 'get' })
  }

  /**
   * @operationName Health Check
   * @category Users & Health
   * @description Checks whether the Metabase instance is up and healthy. Returns the instance's health status. This endpoint does not require authentication and is useful for readiness checks.
   * @route GET /health
   *
   * @returns {Object}
   * @sampleResult {"status":"ok"}
   */
  async healthCheck() {
    const logTag = '[healthCheck]'

    return await this.#apiRequest({ logTag, path: '/health', method: 'get' })
  }

  /* ------------------------------------------------------------------ *
   * Dictionaries
   * ------------------------------------------------------------------ */

  /**
   * @typedef {Object} getCardsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter cards by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Metabase returns cards in one call, so this is unused but kept for compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Cards Dictionary
   * @description Provides a searchable list of saved questions (cards) for selecting a card id in card operations. Each option's value is the card id.
   * @route POST /cards-dictionary
   * @paramDef {"type":"getCardsDictionary__payload","label":"Payload","name":"payload","description":"Search text used to filter cards by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Revenue by month","value":12,"note":"line"}],"cursor":null}
   */
  async getCardsDictionary(payload) {
    const logTag = '[getCardsDictionary]'
    const { search } = payload || {}

    const cards = await this.#apiRequest({ logTag, path: '/card', method: 'get' })
    const list = Array.isArray(cards) ? cards : []

    return {
      items: this.#filterAndMap(list, search, card => ({
        label: card.name || `Card ${ card.id }`,
        value: card.id,
        note: card.display || undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getDatabasesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter databases by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Metabase returns databases in one call, so this is unused but kept for compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Databases Dictionary
   * @description Provides a searchable list of connected databases for selecting a database id in query and card operations. Each option's value is the database id.
   * @route POST /databases-dictionary
   * @paramDef {"type":"getDatabasesDictionary__payload","label":"Payload","name":"payload","description":"Search text used to filter databases by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sample Database","value":1,"note":"h2"}],"cursor":null}
   */
  async getDatabasesDictionary(payload) {
    const logTag = '[getDatabasesDictionary]'
    const { search } = payload || {}

    const response = await this.#apiRequest({ logTag, path: '/database', method: 'get' })
    const list = Array.isArray(response) ? response : (response && response.data) || []

    return {
      items: this.#filterAndMap(list, search, db => ({
        label: db.name || `Database ${ db.id }`,
        value: db.id,
        note: db.engine || undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getCollectionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter collections by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Metabase returns collections in one call, so this is unused but kept for compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Collections Dictionary
   * @description Provides a searchable list of collections for selecting a collection id when creating or moving cards and dashboards. Each option's value is the collection id.
   * @route POST /collections-dictionary
   * @paramDef {"type":"getCollectionsDictionary__payload","label":"Payload","name":"payload","description":"Search text used to filter collections by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Analytics","value":3,"note":"/"}],"cursor":null}
   */
  async getCollectionsDictionary(payload) {
    const logTag = '[getCollectionsDictionary]'
    const { search } = payload || {}

    const collections = await this.#apiRequest({ logTag, path: '/collection', method: 'get' })
    const list = Array.isArray(collections) ? collections : []

    return {
      items: this.#filterAndMap(list, search, col => ({
        label: col.name || `Collection ${ col.id }`,
        value: col.id,
        note: col.location || undefined,
      })).filter(item => item.value !== undefined && item.value !== null && item.value !== 'root'),
      cursor: null,
    }
  }

  /* ------------------------------------------------------------------ *
   * Private helpers
   * ------------------------------------------------------------------ */

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #parseJsonParam(raw, label, logTag) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return undefined
    }

    if (typeof raw === 'object') {
      return raw
    }

    try {
      return JSON.parse(raw)
    } catch (error) {
      logger.error(`${ logTag } - invalid ${ label }: ${ error.message }`)
      throw new Error(`Metabase API error: ${ label } must be valid JSON.`)
    }
  }

  #buildDatasetQuery(databaseId, sqlQuery, queryJson, logTag) {
    if (databaseId === undefined || databaseId === null || databaseId === '') {
      throw new Error('Metabase API error: Database ID is required to build a query.')
    }

    if (queryJson && String(queryJson).trim()) {
      const parsed = this.#parseJsonParam(queryJson, 'Query JSON', logTag)

      // Accept either a full dataset_query ({database,type,...}) or a bare MBQL query object.
      if (parsed && (parsed.type === 'native' || parsed.type === 'query')) {
        return { database: databaseId, ...parsed }
      }

      return { database: databaseId, type: 'query', query: parsed }
    }

    if (sqlQuery && String(sqlQuery).trim()) {
      return { database: databaseId, type: 'native', native: { query: String(sqlQuery) } }
    }

    throw new Error('Metabase API error: Provide either a SQL Query or a Query JSON.')
  }

  #filterAndMap(list, search, mapFn) {
    const term = search ? String(search).toLowerCase() : ''
    const items = []

    for (const entry of list) {
      const mapped = mapFn(entry)

      if (!term || (mapped.label && mapped.label.toLowerCase().includes(term))) {
        items.push(mapped)
      }
    }

    return items
  }
}

Flowrunner.ServerCode.addService(MetabaseService, [
  {
    name: 'serverUrl',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Metabase URL, e.g. https://myco.metabaseapp.com (strip any trailing slash).',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Create one in Metabase: Admin settings > Authentication > API keys > Create a key. Sent as the x-api-key header.',
  },
])
