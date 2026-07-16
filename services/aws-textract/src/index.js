'use strict'

const { jsonRequest } = require('./aws-client')
const { CredentialProvider } = require('./credentials')
const { createLogger, mapAwsError } = require('./errors')
const { awsConfigItems } = require('./config-items')

const TARGET_PREFIX = 'Textract'
const CONTENT_TYPE = 'application/x-amz-json-1.1'
const MAX_SYNC_BYTES = 5 * 1024 * 1024 // 5 MB soft cap for Bytes input on sync operations

/**
 * @integrationName AWS Textract
 * @integrationIcon /icon.svg
 */
class Textract {
  constructor(config = {}) {
    this.region = config.region || 'us-east-1'
    this.logger = createLogger('AWS Textract')

    this.credentials = new CredentialProvider({
      authenticationMethod: config.authenticationMethod || 'API Key',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: this.region,
      roleArn: config.roleArn,
      externalId: config.externalId,
    })

    this.deps = { jsonRequest }
  }

  async sendJson(operation, body) {
    const creds = await this.credentials.resolve()

    return this.deps.jsonRequest(
      { region: this.region, service: 'textract', target: `${ TARGET_PREFIX }.${ operation }`, contentType: CONTENT_TYPE, body },
      creds
    )
  }

  // ---------------------------------------------------------------------------
  // Synchronous operations
  // ---------------------------------------------------------------------------

  /**
   * @operationName Detect Document Text
   * @description Runs synchronous OCR on a single-page image (JPEG, PNG, or TIFF) or single-page PDF and returns every detected line and word as Textract Block objects. Supply the document either as a FlowRunner file URL (downloaded and sent inline, single page and up to about 5 MB) or as an Amazon S3 object. Adds a convenience "text" field that concatenates all LINE blocks into readable plain text. For multi-page PDFs use the asynchronous Start/Get Document Text Detection operations with an S3 object.
   * @route POST /detect-document-text
   * @category Text Detection
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":false,"description":"URL of a single-page image or single-page PDF (up to ~5 MB). The bytes are downloaded and sent inline. Provide this OR the S3 fields."}
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":false,"description":"Name of the S3 bucket holding the document. Provide with S3 Object Name instead of a File URL. The bucket must be in the same region as this integration."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":false,"description":"Key (path) of the document object within the S3 bucket, e.g. invoices/receipt.png."}
   * @returns {Object}
   * @sampleResult {"text":"INVOICE\nAcme Corp\nTotal: $42.00","blocks":[{"BlockType":"LINE","Text":"INVOICE","Confidence":99.4}],"lineCount":3,"pages":1}
   */
  async detectDocumentText(fileUrl, s3Bucket, s3Name) {
    try {
      const Document = await this.#buildDocument(fileUrl, s3Bucket, s3Name)
      const res = await this.sendJson('DetectDocumentText', { Document })
      const blocks = res.Blocks || []

      return {
        text: this.#linesToText(blocks),
        blocks,
        lineCount: blocks.filter(b => b.BlockType === 'LINE').length,
        pages: (res.DocumentMetadata && res.DocumentMetadata.Pages) || 1,
      }
    } catch (error) {
      this.#handleError('detectDocumentText', error)
    }
  }

  /**
   * @operationName Analyze Document
   * @description Runs synchronous document analysis to extract structured data using one or more feature types: FORMS (key-value pairs), TABLES (rows and cells), QUERIES (natural-language questions answered from the document), SIGNATURES (signature locations), and LAYOUT (reading order and layout elements). Supply the document as a FlowRunner file URL (single page, up to ~5 MB) or an S3 object. In addition to the raw Blocks, returns convenience extractions: form key-value pairs, a query-to-answer map, and simplified table rows. This is the flagship Textract operation. For multi-page PDFs use the asynchronous Start/Get Document Analysis operations.
   * @route POST /analyze-document
   * @category Document Analysis
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"Array<String>","label":"Feature Types","name":"featureTypes","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["TABLES","FORMS","QUERIES","SIGNATURES","LAYOUT"]}},"description":"One or more analysis features to run. Choose FORMS for key-value pairs, TABLES for tabular data, QUERIES to ask questions, SIGNATURES to locate signatures, LAYOUT for reading order."}
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":false,"description":"URL of a single-page image or single-page PDF (up to ~5 MB). Provide this OR the S3 fields."}
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":false,"description":"Name of the S3 bucket holding the document. Provide with S3 Object Name instead of a File URL."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":false,"description":"Key (path) of the document object within the S3 bucket."}
   * @paramDef {"type":"Array<Object>","label":"Queries","name":"queries","required":false,"description":"Required when FEATURE type QUERIES is selected. Array of objects, each with a Text field (the question) and an optional Alias, e.g. [{\"Text\":\"What is the invoice total?\",\"Alias\":\"total\"}]."}
   * @returns {Object}
   * @sampleResult {"forms":{"Name":"Ana Silva","Invoice #":"1042"},"queries":{"total":"$42.00"},"tables":[{"rows":[["Item","Price"],["Widget","$10.00"]]}],"blocks":[],"pages":1}
   */
  async analyzeDocument(featureTypes, fileUrl, s3Bucket, s3Name, queries) {
    if (!Array.isArray(featureTypes) || featureTypes.length === 0) {
      throw new Error('featureTypes is required: select at least one of TABLES, FORMS, QUERIES, SIGNATURES, LAYOUT.')
    }

    try {
      const Document = await this.#buildDocument(fileUrl, s3Bucket, s3Name)
      const body = { Document, FeatureTypes: featureTypes }

      if (Array.isArray(queries) && queries.length) {
        body.QueriesConfig = {
          Queries: queries.map(q => {
            const query = { Text: q.Text || q.text }

            if (q.Alias || q.alias) query.Alias = q.Alias || q.alias

            return query
          }),
        }
      }

      const res = await this.sendJson('AnalyzeDocument', body)
      const blocks = res.Blocks || []

      return {
        forms: this.#extractForms(blocks),
        queries: this.#extractQueries(blocks),
        tables: this.#extractTables(blocks),
        text: this.#linesToText(blocks),
        blocks,
        pages: (res.DocumentMetadata && res.DocumentMetadata.Pages) || 1,
      }
    } catch (error) {
      this.#handleError('analyzeDocument', error)
    }
  }

  /**
   * @operationName Analyze Expense
   * @description Synchronously analyzes an invoice or receipt and extracts financially relevant data. Supply the document as a FlowRunner file URL (single page, up to ~5 MB) or an S3 object. Returns the raw ExpenseDocuments alongside a convenience flattening into summaryFields (header-level fields such as vendor name, total, and dates as label/value/type/confidence) and lineItems (individual purchased items, each a flat map of field label to value).
   * @route POST /analyze-expense
   * @category Document Analysis
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":false,"description":"URL of a single-page invoice or receipt image or PDF (up to ~5 MB). Provide this OR the S3 fields."}
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":false,"description":"Name of the S3 bucket holding the document. Provide with S3 Object Name instead of a File URL."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":false,"description":"Key (path) of the document object within the S3 bucket."}
   * @returns {Object}
   * @sampleResult {"summaryFields":[{"type":"TOTAL","label":"Total","value":"$42.00","confidence":98.7}],"lineItems":[{"ITEM":"Widget","PRICE":"$10.00","QUANTITY":"1"}],"pages":1}
   */
  async analyzeExpense(fileUrl, s3Bucket, s3Name) {
    try {
      const Document = await this.#buildDocument(fileUrl, s3Bucket, s3Name)
      const res = await this.sendJson('AnalyzeExpense', { Document })

      return {
        ...this.#flattenExpense(res.ExpenseDocuments || []),
        pages: (res.DocumentMetadata && res.DocumentMetadata.Pages) || 1,
      }
    } catch (error) {
      this.#handleError('analyzeExpense', error)
    }
  }

  /**
   * @operationName Analyze ID
   * @description Synchronously analyzes identity documents such as U.S. driver's licenses and passports and extracts identity fields. Supply the document as a FlowRunner file URL (single page, up to ~5 MB) or an S3 object. Returns a convenience "fields" map keyed by the normalized field type (e.g. FIRST_NAME, LAST_NAME, DATE_OF_BIRTH), each with its detected value and confidence, plus the raw IdentityDocuments array.
   * @route POST /analyze-id
   * @category Document Analysis
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":false,"description":"URL of a single-page identity document image or PDF (up to ~5 MB). Provide this OR the S3 fields."}
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":false,"description":"Name of the S3 bucket holding the document. Provide with S3 Object Name instead of a File URL."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":false,"description":"Key (path) of the document object within the S3 bucket."}
   * @returns {Object}
   * @sampleResult {"fields":{"FIRST_NAME":{"value":"ANA","confidence":99.1},"DATE_OF_BIRTH":{"value":"01/01/1990","confidence":98.2}},"documentCount":1}
   */
  async analyzeId(fileUrl, s3Bucket, s3Name) {
    try {
      const Document = await this.#buildDocument(fileUrl, s3Bucket, s3Name)
      const res = await this.sendJson('AnalyzeID', { DocumentPages: [Document] })
      const idDocs = res.IdentityDocuments || []

      return {
        fields: this.#flattenIdentity(idDocs),
        documentCount: idDocs.length,
        identityDocuments: idDocs,
      }
    } catch (error) {
      this.#handleError('analyzeId', error)
    }
  }

  // ---------------------------------------------------------------------------
  // Asynchronous operations (large / multi-page PDFs from S3)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Start Document Text Detection
   * @description Starts an asynchronous OCR job over a document stored in Amazon S3 (used for multi-page PDFs and TIFFs, up to 500 MB / 3000 pages). Returns a JobId. Poll Get Document Text Detection with that JobId until JobStatus is SUCCEEDED, then read the extracted text. The document must be in an S3 bucket in the same region as this integration.
   * @route POST /start-document-text-detection
   * @category Asynchronous
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":true,"description":"Name of the S3 bucket holding the document."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":true,"description":"Key (path) of the document object within the S3 bucket, e.g. contracts/agreement.pdf."}
   * @paramDef {"type":"String","label":"Client Request Token","name":"clientRequestToken","required":false,"description":"Optional idempotency token so repeated calls with the same value do not start duplicate jobs."}
   * @paramDef {"type":"String","label":"Job Tag","name":"jobTag","required":false,"description":"Optional identifier you can attach to the job to help you group or filter results."}
   * @returns {Object}
   * @sampleResult {"jobId":"a1b2c3d4e5f6"}
   */
  async startDocumentTextDetection(s3Bucket, s3Name, clientRequestToken, jobTag) {
    if (!s3Bucket || !s3Name) throw new Error('s3Bucket and s3Name are required.')

    try {
      const body = { DocumentLocation: { S3Object: { Bucket: s3Bucket, Name: s3Name } } }

      if (clientRequestToken) body.ClientRequestToken = clientRequestToken
      if (jobTag) body.JobTag = jobTag

      const res = await this.sendJson('StartDocumentTextDetection', body)

      return { jobId: res.JobId }
    } catch (error) {
      this.#handleError('startDocumentTextDetection', error)
    }
  }

  /**
   * @operationName Get Document Text Detection
   * @description Retrieves the results of an asynchronous OCR job started by Start Document Text Detection. Returns the JobStatus (IN_PROGRESS, SUCCEEDED, FAILED, or PARTIAL_SUCCESS). When SUCCEEDED, this operation automatically paginates through all result pages (following NextToken) and concatenates every LINE into a single readable "text" field, alongside the full set of Blocks. Poll this operation until JobStatus is no longer IN_PROGRESS.
   * @route POST /get-document-text-detection
   * @category Asynchronous
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"The JobId returned by Start Document Text Detection."}
   * @returns {Object}
   * @sampleResult {"jobStatus":"SUCCEEDED","text":"Page 1 line 1\nPage 1 line 2","blocks":[],"lineCount":2,"pages":5}
   */
  async getDocumentTextDetection(jobId) {
    if (!jobId) throw new Error('jobId is required.')

    try {
      const result = await this.#getJobResults('GetDocumentTextDetection', jobId)

      return {
        jobStatus: result.jobStatus,
        statusMessage: result.statusMessage,
        text: this.#linesToText(result.blocks),
        blocks: result.blocks,
        lineCount: result.blocks.filter(b => b.BlockType === 'LINE').length,
        pages: result.pages,
      }
    } catch (error) {
      this.#handleError('getDocumentTextDetection', error)
    }
  }

  /**
   * @operationName Start Document Analysis
   * @description Starts an asynchronous document analysis job over a document stored in Amazon S3 (used for multi-page PDFs and TIFFs, up to 500 MB / 3000 pages). Choose one or more feature types (FORMS, TABLES, QUERIES, SIGNATURES, LAYOUT). Returns a JobId. Poll Get Document Analysis with that JobId until JobStatus is SUCCEEDED. The document must be in an S3 bucket in the same region as this integration.
   * @route POST /start-document-analysis
   * @category Asynchronous
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"Array<String>","label":"Feature Types","name":"featureTypes","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["TABLES","FORMS","QUERIES","SIGNATURES","LAYOUT"]}},"description":"One or more analysis features to run over the document."}
   * @paramDef {"type":"String","label":"S3 Bucket","name":"s3Bucket","required":true,"description":"Name of the S3 bucket holding the document."}
   * @paramDef {"type":"String","label":"S3 Object Name","name":"s3Name","required":true,"description":"Key (path) of the document object within the S3 bucket."}
   * @paramDef {"type":"Array<Object>","label":"Queries","name":"queries","required":false,"description":"Required when the QUERIES feature is selected. Array of objects, each with a Text field (the question) and an optional Alias."}
   * @paramDef {"type":"String","label":"Client Request Token","name":"clientRequestToken","required":false,"description":"Optional idempotency token so repeated calls with the same value do not start duplicate jobs."}
   * @paramDef {"type":"String","label":"Job Tag","name":"jobTag","required":false,"description":"Optional identifier you can attach to the job to help you group or filter results."}
   * @returns {Object}
   * @sampleResult {"jobId":"a1b2c3d4e5f6"}
   */
  async startDocumentAnalysis(featureTypes, s3Bucket, s3Name, queries, clientRequestToken, jobTag) {
    if (!Array.isArray(featureTypes) || featureTypes.length === 0) {
      throw new Error('featureTypes is required: select at least one of TABLES, FORMS, QUERIES, SIGNATURES, LAYOUT.')
    }

    if (!s3Bucket || !s3Name) throw new Error('s3Bucket and s3Name are required.')

    try {
      const body = {
        DocumentLocation: { S3Object: { Bucket: s3Bucket, Name: s3Name } },
        FeatureTypes: featureTypes,
      }

      if (Array.isArray(queries) && queries.length) {
        body.QueriesConfig = {
          Queries: queries.map(q => {
            const query = { Text: q.Text || q.text }

            if (q.Alias || q.alias) query.Alias = q.Alias || q.alias

            return query
          }),
        }
      }

      if (clientRequestToken) body.ClientRequestToken = clientRequestToken
      if (jobTag) body.JobTag = jobTag

      const res = await this.sendJson('StartDocumentAnalysis', body)

      return { jobId: res.JobId }
    } catch (error) {
      this.#handleError('startDocumentAnalysis', error)
    }
  }

  /**
   * @operationName Get Document Analysis
   * @description Retrieves the results of an asynchronous document analysis job started by Start Document Analysis. Returns the JobStatus (IN_PROGRESS, SUCCEEDED, FAILED, or PARTIAL_SUCCESS). When SUCCEEDED, this operation automatically paginates through all result pages and returns the full set of Blocks plus convenience extractions across the whole document: form key-value pairs, a query-to-answer map, and simplified table rows. Poll this operation until JobStatus is no longer IN_PROGRESS.
   * @route POST /get-document-analysis
   * @category Asynchronous
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"The JobId returned by Start Document Analysis."}
   * @returns {Object}
   * @sampleResult {"jobStatus":"SUCCEEDED","forms":{"Name":"Ana Silva"},"queries":{"total":"$42.00"},"tables":[{"rows":[["Item","Price"]]}],"blocks":[],"pages":5}
   */
  async getDocumentAnalysis(jobId) {
    if (!jobId) throw new Error('jobId is required.')

    try {
      const result = await this.#getJobResults('GetDocumentAnalysis', jobId)

      return {
        jobStatus: result.jobStatus,
        statusMessage: result.statusMessage,
        forms: this.#extractForms(result.blocks),
        queries: this.#extractQueries(result.blocks),
        tables: this.#extractTables(result.blocks),
        text: this.#linesToText(result.blocks),
        blocks: result.blocks,
        pages: result.pages,
      }
    } catch (error) {
      this.#handleError('getDocumentAnalysis', error)
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds a Textract Document object from either an S3 reference or a downloadable file URL.
   * S3 takes precedence when both a bucket and name are supplied.
   */
  async #buildDocument(fileUrl, s3Bucket, s3Name) {
    if (s3Bucket && s3Name) {
      return { S3Object: { Bucket: s3Bucket, Name: s3Name } }
    }

    if (fileUrl) {
      const bytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

      if (buffer.length > MAX_SYNC_BYTES) {
        throw new Error(
          'The document exceeds the ~5 MB limit for inline (Bytes) synchronous processing. Store it in S3 and use the S3 fields, or the asynchronous operations for multi-page PDFs.'
        )
      }

      return { Bytes: buffer.toString('base64') }
    }

    throw new Error('Provide either a File URL or both an S3 Bucket and S3 Object Name.')
  }

  /**
   * Polls a Get* operation, following NextToken, and aggregates all Blocks.
   */
  async #getJobResults(operation, jobId) {
    let nextToken
    let jobStatus
    let statusMessage
    let pages
    const blocks = []

    do {
      const body = { JobId: jobId, MaxResults: 1000 }

      if (nextToken) body.NextToken = nextToken

      const res = await this.sendJson(operation, body)

      jobStatus = res.JobStatus
      statusMessage = res.StatusMessage
      pages = (res.DocumentMetadata && res.DocumentMetadata.Pages) || pages

      if (Array.isArray(res.Blocks)) blocks.push(...res.Blocks)

      nextToken = res.NextToken

      // Only paginate once the job has finished producing blocks.
      if (jobStatus === 'IN_PROGRESS') break
    } while (nextToken)

    return { jobStatus, statusMessage, blocks, pages: pages || 0 }
  }

  /**
   * Concatenates all LINE blocks into readable plain text.
   */
  #linesToText(blocks) {
    return (blocks || [])
      .filter(b => b.BlockType === 'LINE' && typeof b.Text === 'string')
      .map(b => b.Text)
      .join('\n')
  }

  /**
   * Extracts FORMS key-value pairs from Block objects into a plain { key: value } map.
   */
  #extractForms(blocks) {
    const byId = new Map((blocks || []).map(b => [b.Id, b]))
    const forms = {}

    for (const block of blocks || []) {
      if (block.BlockType !== 'KEY_VALUE_SET') continue
      if (!Array.isArray(block.EntityTypes) || !block.EntityTypes.includes('KEY')) continue

      const keyText = this.#collectChildText(block, byId)
      const valueRel = (block.Relationships || []).find(r => r.Type === 'VALUE')
      let valueText = ''

      if (valueRel) {
        for (const valueId of valueRel.Ids) {
          const valueBlock = byId.get(valueId)

          if (valueBlock) valueText += (valueText ? ' ' : '') + this.#collectChildText(valueBlock, byId)
        }
      }

      if (keyText) forms[keyText] = valueText
    }

    return forms
  }

  /**
   * Extracts QUERIES results into a { alias-or-question: answer } map.
   */
  #extractQueries(blocks) {
    const byId = new Map((blocks || []).map(b => [b.Id, b]))
    const queries = {}

    for (const block of blocks || []) {
      if (block.BlockType !== 'QUERY') continue

      const label = (block.Query && (block.Query.Alias || block.Query.Text)) || block.Id
      const answerRel = (block.Relationships || []).find(r => r.Type === 'ANSWER')
      let answer = null

      if (answerRel) {
        const answers = answerRel.Ids
          .map(id => byId.get(id))
          .filter(b => b && b.BlockType === 'QUERY_RESULT')
          .map(b => b.Text)
          .filter(Boolean)

        answer = answers.length ? answers.join(' ') : null
      }

      queries[label] = answer
    }

    return queries
  }

  /**
   * Extracts TABLE blocks into a simplified rows structure: [{ rows: [[cell, cell], ...] }].
   */
  #extractTables(blocks) {
    const byId = new Map((blocks || []).map(b => [b.Id, b]))
    const tables = []

    for (const block of blocks || []) {
      if (block.BlockType !== 'TABLE') continue

      const cells = []
      const childRel = (block.Relationships || []).find(r => r.Type === 'CHILD')

      if (childRel) {
        for (const id of childRel.Ids) {
          const cell = byId.get(id)

          if (cell && cell.BlockType === 'CELL') cells.push(cell)
        }
      }

      const maxRow = cells.reduce((m, c) => Math.max(m, c.RowIndex || 0), 0)
      const maxCol = cells.reduce((m, c) => Math.max(m, c.ColumnIndex || 0), 0)
      const rows = Array.from({ length: maxRow }, () => Array.from({ length: maxCol }, () => ''))

      for (const cell of cells) {
        const r = (cell.RowIndex || 1) - 1
        const c = (cell.ColumnIndex || 1) - 1

        if (rows[r]) rows[r][c] = this.#collectChildText(cell, byId)
      }

      tables.push({ rows })
    }

    return tables
  }

  /**
   * Collects the text of a block's WORD / SELECTION_ELEMENT children.
   */
  #collectChildText(block, byId) {
    const childRel = (block.Relationships || []).find(r => r.Type === 'CHILD')

    if (!childRel) return ''

    const parts = []

    for (const id of childRel.Ids) {
      const child = byId.get(id)

      if (!child) continue

      if (child.BlockType === 'WORD' && child.Text) {
        parts.push(child.Text)
      } else if (child.BlockType === 'SELECTION_ELEMENT' && child.SelectionStatus === 'SELECTED') {
        parts.push('[X]')
      }
    }

    return parts.join(' ')
  }

  /**
   * Flattens AnalyzeExpense ExpenseDocuments into { summaryFields, lineItems }.
   */
  #flattenExpense(expenseDocuments) {
    const summaryFields = []
    const lineItems = []

    for (const doc of expenseDocuments) {
      for (const field of doc.SummaryFields || []) {
        summaryFields.push({
          type: (field.Type && field.Type.Text) || null,
          label: (field.LabelDetection && field.LabelDetection.Text) || null,
          value: (field.ValueDetection && field.ValueDetection.Text) || null,
          confidence: (field.ValueDetection && field.ValueDetection.Confidence) || null,
        })
      }

      for (const group of doc.LineItemGroups || []) {
        for (const item of group.LineItems || []) {
          const flat = {}

          for (const field of item.LineItemExpenseFields || []) {
            const key = (field.Type && field.Type.Text) || (field.LabelDetection && field.LabelDetection.Text)

            if (key) flat[key] = (field.ValueDetection && field.ValueDetection.Text) || null
          }

          lineItems.push(flat)
        }
      }
    }

    return { summaryFields, lineItems }
  }

  /**
   * Flattens AnalyzeID IdentityDocuments into { FIELD_TYPE: { value, confidence } }.
   */
  #flattenIdentity(identityDocuments) {
    const fields = {}

    for (const doc of identityDocuments) {
      for (const field of doc.IdentityDocumentFields || []) {
        const key = field.Type && field.Type.Text

        if (!key) continue

        fields[key] = {
          value: (field.ValueDetection && field.ValueDetection.Text) || null,
          confidence: (field.ValueDetection && field.ValueDetection.Confidence) || null,
        }
      }
    }

    return fields
  }

  #handleError(method, error) {
    this.logger.error(`[${ method }]`, error && error.message)

    if (error && error.name === 'InvalidS3ObjectException') {
      throw new Error(`Unable to access the S3 object: ${ error.message }. Check the bucket and object name, that the object exists, that it is in the same region as this integration, and that the credentials have s3:GetObject permission.`)
    }

    if (error && error.name === 'UnsupportedDocumentException') {
      throw new Error(`Unsupported document format: ${ error.message }. Textract accepts PNG, JPEG, PDF, and TIFF documents.`)
    }

    if (error && error.name === 'DocumentTooLargeException') {
      throw new Error(`Document too large: ${ error.message }. Synchronous operations are limited to ~5 MB inline / 10 MB, and single-page images or PDFs. Use S3 with the asynchronous operations for large or multi-page PDFs.`)
    }

    if (error && error.name === 'BadDocumentException') {
      throw new Error(`Textract could not read the document: ${ error.message }. Ensure the file is a valid, non-corrupt PNG, JPEG, PDF, or TIFF.`)
    }

    if (error && (error.name === 'InvalidJobIdException')) {
      throw new Error(`Invalid Job ID: ${ error.message }. The job may have expired (results are retained for 7 days) or the ID is incorrect.`)
    }

    if (error && error.name === 'InvalidParameterException') {
      throw new Error(`Invalid request: ${ error.message }. When using QUERIES you must supply queries, and you must provide exactly one of a File URL or an S3 object.`)
    }

    throw mapAwsError(error)
  }
}

if (typeof Flowrunner !== 'undefined') {
  Flowrunner.ServerCode.addService(Textract, awsConfigItems)
}

module.exports = { Textract }
