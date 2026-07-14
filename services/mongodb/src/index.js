const { MongoClient, ObjectId } = require('mongodb')

const logger = {
  info: (...args) => console.log('[MongoDB] info:', ...args),
  debug: (...args) => console.log('[MongoDB] debug:', ...args),
  error: (...args) => console.log('[MongoDB] error:', ...args),
  warn: (...args) => console.log('[MongoDB] warn:', ...args),
}

const DEFAULT_CONNECTION_TIMEOUT_SECONDS = 10
const DEFAULT_FIND_LIMIT = 100
const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getCollectionsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter collections by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @integrationName MongoDB
 * @integrationIcon /icon.svg
 */
class MongoDB {
  constructor(config) {
    this.config = config || {}

    this.connectionString = (this.config.connectionString || '').trim()
    this.database = this.config.database

    const timeoutSeconds = parseInt(this.config.connectionTimeoutSeconds, 10)

    this.connectionTimeoutMs = (timeoutSeconds > 0 ? timeoutSeconds : DEFAULT_CONNECTION_TIMEOUT_SECONDS) * 1000
  }

  // ==========================================================================
  //  CORE — connection lifecycle: one short-lived MongoClient per method call.
  //  A client is created, connected, used and always closed in finally.
  //  Connections are NEVER cached between invocations.
  // ==========================================================================
  async #withDb(logTag, fn) {
    if (!this.connectionString) {
      throw new Error(
        'MongoDB error: Connection String is not configured. Provide a mongodb:// or mongodb+srv:// URI ' +
        '(for Atlas, copy it from the cluster\'s Connect dialog).'
      )
    }

    if (!this.database || !String(this.database).trim()) {
      throw new Error('MongoDB error: Database is not configured. Provide the database name in the service configuration.')
    }

    const client = new MongoClient(this.connectionString, {
      serverSelectionTimeoutMS: this.connectionTimeoutMs,
      connectTimeoutMS: this.connectionTimeoutMs,
      appName: 'flowrunner-mongodb',
    })

    try {
      logger.debug(`${ logTag } - connecting to ${ this.#connectionLabel() }`)

      await client.connect()

      return await fn(client.db(String(this.database).trim()))
    } catch (error) {
      this.#throwMongoError(error, logTag)
    } finally {
      try {
        await client.close()
      } catch (closeError) {
        logger.warn(`${ logTag } - failed to close connection: ${ closeError.message }`)
      }
    }
  }

  // Human-readable connection target for logs. Never includes credentials: the connection
  // string embeds the password, so only its host part is extracted.
  #connectionLabel() {
    const match = this.connectionString.match(/@([^/?]+)/)

    return match ? `${ match[1] }/${ this.database }` : `connection string/${ this.database }`
  }

  #throwMongoError(error, logTag) {
    const parts = [error.message]

    if (error.codeName) parts.push(`codeName: ${ error.codeName }`)
    if (error.code !== undefined && error.code !== null) parts.push(`code: ${ error.code }`)

    // Server-selection / network failures against Atlas are almost always the cluster's
    // IP Access List rejecting the connection - surface that instead of a bare timeout.
    const errorText = `${ error.name || '' } ${ error.message || '' }`

    if (
      error.name === 'MongoServerSelectionError' ||
      /ENETUNREACH|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ESERVFAIL|querySrv|queryTxt|Server selection timed out/i.test(errorText)
    ) {
      parts.push(
        'hint: the MongoDB server could not be reached. For MongoDB Atlas the most common cause is the ' +
        'Network Access (IP Access List) blocking the connection - in Atlas open Network Access and allow ' +
        '0.0.0.0/0 (or the FlowRunner egress IPs). Also verify the connection string host, that the cluster ' +
        'is not paused, and that the username/password are URL-encoded.'
      )
    }

    const message = parts.join(' | ')

    logger.error(`${ logTag } - failed: ${ message }`)

    throw new Error(`MongoDB error: ${ message }`)
  }

  #requireCollection(collection) {
    if (typeof collection !== 'string' || !collection.trim()) {
      throw new Error('Collection name is required and must be a non-empty string.')
    }

    return collection.trim()
  }

  #requireNonEmptyObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) {
      throw new Error(`${ label } must be a non-empty object.`)
    }
  }

  #isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
      (value.constructor === Object || value.constructor === undefined)
  }

  // ObjectId convenience: deep-walks a filter/document and converts any string that is
  // exactly 24 hex characters into an ObjectId when it sits under an "_id" key - directly
  // ({"_id":"665f..."}), inside operators ({"_id":{"$in":["665f...","665e..."]}}), or under
  // dotted paths ending in "._id". Everything else is left untouched, so string _id values
  // that are not 24-hex (custom string ids) keep working.
  #normalizeFilter(value, underIdKey = false) {
    if (typeof value === 'string') {
      return underIdKey && OBJECT_ID_HEX_PATTERN.test(value) ? new ObjectId(value) : value
    }

    if (Array.isArray(value)) {
      return value.map(item => this.#normalizeFilter(item, underIdKey))
    }

    if (this.#isPlainObject(value)) {
      const result = {}

      for (const [key, item] of Object.entries(value)) {
        const nextUnderIdKey = key === '_id' || key.endsWith('._id') || (underIdKey && key.startsWith('$'))

        result[key] = this.#normalizeFilter(item, nextUnderIdKey)
      }

      return result
    }

    return value
  }

  // Converts BSON-specific values in results to JSON-safe equivalents:
  // ObjectId -> 24-hex string, Date -> ISO string, Long -> number, Decimal128 -> number,
  // Binary -> base64 string, other BSON types -> their string form.
  #serialize(value) {
    if (value === null || value === undefined) return value

    if (Array.isArray(value)) {
      return value.map(item => this.#serialize(item))
    }

    if (value instanceof Date) return value.toISOString()

    if (typeof value === 'object') {
      if (value._bsontype === 'ObjectId') return value.toHexString()
      if (value._bsontype === 'Long') return value.toNumber()
      if (value._bsontype === 'Decimal128') return Number(value.toString())
      if (value._bsontype === 'Binary') return value.toString('base64')
      if (value._bsontype) return value.toString()

      const result = {}

      for (const [key, item] of Object.entries(value)) {
        result[key] = this.#serialize(item)
      }

      return result
    }

    return value
  }

  // update() documents without atomic operators would REPLACE the matched document, which is
  // never what a user building an "update" step intends - wrap them in $set instead.
  #normalizeUpdate(update) {
    this.#requireNonEmptyObject(update, 'Update')

    const hasOperators = Object.keys(update).some(key => key.startsWith('$'))
    const normalized = hasOperators ? update : { $set: update }

    return this.#normalizeFilter(normalized)
  }

  // ==========================================================================
  //  DOCUMENTS — READ
  // ==========================================================================
  /**
   * @operationName Find Documents
   * @description Queries a collection with a MongoDB filter and returns the matching documents plus their count. Supports the full MongoDB query syntax in the filter (comparison, logical and element operators, e.g. {"age":{"$gte":18},"status":"active"}), field projection, sorting, and limit/skip pagination. 24-hex-character strings under an _id key in the filter are automatically converted to ObjectId. ObjectId and Date values in results are returned as strings.
   * @category Documents
   * @route POST /find-documents
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to query."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"MongoDB query filter as a JSON object (e.g. {\"status\":\"active\",\"age\":{\"$gte\":18}}). Leave empty to match all documents. 24-hex strings under _id are converted to ObjectId automatically."}
   * @paramDef {"type":"Object","label":"Projection","name":"projection","description":"Fields to include or exclude as a JSON object (e.g. {\"name\":1,\"email\":1} or {\"password\":0}). Leave empty to return full documents."}
   * @paramDef {"type":"Object","label":"Sort","name":"sort","description":"Sort specification as a JSON object: 1 for ascending, -1 for descending (e.g. {\"createdAt\":-1})."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Maximum number of documents to return. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of matching documents to skip before returning results (for pagination)."}
   * @returns {Object}
   * @sampleResult {"documents":[{"_id":"665f1c2ab7e4a3d2f0a11b22","name":"Ada","status":"active"}],"count":1}
   */
  async findDocuments(collection, filter, projection, sort, limit, skip) {
    const collectionName = this.#requireCollection(collection)
    const normalizedFilter = this.#normalizeFilter(filter || {})

    return this.#withDb('findDocuments', async db => {
      let query = db.collection(collectionName).find(normalizedFilter)

      if (projection && Object.keys(projection).length) query = query.project(projection)
      if (sort && Object.keys(sort).length) query = query.sort(sort)
      if (skip !== undefined && skip !== null && skip !== '') query = query.skip(parseInt(skip, 10) || 0)

      const effectiveLimit = limit !== undefined && limit !== null && limit !== '' ? parseInt(limit, 10) : DEFAULT_FIND_LIMIT

      if (effectiveLimit > 0) query = query.limit(effectiveLimit)

      const documents = await query.toArray()

      return { documents: this.#serialize(documents), count: documents.length }
    })
  }

  /**
   * @operationName Find One Document
   * @description Returns the first document matching a MongoDB filter, or null when nothing matches. Supports the full MongoDB query syntax in the filter and optional field projection. 24-hex-character strings under an _id key are automatically converted to ObjectId, so {"_id":"665f1c2ab7e4a3d2f0a11b22"} finds a document by its ObjectId directly.
   * @category Documents
   * @route POST /find-one-document
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to query."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":true,"description":"MongoDB query filter as a JSON object (e.g. {\"_id\":\"665f1c2ab7e4a3d2f0a11b22\"} or {\"email\":\"ada@example.com\"}). 24-hex strings under _id are converted to ObjectId automatically."}
   * @paramDef {"type":"Object","label":"Projection","name":"projection","description":"Fields to include or exclude as a JSON object (e.g. {\"name\":1,\"email\":1}). Leave empty to return the full document."}
   * @returns {Object}
   * @sampleResult {"document":{"_id":"665f1c2ab7e4a3d2f0a11b22","name":"Ada","email":"ada@example.com"},"found":true}
   */
  async findOneDocument(collection, filter, projection) {
    const collectionName = this.#requireCollection(collection)

    this.#requireNonEmptyObject(filter, 'Filter')

    const normalizedFilter = this.#normalizeFilter(filter)
    const options = projection && Object.keys(projection).length ? { projection } : {}

    return this.#withDb('findOneDocument', async db => {
      const document = await db.collection(collectionName).findOne(normalizedFilter, options)

      return { document: this.#serialize(document), found: document !== null }
    })
  }

  // ==========================================================================
  //  DOCUMENTS — WRITE
  // ==========================================================================
  /**
   * @operationName Insert Document
   * @description Inserts a single document into a collection and returns the generated (or provided) _id as a string. When no _id is supplied MongoDB generates an ObjectId; a supplied _id that is a 24-hex-character string is converted to an ObjectId automatically.
   * @category Documents
   * @route POST /insert-document
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to insert into. Created automatically if it does not exist."}
   * @paramDef {"type":"Object","label":"Document","name":"document","required":true,"description":"The document to insert as a JSON object (e.g. {\"name\":\"Ada\",\"email\":\"ada@example.com\"}). An _id that is a 24-hex string is converted to ObjectId."}
   * @returns {Object}
   * @sampleResult {"insertedId":"665f1c2ab7e4a3d2f0a11b22","acknowledged":true}
   */
  async insertDocument(collection, document) {
    const collectionName = this.#requireCollection(collection)

    this.#requireNonEmptyObject(document, 'Document')

    const normalizedDocument = this.#normalizeFilter(document)

    return this.#withDb('insertDocument', async db => {
      const result = await db.collection(collectionName).insertOne(normalizedDocument)

      return { insertedId: this.#serialize(result.insertedId), acknowledged: result.acknowledged }
    })
  }

  /**
   * @operationName Insert Documents
   * @description Bulk-inserts an array of documents into a collection in a single call and returns the inserted count plus a map of array index to generated _id (as strings). Supplied _id values that are 24-hex-character strings are converted to ObjectId automatically.
   * @category Documents
   * @route POST /insert-documents
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to insert into. Created automatically if it does not exist."}
   * @paramDef {"type":"Array<Object>","label":"Documents","name":"documents","required":true,"description":"An array of documents to insert (e.g. [{\"name\":\"Ada\"},{\"name\":\"Linus\"}])."}
   * @returns {Object}
   * @sampleResult {"insertedCount":2,"insertedIds":{"0":"665f1c2ab7e4a3d2f0a11b22","1":"665f1c2ab7e4a3d2f0a11b23"}}
   */
  async insertDocuments(collection, documents) {
    const collectionName = this.#requireCollection(collection)

    if (!Array.isArray(documents) || !documents.length) {
      throw new Error('Documents must be a non-empty array of objects.')
    }

    documents.forEach((document, index) => this.#requireNonEmptyObject(document, `Documents[${ index }]`))

    const normalizedDocuments = documents.map(document => this.#normalizeFilter(document))

    return this.#withDb('insertDocuments', async db => {
      const result = await db.collection(collectionName).insertMany(normalizedDocuments)

      return { insertedCount: result.insertedCount, insertedIds: this.#serialize(result.insertedIds) }
    })
  }

  /**
   * @operationName Update Document
   * @description Updates the first document matching the filter. The Update object may use MongoDB update operators ($set, $inc, $push, $unset, ...); if it contains no $-operators it is automatically wrapped in {"$set": ...} so plain field/value objects update fields instead of replacing the document. Optionally upserts (inserts a new document) when nothing matches. 24-hex strings under _id in the filter are converted to ObjectId.
   * @category Documents
   * @route PATCH /update-document
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to update."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":true,"description":"MongoDB query filter selecting the document to update (e.g. {\"_id\":\"665f1c2ab7e4a3d2f0a11b22\"}). 24-hex strings under _id are converted to ObjectId automatically."}
   * @paramDef {"type":"Object","label":"Update","name":"update","required":true,"description":"Update to apply. Either update operators (e.g. {\"$set\":{\"status\":\"archived\"},\"$inc\":{\"loginCount\":1}}) or a plain field/value object (e.g. {\"status\":\"archived\"}), which is wrapped in $set automatically."}
   * @paramDef {"type":"Boolean","label":"Upsert","name":"upsert","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"When enabled, inserts a new document (combining filter and update) if no document matches the filter."}
   * @returns {Object}
   * @sampleResult {"matchedCount":1,"modifiedCount":1,"upsertedId":null}
   */
  async updateDocument(collection, filter, update, upsert) {
    const collectionName = this.#requireCollection(collection)

    this.#requireNonEmptyObject(filter, 'Filter')

    const normalizedFilter = this.#normalizeFilter(filter)
    const normalizedUpdate = this.#normalizeUpdate(update)

    return this.#withDb('updateDocument', async db => {
      const result = await db.collection(collectionName).updateOne(normalizedFilter, normalizedUpdate, { upsert: upsert === true })

      return {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: this.#serialize(result.upsertedId ?? null),
      }
    })
  }

  /**
   * @operationName Update Documents
   * @description Updates ALL documents matching the filter in a single operation. The Update object may use MongoDB update operators ($set, $inc, $push, $unset, ...); if it contains no $-operators it is automatically wrapped in {"$set": ...}. A non-empty filter is required to prevent accidental collection-wide updates from an empty input — to intentionally update every document, use a match-all filter such as {"_id":{"$exists":true}}. Optionally upserts when nothing matches.
   * @category Documents
   * @route PATCH /update-documents
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to update."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":true,"description":"MongoDB query filter selecting the documents to update (e.g. {\"status\":\"active\"}). Must be non-empty. 24-hex strings under _id are converted to ObjectId automatically."}
   * @paramDef {"type":"Object","label":"Update","name":"update","required":true,"description":"Update to apply to every matched document. Either update operators (e.g. {\"$set\":{\"status\":\"archived\"}}) or a plain field/value object, which is wrapped in $set automatically."}
   * @paramDef {"type":"Boolean","label":"Upsert","name":"upsert","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"When enabled, inserts a new document (combining filter and update) if no document matches the filter."}
   * @returns {Object}
   * @sampleResult {"matchedCount":5,"modifiedCount":5,"upsertedId":null}
   */
  async updateDocuments(collection, filter, update, upsert) {
    const collectionName = this.#requireCollection(collection)

    this.#requireNonEmptyObject(filter, 'Filter')

    const normalizedFilter = this.#normalizeFilter(filter)
    const normalizedUpdate = this.#normalizeUpdate(update)

    return this.#withDb('updateDocuments', async db => {
      const result = await db.collection(collectionName).updateMany(normalizedFilter, normalizedUpdate, { upsert: upsert === true })

      return {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: this.#serialize(result.upsertedId ?? null),
      }
    })
  }

  /**
   * @operationName Replace Document
   * @description Replaces the ENTIRE first document matching the filter with the provided replacement document (all previous fields are removed except _id). Use Update Document instead to change individual fields. Optionally upserts when nothing matches. 24-hex strings under _id in the filter are converted to ObjectId.
   * @category Documents
   * @route PUT /replace-document
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection containing the document to replace."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":true,"description":"MongoDB query filter selecting the document to replace (e.g. {\"_id\":\"665f1c2ab7e4a3d2f0a11b22\"}). 24-hex strings under _id are converted to ObjectId automatically."}
   * @paramDef {"type":"Object","label":"Replacement","name":"replacement","required":true,"description":"The full new document as a JSON object. Must not contain update operators ($set etc.). The existing _id is preserved."}
   * @paramDef {"type":"Boolean","label":"Upsert","name":"upsert","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"When enabled, inserts the replacement as a new document if no document matches the filter."}
   * @returns {Object}
   * @sampleResult {"matchedCount":1,"modifiedCount":1,"upsertedId":null}
   */
  async replaceDocument(collection, filter, replacement, upsert) {
    const collectionName = this.#requireCollection(collection)

    this.#requireNonEmptyObject(filter, 'Filter')
    this.#requireNonEmptyObject(replacement, 'Replacement')

    const normalizedFilter = this.#normalizeFilter(filter)
    const normalizedReplacement = this.#normalizeFilter(replacement)

    return this.#withDb('replaceDocument', async db => {
      const result = await db
        .collection(collectionName)
        .replaceOne(normalizedFilter, normalizedReplacement, { upsert: upsert === true })

      return {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: this.#serialize(result.upsertedId ?? null),
      }
    })
  }

  /**
   * @operationName Delete Document
   * @description Deletes the first document matching the filter and returns the deleted count (0 or 1). A non-empty filter is required to prevent accidental deletions from an empty input. 24-hex strings under _id in the filter are converted to ObjectId, so {"_id":"665f1c2ab7e4a3d2f0a11b22"} deletes a document by id directly.
   * @category Documents
   * @route DELETE /delete-document
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to delete from."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":true,"description":"MongoDB query filter selecting the document to delete (e.g. {\"_id\":\"665f1c2ab7e4a3d2f0a11b22\"}). Must be non-empty. 24-hex strings under _id are converted to ObjectId automatically."}
   * @returns {Object}
   * @sampleResult {"deletedCount":1}
   */
  async deleteDocument(collection, filter) {
    const collectionName = this.#requireCollection(collection)

    this.#requireNonEmptyObject(filter, 'Filter')

    const normalizedFilter = this.#normalizeFilter(filter)

    return this.#withDb('deleteDocument', async db => {
      const result = await db.collection(collectionName).deleteOne(normalizedFilter)

      return { deletedCount: result.deletedCount }
    })
  }

  /**
   * @operationName Delete Documents
   * @description Deletes ALL documents matching the filter and returns the deleted count. A non-empty filter is required to prevent accidental collection-wide deletion from an empty input — to intentionally delete every document, use a match-all filter such as {"_id":{"$exists":true}}, or drop and recreate the collection.
   * @category Documents
   * @route DELETE /delete-documents
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to delete from."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":true,"description":"MongoDB query filter selecting the documents to delete (e.g. {\"status\":\"archived\"}). Must be non-empty. 24-hex strings under _id are converted to ObjectId automatically."}
   * @returns {Object}
   * @sampleResult {"deletedCount":42}
   */
  async deleteDocuments(collection, filter) {
    const collectionName = this.#requireCollection(collection)

    this.#requireNonEmptyObject(filter, 'Filter')

    const normalizedFilter = this.#normalizeFilter(filter)

    return this.#withDb('deleteDocuments', async db => {
      const result = await db.collection(collectionName).deleteMany(normalizedFilter)

      return { deletedCount: result.deletedCount }
    })
  }

  // ==========================================================================
  //  AGGREGATION & ANALYSIS
  // ==========================================================================
  /**
   * @operationName Count Documents
   * @description Counts the documents matching a MongoDB filter (full query syntax supported). Leave the filter empty to count all documents in the collection. 24-hex strings under _id in the filter are converted to ObjectId automatically.
   * @category Aggregation
   * @route POST /count-documents
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to count documents in."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"MongoDB query filter as a JSON object (e.g. {\"status\":\"active\"}). Leave empty to count all documents."}
   * @returns {Object}
   * @sampleResult {"count":128}
   */
  async countDocuments(collection, filter) {
    const collectionName = this.#requireCollection(collection)
    const normalizedFilter = this.#normalizeFilter(filter || {})

    return this.#withDb('countDocuments', async db => {
      const count = await db.collection(collectionName).countDocuments(normalizedFilter)

      return { count }
    })
  }

  /**
   * @operationName Distinct Values
   * @description Returns the distinct values of a field across the documents matching an optional filter, plus the number of distinct values. Works with nested fields using dot notation (e.g. address.city). ObjectId and Date values are returned as strings.
   * @category Aggregation
   * @route POST /distinct-values
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to read from."}
   * @paramDef {"type":"String","label":"Field","name":"field","required":true,"description":"The field whose distinct values to return. Supports dot notation for nested fields (e.g. address.city)."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Optional MongoDB query filter restricting which documents are considered (e.g. {\"status\":\"active\"})."}
   * @returns {Object}
   * @sampleResult {"values":["London","Paris","Tokyo"],"count":3}
   */
  async distinctValues(collection, field, filter) {
    const collectionName = this.#requireCollection(collection)

    if (typeof field !== 'string' || !field.trim()) {
      throw new Error('Field is required and must be a non-empty string.')
    }

    const normalizedFilter = this.#normalizeFilter(filter || {})

    return this.#withDb('distinctValues', async db => {
      const values = await db.collection(collectionName).distinct(field.trim(), normalizedFilter)

      return { values: this.#serialize(values), count: values.length }
    })
  }

  /**
   * @operationName Aggregate
   * @description Runs a MongoDB aggregation pipeline (an ordered array of stages such as $match, $group, $sort, $project, $lookup, $unwind, $facet) and returns the resulting documents. The pipeline runs with allowDiskUse enabled so large $group/$sort stages are not memory-bound, and the operation is allowed up to 120 seconds. 24-hex strings under _id keys in pipeline stages are converted to ObjectId; results are returned JSON-safe (ObjectId/Date as strings).
   * @category Aggregation
   * @route POST /aggregate
   * @appearanceColor #47A248 #00684A
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection the pipeline reads from."}
   * @paramDef {"type":"Array<Object>","label":"Pipeline","name":"pipeline","required":true,"description":"Aggregation pipeline as an array of stage objects, executed in order (e.g. [{\"$match\":{\"status\":\"active\"}},{\"$group\":{\"_id\":\"$country\",\"total\":{\"$sum\":1}}},{\"$sort\":{\"total\":-1}}])."}
   * @returns {Object}
   * @sampleResult {"results":[{"_id":"US","total":42},{"_id":"UK","total":17}],"count":2}
   */
  async aggregate(collection, pipeline) {
    const collectionName = this.#requireCollection(collection)

    if (!Array.isArray(pipeline) || !pipeline.length) {
      throw new Error('Pipeline must be a non-empty array of aggregation stage objects.')
    }

    const normalizedPipeline = pipeline.map(stage => this.#normalizeFilter(stage))

    return this.#withDb('aggregate', async db => {
      const results = await db.collection(collectionName).aggregate(normalizedPipeline, { allowDiskUse: true }).toArray()

      return { results: this.#serialize(results), count: results.length }
    })
  }

  // ==========================================================================
  //  COLLECTIONS
  // ==========================================================================
  /**
   * @operationName List Collections
   * @description Lists all collections and views in the configured database with each one's name and type (collection, view, or timeseries). Useful for discovering what data is available before reading or writing.
   * @category Collections
   * @route GET /collections
   * @appearanceColor #47A248 #00684A
   * @returns {Object}
   * @sampleResult {"collections":[{"name":"users","type":"collection"},{"name":"active_users","type":"view"}],"count":2}
   */
  async listCollections() {
    return this.#withDb('listCollections', async db => {
      const collections = await db.listCollections({}, { nameOnly: false }).toArray()

      const items = collections
        .map(item => ({ name: item.name, type: item.type || 'collection' }))
        .sort((a, b) => a.name.localeCompare(b.name))

      return { collections: items, count: items.length }
    })
  }

  /**
   * @operationName Create Collection
   * @description Explicitly creates a new collection in the configured database. MongoDB also creates collections implicitly on first insert, so this is mainly useful to create a collection ahead of time. Fails if a collection with the same name already exists.
   * @category Collections
   * @route POST /create-collection
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection Name","name":"name","required":true,"description":"Name of the collection to create (e.g. orders)."}
   * @returns {Object}
   * @sampleResult {"collection":"orders","created":true}
   */
  async createCollection(name) {
    const collectionName = this.#requireCollection(name)

    return this.#withDb('createCollection', async db => {
      await db.createCollection(collectionName)

      return { collection: collectionName, created: true }
    })
  }

  /**
   * @operationName Drop Collection
   * @description DESTRUCTIVE: permanently deletes an entire collection, including ALL of its documents and indexes. This cannot be undone. Returns whether the collection was dropped (false when it did not exist).
   * @category Collections
   * @route DELETE /drop-collection
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to permanently delete. All documents and indexes in it are irreversibly removed."}
   * @returns {Object}
   * @sampleResult {"collection":"old_logs","dropped":true}
   */
  async dropCollection(collection) {
    const collectionName = this.#requireCollection(collection)

    return this.#withDb('dropCollection', async db => {
      const dropped = await db.collection(collectionName).drop().catch(error => {
        if (error.codeName === 'NamespaceNotFound' || /ns not found/i.test(error.message)) return false

        throw error
      })

      return { collection: collectionName, dropped }
    })
  }

  // ==========================================================================
  //  INDEXES
  // ==========================================================================
  /**
   * @operationName Create Index
   * @description Creates an index on a collection from a keys specification (1 ascending, -1 descending, or "text"/"2dsphere" for special indexes) and optional index options such as unique, a custom name, sparse, or expireAfterSeconds for TTL indexes. Returns the created index name. Creating an index that already exists is a no-op.
   * @category Indexes
   * @route POST /create-index
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to index."}
   * @paramDef {"type":"Object","label":"Keys","name":"keys","required":true,"description":"Index key specification as a JSON object: 1 for ascending, -1 for descending (e.g. {\"email\":1} or {\"userId\":1,\"createdAt\":-1}); string values create special indexes (e.g. {\"bio\":\"text\"})."}
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Optional index options as a JSON object, e.g. {\"unique\":true}, {\"name\":\"email_unique\"}, {\"sparse\":true}, or {\"expireAfterSeconds\":3600} for a TTL index on a date field."}
   * @returns {Object}
   * @sampleResult {"indexName":"email_1","collection":"users"}
   */
  async createIndex(collection, keys, options) {
    const collectionName = this.#requireCollection(collection)

    this.#requireNonEmptyObject(keys, 'Keys')

    return this.#withDb('createIndex', async db => {
      const indexName = await db.collection(collectionName).createIndex(keys, this.#isPlainObject(options) ? options : {})

      return { indexName, collection: collectionName }
    })
  }

  /**
   * @operationName List Indexes
   * @description Lists all indexes defined on a collection, including each index's name, key specification, and options such as unique or expireAfterSeconds. Every collection has at least the default _id index.
   * @category Indexes
   * @route GET /list-indexes
   * @appearanceColor #47A248 #00684A
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"dictionary":"getCollectionsDictionary","description":"The collection whose indexes to list."}
   * @returns {Object}
   * @sampleResult {"indexes":[{"name":"_id_","key":{"_id":1}},{"name":"email_1","key":{"email":1},"unique":true}],"count":2}
   */
  async listIndexes(collection) {
    const collectionName = this.#requireCollection(collection)

    return this.#withDb('listIndexes', async db => {
      const indexes = await db.collection(collectionName).indexes()

      return { indexes: this.#serialize(indexes), count: indexes.length }
    })
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Collections Dictionary
   * @description Provides a searchable list of collections and views in the configured database for dynamic dropdown selection in other operations.
   * @route POST /get-collections-dictionary
   * @paramDef {"type":"getCollectionsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"users","value":"users","note":"collection"}],"cursor":null}
   */
  async getCollectionsDictionary(payload) {
    const { search } = payload || {}

    return this.#withDb('getCollectionsDictionary', async db => {
      const collections = await db.listCollections({}, { nameOnly: false }).toArray()
      const searchText = (search || '').toLowerCase()

      const items = collections
        .filter(item => !searchText || item.name.toLowerCase().includes(searchText))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(item => ({ name: item.name, type: item.type || 'collection' }))

      return {
        items: items.map(item => ({ label: item.name, value: item.name, note: item.type })),
        cursor: null,
      }
    })
  }
}

Flowrunner.ServerCode.addService(MongoDB, [
  {
    name: 'connectionString',
    displayName: 'Connection String',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Full MongoDB connection URI: mongodb:// for self-hosted servers or mongodb+srv:// for MongoDB Atlas, e.g. mongodb+srv://user:password@cluster0.xxxxx.mongodb.net - copy it from the Atlas cluster\'s Connect dialog ("Drivers"). Special characters in the username or password must be URL-encoded (e.g. @ becomes %40). For Atlas, make sure Network Access (IP Access List) allows connections from FlowRunner (e.g. 0.0.0.0/0 or the FlowRunner egress IPs).',
  },
  {
    name: 'database',
    displayName: 'Database',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Name of the database to work with (e.g. myapp). All operations run against collections in this database.',
  },
  {
    name: 'connectionTimeoutSeconds',
    displayName: 'Connection Timeout (seconds)',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '10',
    hint: 'How long to wait when establishing a connection and selecting a server before failing. Defaults to 10 seconds.',
  },
])
