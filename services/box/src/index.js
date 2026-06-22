// ============================================================================
//  SPEC: Box   auth: oauth2
//  RESOURCES:
//    - name: File          tier: primary    ops: create(upload),read(info),download,update,move,copy,delete
//    - name: Folder        tier: primary    ops: create,read(info),list-items,update,move,copy,delete
//    - name: SharedLink    tier: primary    ops: create/update(file),create/update(folder),remove
//    - name: Collaboration tier: primary    ops: create,get,list(folder),list(file),update,delete
//    - name: Search        tier: primary    ops: search
//    - name: User          tier: secondary  ops: read(current user)
//    - name: Webhook       tier: primary    ops: create/list/delete (back the REALTIME triggers)
//    - name: ChunkedUpload tier: primary    ops: create-session,upload-part,commit,abort (uploadLargeFile)
//    - name: Metadata      tier: primary    ops: list-templates(dict),create,get,list,delete  (update = UNVERIFIABLE — see GATES)
//    - name: FileVersion   tier: primary    ops: list,get,promote,delete
//    - name: Comment       tier: primary    ops: create,list(file),get,update,delete
//    - name: Task          tier: primary    ops: create,list(file),get,update,delete
//    - name: Trash         tier: primary    ops: list-items,restore(file/folder),permanently-delete(file/folder)
//  TRIGGERS: REALTIME (SINGLE_APP) — onFileEvent, onFolderEvent, onCollaborationEvent
//  GATES (human/Tier-4): webhook signature keys (config items, not OAuth-token reachable) + live webhook
//         registration round-trip; chunked-upload part/SHA-1/Content-Range against a real >20MB binary;
//         metadata instance ops need an existing enterprise template; file versions need a premium account;
//         updateMetadataInstance is UNVERIFIABLE (JSON-Patch body, no doc example) — NOT shipped, on GATES;
//         upload multipart ordering, download 302 redirect, OAuth browser flow.
//  ---------------------------------------------------------------------------
//  Build doctrine:  docs/ai/extension-build-playbook.md   Contract: ./DESIGN.md
// ============================================================================

const crypto = require('crypto')

// ============================================================================
//  CONSTANTS
// ============================================================================
const API_BASE = 'https://api.box.com/2.0'
const UPLOAD_BASE = 'https://upload.box.com/api/2.0'
const OAUTH_AUTHORIZE_URL = 'https://account.box.com/api/oauth2/authorize'
const OAUTH_TOKEN_URL = 'https://api.box.com/oauth2/token'
const ROOT_FOLDER_ID = '0'
const DEFAULT_SCOPE_LIST = ['root_readwrite']
const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

// Webhook signature verification rejects deliveries older than this (Box guidance: 10 minutes).
const WEBHOOK_MAX_AGE_MS = 10 * 60 * 1000

// Maps an inbound Box webhook trigger family to the REALTIME trigger method that shapes/filters it.
// FILE.* events can target either a file webhook (onFileEvent) or a folder webhook (a file uploaded
// into a watched folder); handleTriggerResolveEvents routes FILE.* to both so each trigger's own
// FILTER_TRIGGER decides whether it matches.
const EVENT_FAMILY_TO_METHODS = {
  FILE: ['onFileEvent', 'onFolderEvent'],
  FOLDER: ['onFolderEvent'],
  COLLABORATION: ['onCollaborationEvent'],
}

const CALL_TYPES = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

// Maps the friendly Event dropdown label (shown in the UI) to the Box webhook trigger value sent to
// the API and matched against inbound deliveries. Covers the File, Folder, and Collaboration triggers.
const EVENT_LABEL_TO_VALUE = {
  'File Uploaded': 'FILE.UPLOADED',
  'File Deleted': 'FILE.DELETED',
  'File Trashed': 'FILE.TRASHED',
  'File Restored': 'FILE.RESTORED',
  'File Copied': 'FILE.COPIED',
  'File Moved': 'FILE.MOVED',
  'File Renamed': 'FILE.RENAMED',
  'File Locked': 'FILE.LOCKED',
  'File Unlocked': 'FILE.UNLOCKED',
  'File Downloaded': 'FILE.DOWNLOADED',
  'File Previewed': 'FILE.PREVIEWED',
  'Folder Created': 'FOLDER.CREATED',
  'Folder Renamed': 'FOLDER.RENAMED',
  'Folder Deleted': 'FOLDER.DELETED',
  'Folder Trashed': 'FOLDER.TRASHED',
  'Folder Restored': 'FOLDER.RESTORED',
  'Folder Copied': 'FOLDER.COPIED',
  'Folder Moved': 'FOLDER.MOVED',
  'Folder Downloaded': 'FOLDER.DOWNLOADED',
  'File Uploaded (into folder)': 'FILE.UPLOADED',
  'Collaboration Created': 'COLLABORATION.CREATED',
  'Collaboration Accepted': 'COLLABORATION.ACCEPTED',
  'Collaboration Rejected': 'COLLABORATION.REJECTED',
  'Collaboration Removed': 'COLLABORATION.REMOVED',
  'Collaboration Updated': 'COLLABORATION.UPDATED',
}

const ERROR_HINTS = {
  401: 'Authentication failed — reconnect the Box account.',
  403: 'Access denied — the account lacks permission for this item, or sharing is disabled.',
  404: 'Not found — the ID may be wrong; use the matching picker or a list action to choose a valid one.',
  409: 'Conflict — an item with that name already exists in the destination folder.',
  429: 'Rate limit hit — retry in a moment.',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Box] info:', ...args),
  debug: (...args) => console.log('[Box] debug:', ...args),
  error: (...args) => console.log('[Box] error:', ...args),
  warn: (...args) => console.log('[Box] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getFoldersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter folders by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getFilesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter files by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getItemsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter files and folders by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getCollaborationsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Folder","name":"folderId","description":"The folder whose collaborations populate the list."}
 */

/**
 * @typedef {Object} getCollaborationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter collaborations by collaborator email or name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination marker for the next page of results."}
 * @paramDef {"type":"getCollaborationsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The folder whose collaborations to list."}
 */

/**
 * @typedef {Object} getMetadataTemplatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter metadata templates by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination marker for the next page of results."}
 */

/**
 * @typedef {Object} getGroupsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter groups by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} fileScopedDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"File","name":"fileId","description":"The file whose items populate the list."}
 */

/**
 * @typedef {Object} fileScopedDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the list."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"fileScopedDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The file whose items to list."}
 */

/**
 * @typedef {Object} trashedItemsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter trashed items by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @integrationName Box
 * @integrationIcon /icon.svg
 * @requireOAuth
 * @integrationTriggersScope SINGLE_APP
 */
class Box {
  constructor(config) {
    this.config = config || {}
    this.clientId = this.config.clientId
    this.clientSecret = this.config.clientSecret
  }

  // ==========================================================================
  //  CORE — every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set(this.#headers())
        .query(query || {})

      if (body !== undefined) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #headers() {
    return {
      Authorization: `Bearer ${ this.#getAccessToken() }`,
      'Content-Type': 'application/json',
    }
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.body?.status || error?.code
    const apiMessage =
      error?.body?.context_info?.errors?.[0]?.message ||
      error?.body?.message ||
      error?.message ||
      'Request failed'
    const hint = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  // Splits an Array.<String> param that may also arrive as a comma-separated string.
  #toList(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const list = Array.isArray(value)
      ? value
      : String(value).split(',').map(part => part.trim()).filter(Boolean)

    return list.length ? list : undefined
  }

  // Normalize a downloaded file body to a Buffer. Flowrunner.Request auto-parses
  // the response by Content-Type, so a JSON/text source comes back as a parsed
  // object/array/string rather than bytes despite .setEncoding(null). Buffer.from
  // on a parsed array would also misread elements as byte values, so re-serialize
  // anything that isn't already a Buffer.
  #toBuffer(body) {
    if (Buffer.isBuffer(body)) {
      return body
    }

    if (typeof body === 'string') {
      return Buffer.from(body)
    }

    return Buffer.from(JSON.stringify(body))
  }

  // Maps a friendly dropdown label to its Box API value. Unmapped values
  // (and identity dropdowns) pass through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ==========================================================================
  //  OAUTH2 SYSTEM METHODS
  // ==========================================================================
  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    // docs: https://developer.box.com/reference/get-authorize/
    // redirect_uri is injected by the FlowRunner platform (repo OAuth pattern) — do not append it here.
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: DEFAULT_SCOPE_STRING,
    })

    return `${ OAUTH_AUTHORIZE_URL }?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   */
  async executeCallback(callbackObject) {
    // docs: https://developer.box.com/reference/post-oauth2-token/
    const tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: callbackObject.code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: callbackObject.redirectURI,
        }).toString()
      )

    const user = await Flowrunner.Request.get(`${ API_BASE }/users/me`)
      .set({ Authorization: `Bearer ${ tokenResponse.access_token }` })
      .query({ fields: 'name,login,avatar_url' })

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: user?.name || user?.login || null,
      connectionIdentityImageURL: user?.avatar_url || null,
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   */
  async refreshToken(refreshToken) {
    // docs: https://developer.box.com/reference/post-oauth2-token/
    const tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }).toString()
      )

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
    }
  }

  // ==========================================================================
  //  FILES
  // ==========================================================================
  /**
   * @operationName Upload File
   * @category Files
   * @description Uploads a Flowrunner file's contents into a Box folder, creating a new Box file. Use this to push a generated document, export, or attachment into Box. Files must be under 50MB.
   * @route POST /upload-file
   * @paramDef {"type":"String","label":"Destination Folder","name":"parentFolderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to upload into. Use 0 for the root folder, or pick one with the folder dictionary."}
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The Flowrunner file to upload (its URL). The file's bytes are streamed to Box."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Name to give the file in Box (e.g. Contract.pdf). Defaults to the source file name. Must be unique within the folder."}
   * @returns {Object}
   * @sampleResult {"total_count":1,"entries":[{"id":"12345","type":"file","name":"Contract.pdf","size":10240,"etag":"0","parent":{"id":"0","name":"All Files","type":"folder"},"created_at":"2024-01-15T09:30:00-08:00","modified_at":"2024-01-15T09:30:00-08:00"}]}
   */
  async uploadFile(parentFolderId, fileUrl, fileName) {
    // docs: https://developer.box.com/reference/post-files-content/
    try {
      logger.debug(`uploadFile from ${ fileUrl } into folder ${ parentFolderId }`)

      const resolvedName = fileName || decodeURIComponent(String(fileUrl).split('/').pop().split('?')[0])
      const fileBytes = this.#toBuffer(await Flowrunner.Request.get(fileUrl).setEncoding(null))

      // Do NOT set Content-Type manually — the form supplies the multipart boundary.
      const formData = new Flowrunner.Request.FormData()
      // attributes part MUST come BEFORE the file part (Box 400s on the reverse order).
      formData.append('attributes', JSON.stringify({ name: resolvedName, parent: { id: parentFolderId } }))
      formData.append('file', fileBytes, { filename: resolvedName })

      return await Flowrunner.Request.post(`${ UPLOAD_BASE }/files/content`)
        .set({ Authorization: `Bearer ${ this.#getAccessToken() }` })
        .form(formData)
    } catch (error) {
      this.#handleError(error, 'uploadFile')
    }
  }

  /**
   * @operationName Get File Info
   * @category Files
   * @description Retrieves the metadata for a single Box file — name, size, parent folder, timestamps, and shared-link status. Use this to inspect a file before acting on it.
   * @route POST /get-file-info
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to fetch metadata for. Pick from the file picker or paste a Box file ID."}
   * @returns {Object}
   * @sampleResult {"id":"12345","type":"file","name":"Contract.pdf","size":10240,"etag":"1","parent":{"id":"0","name":"All Files","type":"folder"},"created_at":"2024-01-15T09:30:00-08:00","modified_at":"2024-01-16T11:00:00-08:00","shared_link":null,"description":""}
   */
  async getFileInfo(fileId) {
    // docs: https://developer.box.com/reference/get-files-id/
    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }`,
      logTag: 'getFileInfo',
    })
  }

  /**
   * @operationName Download File
   * @category Files
   * @description Downloads a Box file's contents and saves them to Flowrunner file storage, returning the saved file's URL. Box redirects to its download host, which this action follows automatically.
   * @route POST /download-file
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to download. Returns the file's contents (follows Box's redirect to the download host)."}
   * @returns {Object}
   * @sampleResult {"fileName":"Contract.pdf","contentType":"application/pdf","sizeBytes":10240,"downloadUrl":"https://dl.boxcloud.com/Contract.pdf"}
   */
  async downloadFile(fileId) {
    // docs: https://developer.box.com/reference/get-files-id-content/
    try {
      logger.debug(`downloadFile ${ fileId }`)

      const info = await this.getFileInfo(fileId)
      // .setEncoding(null) keeps the binary intact; the SDK follows Box's 302 to dl.boxcloud.com.
      const fileBytes = await Flowrunner.Request.get(`${ API_BASE }/files/${ fileId }/content`)
        .set({ Authorization: `Bearer ${ this.#getAccessToken() }` })
        .setEncoding(null)

      const buffer = Buffer.isBuffer(fileBytes) ? fileBytes : Buffer.from(fileBytes)
      const savedFile = await Flowrunner.Files.saveFile(`box-downloads/${ fileId }`, info.name, buffer, true)

      return {
        fileName: info.name,
        contentType: info.content_type || null,
        sizeBytes: info.size,
        downloadUrl: savedFile,
      }
    } catch (error) {
      this.#handleError(error, 'downloadFile')
    }
  }

  /**
   * @operationName Update File
   * @category Files
   * @description Renames a Box file and/or updates its description and tags. Leave a field blank to keep its current value. To move a file to another folder, use Move File instead.
   * @route POST /update-file
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to rename or update. Pick from the file picker."}
   * @paramDef {"type":"String","label":"New Name","name":"name","description":"Rename the file (must be unique within its folder). Leave blank to keep the current name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Up to 256 characters. Searchable in Box."}
   * @paramDef {"type":"Array.<String>","label":"Tags","name":"tags","description":"Tags to set on the file. Accepts a list or a comma-separated string."}
   * @returns {Object}
   * @sampleResult {"id":"12345","type":"file","name":"Renamed.pdf","size":10240,"etag":"2","description":"Signed copy","parent":{"id":"0","name":"All Files","type":"folder"},"modified_at":"2024-01-17T08:00:00-08:00"}
   */
  async updateFile(fileId, name, description, tags) {
    // docs: https://developer.box.com/reference/put-files-id/
    const body = {}

    if (name !== undefined && name !== null && name !== '') {
      body.name = name
    }

    if (description !== undefined && description !== null) {
      body.description = description
    }

    const tagList = this.#toList(tags)

    if (tagList) {
      body.tags = tagList
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }`,
      method: 'put',
      body,
      logTag: 'updateFile',
    })
  }

  /**
   * @operationName Move File
   * @category Files
   * @description Moves a Box file into a different folder. Use this to reorganize files; the file keeps its ID and name.
   * @route POST /move-file
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to move to another folder."}
   * @paramDef {"type":"String","label":"Destination Folder","name":"parentFolderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to move the file into. Use 0 for root."}
   * @returns {Object}
   * @sampleResult {"id":"12345","type":"file","name":"Contract.pdf","parent":{"id":"678","name":"Signed","type":"folder"},"modified_at":"2024-01-17T08:05:00-08:00"}
   */
  async moveFile(fileId, parentFolderId) {
    // docs: https://developer.box.com/reference/put-files-id/
    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }`,
      method: 'put',
      body: { parent: { id: parentFolderId } },
      logTag: 'moveFile',
    })
  }

  /**
   * @operationName Copy File
   * @category Files
   * @description Copies a Box file into a folder, optionally under a new name. The original is left untouched and a new file is created.
   * @route POST /copy-file
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to copy."}
   * @paramDef {"type":"String","label":"Destination Folder","name":"parentFolderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to copy the file into. Use 0 for root."}
   * @paramDef {"type":"String","label":"New Name","name":"name","description":"Name for the copied file. Leave blank to keep the original name."}
   * @returns {Object}
   * @sampleResult {"id":"99999","type":"file","name":"FileCopy.pdf","size":10240,"parent":{"id":"678","name":"Signed","type":"folder"},"created_at":"2024-01-17T09:00:00-08:00"}
   */
  async copyFile(fileId, parentFolderId, name) {
    // docs: https://developer.box.com/reference/post-files-id-copy/
    const body = { parent: { id: parentFolderId } }

    if (name !== undefined && name !== null && name !== '') {
      body.name = name
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }/copy`,
      method: 'post',
      body,
      logTag: 'copyFile',
    })
  }

  /**
   * @operationName Delete File
   * @category Files
   * @description Deletes a Box file. Depending on the account's settings the file is moved to trash or permanently removed. This cannot be undone from here.
   * @route POST /delete-file
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to delete. Depending on enterprise settings it is moved to trash or permanently deleted."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"fileId":"12345"}
   */
  async deleteFile(fileId) {
    // docs: https://developer.box.com/reference/delete-files-id/
    await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }`,
      method: 'delete',
      logTag: 'deleteFile',
    })

    return { deleted: true, fileId }
  }

  // ==========================================================================
  //  FOLDERS
  // ==========================================================================
  /**
   * @operationName Create Folder
   * @category Folders
   * @description Creates a new folder inside a parent folder. Use this to set up a destination before uploading or moving files.
   * @route POST /create-folder
   * @paramDef {"type":"String","label":"Folder Name","name":"name","required":true,"description":"Name for the new folder (1-255 chars). Cannot contain slashes or be '.' or '..'."}
   * @paramDef {"type":"String","label":"Parent Folder","name":"parentFolderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to create this folder inside. Use 0 for the root folder."}
   * @returns {Object}
   * @sampleResult {"id":"678","type":"folder","name":"New Folder","created_at":"2024-01-15T09:30:00-08:00","modified_at":"2024-01-15T09:30:00-08:00","parent":{"id":"0","name":"All Files","type":"folder"}}
   */
  async createFolder(name, parentFolderId) {
    // docs: https://developer.box.com/reference/post-folders/
    return await this.#apiRequest({
      url: `${ API_BASE }/folders`,
      method: 'post',
      body: { name, parent: { id: parentFolderId } },
      logTag: 'createFolder',
    })
  }

  /**
   * @operationName Get Folder Info
   * @category Folders
   * @description Retrieves the metadata for a Box folder — name, parent, timestamps, and a preview of its contents. Use this to inspect a folder before listing or modifying it.
   * @route POST /get-folder-info
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to fetch metadata for. Use 0 for root, or pick one from the folder picker."}
   * @returns {Object}
   * @sampleResult {"id":"678","type":"folder","name":"New Folder","parent":{"id":"0","name":"All Files","type":"folder"},"created_at":"2024-01-15T09:30:00-08:00","modified_at":"2024-01-16T10:00:00-08:00","item_collection":{"total_count":2,"entries":[]}}
   */
  async getFolderInfo(folderId) {
    // docs: https://developer.box.com/reference/get-folders-id/
    return await this.#apiRequest({
      url: `${ API_BASE }/folders/${ folderId }`,
      logTag: 'getFolderInfo',
    })
  }

  /**
   * @operationName List Folder Items
   * @category Folders
   * @description Lists the files, folders, and web links inside a Box folder, with paging and sorting. Use this to browse a folder's contents or feed downstream actions with item IDs.
   * @route POST /list-folder-items
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder whose contents to list. Use 0 for the root folder."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max items to return per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based index of the first item to return, for paging through large folders."}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Name","Date","Size","Id"]}},"description":"Attribute to sort items by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Order of the sort."}
   * @returns {Object}
   * @sampleResult {"total_count":2,"offset":0,"limit":100,"entries":[{"id":"12345","type":"file","name":"Contract.pdf"},{"id":"678","type":"folder","name":"New Folder"}]}
   */
  async listFolderItems(folderId, limit, offset, sort, direction) {
    // docs: https://developer.box.com/reference/get-folders-id-items/
    const query = { limit: limit || 100, offset: offset || 0 }

    const resolvedSort = this.#resolveChoice(sort, { Name: 'name', Date: 'date', Size: 'size', Id: 'id' })

    if (resolvedSort) {
      query.sort = resolvedSort
    }

    const resolvedDirection = this.#resolveChoice(direction, { Ascending: 'ASC', Descending: 'DESC' })

    if (resolvedDirection) {
      query.direction = resolvedDirection
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/folders/${ folderId }/items`,
      query,
      logTag: 'listFolderItems',
    })
  }

  /**
   * @operationName Update Folder
   * @category Folders
   * @description Renames a Box folder and/or updates its description. Leave a field blank to keep its current value. To move a folder, use Move Folder instead.
   * @route POST /update-folder
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to rename or update."}
   * @paramDef {"type":"String","label":"New Name","name":"name","description":"Rename the folder. Leave blank to keep the current name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Folder description (up to 256 characters)."}
   * @returns {Object}
   * @sampleResult {"id":"678","type":"folder","name":"New folder name","description":"Project files","modified_at":"2024-01-17T08:00:00-08:00"}
   */
  async updateFolder(folderId, name, description) {
    // docs: https://developer.box.com/reference/put-folders-id/
    const body = {}

    if (name !== undefined && name !== null && name !== '') {
      body.name = name
    }

    if (description !== undefined && description !== null) {
      body.description = description
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/folders/${ folderId }`,
      method: 'put',
      body,
      logTag: 'updateFolder',
    })
  }

  /**
   * @operationName Move Folder
   * @category Folders
   * @description Moves a Box folder (and everything inside it) into a different parent folder. The folder keeps its ID and name.
   * @route POST /move-folder
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to move."}
   * @paramDef {"type":"String","label":"Destination Folder","name":"parentFolderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to move this folder into. Use 0 for root."}
   * @returns {Object}
   * @sampleResult {"id":"678","type":"folder","name":"New Folder","parent":{"id":"345","name":"Archive","type":"folder"},"modified_at":"2024-01-17T08:10:00-08:00"}
   */
  async moveFolder(folderId, parentFolderId) {
    // docs: https://developer.box.com/reference/put-folders-id/
    return await this.#apiRequest({
      url: `${ API_BASE }/folders/${ folderId }`,
      method: 'put',
      body: { parent: { id: parentFolderId } },
      logTag: 'moveFolder',
    })
  }

  /**
   * @operationName Copy Folder
   * @category Folders
   * @description Copies a Box folder and all of its contents into a destination folder, optionally under a new name. The root folder (id 0) cannot be copied.
   * @route POST /copy-folder
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to copy (the root folder, id 0, cannot be copied)."}
   * @paramDef {"type":"String","label":"Destination Folder","name":"parentFolderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to copy into. Use 0 for root."}
   * @paramDef {"type":"String","label":"New Name","name":"name","description":"Name for the copied folder. Leave blank to keep the original name."}
   * @returns {Object}
   * @sampleResult {"id":"9001","type":"folder","name":"New Folder","parent":{"id":"345","name":"Archive","type":"folder"},"created_at":"2024-01-17T09:00:00-08:00"}
   */
  async copyFolder(folderId, parentFolderId, name) {
    // docs: https://developer.box.com/reference/post-folders-id-copy/
    const body = { parent: { id: parentFolderId } }

    if (name !== undefined && name !== null && name !== '') {
      body.name = name
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/folders/${ folderId }/copy`,
      method: 'post',
      body,
      logTag: 'copyFolder',
    })
  }

  /**
   * @operationName Delete Folder
   * @category Folders
   * @description Deletes a Box folder. Turn on Delete Contents to remove a non-empty folder and everything inside it; otherwise the call fails if the folder is not empty.
   * @route POST /delete-folder
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to delete."}
   * @paramDef {"type":"Boolean","label":"Delete Contents","name":"recursive","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Turn on to delete a non-empty folder and everything inside it. Off fails if the folder is not empty."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"folderId":"678"}
   */
  async deleteFolder(folderId, recursive) {
    // docs: https://developer.box.com/reference/delete-folders-id/
    await this.#apiRequest({
      url: `${ API_BASE }/folders/${ folderId }`,
      method: 'delete',
      query: { recursive: Boolean(recursive) },
      logTag: 'deleteFolder',
    })

    return { deleted: true, folderId }
  }

  // ==========================================================================
  //  SHARING
  // ==========================================================================
  /**
   * @operationName Create File Shared Link
   * @category Sharing
   * @description Creates or updates a shared link on a Box file so it can be shared by URL. Choose who can use the link and whether they can download. Returns the file with its shared-link details.
   * @route POST /create-file-shared-link
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to create or update a shared link for."}
   * @paramDef {"type":"String","label":"Access Level","name":"access","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Open (anyone with link)","Company only","Collaborators only"]}},"description":"Who can use the link."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"Optional password to protect the link (only allowed with Open access)."}
   * @paramDef {"type":"Boolean","label":"Allow Download","name":"canDownload","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Whether people with the link can download the file."}
   * @paramDef {"type":"String","label":"Expires At","name":"unsharedAt","uiComponent":{"type":"DATE_PICKER"},"description":"Optional date when the link stops working (ISO 8601)."}
   * @returns {Object}
   * @sampleResult {"id":"12345","type":"file","name":"Contract.pdf","shared_link":{"url":"https://app.box.com/s/abc123","download_url":"https://app.box.com/shared/static/abc123.pdf","access":"open","permissions":{"can_download":true}}}
   */
  async createFileSharedLink(fileId, access, password, canDownload, unsharedAt) {
    // docs: https://developer.box.com/reference/put-files-id--add-shared-link/
    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }`,
      method: 'put',
      query: { fields: 'shared_link' },
      body: { shared_link: this.#buildSharedLink(access, password, canDownload, unsharedAt) },
      logTag: 'createFileSharedLink',
    })
  }

  /**
   * @operationName Create Folder Shared Link
   * @category Sharing
   * @description Creates or updates a shared link on a Box folder so it can be shared by URL. Choose who can use the link and whether they can download its contents. Returns the folder with its shared-link details.
   * @route POST /create-folder-shared-link
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to create or update a shared link for."}
   * @paramDef {"type":"String","label":"Access Level","name":"access","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Open (anyone with link)","Company only","Collaborators only"]}},"description":"Who can use the link."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"Optional password to protect the link (only allowed with Open access)."}
   * @paramDef {"type":"Boolean","label":"Allow Download","name":"canDownload","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Whether people with the link can download the folder's contents."}
   * @paramDef {"type":"String","label":"Expires At","name":"unsharedAt","uiComponent":{"type":"DATE_PICKER"},"description":"Optional date when the link stops working (ISO 8601)."}
   * @returns {Object}
   * @sampleResult {"id":"678","type":"folder","name":"New Folder","shared_link":{"url":"https://app.box.com/s/kwio6b4ovt1264rnfbyqo1","access":"open","permissions":{"can_download":true}}}
   */
  async createFolderSharedLink(folderId, access, password, canDownload, unsharedAt) {
    // docs: https://developer.box.com/reference/put-folders-id--add-shared-link/
    return await this.#apiRequest({
      url: `${ API_BASE }/folders/${ folderId }`,
      method: 'put',
      query: { fields: 'shared_link' },
      body: { shared_link: this.#buildSharedLink(access, password, canDownload, unsharedAt) },
      logTag: 'createFolderSharedLink',
    })
  }

  #buildSharedLink(access, password, canDownload, unsharedAt) {
    const sharedLink = {
      access: this.#resolveChoice(access, {
        'Open (anyone with link)': 'open',
        'Company only': 'company',
        'Collaborators only': 'collaborators',
      }),
    }

    if (password !== undefined && password !== null && password !== '') {
      sharedLink.password = password
    }

    if (unsharedAt !== undefined && unsharedAt !== null && unsharedAt !== '') {
      sharedLink.unshared_at = unsharedAt
    }

    if (canDownload !== undefined && canDownload !== null) {
      sharedLink.permissions = { can_download: Boolean(canDownload) }
    }

    return sharedLink
  }

  /**
   * @operationName Remove Shared Link
   * @category Sharing
   * @description Removes the shared link from a Box file or folder, revoking URL access. The item itself is not deleted.
   * @route POST /remove-shared-link
   * @paramDef {"type":"String","label":"Item Type","name":"itemType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["File","Folder"]}},"description":"Whether the shared link is on a file or a folder."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The file or folder whose shared link to remove."}
   * @returns {Object}
   * @sampleResult {"id":"12345","type":"file","name":"Contract.pdf","shared_link":null}
   */
  async removeSharedLink(itemType, itemId) {
    // docs: https://developer.box.com/reference/put-files-id--add-shared-link/
    const resolvedItemType = this.#resolveChoice(itemType, { File: 'file', Folder: 'folder' })
    const resource = resolvedItemType === 'folder' ? 'folders' : 'files'

    return await this.#apiRequest({
      url: `${ API_BASE }/${ resource }/${ itemId }`,
      method: 'put',
      query: { fields: 'shared_link' },
      body: { shared_link: null },
      logTag: 'removeSharedLink',
    })
  }

  // ==========================================================================
  //  COLLABORATIONS
  // ==========================================================================
  /**
   * @operationName Add Collaboration
   * @category Collaborations
   * @description Invites a user or group to collaborate on a Box file or folder with a chosen role (Editor, Viewer, etc.). Use this to grant someone access to shared content.
   * @route POST /add-collaboration
   * @paramDef {"type":"String","label":"Item Type","name":"itemType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["File","Folder"]}},"description":"Whether you are sharing a file or a folder."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The file or folder to share."}
   * @paramDef {"type":"String","label":"Invite","name":"accessibleByType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["User","Group"]}},"description":"Whether you are inviting an individual user or a group."}
   * @paramDef {"type":"String","label":"Email","name":"login","description":"The email address (login) of the user to invite. Use this when Invite is set to User."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","dictionary":"getGroupsDictionary","description":"The group to invite. Use this when Invite is set to Group (groups are referenced by id, not email)."}
   * @paramDef {"type":"String","label":"Role","name":"role","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Editor","Viewer","Previewer","Uploader","Previewer Uploader","Viewer Uploader","Co-owner"]}},"description":"The access level to grant the collaborator."}
   * @paramDef {"type":"Boolean","label":"Send Email Notification","name":"notify","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Email the collaborator that they have been added."}
   * @returns {Object}
   * @sampleResult {"id":"55555","type":"collaboration","role":"editor","status":"accepted","accessible_by":{"type":"user","id":"33333","login":"user@example.com","name":"Jane Doe"},"item":{"type":"file","id":"12345","name":"Contract.pdf"}}
   */
  async addCollaboration(itemType, itemId, accessibleByType, login, groupId, role, notify) {
    // docs: https://developer.box.com/reference/post-collaborations/
    // Box accepts accessible_by.login ONLY for type "user"; a group MUST be referenced by id.
    const resolvedItemType = this.#resolveChoice(itemType, { File: 'file', Folder: 'folder' })
    const resolvedAccessibleByType = this.#resolveChoice(accessibleByType, { User: 'user', Group: 'group' })
    const resolvedRole = this.#resolveChoice(role, {
      Editor: 'editor',
      Viewer: 'viewer',
      Previewer: 'previewer',
      Uploader: 'uploader',
      'Previewer Uploader': 'previewer uploader',
      'Viewer Uploader': 'viewer uploader',
      'Co-owner': 'co-owner',
    })
    let accessibleBy

    if (resolvedAccessibleByType === 'group') {
      if (!groupId) {
        throw new Error('Inviting a group requires a Group (id). Pick a group or paste a group id.')
      }

      accessibleBy = { type: 'group', id: groupId }
    } else {
      if (!login) {
        throw new Error('Inviting a user requires an Email (login).')
      }

      accessibleBy = { type: 'user', login }
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/collaborations`,
      method: 'post',
      query: { notify: notify === undefined || notify === null ? true : Boolean(notify) },
      body: {
        item: { type: resolvedItemType, id: itemId },
        accessible_by: accessibleBy,
        role: resolvedRole,
      },
      logTag: 'addCollaboration',
    })
  }

  /**
   * @operationName Get Collaboration
   * @category Collaborations
   * @description Retrieves a single collaboration by its ID, showing the role, status, who has access, and the item. Pick a folder to populate the collaboration picker.
   * @route POST /get-collaboration
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getFoldersDictionary","description":"Optional. Pick a folder to populate the Collaboration picker from that folder's collaborators. Not sent to Box — the collaboration is fetched by its own ID."}
   * @paramDef {"type":"String","label":"Collaboration","name":"collaborationId","required":true,"dictionary":"getCollaborationsDictionary","dependsOn":["folderId"],"description":"The collaboration to fetch. Choose a folder above to pick from its collaborators, or paste a collaboration ID."}
   * @returns {Object}
   * @sampleResult {"id":"55555","type":"collaboration","role":"editor","status":"accepted","accessible_by":{"type":"user","id":"33333","login":"user@example.com"},"item":{"type":"file","id":"12345"},"created_at":"2024-01-15T09:30:00-08:00"}
   */
  async getCollaboration(folderId, collaborationId) {
    // docs: https://developer.box.com/reference/get-collaborations-id/
    // folderId only scopes the collaboration picker; the read is by collaborationId alone.
    return await this.#apiRequest({
      url: `${ API_BASE }/collaborations/${ collaborationId }`,
      logTag: 'getCollaboration',
    })
  }

  /**
   * @operationName List Folder Collaborations
   * @category Collaborations
   * @description Lists the collaborators on a Box folder — who has access and at what role. Use this to audit sharing or to find a collaboration ID to update or remove.
   * @route POST /list-folder-collaborations
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder whose collaborators to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max collaborations per page (1-1000)."}
   * @paramDef {"type":"String","label":"Marker","name":"marker","description":"Pagination marker from a previous response's next_marker to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"entries":[{"id":"55555","type":"collaboration","role":"editor","status":"accepted","accessible_by":{"type":"user","login":"user@example.com"}}],"limit":100,"next_marker":null}
   */
  async listFolderCollaborations(folderId, limit, marker) {
    // docs: https://developer.box.com/reference/get-folders-id-collaborations/
    const query = { limit: limit || 100 }

    if (marker) {
      query.marker = marker
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/folders/${ folderId }/collaborations`,
      query,
      logTag: 'listFolderCollaborations',
    })
  }

  /**
   * @operationName List File Collaborations
   * @category Collaborations
   * @description Lists the collaborators on a Box file — who has access and at what role. Use this to audit sharing or to find a collaboration ID to update or remove.
   * @route POST /list-file-collaborations
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file whose collaborators to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max collaborations per page (1-1000)."}
   * @paramDef {"type":"String","label":"Marker","name":"marker","description":"Pagination marker from a previous response's next_marker to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"entries":[{"id":"55555","type":"collaboration","role":"viewer","status":"accepted","accessible_by":{"type":"user","login":"user@example.com"}}],"limit":100,"next_marker":null}
   */
  async listFileCollaborations(fileId, limit, marker) {
    // docs: https://developer.box.com/reference/get-files-id-collaborations/
    const query = { limit: limit || 100 }

    if (marker) {
      query.marker = marker
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }/collaborations`,
      query,
      logTag: 'listFileCollaborations',
    })
  }

  /**
   * @operationName Update Collaboration
   * @category Collaborations
   * @description Changes a collaborator's role on a Box file or folder (for example from Viewer to Editor). Pick a folder to populate the collaboration picker.
   * @route POST /update-collaboration
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getFoldersDictionary","description":"Optional. Pick a folder to populate the Collaboration picker from that folder's collaborators. Not sent to Box — the collaboration is updated by its own ID."}
   * @paramDef {"type":"String","label":"Collaboration","name":"collaborationId","required":true,"dictionary":"getCollaborationsDictionary","dependsOn":["folderId"],"description":"The collaboration to update. Choose a folder above to pick from its collaborators, or paste a collaboration ID."}
   * @paramDef {"type":"String","label":"Role","name":"role","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Editor","Viewer","Previewer","Uploader","Previewer Uploader","Viewer Uploader","Co-owner","Owner"]}},"description":"The new access level for the collaborator."}
   * @returns {Object}
   * @sampleResult {"id":"55555","type":"collaboration","role":"viewer","status":"accepted","accessible_by":{"type":"user","login":"user@example.com"},"item":{"type":"file","id":"12345"}}
   */
  async updateCollaboration(folderId, collaborationId, role) {
    // docs: https://developer.box.com/reference/put-collaborations-id/
    // folderId only scopes the collaboration picker; the update is by collaborationId alone.
    const resolvedRole = this.#resolveChoice(role, {
      Editor: 'editor',
      Viewer: 'viewer',
      Previewer: 'previewer',
      Uploader: 'uploader',
      'Previewer Uploader': 'previewer uploader',
      'Viewer Uploader': 'viewer uploader',
      'Co-owner': 'co-owner',
      Owner: 'owner',
    })

    return await this.#apiRequest({
      url: `${ API_BASE }/collaborations/${ collaborationId }`,
      method: 'put',
      body: { role: resolvedRole },
      logTag: 'updateCollaboration',
    })
  }

  /**
   * @operationName Remove Collaboration
   * @category Collaborations
   * @description Removes a collaboration, revoking that user's or group's access to the Box file or folder. Pick a folder to populate the collaboration picker.
   * @route POST /remove-collaboration
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getFoldersDictionary","description":"Optional. Pick a folder to populate the Collaboration picker from that folder's collaborators. Not sent to Box — the collaboration is removed by its own ID."}
   * @paramDef {"type":"String","label":"Collaboration","name":"collaborationId","required":true,"dictionary":"getCollaborationsDictionary","dependsOn":["folderId"],"description":"The collaboration to remove. Choose a folder above to pick from its collaborators, or paste a collaboration ID."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"collaborationId":"55555"}
   */
  async removeCollaboration(folderId, collaborationId) {
    // docs: https://developer.box.com/reference/delete-collaborations-id/
    // folderId only scopes the collaboration picker; the delete is by collaborationId alone.
    await this.#apiRequest({
      url: `${ API_BASE }/collaborations/${ collaborationId }`,
      method: 'delete',
      logTag: 'removeCollaboration',
    })

    return { deleted: true, collaborationId }
  }

  // ==========================================================================
  //  SEARCH
  // ==========================================================================
  /**
   * @operationName Search Content
   * @category Search
   * @description Searches Box for files, folders, and web links matching a query across names, descriptions, and contents. Use this to locate items when you don't know their IDs.
   * @route POST /search-content
   * @paramDef {"type":"String","label":"Search Query","name":"query","required":true,"description":"Words to search for across file/folder names, descriptions, and contents."}
   * @paramDef {"type":"String","label":"Item Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["File","Folder","Web Link"]}},"description":"Restrict results to one kind of item. Leave blank for all."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","uiComponent":{"type":"DROPDOWN","options":{"values":["User content","Enterprise content"]}},"description":"Search only your own content, or the whole enterprise."}
   * @paramDef {"type":"Array.<String>","label":"File Extensions","name":"fileExtensions","description":"Limit to these file extensions (without dots, e.g. pdf, png). Accepts a list or comma-separated string."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":30,"description":"Max results per page (1-200, default 30)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based offset for paging through results (max 10000)."}
   * @returns {Object}
   * @sampleResult {"type":"search_results_items","total_count":1,"limit":30,"offset":0,"entries":[{"id":"12345","type":"file","name":"sales-report.pdf","size":20480}]}
   */
  async searchContent(query, type, scope, fileExtensions, limit, offset) {
    // docs: https://developer.box.com/reference/get-search/
    const params = { query, limit: limit || 30, offset: offset || 0 }

    const resolvedType = this.#resolveChoice(type, { File: 'file', Folder: 'folder', 'Web Link': 'web_link' })

    if (resolvedType) {
      params.type = resolvedType
    }

    const resolvedScope = this.#resolveChoice(scope, { 'User content': 'user_content', 'Enterprise content': 'enterprise_content' })

    if (resolvedScope) {
      params.scope = resolvedScope
    }

    const extensions = this.#toList(fileExtensions)

    if (extensions) {
      params.file_extensions = extensions.join(',')
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/search`,
      query: params,
      logTag: 'searchContent',
    })
  }

  // ==========================================================================
  //  ACCOUNT
  // ==========================================================================
  /**
   * @operationName Get Current User
   * @category Account
   * @description Returns the profile of the connected Box user — name, login email, and storage usage. Use this to confirm which account is connected.
   * @route POST /get-current-user
   * @returns {Object}
   * @sampleResult {"id":"33333","type":"user","name":"Jane Doe","login":"jane@example.com","created_at":"2023-06-01T10:00:00-07:00","space_amount":10737418240,"space_used":524288000,"avatar_url":"https://app.box.com/api/avatar/large/33333"}
   */
  async getCurrentUser() {
    // docs: https://developer.box.com/reference/get-users-me/
    return await this.#apiRequest({
      url: `${ API_BASE }/users/me`,
      logTag: 'getCurrentUser',
    })
  }

  // ==========================================================================
  //  UPLOADS — chunked upload for files > 50 MB (host = upload.box.com)
  // ==========================================================================
  /**
   * @operationName Upload Large File
   * @category Uploads
   * @description Uploads a large file (over 50 MB) to Box using the chunked upload API: it creates an upload session, streams the file in parts, and commits it. Use Upload File for smaller files.
   * @route POST /upload-large-file
   * @executionTimeoutInSeconds 300
   * @paramDef {"type":"String","label":"Destination Folder","name":"parentFolderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to upload into. Use 0 for the root folder, or pick one with the folder picker."}
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The Flowrunner file to upload (its URL). Streamed to Box in parts. Use this for files larger than 50 MB."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"Name to give the file in Box (e.g. BigVideo.mp4). Must be unique within the folder."}
   * @returns {Object}
   * @sampleResult {"total_count":1,"entries":[{"id":"99999","type":"file","name":"BigVideo.mp4","size":104857600,"etag":"0","sha1":"134b65991ed521fcfe4724b7d814ab8ded5185dc","parent":{"id":"0","name":"All Files","type":"folder"},"created_at":"2024-01-15T09:30:00-08:00"}]}
   */
  async uploadLargeFile(parentFolderId, fileUrl, fileName) {
    // docs: https://developer.box.com/reference/post-files-upload-sessions/
    //       https://developer.box.com/reference/put-files-upload-sessions-id/
    //       https://developer.box.com/reference/post-files-upload-sessions-id-commit/
    let session

    try {
      logger.debug(`uploadLargeFile ${ fileName } into folder ${ parentFolderId }`)

      const buffer = this.#toBuffer(await Flowrunner.Request.get(fileUrl).setEncoding(null))
      const fileSize = buffer.length

      // 1) Create the upload session (returns part_size + session endpoints).
      session = await Flowrunner.Request.post(`${ UPLOAD_BASE }/files/upload_sessions`)
        .set({ Authorization: `Bearer ${ this.#getAccessToken() }`, 'Content-Type': 'application/json' })
        .send({ folder_id: parentFolderId, file_size: fileSize, file_name: fileName })

      const partSize = session.part_size
      const parts = []

      // 2) Upload each part with a SHA-1 (base64) digest + Content-Range header.
      for (let start = 0; start < fileSize; start += partSize) {
        const end = Math.min(start + partSize, fileSize)
        const chunk = buffer.subarray(start, end)
        const chunkDigest = crypto.createHash('sha1').update(chunk).digest('base64')

        const partResponse = await Flowrunner.Request.put(`${ UPLOAD_BASE }/files/upload_sessions/${ session.id }`)
          .set({
            Authorization: `Bearer ${ this.#getAccessToken() }`,
            'Content-Type': 'application/octet-stream',
            'digest': `sha=${ chunkDigest }`,
            'content-range': `bytes ${ start }-${ end - 1 }/${ fileSize }`,
          })
          .setEncoding(null)
          .send(chunk)

        parts.push(partResponse.part)
      }

      // 3) Commit with the whole-file SHA-1 digest and the collected parts.
      const wholeDigest = crypto.createHash('sha1').update(buffer).digest('base64')

      return await Flowrunner.Request.post(`${ UPLOAD_BASE }/files/upload_sessions/${ session.id }/commit`)
        .set({
          Authorization: `Bearer ${ this.#getAccessToken() }`,
          'Content-Type': 'application/json',
          'digest': `sha=${ wholeDigest }`,
        })
        .send({ parts })
    } catch (error) {
      // Abort the session so partial uploads do not linger, then surface the error.
      if (session?.id) {
        try {
          await Flowrunner.Request.delete(`${ UPLOAD_BASE }/files/upload_sessions/${ session.id }`)
            .set({ Authorization: `Bearer ${ this.#getAccessToken() }` })
        } catch (abortError) {
          logger.warn(`uploadLargeFile abort failed: ${ abortError?.message }`)
        }
      }

      this.#handleError(error, 'uploadLargeFile')
    }
  }

  // ==========================================================================
  //  FILE VERSIONS (premium-account feature)
  // ==========================================================================
  /**
   * @operationName List File Versions
   * @category Versions
   * @description Lists the version history of a Box file. Requires a Box premium account; on free accounts only the current version is returned.
   * @route POST /list-file-versions
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file whose version history to list (requires a Box premium account)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max versions per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based offset for paging through the version history."}
   * @returns {Object}
   * @sampleResult {"total_count":1,"offset":0,"limit":100,"entries":[{"id":"456456","type":"file_version","sha1":"134b65991ed521fcfe4724b7d814ab8ded5185dc","name":"Contract.pdf","size":10240,"created_at":"2024-01-10T09:30:00-08:00","modified_at":"2024-01-10T09:30:00-08:00"}]}
   */
  async listFileVersions(fileId, limit, offset) {
    // docs: https://developer.box.com/reference/get-files-id-versions/
    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }/versions`,
      query: { limit: limit || 100, offset: offset || 0 },
      logTag: 'listFileVersions',
    })
  }

  /**
   * @operationName Get File Version
   * @category Versions
   * @description Retrieves the details of a single version of a Box file. Get version IDs from List File Versions.
   * @route POST /get-file-version
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file the version belongs to."}
   * @paramDef {"type":"String","label":"Version ID","name":"versionId","required":true,"dictionary":"getFileVersionsDictionary","dependsOn":["fileId"],"description":"The file version to fetch. Choose the file above to pick from its versions, or paste a version ID."}
   * @returns {Object}
   * @sampleResult {"id":"456456","type":"file_version","sha1":"134b65991ed521fcfe4724b7d814ab8ded5185dc","name":"Contract.pdf","size":10240,"created_at":"2024-01-10T09:30:00-08:00","modified_at":"2024-01-10T09:30:00-08:00"}
   */
  async getFileVersion(fileId, versionId) {
    // docs: https://developer.box.com/reference/get-files-id-versions-id/
    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }/versions/${ versionId }`,
      logTag: 'getFileVersion',
    })
  }

  /**
   * @operationName Promote File Version
   * @category Versions
   * @description Promotes an older version of a Box file to be the current version (Box keeps the old versions). Get version IDs from List File Versions.
   * @route POST /promote-file-version
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to promote an older version of (makes that version the current one)."}
   * @paramDef {"type":"String","label":"Version ID","name":"versionId","required":true,"dictionary":"getFileVersionsDictionary","dependsOn":["fileId"],"description":"The older version to promote to current. Choose the file above to pick from its versions, or paste a version ID."}
   * @returns {Object}
   * @sampleResult {"id":"789789","type":"file_version","sha1":"134b65991ed521fcfe4724b7d814ab8ded5185dc","name":"Contract.pdf","size":10240,"created_at":"2024-01-17T09:30:00-08:00"}
   */
  async promoteFileVersion(fileId, versionId) {
    // docs: https://developer.box.com/reference/post-files-id-versions-current/
    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }/versions/current`,
      method: 'post',
      body: { type: 'file_version', id: versionId },
      logTag: 'promoteFileVersion',
    })
  }

  /**
   * @operationName Delete File Version
   * @category Versions
   * @description Moves an older version of a Box file to the trash. The current version is unaffected. Get version IDs from List File Versions.
   * @route POST /delete-file-version
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file the version belongs to."}
   * @paramDef {"type":"String","label":"Version ID","name":"versionId","required":true,"dictionary":"getFileVersionsDictionary","dependsOn":["fileId"],"description":"The file version to move to trash. Choose the file above to pick from its versions, or paste a version ID."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"fileId":"12345","versionId":"456456"}
   */
  async deleteFileVersion(fileId, versionId) {
    // docs: https://developer.box.com/reference/delete-files-id-versions-id/
    await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }/versions/${ versionId }`,
      method: 'delete',
      logTag: 'deleteFileVersion',
    })

    return { deleted: true, fileId, versionId }
  }

  // ==========================================================================
  //  COMMENTS
  // ==========================================================================
  /**
   * @operationName Create Comment
   * @category Comments
   * @description Adds a comment to a Box file. Use this to leave review notes or feedback on a document.
   * @route POST /create-comment
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to comment on."}
   * @paramDef {"type":"String","label":"Comment","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text of the comment to add."}
   * @returns {Object}
   * @sampleResult {"id":"77777","type":"comment","message":"Review completed!","created_at":"2024-01-15T09:30:00-08:00","created_by":{"id":"33333","type":"user","name":"Jane Doe","login":"jane@example.com"},"item":{"id":"12345","type":"file"}}
   */
  async createComment(fileId, message) {
    // docs: https://developer.box.com/reference/post-comments/
    return await this.#apiRequest({
      url: `${ API_BASE }/comments`,
      method: 'post',
      body: { message, item: { type: 'file', id: fileId } },
      logTag: 'createComment',
    })
  }

  /**
   * @operationName List File Comments
   * @category Comments
   * @description Lists the comments on a Box file, with paging. Use this to read feedback or find a comment ID to edit or delete.
   * @route POST /list-file-comments
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file whose comments to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max comments per page. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based offset for paging through comments."}
   * @returns {Object}
   * @sampleResult {"total_count":1,"offset":0,"limit":100,"entries":[{"id":"77777","type":"comment","message":"Review completed!","created_by":{"id":"33333","type":"user","name":"Jane Doe"}}]}
   */
  async listFileComments(fileId, limit, offset) {
    // docs: https://developer.box.com/reference/get-files-id-comments/
    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }/comments`,
      query: { limit: limit || 100, offset: offset || 0 },
      logTag: 'listFileComments',
    })
  }

  /**
   * @operationName Get Comment
   * @category Comments
   * @description Retrieves a single comment by its ID. Pick a file to populate the comment picker.
   * @route POST /get-comment
   * @paramDef {"type":"String","label":"File","name":"fileId","dictionary":"getFilesDictionary","description":"Optional. Pick a file to populate the Comment picker from that file's comments. Not sent to Box — the comment is fetched by its own ID."}
   * @paramDef {"type":"String","label":"Comment","name":"commentId","required":true,"dictionary":"getFileCommentsDictionary","dependsOn":["fileId"],"description":"The comment to fetch. Choose a file above to pick from its comments, or paste a comment ID."}
   * @returns {Object}
   * @sampleResult {"id":"77777","type":"comment","message":"Review completed!","created_at":"2024-01-15T09:30:00-08:00","created_by":{"id":"33333","type":"user","name":"Jane Doe"},"item":{"id":"12345","type":"file"}}
   */
  async getComment(fileId, commentId) {
    // docs: https://developer.box.com/reference/get-comments-id/
    return await this.#apiRequest({
      url: `${ API_BASE }/comments/${ commentId }`,
      logTag: 'getComment',
    })
  }

  /**
   * @operationName Update Comment
   * @category Comments
   * @description Edits the text of an existing Box comment. You can only edit your own comments.
   * @route POST /update-comment
   * @paramDef {"type":"String","label":"File","name":"fileId","dictionary":"getFilesDictionary","description":"Optional. Pick a file to populate the Comment picker from that file's comments. Not sent to Box — the comment is updated by its own ID."}
   * @paramDef {"type":"String","label":"Comment","name":"commentId","required":true,"dictionary":"getFileCommentsDictionary","dependsOn":["fileId"],"description":"The comment to edit (you can only edit your own comments). Choose a file above to pick from its comments, or paste a comment ID."}
   * @paramDef {"type":"String","label":"New Comment","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new text for the comment."}
   * @returns {Object}
   * @sampleResult {"id":"77777","type":"comment","message":"My New Message","created_by":{"id":"33333","type":"user","name":"Jane Doe"},"item":{"id":"12345","type":"file"}}
   */
  async updateComment(fileId, commentId, message) {
    // docs: https://developer.box.com/reference/put-comments-id/
    return await this.#apiRequest({
      url: `${ API_BASE }/comments/${ commentId }`,
      method: 'put',
      body: { message },
      logTag: 'updateComment',
    })
  }

  /**
   * @operationName Delete Comment
   * @category Comments
   * @description Deletes a Box comment. You can only delete your own comments.
   * @route POST /delete-comment
   * @paramDef {"type":"String","label":"File","name":"fileId","dictionary":"getFilesDictionary","description":"Optional. Pick a file to populate the Comment picker from that file's comments. Not sent to Box — the comment is deleted by its own ID."}
   * @paramDef {"type":"String","label":"Comment","name":"commentId","required":true,"dictionary":"getFileCommentsDictionary","dependsOn":["fileId"],"description":"The comment to delete (you can only delete your own comments). Choose a file above to pick from its comments, or paste a comment ID."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"commentId":"77777"}
   */
  async deleteComment(fileId, commentId) {
    // docs: https://developer.box.com/reference/delete-comments-id/
    await this.#apiRequest({
      url: `${ API_BASE }/comments/${ commentId }`,
      method: 'delete',
      logTag: 'deleteComment',
    })

    return { deleted: true, commentId }
  }

  // ==========================================================================
  //  TASKS
  // ==========================================================================
  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a task on a Box file (for review or completion). Use this to request approval or action on a document from collaborators.
   * @route POST /create-task
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to create a task on."}
   * @paramDef {"type":"String","label":"Action","name":"action","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Review","Complete"]}},"description":"What kind of task this is."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the task for assignees."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the task is due (ISO 8601)."}
   * @paramDef {"type":"String","label":"Completion Rule","name":"completionRule","uiComponent":{"type":"DROPDOWN","options":{"values":["All assignees","Any assignee"]}},"description":"Whether all assignees or any single assignee completing the task marks it done."}
   * @returns {Object}
   * @sampleResult {"id":"88888","type":"task","item":{"id":"12345","type":"file","name":"Contract.pdf"},"action":"review","message":"Legal review","due_at":"2024-02-01T17:00:00-08:00","is_completed":false,"created_at":"2024-01-15T09:30:00-08:00","completion_rule":"all_assignees"}
   */
  async createTask(fileId, action, message, dueAt, completionRule) {
    // docs: https://developer.box.com/reference/post-tasks/
    const body = {
      item: { type: 'file', id: fileId },
      action: this.#resolveChoice(action, { Review: 'review', Complete: 'complete' }),
    }

    if (message !== undefined && message !== null && message !== '') {
      body.message = message
    }

    if (dueAt !== undefined && dueAt !== null && dueAt !== '') {
      body.due_at = dueAt
    }

    if (completionRule !== undefined && completionRule !== null && completionRule !== '') {
      body.completion_rule = this.#resolveChoice(completionRule, { 'All assignees': 'all_assignees', 'Any assignee': 'any_assignee' })
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/tasks`,
      method: 'post',
      body,
      logTag: 'createTask',
    })
  }

  /**
   * @operationName List File Tasks
   * @category Tasks
   * @description Lists all tasks on a Box file. Use this to see outstanding reviews or find a task ID to update or delete.
   * @route POST /list-file-tasks
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file whose tasks to list."}
   * @returns {Object}
   * @sampleResult {"total_count":1,"entries":[{"id":"88888","type":"task","action":"review","message":"Legal review","due_at":"2024-02-01T17:00:00-08:00","is_completed":false,"completion_rule":"all_assignees"}]}
   */
  async listFileTasks(fileId) {
    // docs: https://developer.box.com/reference/get-files-id-tasks/
    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }/tasks`,
      logTag: 'listFileTasks',
    })
  }

  /**
   * @operationName Get Task
   * @category Tasks
   * @description Retrieves a single task by its ID. Pick a file to populate the task picker.
   * @route POST /get-task
   * @paramDef {"type":"String","label":"File","name":"fileId","dictionary":"getFilesDictionary","description":"Optional. Pick a file to populate the Task picker from that file's tasks. Not sent to Box — the task is fetched by its own ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getFileTasksDictionary","dependsOn":["fileId"],"description":"The task to fetch. Choose a file above to pick from its tasks, or paste a task ID."}
   * @returns {Object}
   * @sampleResult {"id":"88888","type":"task","item":{"id":"12345","type":"file"},"action":"review","message":"Legal review","due_at":"2024-02-01T17:00:00-08:00","is_completed":false,"completion_rule":"all_assignees"}
   */
  async getTask(fileId, taskId) {
    // docs: https://developer.box.com/reference/get-tasks-id/
    return await this.#apiRequest({
      url: `${ API_BASE }/tasks/${ taskId }`,
      logTag: 'getTask',
    })
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Updates a Box task's action, message, due date, or completion rule. Leave a field blank to keep its current value.
   * @route POST /update-task
   * @paramDef {"type":"String","label":"File","name":"fileId","dictionary":"getFilesDictionary","description":"Optional. Pick a file to populate the Task picker from that file's tasks. Not sent to Box — the task is updated by its own ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getFileTasksDictionary","dependsOn":["fileId"],"description":"The task to update. Choose a file above to pick from its tasks, or paste a task ID."}
   * @paramDef {"type":"String","label":"Action","name":"action","uiComponent":{"type":"DROPDOWN","options":{"values":["Review","Complete"]}},"description":"Change the task type. Leave blank to keep it."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Update the task description. Leave blank to keep it."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Update the due date (ISO 8601). Leave blank to keep it."}
   * @paramDef {"type":"String","label":"Completion Rule","name":"completionRule","uiComponent":{"type":"DROPDOWN","options":{"values":["All assignees","Any assignee"]}},"description":"Update the completion rule. Leave blank to keep it."}
   * @returns {Object}
   * @sampleResult {"id":"88888","type":"task","action":"review","message":"Updated review","due_at":"2024-02-05T17:00:00-08:00","is_completed":false,"completion_rule":"all_assignees"}
   */
  async updateTask(fileId, taskId, action, message, dueAt, completionRule) {
    // docs: https://developer.box.com/reference/put-tasks-id/
    const body = {}

    if (action !== undefined && action !== null && action !== '') {
      body.action = this.#resolveChoice(action, { Review: 'review', Complete: 'complete' })
    }

    if (message !== undefined && message !== null && message !== '') {
      body.message = message
    }

    if (dueAt !== undefined && dueAt !== null && dueAt !== '') {
      body.due_at = dueAt
    }

    if (completionRule !== undefined && completionRule !== null && completionRule !== '') {
      body.completion_rule = this.#resolveChoice(completionRule, { 'All assignees': 'all_assignees', 'Any assignee': 'any_assignee' })
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/tasks/${ taskId }`,
      method: 'put',
      body,
      logTag: 'updateTask',
    })
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @description Deletes a Box task. This also removes any assignments on it.
   * @route POST /delete-task
   * @paramDef {"type":"String","label":"File","name":"fileId","dictionary":"getFilesDictionary","description":"Optional. Pick a file to populate the Task picker from that file's tasks. Not sent to Box — the task is deleted by its own ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getFileTasksDictionary","dependsOn":["fileId"],"description":"The task to delete. Choose a file above to pick from its tasks, or paste a task ID."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"taskId":"88888"}
   */
  async deleteTask(fileId, taskId) {
    // docs: https://developer.box.com/reference/delete-tasks-id/
    await this.#apiRequest({
      url: `${ API_BASE }/tasks/${ taskId }`,
      method: 'delete',
      logTag: 'deleteTask',
    })

    return { deleted: true, taskId }
  }

  // ==========================================================================
  //  METADATA (consume enterprise templates; instance CRUD)
  // ==========================================================================
  /**
   * @operationName Create Metadata Instance
   * @category Metadata
   * @description Applies a metadata template to a Box file, setting its field values. Pick a template from your enterprise templates and supply the field values as a JSON object.
   * @route POST /create-metadata-instance
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to apply the metadata template to."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Global","Enterprise"]}},"description":"Whether the template is a built-in (global) or enterprise template."}
   * @paramDef {"type":"String","label":"Template","name":"templateKey","required":true,"dictionary":"getMetadataTemplatesDictionary","description":"The metadata template to apply. Pick from your enterprise templates."}
   * @paramDef {"type":"Object","label":"Field Values","name":"values","required":true,"freeform":true,"description":"The metadata field values to set, as a JSON object of field-key to value matching the chosen template (e.g. {\"status\":\"active\",\"author\":\"Jones\"})."}
   * @returns {Object}
   * @sampleResult {"$id":"01234567-89ab-cdef-0123-456789abcdef","$type":"blueprintTemplate-1234","$parent":"file_12345","$scope":"enterprise_27335","$template":"blueprintTemplate","$version":0,"status":"active","author":"Jones"}
   */
  async createMetadataInstance(fileId, scope, templateKey, values) {
    // docs: https://developer.box.com/reference/post-files-id-metadata-id-id/
    const resolvedScope = this.#resolveChoice(scope, { Global: 'global', Enterprise: 'enterprise' })

    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }/metadata/${ resolvedScope }/${ templateKey }`,
      method: 'post',
      body: values || {},
      logTag: 'createMetadataInstance',
    })
  }

  /**
   * @operationName Get Metadata Instance
   * @category Metadata
   * @description Reads the metadata a template has stored on a Box file (its field values). Pick the same template and scope used to apply it.
   * @route POST /get-metadata-instance
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to read metadata from."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Global","Enterprise"]}},"description":"Whether the template is global or enterprise."}
   * @paramDef {"type":"String","label":"Template","name":"templateKey","required":true,"dictionary":"getMetadataTemplatesDictionary","description":"The metadata template instance to fetch."}
   * @returns {Object}
   * @sampleResult {"$id":"01234567-89ab-cdef-0123-456789abcdef","$type":"blueprintTemplate-1234","$parent":"file_12345","$scope":"enterprise_27335","$template":"blueprintTemplate","$version":1,"status":"active","author":"Jones"}
   */
  async getMetadataInstance(fileId, scope, templateKey) {
    // docs: https://developer.box.com/reference/get-files-id-metadata-id-id/
    const resolvedScope = this.#resolveChoice(scope, { Global: 'global', Enterprise: 'enterprise' })

    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }/metadata/${ resolvedScope }/${ templateKey }`,
      logTag: 'getMetadataInstance',
    })
  }

  /**
   * @operationName List Metadata Instances
   * @category Metadata
   * @description Lists all metadata templates applied to a Box file and their stored values. Use this to discover which templates are on a file.
   * @route POST /list-metadata-instances
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file whose applied metadata instances to list."}
   * @returns {Object}
   * @sampleResult {"entries":[{"$id":"01234567-89ab-cdef-0123-456789abcdef","$type":"blueprintTemplate-1234","$parent":"file_12345","$scope":"enterprise_27335","$template":"blueprintTemplate","$version":1,"status":"active"}],"limit":100}
   */
  async listMetadataInstances(fileId) {
    // docs: https://developer.box.com/reference/get-files-id-metadata/
    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }/metadata`,
      logTag: 'listMetadataInstances',
    })
  }

  /**
   * @operationName Delete Metadata Instance
   * @category Metadata
   * @description Removes a metadata template (and its values) from a Box file. The file itself is unaffected.
   * @route POST /delete-metadata-instance
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to remove metadata from."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Global","Enterprise"]}},"description":"Whether the template is global or enterprise."}
   * @paramDef {"type":"String","label":"Template","name":"templateKey","required":true,"dictionary":"getMetadataTemplatesDictionary","description":"The metadata template instance to remove."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"fileId":"12345","scope":"enterprise","templateKey":"blueprintTemplate"}
   */
  async deleteMetadataInstance(fileId, scope, templateKey) {
    // docs: https://developer.box.com/reference/delete-files-id-metadata-id-id/
    const resolvedScope = this.#resolveChoice(scope, { Global: 'global', Enterprise: 'enterprise' })

    await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }/metadata/${ resolvedScope }/${ templateKey }`,
      method: 'delete',
      logTag: 'deleteMetadataInstance',
    })

    return { deleted: true, fileId, scope: resolvedScope, templateKey }
  }

  // updateMetadataInstance is intentionally NOT shipped: the Box metadata-instance update uses a
  // JSON-Patch body (application/json-patch+json) for which DESIGN.md flags no verbatim_evidence
  // example. Per the no-fabrication rule it stays on GATES (human verify) until a doc example is
  // cited — guessing the body would be an N1 defect. See DESIGN.md lines 1781-1791, 2448-2457.

  // ==========================================================================
  //  TRASH
  // ==========================================================================
  /**
   * @operationName List Trashed Items
   * @category Trash
   * @description Lists the files and folders currently in the Box trash, with paging and sorting. Use this to find an item to restore or permanently delete.
   * @route POST /list-trashed-items
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max trashed items per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based offset for paging through trashed items."}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Name","Date","Size"]}},"description":"Attribute to sort trashed items by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Order of the sort."}
   * @returns {Object}
   * @sampleResult {"total_count":2,"offset":0,"limit":100,"entries":[{"id":"12345","type":"file","name":"Contract.pdf"},{"id":"678","type":"folder","name":"Old Folder"}]}
   */
  async listTrashedItems(limit, offset, sort, direction) {
    // docs: https://developer.box.com/reference/get-folders-trash-items/
    const query = { limit: limit || 100, offset: offset || 0 }

    const resolvedSort = this.#resolveChoice(sort, { Name: 'name', Date: 'date', Size: 'size' })

    if (resolvedSort) {
      query.sort = resolvedSort
    }

    const resolvedDirection = this.#resolveChoice(direction, { Ascending: 'ASC', Descending: 'DESC' })

    if (resolvedDirection) {
      query.direction = resolvedDirection
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/folders/trash/items`,
      query,
      logTag: 'listTrashedItems',
    })
  }

  /**
   * @operationName Restore File
   * @category Trash
   * @description Restores a file from the Box trash. Optionally rename it or restore it to a different folder if the original name or parent is gone.
   * @route POST /restore-file
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getTrashedFilesDictionary","description":"The trashed file to restore. Pick from the trash, or paste a Box file ID."}
   * @paramDef {"type":"String","label":"New Name","name":"name","description":"Rename on restore if a file with the original name now exists. Leave blank to keep the name."}
   * @paramDef {"type":"String","label":"Restore To Folder","name":"parentFolderId","dictionary":"getFoldersDictionary","description":"Folder to restore into if the original parent is gone. Leave blank to restore to the original location."}
   * @returns {Object}
   * @sampleResult {"id":"12345","type":"file","name":"Contract.pdf","item_status":"active","trashed_at":null,"parent":{"id":"0","name":"All Files","type":"folder"}}
   */
  async restoreFile(fileId, name, parentFolderId) {
    // docs: https://developer.box.com/reference/post-files-id/
    const body = {}

    if (name !== undefined && name !== null && name !== '') {
      body.name = name
    }

    if (parentFolderId !== undefined && parentFolderId !== null && parentFolderId !== '') {
      body.parent = { id: parentFolderId }
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }`,
      method: 'post',
      body: Object.keys(body).length ? body : {},
      logTag: 'restoreFile',
    })
  }

  /**
   * @operationName Restore Folder
   * @category Trash
   * @description Restores a folder (and its contents) from the Box trash. Optionally rename it or restore it to a different parent if the original is gone.
   * @route POST /restore-folder
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getTrashedFoldersDictionary","description":"The trashed folder to restore. Pick from the trash, or paste a Box folder ID."}
   * @paramDef {"type":"String","label":"New Name","name":"name","description":"Rename on restore if a folder with the original name now exists."}
   * @paramDef {"type":"String","label":"Restore To Folder","name":"parentFolderId","dictionary":"getFoldersDictionary","description":"Folder to restore into if the original parent is gone. Leave blank for the original location."}
   * @returns {Object}
   * @sampleResult {"id":"678","type":"folder","name":"Old Folder","item_status":"active","trashed_at":null,"parent":{"id":"0","name":"All Files","type":"folder"}}
   */
  async restoreFolder(folderId, name, parentFolderId) {
    // docs: https://developer.box.com/reference/post-folders-id/
    const body = {}

    if (name !== undefined && name !== null && name !== '') {
      body.name = name
    }

    if (parentFolderId !== undefined && parentFolderId !== null && parentFolderId !== '') {
      body.parent = { id: parentFolderId }
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/folders/${ folderId }`,
      method: 'post',
      body: Object.keys(body).length ? body : {},
      logTag: 'restoreFolder',
    })
  }

  /**
   * @operationName Permanently Delete File
   * @category Trash
   * @description Permanently deletes a file from the Box trash. This cannot be undone. Get IDs from List Trashed Items.
   * @route POST /permanently-delete-file
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getTrashedFilesDictionary","description":"The trashed file to permanently delete. This cannot be undone. Pick from the trash, or paste a Box file ID."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"fileId":"12345"}
   */
  async permanentlyDeleteFile(fileId) {
    // docs: https://developer.box.com/reference/delete-files-id-trash/
    await this.#apiRequest({
      url: `${ API_BASE }/files/${ fileId }/trash`,
      method: 'delete',
      logTag: 'permanentlyDeleteFile',
    })

    return { deleted: true, fileId }
  }

  /**
   * @operationName Permanently Delete Folder
   * @category Trash
   * @description Permanently deletes a folder from the Box trash. This cannot be undone. Get IDs from List Trashed Items.
   * @route POST /permanently-delete-folder
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getTrashedFoldersDictionary","description":"The trashed folder to permanently delete. This cannot be undone. Pick from the trash, or paste a Box folder ID."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"folderId":"678"}
   */
  async permanentlyDeleteFolder(folderId) {
    // docs: https://developer.box.com/reference/delete-folders-id-trash/
    await this.#apiRequest({
      url: `${ API_BASE }/folders/${ folderId }/trash`,
      method: 'delete',
      logTag: 'permanentlyDeleteFolder',
    })

    return { deleted: true, folderId }
  }

  // ==========================================================================
  //  REALTIME TRIGGERS (SINGLE_APP — webhooks are per-target)
  // ==========================================================================
  /**
   * @operationName On File Event
   * @category Triggers
   * @description Fires when a chosen Box file changes (uploaded, deleted, moved, renamed, and more). Box registers a webhook on the file and this trigger runs your flow when the event arrives.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-file-event
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to watch. Box creates a webhook on this file."}
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["File Uploaded","File Deleted","File Trashed","File Restored","File Copied","File Moved","File Renamed","File Locked","File Unlocked","File Downloaded","File Previewed"]}},"description":"Which file change fires this trigger."}
   * @returns {Object}
   * @sampleResult {"eventId":"f82c3ba03e41f7e8a7608363cc6c0390","trigger":"FILE.UPLOADED","fileId":"12345","fileName":"Contract.pdf","source":{"id":"12345","type":"file","name":"Contract.pdf","parent":{"id":"0","name":"All Files","type":"folder"}},"createdAt":"2024-01-15T09:30:00-08:00","createdBy":{"id":"33333","type":"user","name":"Jane Doe","login":"jane@example.com"}}
   */
  onFileEvent(callType, payload) {
    if (callType === CALL_TYPES.SHAPE_EVENT) {
      return [{ name: 'onFileEvent', data: this.#shapeFileEvent(payload) }]
    }

    if (callType === CALL_TYPES.FILTER_TRIGGER) {
      return {
        ids: this.#matchTriggers(payload, (trigger, event) =>
          trigger.data.fileId === event.source?.id &&
          this.#resolveChoice(trigger.data.event, EVENT_LABEL_TO_VALUE) === event.trigger),
      }
    }
  }

  /**
   * @operationName On Folder Event
   * @category Triggers
   * @description Fires when a chosen Box folder changes (created, renamed, moved, deleted, or a file is uploaded into it). Box registers a webhook on the folder and this trigger runs your flow when the event arrives.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-folder-event
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to watch. Use 0 for the root folder. Box creates a webhook on this folder."}
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Folder Created","Folder Renamed","Folder Deleted","Folder Trashed","Folder Restored","Folder Copied","Folder Moved","Folder Downloaded","File Uploaded (into folder)"]}},"description":"Which folder change fires this trigger."}
   * @returns {Object}
   * @sampleResult {"eventId":"a1b2c3","trigger":"FOLDER.CREATED","folderId":"678","folderName":"New Folder","source":{"id":"678","type":"folder","name":"New Folder","parent":{"id":"0","name":"All Files","type":"folder"}},"createdAt":"2024-01-15T09:30:00-08:00","createdBy":{"id":"33333","type":"user","name":"Jane Doe"}}
   */
  onFolderEvent(callType, payload) {
    if (callType === CALL_TYPES.SHAPE_EVENT) {
      return [{ name: 'onFolderEvent', data: this.#shapeFolderEvent(payload) }]
    }

    if (callType === CALL_TYPES.FILTER_TRIGGER) {
      return {
        ids: this.#matchTriggers(payload, (trigger, event) => {
          const targetMatches = trigger.data.folderId === event.source?.id ||
          trigger.data.folderId === event.source?.parent?.id

          return targetMatches &&
            this.#resolveChoice(trigger.data.event, EVENT_LABEL_TO_VALUE) === event.trigger
        }),
      }
    }
  }

  /**
   * @operationName On Collaboration Event
   * @category Triggers
   * @description Fires when collaboration on a chosen Box folder changes (invites created, accepted, rejected, updated, or removed). Box registers a webhook on the folder and this trigger runs your flow when the event arrives.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-collaboration-event
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to watch for collaboration changes (sharing/invites). Use 0 for root."}
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Collaboration Created","Collaboration Accepted","Collaboration Rejected","Collaboration Removed","Collaboration Updated"]}},"description":"Which collaboration change fires this trigger."}
   * @returns {Object}
   * @sampleResult {"eventId":"c0ll4b","trigger":"COLLABORATION.CREATED","collaborationId":"55555","source":{"id":"55555","type":"collaboration","role":"editor","status":"pending","accessible_by":{"type":"user","login":"user@example.com"},"item":{"type":"folder","id":"678","name":"New Folder"}},"createdAt":"2024-01-15T09:30:00-08:00","createdBy":{"id":"33333","type":"user","name":"Jane Doe"}}
   */
  onCollaborationEvent(callType, payload) {
    if (callType === CALL_TYPES.SHAPE_EVENT) {
      return [{ name: 'onCollaborationEvent', data: this.#shapeCollaborationEvent(payload) }]
    }

    if (callType === CALL_TYPES.FILTER_TRIGGER) {
      return {
        ids: this.#matchTriggers(payload, (trigger, event) => {
          const itemId = event.source?.item?.id
          const targetMatches = trigger.data.folderId === itemId || trigger.data.folderId === event.source?.id

          return targetMatches &&
            this.#resolveChoice(trigger.data.event, EVENT_LABEL_TO_VALUE) === event.trigger
        }),
      }
    }
  }

  // ── Trigger event shaping ──────────────────────────────────────────────
  #shapeFileEvent(body) {
    return {
      eventId: body.id,
      trigger: body.trigger,
      fileId: body.source?.id,
      fileName: body.source?.name,
      source: body.source,
      createdAt: body.created_at,
      createdBy: body.created_by,
    }
  }

  #shapeFolderEvent(body) {
    return {
      eventId: body.id,
      trigger: body.trigger,
      folderId: body.source?.id,
      folderName: body.source?.name,
      source: body.source,
      createdAt: body.created_at,
      createdBy: body.created_by,
    }
  }

  #shapeCollaborationEvent(body) {
    return {
      eventId: body.id,
      trigger: body.trigger,
      collaborationId: body.source?.id,
      source: body.source,
      createdAt: body.created_at,
      createdBy: body.created_by,
    }
  }

  // The FILTER_TRIGGER payload carries the shaped eventData (under .data) and the registered triggers.
  #matchTriggers(payload, predicate) {
    const eventData = payload.eventData || payload.data || {}
    const event = { trigger: eventData.trigger, source: eventData.source }

    return (payload.triggers || [])
      .filter(trigger => predicate(trigger, event))
      .map(trigger => trigger.id)
  }

  // ── SYSTEM trigger handlers (SINGLE_APP) ───────────────────────────────
  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerUpsertWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook.invocation: ${ JSON.stringify(invocation) }`)

    const address = `${ invocation.callbackUrl }${ invocation.callbackUrl.includes('?') ? '&' : '?' }connectionId=${ invocation.connectionId }`
    const webhooks = []

    for (const event of invocation.events || []) {
      const data = event.triggerData || {}
      const isFolderScope = event.name === 'onFolderEvent' || event.name === 'onCollaborationEvent'
      const targetType = isFolderScope ? 'folder' : 'file'
      const targetId = isFolderScope ? data.folderId : data.fileId
      const resolvedEvent = this.#resolveChoice(data.event, EVENT_LABEL_TO_VALUE)

      const created = await this.#apiRequest({
        url: `${ API_BASE }/webhooks`,
        method: 'post',
        body: { target: { id: targetId, type: targetType }, address, triggers: [resolvedEvent] },
        logTag: 'createWebhook',
      })

      webhooks.push({ triggerId: event.id, webhookId: created?.id, targetType, targetId, event: resolvedEvent })
    }

    return { webhookData: { webhooks }, connectionId: invocation.connectionId }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerResolveEvents
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug('handleTriggerResolveEvents invoked')

    // Box's webhook setup performs no handshake, but guard the empty-body case defensively.
    if (!invocation || !invocation.body) {
      return { handshake: true, responseToExternalService: invocation?.body || {} }
    }

    if (!this.#verifyWebhookSignature(invocation)) {
      logger.warn('handleTriggerResolveEvents: webhook signature verification failed — rejecting delivery')

      return { connectionId: invocation.queryParams?.connectionId, events: [] }
    }

    const family = String(invocation.body.trigger || '').split('.')[0]
    const methodNames = EVENT_FAMILY_TO_METHODS[family]

    if (!methodNames) {
      return { connectionId: invocation.queryParams?.connectionId, events: [] }
    }

    const events = methodNames.flatMap(methodName => this[methodName](CALL_TYPES.SHAPE_EVENT, invocation.body))

    return { connectionId: invocation.queryParams?.connectionId, events }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerSelectMatched
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }`)

    return this[invocation.eventName](CALL_TYPES.FILTER_TRIGGER, invocation)
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerDeleteWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug('handleTriggerDeleteWebhook invoked')

    const webhooks = invocation.webhookData?.webhooks || []

    for (const webhook of webhooks) {
      if (!webhook.webhookId) {
        continue
      }

      try {
        await this.#apiRequest({
          url: `${ API_BASE }/webhooks/${ webhook.webhookId }`,
          method: 'delete',
          logTag: 'deleteWebhook',
        })
      } catch (error) {
        logger.warn(`handleTriggerDeleteWebhook: failed to delete webhook ${ webhook.webhookId }: ${ error?.message }`)
      }
    }

    return { webhookData: {} }
  }

  // Verifies the inbound Box webhook signature (HMAC-SHA256 over body-bytes ‖ timestamp, base64)
  // against the primary/secondary signature keys, and rejects deliveries older than 10 minutes.
  // Keys come from the Box Developer Console (config items) — see GATES. If keys are unset the
  // build-time mock has no real signature, so verification is skipped with a warning.
  #verifyWebhookSignature(invocation) {
    const primaryKey = this.config.webhookPrimaryKey
    const secondaryKey = this.config.webhookSecondaryKey

    if (!primaryKey && !secondaryKey) {
      logger.warn('Webhook signature keys are not configured — skipping signature verification (set them in the Box Developer Console).')

      return true
    }

    const headers = invocation.headers || {}
    const timestamp = headers['BOX-DELIVERY-TIMESTAMP'] || headers['box-delivery-timestamp']
    const primarySig = headers['BOX-SIGNATURE-PRIMARY'] || headers['box-signature-primary']
    const secondarySig = headers['BOX-SIGNATURE-SECONDARY'] || headers['box-signature-secondary']

    if (!timestamp) {
      return false
    }

    if (Date.now() - new Date(timestamp).getTime() > WEBHOOK_MAX_AGE_MS) {
      logger.warn('Webhook delivery is older than 10 minutes — rejecting.')

      return false
    }

    const rawBody = invocation.rawBody !== undefined ? invocation.rawBody : JSON.stringify(invocation.body)
    const message = Buffer.concat([Buffer.from(rawBody), Buffer.from(String(timestamp))])

    return this.#signatureMatches(message, primaryKey, primarySig) ||
      this.#signatureMatches(message, secondaryKey, secondarySig)
  }

  #signatureMatches(message, key, providedSignature) {
    if (!key || !providedSignature) {
      return false
    }

    const expected = crypto.createHmac('sha256', key).update(message).digest('base64')
    const expectedBuffer = Buffer.from(expected)
    const providedBuffer = Buffer.from(providedSignature)

    return expectedBuffer.length === providedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Folders Dictionary
   * @description Provides a searchable list of Box folders for dropdown selection in other actions.
   * @route POST /get-folders-dictionary
   * @paramDef {"type":"getFoldersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"New Folder","value":"678","note":"Folder ID: 678"}],"cursor":null}
   */
  async getFoldersDictionary(payload) {
    const { search, cursor } = payload || {}

    if (search) {
      const result = await this.searchContent(search, 'folder', undefined, undefined, 50, Number(cursor) || 0)
      const entries = (result && result.entries) || []

      return {
        items: entries.map(item => ({ label: item.name, value: item.id, note: `Folder ID: ${ item.id }` })),
        cursor: this.#nextOffsetCursor(result),
      }
    }

    const result = await this.listFolderItems(ROOT_FOLDER_ID, 100, Number(cursor) || 0, 'name', 'ASC')
    const entries = (result && result.entries) || []

    return {
      items: entries
        .filter(item => item.type === 'folder')
        .map(item => ({ label: item.name, value: item.id, note: `Folder ID: ${ item.id }` })),
      cursor: this.#nextOffsetCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Files Dictionary
   * @description Provides a searchable list of Box files for dropdown selection in other actions.
   * @route POST /get-files-dictionary
   * @paramDef {"type":"getFilesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Contract.pdf","value":"12345","note":"File ID: 12345"}],"cursor":null}
   */
  async getFilesDictionary(payload) {
    const { search, cursor } = payload || {}

    if (search) {
      const result = await this.searchContent(search, 'file', undefined, undefined, 50, Number(cursor) || 0)
      const entries = (result && result.entries) || []

      return {
        items: entries.map(item => ({ label: item.name, value: item.id, note: `File ID: ${ item.id }` })),
        cursor: this.#nextOffsetCursor(result),
      }
    }

    const result = await this.listFolderItems(ROOT_FOLDER_ID, 100, Number(cursor) || 0, 'name', 'ASC')
    const entries = (result && result.entries) || []

    return {
      items: entries
        .filter(item => item.type === 'file')
        .map(item => ({ label: item.name, value: item.id, note: `File ID: ${ item.id }` })),
      cursor: this.#nextOffsetCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Items Dictionary
   * @description Provides a searchable list of Box files and folders for dropdown selection in actions that accept either kind of item.
   * @route POST /get-items-dictionary
   * @paramDef {"type":"getItemsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Contract.pdf","value":"12345","note":"file 12345"}],"cursor":null}
   */
  async getItemsDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = search
      ? await this.searchContent(search, undefined, undefined, undefined, 50, Number(cursor) || 0)
      : await this.listFolderItems(ROOT_FOLDER_ID, 100, Number(cursor) || 0, 'name', 'ASC')
    const entries = (result && result.entries) || []

    return {
      items: entries.map(item => ({ label: item.name, value: item.id, note: `${ item.type } ${ item.id }` })),
      cursor: this.#nextOffsetCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Collaborations Dictionary
   * @description Provides a searchable list of a folder's collaborations for dropdown selection in the collaboration actions.
   * @route POST /get-collaborations-dictionary
   * @paramDef {"type":"getCollaborationsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the folder criteria whose collaborations to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"user@example.com — Editor","value":"55555","note":"Collaboration ID: 55555"}],"cursor":null}
   */
  async getCollaborationsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const folderId = criteria?.folderId

    if (!folderId) {
      return { items: [], cursor: null }
    }

    const result = await this.listFolderCollaborations(folderId, 100, cursor || undefined)
    const entries = (result && result.entries) || []
    const term = (search || '').toLowerCase()

    const items = entries
      .map(collab => {
        const who = collab.accessible_by?.login || collab.accessible_by?.name || collab.accessible_by?.id || 'Unknown'

        return { label: `${ who } — ${ collab.role }`, value: collab.id, note: `Collaboration ID: ${ collab.id }` }
      })
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: (result && result.next_marker) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Metadata Templates Dictionary
   * @description Provides a searchable list of the enterprise metadata templates for dropdown selection in the metadata actions.
   * @route POST /get-metadata-templates-dictionary
   * @paramDef {"type":"getMetadataTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Blueprint Template","value":"blueprintTemplate","note":"Scope: enterprise_27335"}],"cursor":null}
   */
  async getMetadataTemplatesDictionary(payload) {
    // docs: https://developer.box.com/reference/get-metadata-templates-enterprise/
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ API_BASE }/metadata_templates/enterprise`,
      query: cursor ? { marker: cursor } : {},
      logTag: 'getMetadataTemplatesDictionary',
    })

    const entries = (result && result.entries) || []
    const term = (search || '').toLowerCase()

    const items = entries
      .map(template => ({
        label: template.displayName || template.templateKey,
        value: template.templateKey,
        note: `Scope: ${ template.scope }`,
      }))
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: (result && result.next_marker) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Groups Dictionary
   * @description Provides a searchable list of the Box groups the connected user can see, for selecting a group when adding a collaboration.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engineering","value":"24681012","note":"Group ID: 24681012"}],"cursor":null}
   */
  async getGroupsDictionary(payload) {
    // docs: https://developer.box.com/reference/get-groups/
    const { search, cursor } = payload || {}
    const query = { limit: 100, offset: Number(cursor) || 0 }

    if (search) {
      query.filter_term = search
    }

    const result = await this.#apiRequest({
      url: `${ API_BASE }/groups`,
      query,
      logTag: 'getGroupsDictionary',
    })

    const entries = (result && result.entries) || []

    return {
      items: entries.map(group => ({ label: group.name, value: group.id, note: `Group ID: ${ group.id }` })),
      cursor: this.#nextOffsetCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get File Versions Dictionary
   * @description Provides a list of a file's versions for dropdown selection in the version actions.
   * @route POST /get-file-versions-dictionary
   * @paramDef {"type":"fileScopedDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the file criteria whose versions to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Contract.pdf (10 KB)","value":"456456","note":"Version ID: 456456"}],"cursor":null}
   */
  async getFileVersionsDictionary(payload) {
    const { cursor, criteria } = payload || {}
    const fileId = criteria?.fileId

    if (!fileId) {
      return { items: [], cursor: null }
    }

    const result = await this.listFileVersions(fileId, 100, Number(cursor) || 0)
    const entries = (result && result.entries) || []

    return {
      items: entries.map(version => ({
        label: `${ version.name } (${ version.size } bytes)`,
        value: version.id,
        note: `Version ID: ${ version.id }`,
      })),
      cursor: this.#nextOffsetCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get File Comments Dictionary
   * @description Provides a list of a file's comments for dropdown selection in the comment actions.
   * @route POST /get-file-comments-dictionary
   * @paramDef {"type":"fileScopedDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the file criteria whose comments to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Review completed!","value":"77777","note":"Comment ID: 77777"}],"cursor":null}
   */
  async getFileCommentsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const fileId = criteria?.fileId

    if (!fileId) {
      return { items: [], cursor: null }
    }

    const result = await this.listFileComments(fileId, 100, Number(cursor) || 0)
    const entries = (result && result.entries) || []
    const term = (search || '').toLowerCase()

    const items = entries
      .map(comment => ({
        label: (comment.message || '[no message]').slice(0, 60),
        value: comment.id,
        note: `Comment ID: ${ comment.id }`,
      }))
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: this.#nextOffsetCursor(result) }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get File Tasks Dictionary
   * @description Provides a list of a file's tasks for dropdown selection in the task actions.
   * @route POST /get-file-tasks-dictionary
   * @paramDef {"type":"fileScopedDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the file criteria whose tasks to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Legal review (review)","value":"88888","note":"Task ID: 88888"}],"cursor":null}
   */
  async getFileTasksDictionary(payload) {
    const { search, criteria } = payload || {}
    const fileId = criteria?.fileId

    if (!fileId) {
      return { items: [], cursor: null }
    }

    const result = await this.listFileTasks(fileId)
    const entries = (result && result.entries) || []
    const term = (search || '').toLowerCase()

    const items = entries
      .map(task => ({
        label: `${ task.message || task.action } (${ task.action })`,
        value: task.id,
        note: `Task ID: ${ task.id }`,
      }))
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Trashed Files Dictionary
   * @description Provides a list of the files currently in the trash for dropdown selection in the restore and permanent-delete actions.
   * @route POST /get-trashed-files-dictionary
   * @paramDef {"type":"trashedItemsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Contract.pdf","value":"12345","note":"File ID: 12345"}],"cursor":null}
   */
  async getTrashedFilesDictionary(payload) {
    return this.#trashedItemsDictionary(payload, 'file', 'File ID')
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Trashed Folders Dictionary
   * @description Provides a list of the folders currently in the trash for dropdown selection in the restore and permanent-delete actions.
   * @route POST /get-trashed-folders-dictionary
   * @paramDef {"type":"trashedItemsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Old Folder","value":"678","note":"Folder ID: 678"}],"cursor":null}
   */
  async getTrashedFoldersDictionary(payload) {
    return this.#trashedItemsDictionary(payload, 'folder', 'Folder ID')
  }

  async #trashedItemsDictionary(payload, itemType, noteLabel) {
    const { search, cursor } = payload || {}
    const result = await this.listTrashedItems(100, Number(cursor) || 0, 'name', 'ASC')
    const entries = (result && result.entries) || []
    const term = (search || '').toLowerCase()

    const items = entries
      .filter(item => item.type === itemType)
      .map(item => ({ label: item.name, value: item.id, note: `${ noteLabel }: ${ item.id }` }))
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: this.#nextOffsetCursor(result) }
  }

  // Offset pagination: next cursor is offset+limit while more items remain, else null.
  #nextOffsetCursor(result) {
    if (!result || typeof result.offset !== 'number' || typeof result.limit !== 'number') {
      return null
    }

    const next = result.offset + result.limit

    return typeof result.total_count === 'number' && next < result.total_count ? String(next) : null
  }
}

Flowrunner.ServerCode.addService(Box, [
  {
    name: 'clientId',
    shared: true,
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'OAuth2 Client ID from your Box app settings (developer.box.com).',
  },
  {
    name: 'clientSecret',
    shared: true,
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'OAuth2 Client Secret from your Box app settings (developer.box.com).',
  },
  {
    name: 'webhookPrimaryKey',
    shared: false,
    displayName: 'Webhook Primary Signature Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    hint: 'From the Box Developer Console → your app → Webhooks → Manage signature keys. Used to verify incoming webhook payloads.',
  },
  {
    name: 'webhookSecondaryKey',
    shared: false,
    displayName: 'Webhook Secondary Signature Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    hint: 'From the Box Developer Console → your app → Webhooks → Manage signature keys. Used to verify incoming webhook payloads.',
  },
])
