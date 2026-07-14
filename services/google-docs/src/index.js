'use strict'

const DOCS_API_BASE_URL = 'https://docs.googleapis.com/v1'
const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const DEFAULT_SCOPE_LIST = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_PAGE_SIZE = 100

const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document'

const EXPORT_FORMATS = {
  'PDF': { mimeType: 'application/pdf', extension: 'pdf' },
  'Plain Text': { mimeType: 'text/plain', extension: 'txt' },
  'Word (DOCX)': {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
  },
  'HTML': { mimeType: 'text/html', extension: 'html' },
}

const logger = {
  info: (...args) => console.log('[Google Docs] info:', ...args),
  debug: (...args) => console.log('[Google Docs] debug:', ...args),
  error: (...args) => console.log('[Google Docs] error:', ...args),
  warn: (...args) => console.log('[Google Docs] warn:', ...args),
}

/**
 * @requireOAuth
 * @usesFileStorage
 * @integrationName Google Docs
 * @integrationIcon /icon.svg
 **/
class GoogleDocsService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Google Docs API error: ${ message }`)
    }
  }

  async #binaryRequest({ url, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [GET::${ url }] q=[${ JSON.stringify(query) }]`)

      const bytes = await Flowrunner.Request.get(url)
        .set(this.#getAccessTokenHeader())
        .query(cleanupObject(query || {}))
        .setEncoding(null)

      return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Google Docs API error: ${ message }`)
    }
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #normalizeDocumentId(documentId) {
    if (!documentId) {
      throw new Error('"Document" is required')
    }

    const id = String(documentId).trim()

    // Accept a full Google Docs URL (https://docs.google.com/document/d/{id}/edit) or a bare ID
    const urlMatch = id.match(/\/document\/d\/([a-zA-Z0-9_-]+)/)

    return urlMatch ? urlMatch[1] : id
  }

  async #batchUpdate(documentId, requests, logTag) {
    return this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ DOCS_API_BASE_URL }/documents/${ documentId }:batchUpdate`,
      body: { requests },
    })
  }

  #buildDocumentUrl(documentId) {
    return `https://docs.google.com/document/d/${ documentId }/edit`
  }

  // ============================================= OAUTH ================================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('access_type', 'offline')
    params.append('prompt', 'consent')

    const connectionURL = `${ OAUTH_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)
    params.append('access_type', 'offline')

    const codeExchangeResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'Google Docs Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(USER_INFO_URL)
        .set(this.#getAccessTokenHeader(codeExchangeResponse.access_token))

      if (userData.name || userData.email) {
        connectionIdentityName = userData.name
          ? `${ userData.name } (${ userData.email })`
          : userData.email
      }

      connectionIdentityImageURL = userData.picture || null
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ error.message }`)
    }

    return {
      token: codeExchangeResponse.access_token,
      expirationInSeconds: codeExchangeResponse.expires_in,
      refreshToken: codeExchangeResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
      userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   * @property {String} [refreshToken]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const { access_token, expires_in } = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        })

      return {
        token: access_token,
        expirationInSeconds: expires_in,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getDocumentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter documents by name (Drive 'name contains' query)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Documents Dictionary
   * @description Lists Google Docs documents accessible to the connected user (own drive and shared drives, excluding trashed files), for selection in dependent parameters. Returns the document name as the label and the document ID as the value, with the last modification time as a note.
   * @route POST /get-documents-dictionary
   * @paramDef {"type":"getDocumentsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Q3 Marketing Plan","value":"1x2y3z4a5b6c7d8e9f0g","note":"Modified 2025-01-15T14:30:00.000Z"}],"cursor":"nextPageToken123"}
   */
  async getDocumentsDictionary(payload) {
    const { search, cursor } = payload || {}

    const queryParts = [`mimeType='${ GOOGLE_DOC_MIME_TYPE }'`, 'trashed=false']

    if (search) {
      const escaped = String(search).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

      queryParts.push(`name contains '${ escaped }'`)
    }

    const response = await this.#apiRequest({
      logTag: 'getDocumentsDictionary',
      url: `${ DRIVE_API_BASE_URL }/files`,
      query: {
        q: queryParts.join(' and '),
        pageSize: DEFAULT_PAGE_SIZE,
        pageToken: cursor,
        orderBy: 'modifiedTime desc',
        fields: 'nextPageToken,files(id,name,modifiedTime)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      },
    })

    return {
      cursor: response.nextPageToken,
      items: (response.files || []).map(file => ({
        label: file.name,
        value: file.id,
        note: file.modifiedTime ? `Modified ${ file.modifiedTime }` : undefined,
      })),
    }
  }

  // ============================================ DOCUMENTS =============================================

  /**
   * @description Creates a new blank Google Docs document with the given title in the connected user's My Drive root. Optionally inserts initial body text right after creation. Returns the new document ID, title, revision ID, and a direct edit URL.
   *
   * @route POST /create-document
   * @operationName Create Document
   * @category Documents
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the new document, shown in Google Drive and in the document header."}
   * @paramDef {"type":"String","label":"Initial Text","name":"initialText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional text inserted into the document body immediately after creation. Use newline characters to create multiple paragraphs."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1x2y3z4a5b6c7d8e9f0g","title":"Q3 Marketing Plan","revisionId":"ALm37BW...","documentUrl":"https://docs.google.com/document/d/1x2y3z4a5b6c7d8e9f0g/edit"}
   */
  async createDocument(title, initialText) {
    if (!title) {
      throw new Error('"Title" is required')
    }

    const document = await this.#apiRequest({
      logTag: 'createDocument',
      method: 'post',
      url: `${ DOCS_API_BASE_URL }/documents`,
      body: { title },
    })

    let revisionId = document.revisionId

    if (initialText) {
      const updateResponse = await this.#batchUpdate(document.documentId, [
        { insertText: { endOfSegmentLocation: {}, text: initialText } },
      ], 'createDocument:insertInitialText')

      revisionId = updateResponse.writeControl?.requiredRevisionId || revisionId
    }

    return {
      documentId: document.documentId,
      title: document.title,
      revisionId,
      documentUrl: this.#buildDocumentUrl(document.documentId),
    }
  }

  /**
   * @description Retrieves a Google Docs document by ID, returning the raw document resource (title, body structure, styles, revision ID) plus a convenience 'text' field containing the full document body as concatenated plain text (paragraphs, tables, and table-of-contents content included). Use 'text' for easy consumption in workflows and the raw 'body' for index-based editing.
   *
   * @route GET /get-document
   * @operationName Get Document
   * @category Documents
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The document to retrieve. Select from the list, or provide a document ID or full Google Docs URL."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1x2y3z4a5b6c7d8e9f0g","title":"Q3 Marketing Plan","revisionId":"ALm37BW...","text":"Q3 Marketing Plan\nGoals for the quarter...\n","documentUrl":"https://docs.google.com/document/d/1x2y3z4a5b6c7d8e9f0g/edit","body":{"content":[{"endIndex":1,"sectionBreak":{}}]}}
   */
  async getDocument(documentId) {
    const id = this.#normalizeDocumentId(documentId)

    const document = await this.#apiRequest({
      logTag: 'getDocument',
      url: `${ DOCS_API_BASE_URL }/documents/${ id }`,
    })

    return {
      ...document,
      text: extractTextFromContent(document.body?.content),
      documentUrl: this.#buildDocumentUrl(document.documentId),
    }
  }

  /**
   * @description Permanently deletes a Google Docs document from Google Drive by ID. The file is deleted immediately without being moved to the trash and cannot be recovered — the connected user must own the file or have permission to delete it.
   *
   * @route DELETE /delete-document
   * @operationName Delete Document
   * @category Documents
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The document to delete. Select from the list, or provide a document ID or full Google Docs URL."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Document deleted successfully","documentId":"1x2y3z4a5b6c7d8e9f0g"}
   */
  async deleteDocument(documentId) {
    const id = this.#normalizeDocumentId(documentId)

    await this.#apiRequest({
      logTag: 'deleteDocument',
      method: 'delete',
      url: `${ DRIVE_API_BASE_URL }/files/${ id }`,
      query: { supportsAllDrives: true },
    })

    return {
      success: true,
      message: 'Document deleted successfully',
      documentId: id,
    }
  }

  // ========================================== TEXT EDITING ===========================================

  /**
   * @description Appends text to the very end of a Google Docs document body. Use newline characters in the text to create new paragraphs. Returns the batch update result including the new revision ID.
   *
   * @route POST /append-text
   * @operationName Append Text
   * @category Text Editing
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The document to append to. Select from the list, or provide a document ID or full Google Docs URL."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to append at the end of the document body. Start with a newline character ('\\n') to append as a new paragraph."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1x2y3z4a5b6c7d8e9f0g","replies":[{}],"writeControl":{"requiredRevisionId":"ALm37BW..."},"documentUrl":"https://docs.google.com/document/d/1x2y3z4a5b6c7d8e9f0g/edit"}
   */
  async appendText(documentId, text) {
    if (!text) {
      throw new Error('"Text" is required')
    }

    const id = this.#normalizeDocumentId(documentId)

    const response = await this.#batchUpdate(id, [
      { insertText: { endOfSegmentLocation: {}, text } },
    ], 'appendText')

    return {
      ...response,
      documentUrl: this.#buildDocumentUrl(id),
    }
  }

  /**
   * @description Inserts text at a specific character index in a Google Docs document body. Index 1 is the very beginning of the body; indexes for existing content can be found in the 'body.content' structure returned by Get Document ('startIndex'/'endIndex' of each element). The index must fall inside the body's existing bounds.
   *
   * @route POST /insert-text
   * @operationName Insert Text
   * @category Text Editing
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The document to insert into. Select from the list, or provide a document ID or full Google Docs URL."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to insert. Use newline characters to create paragraph breaks."}
   * @paramDef {"type":"Number","label":"Index","name":"index","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The character index in the document body where the text is inserted. Index 1 is the start of the body. Must be within the existing body bounds (see 'startIndex'/'endIndex' values from Get Document)."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1x2y3z4a5b6c7d8e9f0g","replies":[{}],"writeControl":{"requiredRevisionId":"ALm37BW..."},"documentUrl":"https://docs.google.com/document/d/1x2y3z4a5b6c7d8e9f0g/edit"}
   */
  async insertText(documentId, text, index) {
    if (!text) {
      throw new Error('"Text" is required')
    }

    const insertIndex = Number(index)

    if (!Number.isInteger(insertIndex) || insertIndex < 1) {
      throw new Error('"Index" must be an integer greater than or equal to 1')
    }

    const id = this.#normalizeDocumentId(documentId)

    const response = await this.#batchUpdate(id, [
      { insertText: { location: { index: insertIndex }, text } },
    ], 'insertText')

    return {
      ...response,
      documentUrl: this.#buildDocumentUrl(id),
    }
  }

  /**
   * @description Replaces all occurrences of a text string in a Google Docs document with replacement text. Matching can be case-sensitive or case-insensitive. Leave the replacement empty to delete all occurrences. Returns the number of occurrences changed.
   *
   * @route POST /replace-all-text
   * @operationName Replace All Text
   * @category Text Editing
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The document to update. Select from the list, or provide a document ID or full Google Docs URL."}
   * @paramDef {"type":"String","label":"Find Text","name":"findText","required":true,"description":"The text to search for in the document body, headers, and footers."}
   * @paramDef {"type":"String","label":"Replace Text","name":"replaceText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text that replaces each match. Leave empty to delete all occurrences of the found text."}
   * @paramDef {"type":"Boolean","label":"Match Case","name":"matchCase","defaultValue":true,"uiComponent":{"type":"CHECKBOX"},"description":"Whether the search is case-sensitive. Default: true."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1x2y3z4a5b6c7d8e9f0g","occurrencesChanged":3,"writeControl":{"requiredRevisionId":"ALm37BW..."},"documentUrl":"https://docs.google.com/document/d/1x2y3z4a5b6c7d8e9f0g/edit"}
   */
  async replaceAllText(documentId, findText, replaceText, matchCase) {
    if (!findText) {
      throw new Error('"Find Text" is required')
    }

    const id = this.#normalizeDocumentId(documentId)

    const response = await this.#batchUpdate(id, [
      {
        replaceAllText: {
          containsText: { text: findText, matchCase: matchCase !== false },
          replaceText: replaceText || '',
        },
      },
    ], 'replaceAllText')

    return {
      documentId: id,
      occurrencesChanged: response.replies?.[0]?.replaceAllText?.occurrencesChanged || 0,
      writeControl: response.writeControl,
      documentUrl: this.#buildDocumentUrl(id),
    }
  }

  /**
   * @description Executes a raw Google Docs batchUpdate request against a document — an escape hatch for any operation not covered by dedicated actions (styling, tables, images, named ranges, headers/footers, deletions, etc.). Provide an array of request objects exactly as defined by the Google Docs API batchUpdate reference; requests are applied atomically in order.
   *
   * @route POST /batch-update
   * @operationName Batch Update
   * @category Text Editing
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The document to update. Select from the list, or provide a document ID or full Google Docs URL."}
   * @paramDef {"type":"Array<Object>","label":"Requests","name":"requests","required":true,"description":"Array of Google Docs API request objects, e.g. [{\"insertText\":{\"location\":{\"index\":1},\"text\":\"Hello\"}},{\"updateTextStyle\":{\"range\":{\"startIndex\":1,\"endIndex\":6},\"textStyle\":{\"bold\":true},\"fields\":\"bold\"}}]. See the Google Docs API batchUpdate reference for all supported request types."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1x2y3z4a5b6c7d8e9f0g","replies":[{},{}],"writeControl":{"requiredRevisionId":"ALm37BW..."},"documentUrl":"https://docs.google.com/document/d/1x2y3z4a5b6c7d8e9f0g/edit"}
   */
  async batchUpdate(documentId, requests) {
    if (!Array.isArray(requests) || !requests.length) {
      throw new Error('"Requests" must be a non-empty array of Google Docs API request objects')
    }

    const id = this.#normalizeDocumentId(documentId)

    const response = await this.#batchUpdate(id, requests, 'batchUpdate')

    return {
      ...response,
      documentUrl: this.#buildDocumentUrl(id),
    }
  }

  // ============================================ TEMPLATES =============================================

  /**
   * @description Creates a new Google Docs document from a template: copies the template document via Google Drive, then replaces placeholder tokens with the provided values. Placeholders in the template should use the double-curly-brace convention, e.g. {{name}} or {{invoice_number}}; the replacements object maps placeholder keys to values ({"name":"Acme Corp","invoice_number":"INV-42"} — braces are added automatically, keys already wrapped in {{ }} are used as-is). Matching is case-sensitive. This is the go-to operation for generating contracts, invoices, and personalized letters.
   *
   * @route POST /create-from-template
   * @operationName Create From Template
   * @category Templates
   *
   * @paramDef {"type":"String","label":"Template Document","name":"templateId","required":true,"dictionary":"getDocumentsDictionary","description":"The template document to copy. Select from the list, or provide a document ID or full Google Docs URL."}
   * @paramDef {"type":"String","label":"New Document Name","name":"name","required":true,"description":"The name (title) of the new document created from the template."}
   * @paramDef {"type":"Object","label":"Replacements","name":"replacements","description":"Object mapping template placeholder keys to replacement values, e.g. {\"name\":\"Acme Corp\",\"date\":\"2025-01-15\"}. Each key 'foo' replaces every occurrence of '{{foo}}' in the copied document; keys already containing '{{ }}' are matched literally. Values are converted to strings; null values are replaced with an empty string."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1a2b3c4d5e6f7g8h9i0j","name":"Invoice INV-42 - Acme Corp","documentUrl":"https://docs.google.com/document/d/1a2b3c4d5e6f7g8h9i0j/edit","replacements":[{"placeholder":"{{name}}","occurrencesChanged":2},{"placeholder":"{{invoice_number}}","occurrencesChanged":1}]}
   */
  async createFromTemplate(templateId, name, replacements) {
    if (!name) {
      throw new Error('"New Document Name" is required')
    }

    const template = this.#normalizeDocumentId(templateId)

    const copy = await this.#apiRequest({
      logTag: 'createFromTemplate:copy',
      method: 'post',
      url: `${ DRIVE_API_BASE_URL }/files/${ template }/copy`,
      query: { supportsAllDrives: true },
      body: { name },
    })

    const replacementEntries = Object.entries(replacements || {})
    const replacementResults = []

    if (replacementEntries.length) {
      const requests = replacementEntries.map(([key, value]) => ({
        replaceAllText: {
          containsText: {
            text: key.includes('{{') ? key : `{{${ key }}}`,
            matchCase: true,
          },
          replaceText: value === null || value === undefined ? '' : String(value),
        },
      }))

      const updateResponse = await this.#batchUpdate(copy.id, requests, 'createFromTemplate:replace')

      requests.forEach((request, i) => {
        replacementResults.push({
          placeholder: request.replaceAllText.containsText.text,
          occurrencesChanged: updateResponse.replies?.[i]?.replaceAllText?.occurrencesChanged || 0,
        })
      })
    }

    return {
      documentId: copy.id,
      name: copy.name,
      documentUrl: this.#buildDocumentUrl(copy.id),
      replacements: replacementResults,
    }
  }

  // ============================================= EXPORT ===============================================

  /**
   * @description Exports a Google Docs document to PDF, plain text, Word (DOCX), or HTML and saves the exported file to FlowRunner file storage, returning a URL to the stored file. Uses the Google Drive export endpoint, which limits exported content to 10 MB.
   *
   * @route POST /export-document
   * @operationName Export Document
   * @category Export
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The document to export. Select from the list, or provide a document ID or full Google Docs URL."}
   * @paramDef {"type":"String","label":"Format","name":"format","defaultValue":"PDF","uiComponent":{"type":"DROPDOWN","options":{"values":["PDF","Plain Text","Word (DOCX)","HTML"]}},"description":"The export format. Default: 'PDF'."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional name for the stored file. The format's extension is appended automatically if missing. Defaults to 'document_{documentId}_{timestamp}.{ext}'."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the exported file."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://storage.flowrunner.com/files/document_1x2y3z4a5b6c7d8e9f0g_1736952600000.pdf","fileName":"document_1x2y3z4a5b6c7d8e9f0g_1736952600000.pdf","format":"PDF","mimeType":"application/pdf","size":48213}
   */
  async exportDocument(documentId, format, fileName, fileOptions) {
    const id = this.#normalizeDocumentId(documentId)
    const formatKey = format || 'PDF'
    const exportFormat = EXPORT_FORMATS[formatKey]

    if (!exportFormat) {
      throw new Error(`"Format" must be one of: ${ Object.keys(EXPORT_FORMATS).join(', ') }`)
    }

    const buffer = await this.#binaryRequest({
      logTag: 'exportDocument',
      url: `${ DRIVE_API_BASE_URL }/files/${ id }/export`,
      query: { mimeType: exportFormat.mimeType },
    })

    let targetFileName = fileName || `document_${ id }_${ Date.now() }.${ exportFormat.extension }`

    if (!targetFileName.toLowerCase().endsWith(`.${ exportFormat.extension }`)) {
      targetFileName = `${ targetFileName }.${ exportFormat.extension }`
    }

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: targetFileName,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      url,
      fileName: targetFileName,
      format: formatKey,
      mimeType: exportFormat.mimeType,
      size: buffer.length,
    }
  }
}

Flowrunner.ServerCode.addService(GoogleDocsService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client ID from the Google Cloud Console (used for authentication requests).',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client Secret from the Google Cloud Console (required for secure authentication).',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function extractTextFromContent(content) {
  let text = ''

  for (const element of content || []) {
    if (element.paragraph) {
      for (const paragraphElement of element.paragraph.elements || []) {
        if (paragraphElement.textRun?.content) {
          text += paragraphElement.textRun.content
        }
      }
    } else if (element.table) {
      for (const row of element.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          text += extractTextFromContent(cell.content)
        }
      }
    } else if (element.tableOfContents) {
      text += extractTextFromContent(element.tableOfContents.content)
    }
  }

  return text
}
