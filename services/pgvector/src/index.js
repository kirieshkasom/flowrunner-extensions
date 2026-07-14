const pg = require('pg')

const logger = {
  info: (...args) => console.log('[PGVector] info:', ...args),
  debug: (...args) => console.log('[PGVector] debug:', ...args),
  error: (...args) => console.log('[PGVector] error:', ...args),
  warn: (...args) => console.log('[PGVector] warn:', ...args),
}

const DEFAULT_PORT = 5432
const DEFAULT_CONNECTION_TIMEOUT_SECONDS = 10
const STATEMENT_TIMEOUT_MS = 120000
const DICTIONARY_PAGE_SIZE = 200

// Maps friendly distance-metric labels to pgvector operators.
// <=> cosine distance, <-> L2 (Euclidean) distance, <#> negative inner product.
// All three yield a value where SMALLER means MORE similar, so ORDER BY distance ASC
// consistently returns nearest neighbours first.
const METRIC_OPERATORS = {
  'Cosine': '<=>',
  'L2': '<->',
  'Inner Product': '<#>',
}

// Maps friendly distance-metric labels to the operator class used by an index.
const METRIC_OPS_CLASSES = {
  'Cosine': 'vector_cosine_ops',
  'L2': 'vector_l2_ops',
  'Inner Product': 'vector_ip_ops',
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getTablesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tables and views by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getColumnsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Table","name":"table","description":"The table whose columns populate the list."}
 */

/**
 * @typedef {Object} getColumnsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter columns by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getColumnsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The table whose columns to list."}
 */

/**
 * @integrationName PGVector
 * @integrationIcon /icon.png
 */
class PGVector {
  constructor(config) {
    this.config = config || {}

    this.connectionString = (this.config.connectionString || '').trim()
    this.host = this.config.host
    this.port = parseInt(this.config.port, 10) || DEFAULT_PORT
    this.database = this.config.database
    this.user = this.config.user
    this.password = this.config.password
    this.ssl = this.config.ssl === true || this.config.ssl === 'true'

    const timeoutSeconds = parseInt(this.config.connectionTimeoutSeconds, 10)

    this.connectionTimeoutMillis = (timeoutSeconds > 0 ? timeoutSeconds : DEFAULT_CONNECTION_TIMEOUT_SECONDS) * 1000
  }

  // ==========================================================================
  //  CORE — connection lifecycle: one short-lived pg.Client per method call.
  //  A client is created, connected, used and always closed in finally.
  //  Connections are NEVER cached between invocations.
  // ==========================================================================
  async #withClient(logTag, fn) {
    const client = new pg.Client(this.#buildClientConfig(logTag))

    try {
      logger.debug(`${ logTag } - connecting to ${ this.#connectionLabel() }`)

      await client.connect()

      return await fn(client)
    } catch (error) {
      this.#throwPgError(error, logTag)
    } finally {
      try {
        await client.end()
      } catch (endError) {
        logger.warn(`${ logTag } - failed to close connection: ${ endError.message }`)
      }
    }
  }

  // A Connection String, when set, wins over the individual fields. When using it, the SSL
  // toggle only ADDS the managed-provider-friendly ssl config on top; when the toggle is off
  // the string's own sslmode/ssl query params stay in effect (we must not pass ssl: false,
  // as explicit config overrides values parsed from the string).
  #buildClientConfig(logTag) {
    const shared = {
      connectionTimeoutMillis: this.connectionTimeoutMillis,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      query_timeout: STATEMENT_TIMEOUT_MS,
      application_name: 'flowrunner-pgvector',
    }

    if (this.connectionString) {
      return {
        connectionString: this.connectionString,
        ...(this.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
        ...shared,
      }
    }

    if (!this.host || !this.database || !this.user) {
      logger.error(`${ logTag } - incomplete connection configuration`)

      throw new Error(
        'PGVector error: incomplete connection configuration. ' +
        'Provide a Connection String (e.g. postgresql://user:password@host:5432/database), ' +
        'or fill in Host, Database, User and Password in the service configuration.'
      )
    }

    return {
      host: this.host,
      port: this.port,
      database: this.database,
      user: this.user,
      password: this.password,
      ssl: this.ssl ? { rejectUnauthorized: false } : false,
      ...shared,
    }
  }

  // Human-readable connection target for logs. Never includes credentials: the connection
  // string embeds the password, so only its host part is extracted.
  #connectionLabel() {
    if (this.connectionString) {
      const match = this.connectionString.match(/@([^/?]+)/)

      return match ? `${ match[1] } (connection string)` : 'connection string'
    }

    return `${ this.host }:${ this.port }/${ this.database }`
  }

  #throwPgError(error, logTag) {
    const parts = [error.message]

    if (error.code) parts.push(`code: ${ error.code }`)
    if (error.detail) parts.push(`detail: ${ error.detail }`)
    if (error.hint) parts.push(`hint: ${ error.hint }`)

    // ENETUNREACH against an IPv6 address means the host resolved to IPv6 only and this
    // environment has no IPv6 route - common with Supabase's direct endpoint. Point the
    // user at an IPv4-compatible endpoint instead of leaving them with a bare ENETUNREACH.
    if (error.code === 'ENETUNREACH' && String(error.address || '').includes(':')) {
      parts.push(
        'hint: the database host resolved to an IPv6-only address and this environment has no IPv6 connectivity. ' +
        'Use an IPv4-compatible endpoint - for Supabase, copy the "Session pooler" connection string ' +
        '(postgres.<project-ref>@aws-0-<region>.pooler.supabase.com:5432) from the dashboard\'s Connect dialog ' +
        'instead of the direct db.<project-ref>.supabase.co address.'
      )
    }

    const message = parts.join(' | ')

    logger.error(`${ logTag } - failed: ${ message }`)

    throw new Error(`PGVector error: ${ message }`)
  }

  // Quotes a single SQL identifier (column name). Identifiers cannot be bound
  // as query parameters, so they are escaped with double-quote doubling.
  #quoteIdent(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`Invalid identifier: ${ JSON.stringify(name) }. Identifiers must be non-empty strings.`)
    }

    return `"${ name.replace(/"/g, '""') }"`
  }

  // Quotes a table reference, supporting optional schema qualification ("public.items").
  #quoteTable(table) {
    const { schema, name } = this.#splitTable(table)

    return `${ this.#quoteIdent(schema) }.${ this.#quoteIdent(name) }`
  }

  #splitTable(table) {
    if (typeof table !== 'string' || !table.trim()) {
      throw new Error('Table name is required and must be a non-empty string.')
    }

    const separatorIndex = table.indexOf('.')

    if (separatorIndex === -1) {
      return { schema: 'public', name: table }
    }

    return { schema: table.slice(0, separatorIndex), name: table.slice(separatorIndex + 1) }
  }

  // Builds a parameterized WHERE clause from a conditions object.
  // null values become IS NULL; array values become = ANY($n); everything else uses equality.
  #buildWhere(where, params) {
    const entries = Object.entries(where || {})

    if (!entries.length) return ''

    const clauses = entries.map(([column, value]) => {
      if (value === null) {
        return `${ this.#quoteIdent(column) } IS NULL`
      }

      params.push(value)

      if (Array.isArray(value)) {
        return `${ this.#quoteIdent(column) } = ANY($${ params.length })`
      }

      return `${ this.#quoteIdent(column) } = $${ params.length }`
    })

    return ` WHERE ${ clauses.join(' AND ') }`
  }

  #requireNonEmptyObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) {
      throw new Error(`${ label } must be a non-empty object.`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ==========================================================================
  //  VECTOR HELPERS
  // ==========================================================================
  // Converts a JavaScript array of numbers into a pgvector string literal, e.g.
  // [0.1, 0.2, 0.3] -> '[0.1,0.2,0.3]'. pgvector accepts this literal both for
  // stored values and as the right-hand side of a distance operator. Each element
  // is validated as a finite number so no unexpected text ever reaches the vector
  // column; the resulting string is still passed to Postgres as a BOUND parameter,
  // never interpolated into SQL.
  #toVectorLiteral(array) {
    if (!Array.isArray(array) || !array.length) {
      throw new Error('Embedding must be a non-empty array of numbers.')
    }

    const values = array.map((value, index) => {
      const num = typeof value === 'number' ? value : Number(value)

      if (!Number.isFinite(num)) {
        throw new Error(`Embedding element at index ${ index } is not a finite number: ${ JSON.stringify(value) }.`)
      }

      return num
    })

    return `[${ values.join(',') }]`
  }

  // ==========================================================================
  //  EXTENSION & SCHEMA MANAGEMENT
  // ==========================================================================
  /**
   * @operationName Enable Extension
   * @description Enables the pgvector extension on the connected database by running CREATE EXTENSION IF NOT EXISTS vector. Run this once per database before creating vector tables, indexes, or performing similarity searches. Requires a role with privileges to create extensions (typically a superuser or the database owner); most managed providers such as Supabase, Neon and AWS RDS ship pgvector and permit this.
   * @category Extension
   * @route POST /enable-extension
   * @appearanceColor #336791 #4E8CBF
   * @returns {Object}
   * @sampleResult {"enabled":true,"extension":"vector"}
   */
  async enableExtension() {
    return this.#withClient('enableExtension', async client => {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector')

      return { enabled: true, extension: 'vector' }
    })
  }

  /**
   * @operationName Create Vector Table
   * @description Creates a table with a pgvector column of the given fixed dimension, plus an id column and any optional metadata columns. The id column type is selectable: Serial (auto-incrementing integer primary key), Text (text primary key), or UUID (uuid primary key). Metadata columns are added with the raw Postgres type you specify (e.g. text, int, jsonb, timestamptz). The table is created only if it does not already exist. Ensure the pgvector extension is enabled first (see Enable Extension).
   * @category Tables
   * @route POST /create-vector-table
   * @appearanceColor #336791 #4E8CBF
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"description":"Name of the table to create. May be schema-qualified (e.g. public.documents); defaults to the public schema."}
   * @paramDef {"type":"String","label":"ID Column","name":"idColumn","defaultValue":"id","description":"Name of the primary-key column. Defaults to id."}
   * @paramDef {"type":"String","label":"ID Type","name":"idType","uiComponent":{"type":"DROPDOWN","options":{"values":["Serial","Text","UUID"]}},"defaultValue":"Serial","description":"Primary-key type: Serial (auto-incrementing integer), Text, or UUID."}
   * @paramDef {"type":"String","label":"Embedding Column","name":"embeddingColumn","defaultValue":"embedding","description":"Name of the vector column. Defaults to embedding."}
   * @paramDef {"type":"Number","label":"Dimension","name":"dimension","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Fixed number of dimensions for the vector column (e.g. 1536 for OpenAI text-embedding-3-small). Must match the length of every embedding stored in this column."}
   * @paramDef {"type":"Array<Object>","label":"Metadata Columns","name":"metadataColumns","description":"Optional extra columns as an array of {name, type} objects, where type is a raw Postgres type (e.g. [{\"name\":\"content\",\"type\":\"text\"},{\"name\":\"source\",\"type\":\"text\"},{\"name\":\"metadata\",\"type\":\"jsonb\"}])."}
   * @returns {Object}
   * @sampleResult {"created":true,"table":"public.documents","embeddingColumn":"embedding","dimension":1536,"idColumn":"id"}
   */
  async createVectorTable(table, idColumn, idType, embeddingColumn, dimension, metadataColumns) {
    const idName = (idColumn || 'id').trim() || 'id'
    const embeddingName = (embeddingColumn || 'embedding').trim() || 'embedding'
    const dim = parseInt(dimension, 10)

    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error('Dimension is required and must be a positive integer.')
    }

    const idDefinition = this.#resolveChoice(idType, {
      'Serial': 'serial PRIMARY KEY',
      'Text': 'text PRIMARY KEY',
      'UUID': 'uuid PRIMARY KEY',
    }) || 'serial PRIMARY KEY'

    const columnDefs = [
      `${ this.#quoteIdent(idName) } ${ idDefinition }`,
      `${ this.#quoteIdent(embeddingName) } vector(${ dim })`,
    ]

    if (Array.isArray(metadataColumns)) {
      metadataColumns.forEach((column, index) => {
        if (!column || typeof column !== 'object' || !column.name || !column.type) {
          throw new Error(`Metadata Columns[${ index }] must be an object with "name" and "type".`)
        }

        // The Postgres type is validated to a safe token set: identifier-like words,
        // digits, spaces, parentheses and commas (covers vector(1536), numeric(10,2),
        // timestamptz, jsonb, etc.). Anything else is rejected rather than interpolated.
        if (!/^[A-Za-z0-9_ (),]+$/.test(String(column.type).trim())) {
          throw new Error(`Metadata Columns[${ index }] has an invalid type: ${ JSON.stringify(column.type) }.`)
        }

        columnDefs.push(`${ this.#quoteIdent(column.name) } ${ String(column.type).trim() }`)
      })
    }

    const sql = `CREATE TABLE IF NOT EXISTS ${ this.#quoteTable(table) } (\n  ${ columnDefs.join(',\n  ') }\n)`

    return this.#withClient('createVectorTable', async client => {
      await client.query(sql)

      const { schema, name } = this.#splitTable(table)

      return {
        created: true,
        table: `${ schema }.${ name }`,
        embeddingColumn: embeddingName,
        dimension: dim,
        idColumn: idName,
      }
    })
  }

  /**
   * @operationName Create Index
   * @description Creates an approximate-nearest-neighbour index on a vector column to dramatically speed up similarity searches on large tables (without an index, searches perform an exact but slower full scan). Choose HNSW (higher recall and query speed, slower to build, more memory) or IVFFlat (faster to build, less memory; best created after the table already holds representative data). The metric must match the metric used at query time. HNSW accepts optional m and ef_construction tuning; IVFFlat accepts an optional lists count.
   * @category Indexes
   * @route POST /create-index
   * @appearanceColor #336791 #4E8CBF
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table containing the vector column. May be schema-qualified (e.g. public.documents)."}
   * @paramDef {"type":"String","label":"Embedding Column","name":"embeddingColumn","required":true,"dictionary":"getColumnsDictionary","dependsOn":["table"],"defaultValue":"embedding","description":"The vector column to index."}
   * @paramDef {"type":"String","label":"Index Type","name":"indexType","uiComponent":{"type":"DROPDOWN","options":{"values":["HNSW","IVFFlat"]}},"defaultValue":"HNSW","description":"HNSW for high recall and fast queries; IVFFlat for faster builds and lower memory."}
   * @paramDef {"type":"String","label":"Metric","name":"metric","uiComponent":{"type":"DROPDOWN","options":{"values":["Cosine","L2","Inner Product"]}},"defaultValue":"Cosine","description":"Distance metric the index optimizes. Must match the metric used in Similarity Search."}
   * @paramDef {"type":"Number","label":"Lists (IVFFlat)","name":"lists","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"IVFFlat only: number of inverted lists. A common starting point is rows/1000 for up to 1M rows. Ignored for HNSW."}
   * @paramDef {"type":"Number","label":"M (HNSW)","name":"m","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"HNSW only: max connections per layer (pgvector default 16). Ignored for IVFFlat."}
   * @paramDef {"type":"Number","label":"EF Construction (HNSW)","name":"efConstruction","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"HNSW only: size of the dynamic candidate list during build (pgvector default 64). Higher improves recall at the cost of build time. Ignored for IVFFlat."}
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","description":"Optional explicit name for the index. When omitted, one is generated from the table and column."}
   * @returns {Object}
   * @sampleResult {"created":true,"indexName":"documents_embedding_hnsw_idx","indexType":"hnsw","opClass":"vector_cosine_ops"}
   */
  async createIndex(table, embeddingColumn, indexType, metric, lists, m, efConstruction, indexName) {
    if (typeof embeddingColumn !== 'string' || !embeddingColumn.trim()) {
      throw new Error('Embedding Column is required.')
    }

    const method = this.#resolveChoice(indexType, { 'HNSW': 'hnsw', 'IVFFlat': 'ivfflat' }) || 'hnsw'
    const opClass = METRIC_OPS_CLASSES[metric] || 'vector_cosine_ops'
    const { name: tableName } = this.#splitTable(table)

    const generatedName = `${ tableName }_${ embeddingColumn }_${ method }_idx`.replace(/[^A-Za-z0-9_]/g, '_')
    const finalName = (indexName && indexName.trim()) ? indexName.trim() : generatedName

    const withOptions = []

    if (method === 'ivfflat') {
      const listsCount = parseInt(lists, 10)

      if (Number.isInteger(listsCount) && listsCount > 0) {
        withOptions.push(`lists = ${ listsCount }`)
      }
    } else {
      const mValue = parseInt(m, 10)
      const efValue = parseInt(efConstruction, 10)

      if (Number.isInteger(mValue) && mValue > 0) {
        withOptions.push(`m = ${ mValue }`)
      }

      if (Number.isInteger(efValue) && efValue > 0) {
        withOptions.push(`ef_construction = ${ efValue }`)
      }
    }

    const withClause = withOptions.length ? ` WITH (${ withOptions.join(', ') })` : ''

    const sql =
      `CREATE INDEX IF NOT EXISTS ${ this.#quoteIdent(finalName) } ` +
      `ON ${ this.#quoteTable(table) } USING ${ method } ` +
      `(${ this.#quoteIdent(embeddingColumn) } ${ opClass })${ withClause }`

    return this.#withClient('createIndex', async client => {
      await client.query(sql)

      return { created: true, indexName: finalName, indexType: method, opClass }
    })
  }

  // ==========================================================================
  //  EMBEDDINGS — WRITE
  // ==========================================================================
  /**
   * @operationName Insert Embeddings
   * @description Bulk-inserts rows containing vector embeddings into a table. Each row is an object whose embedding column holds an array of numbers (converted to a pgvector literal); any other keys are treated as regular column values (id, content, metadata, etc.). The column set is the union of keys across all rows; rows missing a key insert NULL. All values are bound as parameters. Returns the inserted rows (via RETURNING *) and the inserted count.
   * @category Embeddings
   * @route POST /insert-embeddings
   * @appearanceColor #336791 #4E8CBF
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to insert into. May be schema-qualified (e.g. public.documents)."}
   * @paramDef {"type":"String","label":"Embedding Column","name":"embeddingColumn","dictionary":"getColumnsDictionary","dependsOn":["table"],"defaultValue":"embedding","description":"The vector column whose value in each row is an array of numbers. Defaults to embedding."}
   * @paramDef {"type":"Array<Object>","label":"Rows","name":"rows","required":true,"description":"Array of row objects. Each must contain the embedding column as an array of numbers, plus any metadata columns (e.g. [{\"content\":\"Hello\",\"embedding\":[0.1,0.2,0.3]}])."}
   * @returns {Object}
   * @sampleResult {"rows":[{"id":1,"content":"Hello","embedding":"[0.1,0.2,0.3]"}],"insertedCount":1}
   */
  async insertEmbeddings(table, embeddingColumn, rows) {
    const embeddingName = (embeddingColumn || 'embedding').trim() || 'embedding'

    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('Rows must be a non-empty array of objects.')
    }

    rows.forEach((row, index) => this.#requireNonEmptyObject(row, `Rows[${ index }]`))

    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))]
    const columnList = columns.map(column => this.#quoteIdent(column)).join(', ')
    const params = []

    const valuesSql = rows
      .map(row => {
        const placeholders = columns.map(column => {
          const raw = column in row ? row[column] : null
          const value = column === embeddingName && raw !== null && raw !== undefined
            ? this.#toVectorLiteral(raw)
            : raw

          params.push(value)

          return `$${ params.length }`
        })

        return `(${ placeholders.join(', ') })`
      })
      .join(', ')

    const sql = `INSERT INTO ${ this.#quoteTable(table) } (${ columnList }) VALUES ${ valuesSql } RETURNING *`

    return this.#withClient('insertEmbeddings', async client => {
      const result = await client.query(sql, params)

      return { rows: result.rows || [], insertedCount: result.rowCount }
    })
  }

  /**
   * @operationName Upsert Embeddings
   * @description Inserts embedding rows, updating existing rows when a unique constraint on the conflict column is violated (INSERT ... ON CONFLICT ... DO UPDATE). All non-conflict columns are refreshed from the incoming row. Ideal for re-embedding: re-running with the same ids replaces their vectors and metadata in place. The conflict column must be covered by a primary key or unique index. Returns the resulting rows (via RETURNING *) and the affected count.
   * @category Embeddings
   * @route POST /upsert-embeddings
   * @appearanceColor #336791 #4E8CBF
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to upsert into. May be schema-qualified (e.g. public.documents)."}
   * @paramDef {"type":"String","label":"Embedding Column","name":"embeddingColumn","dictionary":"getColumnsDictionary","dependsOn":["table"],"defaultValue":"embedding","description":"The vector column whose value in each row is an array of numbers. Defaults to embedding."}
   * @paramDef {"type":"Array<Object>","label":"Rows","name":"rows","required":true,"description":"Array of row objects. Each must include the conflict column and the embedding column (as an array of numbers)."}
   * @paramDef {"type":"String","label":"Conflict Column","name":"conflictColumn","defaultValue":"id","description":"Column that identifies an existing row (must be a primary key or unique column). Defaults to id."}
   * @returns {Object}
   * @sampleResult {"rows":[{"id":"doc-1","content":"Hello","embedding":"[0.1,0.2,0.3]"}],"affectedCount":1}
   */
  async upsertEmbeddings(table, embeddingColumn, rows, conflictColumn) {
    const embeddingName = (embeddingColumn || 'embedding').trim() || 'embedding'
    const conflictName = (conflictColumn || 'id').trim() || 'id'

    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('Rows must be a non-empty array of objects.')
    }

    rows.forEach((row, index) => this.#requireNonEmptyObject(row, `Rows[${ index }]`))

    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))]
    const columnList = columns.map(column => this.#quoteIdent(column)).join(', ')
    const params = []

    const valuesSql = rows
      .map(row => {
        const placeholders = columns.map(column => {
          const raw = column in row ? row[column] : null
          const value = column === embeddingName && raw !== null && raw !== undefined
            ? this.#toVectorLiteral(raw)
            : raw

          params.push(value)

          return `$${ params.length }`
        })

        return `(${ placeholders.join(', ') })`
      })
      .join(', ')

    const updateColumns = columns.filter(column => column !== conflictName)
    const conflictAction = updateColumns.length
      ? `DO UPDATE SET ${ updateColumns.map(column => `${ this.#quoteIdent(column) } = EXCLUDED.${ this.#quoteIdent(column) }`).join(', ') }`
      : 'DO NOTHING'

    const sql =
      `INSERT INTO ${ this.#quoteTable(table) } (${ columnList }) VALUES ${ valuesSql } ` +
      `ON CONFLICT (${ this.#quoteIdent(conflictName) }) ${ conflictAction } RETURNING *`

    return this.#withClient('upsertEmbeddings', async client => {
      const result = await client.query(sql, params)

      return { rows: result.rows || [], affectedCount: result.rowCount }
    })
  }

  /**
   * @operationName Delete Embeddings
   * @description Deletes embedding rows either by a list of ids (matched against the id column) or by equality conditions in a Where object. Exactly one of the two selectors must be provided; this guard prevents accidental full-table deletion. Returns the number of deleted rows.
   * @category Embeddings
   * @route DELETE /delete-embeddings
   * @appearanceColor #336791 #4E8CBF
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to delete from. May be schema-qualified (e.g. public.documents)."}
   * @paramDef {"type":"Array","label":"IDs","name":"ids","description":"List of id values to delete (e.g. [1,2,3] or [\"doc-1\",\"doc-2\"]). Matched against the ID Column. Provide this OR Where, not both."}
   * @paramDef {"type":"String","label":"ID Column","name":"idColumn","defaultValue":"id","description":"The primary-key column used when deleting by IDs. Defaults to id."}
   * @paramDef {"type":"Object","label":"Where","name":"where","description":"Equality conditions selecting rows to delete, combined with AND (e.g. {\"source\":\"import\"}). Provide this OR IDs, not both."}
   * @returns {Object}
   * @sampleResult {"deletedCount":2}
   */
  async deleteEmbeddings(table, ids, idColumn, where) {
    const hasIds = Array.isArray(ids) && ids.length > 0
    const hasWhere = where && typeof where === 'object' && !Array.isArray(where) && Object.keys(where).length > 0

    if (hasIds === hasWhere) {
      throw new Error('Provide exactly one of IDs or Where to select the rows to delete.')
    }

    const params = []
    let sql = `DELETE FROM ${ this.#quoteTable(table) }`

    if (hasIds) {
      const idName = (idColumn || 'id').trim() || 'id'

      params.push(ids)
      sql += ` WHERE ${ this.#quoteIdent(idName) } = ANY($${ params.length })`
    } else {
      sql += this.#buildWhere(where, params)
    }

    return this.#withClient('deleteEmbeddings', async client => {
      const result = await client.query(sql, params)

      return { deletedCount: result.rowCount }
    })
  }

  // ==========================================================================
  //  SIMILARITY SEARCH
  // ==========================================================================
  /**
   * @operationName Similarity Search
   * @description Finds the rows whose vectors are nearest to a query embedding, ordered nearest-first. Pass the query embedding as an array of numbers and pick a distance metric (Cosine, L2/Euclidean, or Inner Product) — it must match the metric of any index on the column for that index to be used. Returns each matched row plus a computed distance column, smaller meaning more similar; for Cosine, similarity = 1 - distance. Optionally restrict columns returned, apply equality filters via the Where object, or supply a raw SQL Where Clause for advanced metadata filtering. Runs with a 120-second limit.
   * @category Search
   * @route POST /similarity-search
   * @appearanceColor #336791 #4E8CBF
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to search. May be schema-qualified (e.g. public.documents)."}
   * @paramDef {"type":"String","label":"Embedding Column","name":"embeddingColumn","dictionary":"getColumnsDictionary","dependsOn":["table"],"defaultValue":"embedding","description":"The vector column to compare against. Defaults to embedding."}
   * @paramDef {"type":"Array<Number>","label":"Query Embedding","name":"queryEmbedding","required":true,"description":"The query vector as an array of numbers (e.g. [0.1,0.2,0.3]). Its length must match the column's dimension."}
   * @paramDef {"type":"String","label":"Metric","name":"metric","uiComponent":{"type":"DROPDOWN","options":{"values":["Cosine","L2","Inner Product"]}},"defaultValue":"Cosine","description":"Distance metric: Cosine (<=>), L2/Euclidean (<->), or Inner Product (<#>). Match the metric of the column's index."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":10,"description":"Maximum number of nearest rows to return. Defaults to 10."}
   * @paramDef {"type":"Array<String>","label":"Select Columns","name":"selectColumns","description":"Column names to return alongside the distance. Leave empty to return all columns (SELECT *)."}
   * @paramDef {"type":"Object","label":"Where","name":"where","description":"Equality filters applied before ranking, combined with AND (e.g. {\"source\":\"docs\"}). Values are safely parameterized."}
   * @paramDef {"type":"String","label":"Where Clause (raw SQL)","name":"whereClause","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Advanced: a raw SQL filter placed in the WHERE clause (e.g. created_at > now() - interval '7 days'). Combined with the Where object using AND. NOT parameterized — never embed untrusted user input here; use the Where object for user-supplied values."}
   * @returns {Object}
   * @sampleResult {"rows":[{"id":1,"content":"Hello","distance":0.0123}],"rowCount":1,"metric":"Cosine","operator":"<=>"}
   */
  async similaritySearch(table, embeddingColumn, queryEmbedding, metric, limit, selectColumns, where, whereClause) {
    const embeddingName = (embeddingColumn || 'embedding').trim() || 'embedding'
    const operator = METRIC_OPERATORS[metric] || '<=>'
    const metricLabel = METRIC_OPERATORS[metric] ? metric : 'Cosine'

    const params = [this.#toVectorLiteral(queryEmbedding)]
    const vectorPlaceholder = `$${ params.length }`

    const columnList = Array.isArray(selectColumns) && selectColumns.length
      ? selectColumns.map(column => this.#quoteIdent(column)).join(', ')
      : '*'

    let sql =
      `SELECT ${ columnList }, ${ this.#quoteIdent(embeddingName) } ${ operator } ${ vectorPlaceholder } AS distance ` +
      `FROM ${ this.#quoteTable(table) }`

    const conditions = []
    const whereSql = this.#buildWhere(where, params)

    if (whereSql) {
      // #buildWhere already prefixes " WHERE "; strip it so we can compose with the raw clause.
      conditions.push(whereSql.replace(/^ WHERE /, ''))
    }

    if (typeof whereClause === 'string' && whereClause.trim()) {
      conditions.push(`(${ whereClause.trim() })`)
    }

    if (conditions.length) {
      sql += ` WHERE ${ conditions.join(' AND ') }`
    }

    const rowLimit = parseInt(limit, 10)
    const effectiveLimit = Number.isInteger(rowLimit) && rowLimit > 0 ? rowLimit : 10

    params.push(effectiveLimit)
    sql += ` ORDER BY distance ASC LIMIT $${ params.length }`

    return this.#withClient('similaritySearch', async client => {
      const result = await client.query(sql, params)

      return {
        rows: result.rows || [],
        rowCount: result.rowCount,
        metric: metricLabel,
        operator,
      }
    })
  }

  // ==========================================================================
  //  SQL ESCAPE HATCH
  // ==========================================================================
  /**
   * @operationName Execute Query
   * @description Executes an arbitrary SQL statement (SELECT, INSERT, UPDATE, DELETE, DDL, CTEs, pgvector operations, etc.) and returns the resulting rows, the affected row count, and result field metadata. Use $1, $2, ... placeholders together with the Parameters array to safely bind values — including vector literals such as '[0.1,0.2,0.3]' — and never interpolate user input into the SQL string. Statements are limited to 120 seconds.
   * @category SQL
   * @route POST /execute-query
   * @appearanceColor #336791 #4E8CBF
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"SQL","name":"sql","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SQL statement to execute. Use $1, $2, ... placeholders for values bound via the Parameters array. Vector literals are written as strings like '[0.1,0.2,0.3]'."}
   * @paramDef {"type":"Array","label":"Parameters","name":"params","description":"Values for the $1, $2, ... placeholders, in order (e.g. [\"[0.1,0.2,0.3]\", 5]). Elements may be strings, numbers, booleans or null."}
   * @returns {Object}
   * @sampleResult {"rows":[{"id":1,"distance":0.0123}],"rowCount":1,"fields":[{"name":"id","dataTypeID":23},{"name":"distance","dataTypeID":701}]}
   */
  async executeQuery(sql, params) {
    if (typeof sql !== 'string' || !sql.trim()) {
      throw new Error('SQL statement is required.')
    }

    return this.#withClient('executeQuery', async client => {
      const result = await client.query(sql, Array.isArray(params) ? params : [])

      return {
        rows: result.rows || [],
        rowCount: result.rowCount,
        fields: (result.fields || []).map(field => ({ name: field.name, dataTypeID: field.dataTypeID })),
      }
    })
  }

  // ==========================================================================
  //  SCHEMA DISCOVERY
  // ==========================================================================
  /**
   * @operationName Get Table Schema
   * @description Returns the column definitions of a table from information_schema.columns: column name, data type, underlying type name, nullability, default expression, maximum character length, and ordinal position. Columns of the pgvector type are flagged (isVector true, udtName "vector") so you can identify embedding columns before searching or inserting.
   * @category Schema
   * @route GET /table-schema
   * @appearanceColor #336791 #4E8CBF
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to describe. May be schema-qualified (e.g. public.documents); defaults to the public schema."}
   * @returns {Object}
   * @sampleResult {"schema":"public","table":"documents","columns":[{"name":"id","type":"integer","udtName":"int4","nullable":false,"default":"nextval('documents_id_seq'::regclass)","maxLength":null,"position":1,"isVector":false},{"name":"embedding","type":"USER-DEFINED","udtName":"vector","nullable":true,"default":null,"maxLength":null,"position":2,"isVector":true}]}
   */
  async getTableSchema(table) {
    const { schema, name } = this.#splitTable(table)

    const sql = `
      SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `

    return this.#withClient('getTableSchema', async client => {
      const result = await client.query(sql, [schema, name])

      if (!result.rows.length) {
        throw new Error(`Table "${ schema }.${ name }" was not found or has no columns.`)
      }

      return {
        schema,
        table: name,
        columns: result.rows.map(row => ({
          name: row.column_name,
          type: row.data_type,
          udtName: row.udt_name,
          nullable: row.is_nullable === 'YES',
          default: row.column_default,
          maxLength: row.character_maximum_length,
          position: row.ordinal_position,
          isVector: row.udt_name === 'vector',
        })),
      }
    })
  }

  /**
   * @operationName List Tables
   * @description Lists all tables and views in user schemas (system schemas pg_catalog and information_schema are excluded), including each object's schema, name, type, and whether it contains at least one pgvector column (hasVectorColumn). Useful for discovering which tables hold embeddings.
   * @category Schema
   * @route GET /tables
   * @appearanceColor #336791 #4E8CBF
   * @returns {Object}
   * @sampleResult {"tables":[{"schema":"public","name":"documents","type":"BASE TABLE","hasVectorColumn":true}],"count":1}
   */
  async listTables() {
    const sql = `
      SELECT t.table_schema, t.table_name, t.table_type,
        EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = t.table_schema
            AND c.table_name = t.table_name
            AND c.udt_name = 'vector'
        ) AS has_vector_column
      FROM information_schema.tables t
      WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY t.table_schema, t.table_name
    `

    return this.#withClient('listTables', async client => {
      const result = await client.query(sql)

      return {
        tables: result.rows.map(row => ({
          schema: row.table_schema,
          name: row.table_name,
          type: row.table_type,
          hasVectorColumn: row.has_vector_column,
        })),
        count: result.rowCount,
      }
    })
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Provides a searchable list of tables and views from user schemas for dynamic dropdown selection in other operations. Values are schema-qualified (e.g. public.documents).
   * @route POST /get-tables-dictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"documents","value":"public.documents","note":"public · BASE TABLE"}],"cursor":null}
   */
  async getTablesDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = parseInt(cursor, 10) || 0
    const params = [search ? `%${ search }%` : null, DICTIONARY_PAGE_SIZE + 1, offset]

    const sql = `
      SELECT table_schema, table_name, table_type
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND ($1::text IS NULL OR table_name ILIKE $1)
      ORDER BY table_schema, table_name
      LIMIT $2 OFFSET $3
    `

    return this.#withClient('getTablesDictionary', async client => {
      const result = await client.query(sql, params)
      const hasMore = result.rows.length > DICTIONARY_PAGE_SIZE
      const rows = hasMore ? result.rows.slice(0, DICTIONARY_PAGE_SIZE) : result.rows

      return {
        items: rows.map(row => ({
          label: row.table_name,
          value: `${ row.table_schema }.${ row.table_name }`,
          note: `${ row.table_schema } · ${ row.table_type }`,
        })),
        cursor: hasMore ? String(offset + DICTIONARY_PAGE_SIZE) : null,
      }
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Columns Dictionary
   * @description Provides a searchable list of column names for the table selected in a dependent parameter, with each column's data type as a note. Vector columns show "vector" as their type.
   * @route POST /get-columns-dictionary
   * @paramDef {"type":"getColumnsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text, pagination cursor, and the selected table as criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"embedding","value":"embedding","note":"vector"}],"cursor":null}
   */
  async getColumnsDictionary(payload) {
    const { search, criteria } = payload || {}
    const table = criteria && criteria.table

    if (!table) {
      return { items: [], cursor: null }
    }

    const { schema, name } = this.#splitTable(table)
    const params = [schema, name, search ? `%${ search }%` : null]

    const sql = `
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
        AND ($3::text IS NULL OR column_name ILIKE $3)
      ORDER BY ordinal_position
    `

    return this.#withClient('getColumnsDictionary', async client => {
      const result = await client.query(sql, params)

      return {
        items: result.rows.map(row => ({
          label: row.column_name,
          value: row.column_name,
          note: row.udt_name === 'vector' ? 'vector' : row.data_type,
        })),
        cursor: null,
      }
    })
  }
}

Flowrunner.ServerCode.addService(PGVector, [
  {
    name: 'connectionString',
    displayName: 'Connection String',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Full PostgreSQL connection URI, e.g. postgresql://user:password@db.example.com:5432/mydb - most managed providers (Supabase, Neon, RDS, Heroku) supply one. The database must have the pgvector extension available. When set, it takes precedence and the Host/Port/Database/User/Password fields below are ignored. Special characters in the password must be URL-encoded; if that is a problem, use the individual fields instead. Supabase: use the "Session pooler" connection string from the Connect dialog - the direct db.<project-ref>.supabase.co endpoint is IPv6-only and usually unreachable.',
  },
  {
    name: 'host',
    displayName: 'Host',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Hostname or IP address of the PostgreSQL server (e.g. db.example.com). Required unless a Connection String is provided. The server must be reachable from FlowRunner.',
  },
  {
    name: 'port',
    displayName: 'Port',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '5432',
    hint: 'TCP port of the PostgreSQL server. The default is 5432. Ignored when a Connection String is provided.',
  },
  {
    name: 'database',
    displayName: 'Database',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Name of the database to connect to. Required unless a Connection String is provided.',
  },
  {
    name: 'user',
    displayName: 'User',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Database user (role) name. Required unless a Connection String is provided.',
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Password for the database user. Required unless a Connection String is provided.',
  },
  {
    name: 'ssl',
    displayName: 'Use SSL/TLS',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.BOOL,
    required: false,
    shared: false,
    defaultValue: false,
    hint: 'Enable TLS-encrypted connections. Required by most managed databases (e.g. AWS RDS, Google Cloud SQL, Azure Database, Heroku Postgres). With a Connection String, enabling this adds managed-provider-friendly TLS on top of the URI; when off, any sslmode in the URI still applies.',
  },
  {
    name: 'connectionTimeoutSeconds',
    displayName: 'Connection Timeout (seconds)',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '10',
    hint: 'How long to wait when establishing a connection before failing. Defaults to 10 seconds.',
  },
])
