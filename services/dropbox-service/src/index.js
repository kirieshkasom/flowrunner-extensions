'use strict'

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize'
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const API_BASE = 'https://api.dropboxapi.com/2'
const CONTENT_BASE = 'https://content.dropboxapi.com/2'

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024

const DEFAULT_SCOPE_LIST = [
  'account_info.read',
  'files.metadata.read',
  'files.metadata.write',
  'files.content.read',
  'files.content.write',
  'sharing.read',
  'sharing.write',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[Dropbox Service] info:', ...args),
  debug: (...args) => console.log('[Dropbox Service] debug:', ...args),
  error: (...args) => console.log('[Dropbox Service] error:', ...args),
  warn: (...args) => console.log('[Dropbox Service] warn:', ...args),
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      result[key] = data[key]
    }
  })

  return result
}

function asciiSafeJsonStringify(obj) {
  // Dropbox-API-Arg header values must be ASCII. Escape any non-ASCII
  // codepoints as \uXXXX so Unicode filenames survive the round trip.
  const json = JSON.stringify(obj)

  return json.replace(/[\u0080-\uFFFF]/g, ch => {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  })
}

function normalizeDropboxPath(folderPath, fileName) {
  // Dropbox uses "" for root and "/folder/file" otherwise.
  // Build a clean path from a folder + file name pair.
  const folder = (folderPath || '').replace(/\/+$/, '')
  const name = (fileName || '').replace(/^\/+/, '')

  if (!folder) {
    return name ? `/${ name }` : ''
  }

  if (!name) {
    return folder.startsWith('/') ? folder : `/${ folder }`
  }

  const withLeadingSlash = folder.startsWith('/') ? folder : `/${ folder }`

  return `${ withLeadingSlash }/${ name }`
}

function basenameFromPath(p) {
  if (!p) return ''

  const trimmed = p.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')

  return idx === -1 ? trimmed : trimmed.slice(idx + 1)
}

function isCursorResetError(error) {
  // Dropbox returns 409 with an error_summary like "reset/..." or
  // "list_folder_continue/reset/..." when a saved cursor becomes invalid.
  if (!error) return false

  const status = error.status || error.statusCode
  const body = error.body || {}
  const summary = typeof body === 'string' ? body : body.error_summary || ''
  const tag = body?.error?.['.tag'] || ''

  if (status !== 409) return false

  return (
    summary.startsWith('reset/') ||
    summary.includes('list_folder_continue/reset') ||
    tag === 'reset'
  )
}

/**
 * @usesFileStorage
 * @requireOAuth
 * @integrationName Dropbox
 * @integrationIcon /icon.svg
 */
class DropboxService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  // ==================== Private Helpers ====================

  #getAccessToken() {
    const token = this.request?.headers?.['oauth-access-token']

    if (!token) {
      throw new Error(
        'Access token is not available. Please reconnect your Dropbox account.'
      )
    }

    return token
  }

  #getAuthHeader() {
    return { Authorization: `Bearer ${ this.#getAccessToken() }` }
  }

  #mapDropboxError(error, logTag) {
    const status = error?.status || error?.statusCode
    const body = error?.body
    const summary =
      (body && typeof body === 'object' && body.error_summary) || ''

    logger.error(
      `${ logTag } - api error:`,
      status || 'no-status',
      summary ||
        (typeof body === 'string'
          ? body
          : JSON.stringify(body || error?.message || error))
    )

    if (status === 401) {
      return new Error(
        'Your Dropbox session has expired. Please reconnect your account.'
      )
    }

    if (status === 429) {
      return new Error('Dropbox rate limit reached. Try again later.')
    }

    if (status === 409 && summary) {
      return new Error(`Dropbox error: ${ summary }`)
    }

    if (summary) {
      return new Error(`Dropbox error: ${ summary }`)
    }

    const message = error?.message || 'Unknown Dropbox error.'

    return new Error(`${ logTag } - ${ message }`)
  }

  async #rpcRequest({ endpoint, body, logTag }) {
    const url = `${ API_BASE }/${ endpoint }`

    logger.debug(`${ logTag } - rpc request: [${ url }]`)

    try {
      const request = Flowrunner.Request.post(url).set(this.#getAuthHeader())

      if (body !== undefined && body !== null) {
        request.set({ 'Content-Type': 'application/json' })

        return await request.send(body)
      }

      // Dropbox accepts an empty body on parameterless RPC endpoints.
      return await request.send()
    } catch (error) {
      throw this.#mapDropboxError(error, logTag)
    }
  }

  async #contentDownload({ endpoint, args, logTag }) {
    const url = `${ CONTENT_BASE }/${ endpoint }`

    logger.debug(`${ logTag } - content download: [${ url }]`)

    try {
      const response = await Flowrunner.Request.post(url)
        .set(this.#getAuthHeader())
        .set({ 'Dropbox-API-Arg': asciiSafeJsonStringify(args) })
        .setEncoding(null)
        .send()

      return Buffer.isBuffer(response) ? response : Buffer.from(response)
    } catch (error) {
      throw this.#mapDropboxError(error, logTag)
    }
  }

  async #contentUpload({ endpoint, args, bodyBuffer, logTag }) {
    const url = `${ CONTENT_BASE }/${ endpoint }`

    logger.debug(
      `${ logTag } - content upload: [${ url }] bytes=${ bodyBuffer?.length || 0 }`
    )

    try {
      return await Flowrunner.Request.post(url)
        .set(this.#getAuthHeader())
        .set({ 'Dropbox-API-Arg': asciiSafeJsonStringify(args) })
        .set({ 'Content-Type': 'application/octet-stream' })
        .send(bodyBuffer)
    } catch (error) {
      throw this.#mapDropboxError(error, logTag)
    }
  }

  // ==================== OAuth2 System Methods ====================

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
    params.append('token_access_type', 'offline')

    return `${ AUTH_URL }?${ params.toString() }`
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {String} connectionIdentityName
   * @property {String} connectionIdentityImageURL
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)

    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let connectionIdentityName = 'Dropbox User'
    let connectionIdentityImageURL

    try {
      // Fetch the connected account profile using the freshly issued token.
      // `this.request.headers` is not populated in this OAuth callback context,
      // so the standard #rpcRequest helper cannot be used here.
      const account = await Flowrunner.Request.post(
        `${ API_BASE }/users/get_current_account`
      )
        .set({ Authorization: `Bearer ${ tokenResponse.access_token }` })
        .send()

      if (account?.email) {
        connectionIdentityName = account.email
      } else if (account?.name?.display_name) {
        connectionIdentityName = account.name.display_name
      }

      if (account?.profile_photo_url) {
        connectionIdentityImageURL = account.profile_photo_url
      }
    } catch (e) {
      logger.warn(
        'executeCallback - could not load Dropbox account profile:',
        e?.message || e
      )
    }

    return {
      token: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expirationInSeconds: tokenResponse.expires_in,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)

    try {
      const response = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in,
      }
    } catch (error) {
      const body = error?.body
      const code = (body && typeof body === 'object' && body.error) || ''

      logger.error('refreshToken - error:', code || error?.message || error)

      if (code === 'invalid_grant') {
        throw new Error(
          'Refresh token expired or invalid, please re-authenticate.'
        )
      }

      throw error
    }
  }

  // ==================== File Operations ====================

  /**
   * @operationName List Folder Contents
   * @category File Operations
   * @description Lists the files and subfolders inside a Dropbox folder. Use this to enumerate a directory before downloading, processing, or organizing items. Supports recursive traversal, pagination, and incremental change tracking through the returned cursor.
   *
   * @route POST /list-folder
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Folder Path","name":"folderPath","dictionary":"getFoldersDictionary","description":"Path of the folder to list. Use an empty string for the Dropbox root. Examples: '', '/Reports', '/Clients/Acme/2024'."}
   * @paramDef {"type":"Boolean","label":"Recursive","name":"recursive","uiComponent":{"type":"TOGGLE"},"description":"When enabled, returns entries from the target folder and all of its subfolders."}
   * @paramDef {"type":"Boolean","label":"Include Deleted","name":"includeDeleted","uiComponent":{"type":"TOGGLE"},"description":"When enabled, deleted entries are included in the result with a 'deleted' tag."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Optional pagination cursor returned by a previous call. When provided, only changes since that cursor are returned via list_folder/continue."}
   *
   * @returns {Object}
   * @sampleResult {"entries":[{".tag":"folder","name":"Reports","path_lower":"/reports","id":"id:abc123"},{".tag":"file","name":"summary.pdf","path_lower":"/reports/summary.pdf","id":"id:def456","size":102400,"rev":"5f1b1c","server_modified":"2025-03-01T12:34:56Z"}],"cursor":"AAEhJg...","has_more":false}
   */
  async listFolder(folderPath, recursive, includeDeleted, cursor) {
    if (cursor) {
      const response = await this.#rpcRequest({
        endpoint: 'files/list_folder/continue',
        body: { cursor },
        logTag: 'listFolder:continue',
      })

      return {
        entries: response.entries || [],
        cursor: response.cursor,
        has_more: response.has_more,
      }
    }

    const body = cleanupObject({
      path: folderPath || '',
      recursive: recursive ?? false,
      include_deleted: includeDeleted ?? false,
      include_media_info: false,
    })

    const response = await this.#rpcRequest({
      endpoint: 'files/list_folder',
      body,
      logTag: 'listFolder',
    })

    return {
      entries: response.entries || [],
      cursor: response.cursor,
      has_more: response.has_more,
    }
  }

  /**
   * @operationName Get File Metadata
   * @category File Operations
   * @description Retrieves metadata for a specific file or folder in Dropbox by its path or ID. Returns properties such as name, size, content hash, revision, and modification timestamps without downloading the file's contents. Use this to inspect items before processing or to validate that a path exists.
   *
   * @route POST /get-metadata
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Path","name":"path","required":true,"description":"Path or ID of the file/folder. Examples: '/Reports/summary.pdf', 'id:abc123'."}
   * @paramDef {"type":"Boolean","label":"Include Media Info","name":"includeMediaInfo","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes additional media metadata (dimensions, duration) for image and video files."}
   *
   * @returns {Object}
   * @sampleResult {".tag":"file","name":"summary.pdf","path_lower":"/reports/summary.pdf","path_display":"/Reports/summary.pdf","id":"id:abc123","client_modified":"2025-03-01T12:30:00Z","server_modified":"2025-03-01T12:34:56Z","rev":"5f1b1c","size":102400,"content_hash":"599c..."}
   */
  async getMetadata(path, includeMediaInfo) {
    assert(path, '"Path" is required.')

    const body = cleanupObject({
      path,
      include_media_info: includeMediaInfo ?? false,
      include_deleted: false,
      include_has_explicit_shared_members: false,
    })

    return this.#rpcRequest({
      endpoint: 'files/get_metadata',
      body,
      logTag: 'getMetadata',
    })
  }

  /**
   * @operationName Upload File from URL
   * @category File Operations
   * @description Downloads a file from a public URL and uploads its content to Dropbox at the specified location. Useful for archiving externally hosted files, capturing API responses, or pushing AI-generated assets into Dropbox. Limited to 150 MB per file; larger uploads require Dropbox upload sessions which are not supported in this version.
   *
   * @route POST /upload-file
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Destination Folder","name":"destinationPath","dictionary":"getFoldersDictionary","description":"Dropbox folder where the file will be placed. Use an empty string for the root. Example: '/Imports'."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"Name to assign to the uploaded file, including extension. Example: 'invoice.pdf'."}
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"Publicly accessible URL of the file to fetch and upload. Example: 'https://example.com/files/invoice.pdf'."}
   * @paramDef {"type":"String","label":"Conflict Mode","name":"conflictMode","uiComponent":{"type":"DROPDOWN","options":{"values":["add","overwrite","update"]}},"defaultValue":"add","description":"How to handle a name conflict at the destination. 'add' creates a new file, 'overwrite' replaces the existing one, 'update' only overwrites if the existing rev matches."}
   * @paramDef {"type":"Boolean","label":"Auto Rename","name":"autorename","uiComponent":{"type":"TOGGLE"},"description":"When enabled and a conflict occurs in 'add' mode, Dropbox automatically appends a numeric suffix to keep the upload."}
   *
   * @returns {Object}
   * @sampleResult {"id":"id:abc123","name":"invoice.pdf","path_lower":"/imports/invoice.pdf","path_display":"/Imports/invoice.pdf","size":81234,"rev":"5f1b1c","server_modified":"2025-03-01T12:34:56Z","content_hash":"599c..."}
   */
  async uploadFile(
    destinationPath,
    fileName,
    fileUrl,
    conflictMode,
    autorename
  ) {
    assert(fileName, '"File Name" is required.')
    assert(fileUrl, '"File URL" is required.')

    const mode = conflictMode || 'add'
    const path = normalizeDropboxPath(destinationPath, fileName)

    assert(path, 'A valid destination path must be provided.')

    logger.debug(`uploadFile - fetching source URL: ${ fileUrl }`)

    let buffer

    try {
      const fetched = await Flowrunner.Request.get(fileUrl)
        .setEncoding(null)
        .send()

      buffer = Buffer.isBuffer(fetched) ? fetched : Buffer.from(fetched)
    } catch (error) {
      logger.error(
        'uploadFile - failed to fetch source URL:',
        error?.message || error
      )

      throw new Error(
        `Failed to download the source file from URL: ${ error?.message || 'unknown error' }.`
      )
    }

    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error(
        'File is too large for a single-shot upload (Dropbox limit is 150 MB). Large-file session upload is not supported in this version.'
      )
    }

    const args = {
      path,
      mode: { '.tag': mode },
      autorename: autorename ?? false,
      mute: false,
      strict_conflict: false,
    }

    const response = await this.#contentUpload({
      endpoint: 'files/upload',
      args,
      bodyBuffer: buffer,
      logTag: 'uploadFile',
    })

    return {
      id: response.id,
      name: response.name,
      path_lower: response.path_lower,
      path_display: response.path_display,
      size: response.size,
      rev: response.rev,
      server_modified: response.server_modified,
      content_hash: response.content_hash,
    }
  }

  /**
   * @operationName Download File
   * @category File Operations
   * @description Downloads a file from Dropbox and stores it in the Flowrunner file storage. Returns the public Flowrunner URL of the saved copy, which can be passed to downstream actions or AI agent tools that operate on file URLs.
   *
   * @route POST /download-file
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File","name":"path","required":true,"dictionary":"getFilesDictionary","description":"Path or ID of the Dropbox file to download. Examples: '/Reports/summary.pdf', 'id:abc123'."}
   * @paramDef {"type":"String","label":"Target File Name","name":"targetFileName","description":"Name to assign to the saved file in Flowrunner. Leave blank to reuse the source file's name."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://backendlessappcontent.com/APP-ID/REST-KEY/files/dropbox-downloads/summary.pdf"}
   */
  async downloadFile(path, targetFileName, fileOptions) {
    assert(path, '"File" is required.')

    const buffer = await this.#contentDownload({
      endpoint: 'files/download',
      args: { path },
      logTag: 'downloadFile',
    })

    const name = targetFileName || basenameFromPath(path) || 'dropbox-file'

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: name,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { url }
  }

  /**
   * @operationName Get Temporary Link
   * @category File Operations
   * @description Generates a short-lived, unauthenticated direct download URL for a Dropbox file. The link is valid for approximately four hours and is useful for handing a file off to external systems that cannot authenticate against Dropbox directly.
   *
   * @route POST /get-temporary-link
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File","name":"path","required":true,"dictionary":"getFilesDictionary","description":"Path or ID of the file to generate a temporary link for. Examples: '/Reports/summary.pdf', 'id:abc123'."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://dl.dropboxusercontent.com/apitl/1/...","expiresInSeconds":14400}
   */
  async getTemporaryLink(path) {
    assert(path, '"File" is required.')

    const response = await this.#rpcRequest({
      endpoint: 'files/get_temporary_link',
      body: { path },
      logTag: 'getTemporaryLink',
    })

    return {
      url: response.link,
      expiresInSeconds: 14400,
    }
  }

  // ==================== File Management ====================

  /**
   * @operationName Create Folder
   * @category File Management
   * @description Creates a new folder at the specified location in Dropbox. Useful for preparing destinations before uploads or for organizing files into hierarchies. Optional auto-renaming avoids collisions when a folder with the same name already exists.
   *
   * @route POST /create-folder
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Parent Folder","name":"parentFolderPath","dictionary":"getFoldersDictionary","description":"Path of the parent folder where the new folder will be created. Use an empty string for the Dropbox root. Example: '/Projects'."}
   * @paramDef {"type":"String","label":"Folder Name","name":"folderName","required":true,"description":"Name of the folder to create. Example: '2025-Q1-Reports'."}
   * @paramDef {"type":"Boolean","label":"Auto Rename","name":"autorename","uiComponent":{"type":"TOGGLE"},"description":"When enabled and a folder with the same name already exists, Dropbox appends a numeric suffix instead of failing."}
   *
   * @returns {Object}
   * @sampleResult {"metadata":{".tag":"folder","name":"2025-Q1-Reports","path_lower":"/projects/2025-q1-reports","path_display":"/Projects/2025-Q1-Reports","id":"id:abc123"}}
   */
  async createFolder(parentFolderPath, folderName, autorename) {
    assert(folderName, '"Folder Name" is required.')

    const path = normalizeDropboxPath(parentFolderPath, folderName)

    assert(path, 'A valid folder path must be provided.')

    const response = await this.#rpcRequest({
      endpoint: 'files/create_folder_v2',
      body: {
        path,
        autorename: autorename ?? false,
      },
      logTag: 'createFolder',
    })

    return {
      metadata: response.metadata,
    }
  }

  /**
   * @operationName Delete File or Folder
   * @category File Management
   * @description Permanently deletes a file or folder in Dropbox. When deleting a folder, all nested files and subfolders are removed as well. This action is irreversible from the API surface; users can still recover the item from the Dropbox web trash if needed.
   *
   * @route POST /delete-file
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Path","name":"path","required":true,"description":"Path or ID of the file or folder to delete. Examples: '/Old/archive.zip', '/Projects/Legacy', 'id:abc123'."}
   *
   * @returns {Object}
   * @sampleResult {"metadata":{".tag":"file","name":"archive.zip","path_lower":"/old/archive.zip","path_display":"/Old/archive.zip","id":"id:abc123","size":204800,"rev":"5f1b1c","server_modified":"2025-03-01T12:34:56Z"}}
   */
  async deleteFile(path) {
    assert(path, '"Path" is required.')

    const response = await this.#rpcRequest({
      endpoint: 'files/delete_v2',
      body: { path },
      logTag: 'deleteFile',
    })

    return {
      metadata: response.metadata,
    }
  }

  /**
   * @operationName Move File or Folder
   * @category File Management
   * @description Moves or renames a file or folder in Dropbox by changing its path. Use this for reorganizing folder structures, renaming items, or relocating processed files to archive locations. The source and destination must be on the same Dropbox account.
   *
   * @route POST /move-file
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"From Path","name":"fromPath","required":true,"description":"Current path or ID of the item to move. Examples: '/Inbox/report.pdf', 'id:abc123'."}
   * @paramDef {"type":"String","label":"To Path","name":"toPath","required":true,"description":"New path where the item should be moved, including the new file or folder name. Example: '/Archive/2025/report.pdf'."}
   * @paramDef {"type":"Boolean","label":"Auto Rename","name":"autorename","uiComponent":{"type":"TOGGLE"},"description":"When enabled and the destination already exists, Dropbox appends a numeric suffix to the moved item's name instead of failing."}
   * @paramDef {"type":"Boolean","label":"Allow Ownership Transfer","name":"allowOwnershipTransfer","uiComponent":{"type":"TOGGLE"},"description":"When enabled, allows moving items between shared folders that have different owners (relevant for Dropbox Business)."}
   *
   * @returns {Object}
   * @sampleResult {"metadata":{".tag":"file","name":"report.pdf","path_lower":"/archive/2025/report.pdf","path_display":"/Archive/2025/report.pdf","id":"id:abc123","size":81234,"rev":"5f1b1c","server_modified":"2025-03-01T12:34:56Z"}}
   */
  async moveFile(fromPath, toPath, autorename, allowOwnershipTransfer) {
    assert(fromPath, '"From Path" is required.')
    assert(toPath, '"To Path" is required.')

    const response = await this.#rpcRequest({
      endpoint: 'files/move_v2',
      body: {
        from_path: fromPath,
        to_path: toPath,
        autorename: autorename ?? false,
        allow_ownership_transfer: allowOwnershipTransfer ?? false,
        allow_shared_folder: true,
      },
      logTag: 'moveFile',
    })

    return {
      metadata: response.metadata,
    }
  }

  /**
   * @operationName Copy File or Folder
   * @category File Management
   * @description Creates a copy of a file or folder at a new location in Dropbox while leaving the original intact. Use this to duplicate templates, snapshot a folder before edits, or stage files for processing without disturbing the source.
   *
   * @route POST /copy-file
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"From Path","name":"fromPath","required":true,"description":"Path or ID of the source item to copy. Examples: '/Templates/contract.docx', 'id:abc123'."}
   * @paramDef {"type":"String","label":"To Path","name":"toPath","required":true,"description":"Destination path for the copy, including the new file or folder name. Example: '/Clients/Acme/contract.docx'."}
   * @paramDef {"type":"Boolean","label":"Auto Rename","name":"autorename","uiComponent":{"type":"TOGGLE"},"description":"When enabled and the destination already exists, Dropbox appends a numeric suffix to the copy's name instead of failing."}
   *
   * @returns {Object}
   * @sampleResult {"metadata":{".tag":"file","name":"contract.docx","path_lower":"/clients/acme/contract.docx","path_display":"/Clients/Acme/contract.docx","id":"id:def456","size":54321,"rev":"5f1b1c","server_modified":"2025-03-01T12:34:56Z"}}
   */
  async copyFile(fromPath, toPath, autorename) {
    assert(fromPath, '"From Path" is required.')
    assert(toPath, '"To Path" is required.')

    const response = await this.#rpcRequest({
      endpoint: 'files/copy_v2',
      body: {
        from_path: fromPath,
        to_path: toPath,
        autorename: autorename ?? false,
        allow_shared_folder: true,
        allow_ownership_transfer: false,
      },
      logTag: 'copyFile',
    })

    return {
      metadata: response.metadata,
    }
  }

  // ==================== File Search ====================

  /**
   * @operationName Search Files
   * @category File Search
   * @description Searches Dropbox for files and folders matching a query. Supports scoping to a folder, filtering by file extension, and filtering by high-level file category. Returns the best-matching entries along with a cursor for pagination.
   *
   * @route POST /search-files
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search query string. Matches against file and folder names and (where indexed) content. Example: 'invoice 2025'."}
   * @paramDef {"type":"String","label":"Scope Path","name":"path","dictionary":"getFoldersDictionary","description":"Folder to scope the search within. Use an empty string to search the entire Dropbox. Example: '/Clients'."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","description":"Maximum number of results to return. Valid range: 1-1000. Default: 100."}
   * @paramDef {"type":"Array.<String>","label":"File Extensions","name":"fileExtensions","description":"Optional list of file extensions to restrict the search to, without leading dots. Example: ['pdf','docx']."}
   * @paramDef {"type":"String","label":"File Category","name":"fileCategories","uiComponent":{"type":"DROPDOWN","options":{"values":["image","document","pdf","spreadsheet","presentation","audio","video","folder","paper","others"]}},"description":"Optional high-level category to restrict the search to."}
   *
   * @returns {Object}
   * @sampleResult {"matches":[{"metadata":{"metadata":{".tag":"file","name":"invoice-2025-001.pdf","path_lower":"/clients/acme/invoice-2025-001.pdf","id":"id:abc123","size":52100,"rev":"5f1b1c","server_modified":"2025-03-01T12:34:56Z"}}}],"cursor":null,"has_more":false}
   */
  async searchFiles(query, path, maxResults, fileExtensions, fileCategories) {
    assert(query, '"Query" is required.')

    const options = cleanupObject({
      path: path || undefined,
      max_results: maxResults || 100,
      file_extensions:
        Array.isArray(fileExtensions) && fileExtensions.length
          ? fileExtensions
          : undefined,
      file_categories: fileCategories ? [fileCategories] : undefined,
    })

    const body = {
      query,
      options,
    }

    const response = await this.#rpcRequest({
      endpoint: 'files/search_v2',
      body,
      logTag: 'searchFiles',
    })

    return {
      matches: response.matches || [],
      cursor: response.cursor || null,
      has_more: response.has_more || false,
    }
  }

  // ==================== Sharing ====================

  /**
   * @operationName Create Shared Link
   * @category Sharing
   * @description Creates a shareable link for a Dropbox file or folder. Optionally restricts access to logged-in members, sets an expiration timestamp, configures a password, and controls whether the recipient can download the content.
   *
   * @route POST /create-shared-link
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Path","name":"path","required":true,"description":"Path or ID of the file or folder to share. Examples: '/Reports/summary.pdf', 'id:abc123'."}
   * @paramDef {"type":"Boolean","label":"Require Login","name":"requireLogin","uiComponent":{"type":"TOGGLE"},"description":"When enabled, only Dropbox members of the team can access the link (audience set to 'members')."}
   * @paramDef {"type":"Boolean","label":"Allow Download","name":"allowDownload","uiComponent":{"type":"TOGGLE"},"description":"When enabled, recipients can download the shared content; when disabled, the link is view-only where supported."}
   * @paramDef {"type":"String","label":"Expires At","name":"expiresAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional expiration timestamp for the link. Leave blank for a link that does not expire."}
   * @paramDef {"type":"String","label":"Link Password","name":"linkPassword","description":"Optional password that recipients must enter to access the link."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://www.dropbox.com/scl/fi/abc123/summary.pdf?dl=0","name":"summary.pdf","path_lower":"/reports/summary.pdf","id":"id:abc123","link_permissions":{"can_revoke":true},"expires":"2025-12-31T23:59:59Z"}
   */
  async createSharedLink(
    path,
    requireLogin,
    allowDownload,
    expiresAt,
    linkPassword
  ) {
    assert(path, '"Path" is required.')

    const settings = {}

    if (requireLogin) {
      settings.audience = { '.tag': 'members' }
    }

    if (allowDownload === false) {
      settings.allow_download = false
    } else if (allowDownload === true) {
      settings.allow_download = true
    }

    if (expiresAt) {
      const date = new Date(expiresAt)

      if (!isNaN(date.getTime())) {
        settings.expires = date.toISOString().replace(/\.\d{3}Z$/, 'Z')
      }
    }

    if (linkPassword) {
      settings.link_password = linkPassword
      settings.requested_visibility = { '.tag': 'password' }
    }

    const body = {
      path,
      settings: Object.keys(settings).length ? settings : undefined,
    }

    if (!body.settings) {
      delete body.settings
    }

    const response = await this.#rpcRequest({
      endpoint: 'sharing/create_shared_link_with_settings',
      body,
      logTag: 'createSharedLink',
    })

    return {
      url: response.url,
      name: response.name,
      path_lower: response.path_lower,
      id: response.id,
      link_permissions: response.link_permissions,
      expires: response.expires,
    }
  }

  /**
   * @operationName List Shared Links
   * @category Sharing
   * @description Lists shared links visible to the current Dropbox account, optionally narrowing the result to links for a specific file. Use the returned cursor to paginate through large result sets.
   *
   * @route POST /list-shared-links
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Path","name":"path","description":"Optional path or ID of a specific file to list links for. Leave blank to list all shared links."}
   * @paramDef {"type":"Boolean","label":"Direct Only","name":"directOnly","uiComponent":{"type":"TOGGLE"},"description":"When enabled and a path is provided, only links pointing directly at the file are returned (excluding links inherited from parent folders)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Optional pagination cursor returned by a previous call to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"links":[{"url":"https://www.dropbox.com/scl/fi/abc123/summary.pdf?dl=0","name":"summary.pdf","id":"id:abc123","path_lower":"/reports/summary.pdf"}],"has_more":false}
   */
  async listSharedLinks(path, directOnly, cursor) {
    const body = cleanupObject({
      path: path || undefined,
      direct_only: directOnly === true ? true : undefined,
      cursor: cursor || undefined,
    })

    const response = await this.#rpcRequest({
      endpoint: 'sharing/list_shared_links',
      body: Object.keys(body).length ? body : null,
      logTag: 'listSharedLinks',
    })

    return {
      links: response.links || [],
      has_more: response.has_more || false,
      cursor: response.cursor || null,
    }
  }

  /**
   * @operationName Revoke Shared Link
   * @category Sharing
   * @description Revokes a previously created shared link by URL so it can no longer be used to access the underlying file or folder. Note: revoking a direct link does not affect access granted by shared links on parent folders.
   *
   * @route POST /revoke-shared-link
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Shared Link URL","name":"url","required":true,"description":"Full URL of the shared link to revoke. Example: 'https://www.dropbox.com/scl/fi/abc123/summary.pdf?dl=0'."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async revokeSharedLink(url) {
    assert(url, '"Shared Link URL" is required.')

    await this.#rpcRequest({
      endpoint: 'sharing/revoke_shared_link',
      body: { url },
      logTag: 'revokeSharedLink',
    })

    return { success: true }
  }

  /**
   * @operationName Share Folder
   * @category Sharing
   * @description Converts a regular Dropbox folder into a shared folder that members can be invited to. The operation may complete synchronously or be queued for asynchronous processing, in which case a job ID is returned that callers can poll via Dropbox's job-status endpoints.
   *
   * @route POST /share-folder
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Folder Path","name":"folderPath","required":true,"dictionary":"getFoldersDictionary","description":"Path of the folder to convert into a shared folder. Example: '/Projects/Acme'."}
   * @paramDef {"type":"String","label":"Member Policy","name":"memberPolicy","uiComponent":{"type":"DROPDOWN","options":{"values":["anyone","team"]}},"description":"Who can become a member of the shared folder. 'anyone' allows external collaborators; 'team' restricts to the Dropbox Business team."}
   * @paramDef {"type":"String","label":"ACL Update Policy","name":"aclUpdatePolicy","uiComponent":{"type":"DROPDOWN","options":{"values":["owner","editors"]}},"description":"Who can manage members and permissions on the folder. 'owner' restricts ACL changes to the owner; 'editors' allows any editor to manage members."}
   *
   * @returns {Object}
   * @sampleResult {"status":"complete","sharedFolderId":"84528192421"}
   */
  async shareFolder(folderPath, memberPolicy, aclUpdatePolicy) {
    assert(folderPath, '"Folder Path" is required.')

    const body = cleanupObject({
      path: folderPath,
      member_policy: memberPolicy ? { '.tag': memberPolicy } : undefined,
      acl_update_policy: aclUpdatePolicy
        ? { '.tag': aclUpdatePolicy }
        : undefined,
      force_async: false,
    })

    const response = await this.#rpcRequest({
      endpoint: 'sharing/share_folder',
      body,
      logTag: 'shareFolder',
    })

    if (response['.tag'] === 'async_job_id') {
      return {
        status: 'pending',
        jobId: response.async_job_id,
      }
    }

    return {
      status: 'complete',
      sharedFolderId: response.shared_folder_id,
    }
  }

  /**
   * @operationName Add Folder Member
   * @category Sharing
   * @description Invites a user (by email) to join a Dropbox shared folder at the requested access level. Optionally suppresses email notifications and includes a custom message visible to the invitee.
   *
   * @route POST /add-folder-member
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Shared Folder","name":"sharedFolderId","required":true,"dictionary":"getSharedFoldersDictionary","description":"Identifier of the shared folder to invite the member to."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the user to invite. Example: 'jane@example.com'."}
   * @paramDef {"type":"String","label":"Access Level","name":"accessLevel","uiComponent":{"type":"DROPDOWN","options":{"values":["viewer","editor","owner"]}},"defaultValue":"viewer","description":"Access level granted to the new member. 'viewer' is read-only, 'editor' can modify contents, 'owner' transfers folder ownership."}
   * @paramDef {"type":"Boolean","label":"Quiet","name":"quiet","uiComponent":{"type":"TOGGLE"},"description":"When enabled, suppresses the email notification normally sent to the invited member."}
   * @paramDef {"type":"String","label":"Custom Message","name":"customMessage","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional message included in the invitation email. Ignored when 'Quiet' is enabled."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"sharedFolderId":"84528192421","email":"jane@example.com","accessLevel":"viewer"}
   */
  async addFolderMember(
    sharedFolderId,
    email,
    accessLevel,
    quiet,
    customMessage
  ) {
    assert(sharedFolderId, '"Shared Folder" is required.')
    assert(email, '"Email" is required.')

    const level = accessLevel || 'viewer'

    const body = cleanupObject({
      shared_folder_id: sharedFolderId,
      members: [
        {
          member: { '.tag': 'email', email },
          access_level: { '.tag': level },
        },
      ],
      quiet: quiet ?? false,
      custom_message: quiet ? undefined : customMessage || undefined,
    })

    await this.#rpcRequest({
      endpoint: 'sharing/add_folder_member',
      body,
      logTag: 'addFolderMember',
    })

    return {
      success: true,
      sharedFolderId,
      email,
      accessLevel: level,
    }
  }

  /**
   * @operationName Remove Folder Member
   * @category Sharing
   * @description Removes a member from a Dropbox shared folder. Optionally lets the removed user retain a personal copy of the folder's contents in their own Dropbox.
   *
   * @route POST /remove-folder-member
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Shared Folder","name":"sharedFolderId","required":true,"dictionary":"getSharedFoldersDictionary","description":"Identifier of the shared folder to remove the member from."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the member to remove. Example: 'jane@example.com'."}
   * @paramDef {"type":"Boolean","label":"Leave a Copy","name":"leaveACopy","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the removed member keeps a personal copy of the folder's contents in their own Dropbox."}
   *
   * @returns {Object}
   * @sampleResult {"status":"pending","jobId":"d1b8b8a9f73f7c8e7e7e7e7e7e7e7e7e"}
   */
  async removeFolderMember(sharedFolderId, email, leaveACopy) {
    assert(sharedFolderId, '"Shared Folder" is required.')
    assert(email, '"Email" is required.')

    const body = {
      shared_folder_id: sharedFolderId,
      member: { '.tag': 'email', email },
      leave_a_copy: leaveACopy ?? false,
    }

    const response = await this.#rpcRequest({
      endpoint: 'sharing/remove_folder_member',
      body,
      logTag: 'removeFolderMember',
    })

    // Endpoint returns an async job launcher union.
    if (response && response['.tag'] === 'async_job_id') {
      return {
        status: 'pending',
        jobId: response.async_job_id,
      }
    }

    return {
      status: 'complete',
    }
  }

  // ==================== Account ====================

  /**
   * @operationName Get Current Account
   * @category Account
   * @description Retrieves profile information for the currently connected Dropbox account, including account ID, display name, email, country, and account type. Use this to confirm which Dropbox identity an agent flow is operating against.
   *
   * @route POST /get-current-account
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"account_id":"dbid:AAH4f99T0taONIb-OurWxbNQ6ywGRopQngc","name":{"given_name":"Jane","surname":"Doe","display_name":"Jane Doe","abbreviated_name":"JD"},"email":"jane@example.com","email_verified":true,"country":"US","locale":"en","account_type":{".tag":"basic"}}
   */
  async getCurrentAccount() {
    return this.#rpcRequest({
      endpoint: 'users/get_current_account',
      body: null,
      logTag: 'getCurrentAccount',
    })
  }

  /**
   * @operationName Get Space Usage
   * @category Account
   * @description Retrieves the storage quota for the current Dropbox account, including used bytes and the total allocation. Use this to gate uploads, surface quota warnings to users, or generate usage reports.
   *
   * @route POST /get-space-usage
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"used":1234567890,"allocation":{".tag":"individual","allocated":2147483648}}
   */
  async getSpaceUsage() {
    return this.#rpcRequest({
      endpoint: 'users/get_space_usage',
      body: null,
      logTag: 'getSpaceUsage',
    })
  }

  // ==================== Dictionary Methods ====================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Folders
   * @description Provides a searchable, paginated list of Dropbox folders for dynamic parameter selection in FlowRunner. Folder names are filtered client-side against the optional search string.
   * @route POST /get-folders-dictionary
   * @paramDef {"type":"getFoldersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering Dropbox folders."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Reports","value":"/Reports","note":"/Reports"}],"cursor":null}
   */
  async getFoldersDictionary(payload) {
    const { search, cursor } = payload || {}

    let response

    if (cursor) {
      response = await this.#rpcRequest({
        endpoint: 'files/list_folder/continue',
        body: { cursor },
        logTag: 'getFoldersDictionary:continue',
      })
    } else {
      response = await this.#rpcRequest({
        endpoint: 'files/list_folder',
        body: {
          path: '',
          recursive: true,
          include_deleted: false,
          include_media_info: false,
        },
        logTag: 'getFoldersDictionary',
      })
    }

    const entries = response.entries || []
    const folders = entries.filter(e => e['.tag'] === 'folder')

    const filtered = search
      ? folders.filter(f =>
        (f.name || '').toLowerCase().includes(String(search).toLowerCase())
      )
      : folders

    const items = filtered.map(folder => ({
      label: folder.name,
      value: folder.path_display || folder.path_lower || '',
      note: folder.path_display || folder.path_lower || '',
    }))

    return {
      items,
      cursor: response.has_more ? response.cursor : null,
    }
  }

  /**
   * @typedef {Object} getFilesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Folder Path","name":"folderPath","description":"Optional Dropbox folder path to scope the file listing. Leave blank to list files from the entire Dropbox."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Files
   * @description Provides a searchable, paginated list of Dropbox files for dynamic parameter selection in FlowRunner. Supports scoping to a specific folder through the criteria payload and client-side filtering by file name.
   * @route POST /get-files-dictionary
   * @paramDef {"type":"getFilesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination cursor, and scoping criteria for retrieving and filtering Dropbox files."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"summary.pdf","value":"/Reports/summary.pdf","note":"/Reports/summary.pdf"}],"cursor":null}
   */
  async getFilesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const folderPath = criteria?.folderPath || ''

    let response

    if (cursor) {
      response = await this.#rpcRequest({
        endpoint: 'files/list_folder/continue',
        body: { cursor },
        logTag: 'getFilesDictionary:continue',
      })
    } else {
      response = await this.#rpcRequest({
        endpoint: 'files/list_folder',
        body: {
          path: folderPath,
          recursive: true,
          include_deleted: false,
          include_media_info: false,
        },
        logTag: 'getFilesDictionary',
      })
    }

    const entries = response.entries || []
    const files = entries.filter(e => e['.tag'] === 'file')

    const filtered = search
      ? files.filter(f =>
        (f.name || '').toLowerCase().includes(String(search).toLowerCase())
      )
      : files

    const items = filtered.map(file => ({
      label: file.name,
      value: file.path_display || file.path_lower || file.id,
      note: file.path_display || file.path_lower || '',
    }))

    return {
      items,
      cursor: response.has_more ? response.cursor : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Shared Folders
   * @description Provides a searchable, paginated list of Dropbox shared folders the current user is a member of. Used as a value source for member-management actions.
   * @route POST /get-shared-folders-dictionary
   * @paramDef {"type":"getSharedFoldersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering shared folders."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Project","value":"84528192421","note":"/Acme Project"}],"cursor":null}
   */
  async getSharedFoldersDictionary(payload) {
    const { search, cursor } = payload || {}

    let response

    if (cursor) {
      response = await this.#rpcRequest({
        endpoint: 'sharing/list_folders/continue',
        body: { cursor },
        logTag: 'getSharedFoldersDictionary:continue',
      })
    } else {
      response = await this.#rpcRequest({
        endpoint: 'sharing/list_folders',
        body: { limit: 100 },
        logTag: 'getSharedFoldersDictionary',
      })
    }

    const entries = response.entries || []

    const filtered = search
      ? entries.filter(e =>
        (e.name || '').toLowerCase().includes(String(search).toLowerCase())
      )
      : entries

    const items = filtered.map(folder => ({
      label: folder.name,
      value: folder.shared_folder_id,
      note: folder.path_lower || `ID: ${ folder.shared_folder_id }`,
    }))

    return {
      items,
      cursor: response.cursor || null,
    }
  }

  // ==================== Polling Triggers ====================

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerPollingForEvent
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On New File
   * @category File Monitoring
   * @description Triggers a workflow whenever a new file appears in the watched Dropbox folder. Useful for automating ingestion of client uploads, AI-generated content, or third-party deliveries. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-file
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Folder Path","name":"folderPath","dictionary":"getFoldersDictionary","description":"Dropbox folder to watch for new files. Use an empty string to watch the root."}
   * @paramDef {"type":"Boolean","label":"Recursive","name":"recursive","uiComponent":{"type":"TOGGLE"},"description":"When enabled, also watches all subfolders for newly added files."}
   *
   * @returns {Object}
   * @sampleResult {".tag":"file","name":"invoice.pdf","path_lower":"/imports/invoice.pdf","path_display":"/Imports/invoice.pdf","id":"id:abc123","size":81234,"rev":"5f1b1c","server_modified":"2025-03-01T12:34:56Z"}
   */
  async onNewFile(invocation) {
    return this.#runPollingTrigger(invocation, 'file', 'onNewFile')
  }

  /**
   * @operationName On New Folder
   * @category File Monitoring
   * @description Triggers a workflow whenever a new subfolder is created inside the watched Dropbox folder. Useful for reacting to client provisioning, project setup, or any process that creates new top-level directories. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-folder
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Folder Path","name":"folderPath","dictionary":"getFoldersDictionary","description":"Dropbox folder to watch for newly created subfolders. Use an empty string to watch the root."}
   * @paramDef {"type":"Boolean","label":"Recursive","name":"recursive","uiComponent":{"type":"TOGGLE"},"description":"When enabled, watches all nested subfolders for new folder creation events."}
   *
   * @returns {Object}
   * @sampleResult {".tag":"folder","name":"Acme","path_lower":"/clients/acme","path_display":"/Clients/Acme","id":"id:fldr123"}
   */
  async onNewFolder(invocation) {
    return this.#runPollingTrigger(invocation, 'folder', 'onNewFolder')
  }

  /**
   * @operationName On File Modified
   * @category File Monitoring
   * @description Triggers a workflow whenever an existing file's content changes in the watched Dropbox folder (detected via revision changes). Useful for reprocessing edited documents or syncing updates to downstream systems. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-file-modified
   * @appearanceColor #0061FF #1A88FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Folder Path","name":"folderPath","dictionary":"getFoldersDictionary","description":"Dropbox folder to watch for file modifications. Use an empty string to watch the root."}
   * @paramDef {"type":"Boolean","label":"Recursive","name":"recursive","uiComponent":{"type":"TOGGLE"},"description":"When enabled, also watches all subfolders for file modifications."}
   *
   * @returns {Object}
   * @sampleResult {".tag":"file","name":"summary.pdf","path_lower":"/reports/summary.pdf","path_display":"/Reports/summary.pdf","id":"id:abc123","size":102400,"rev":"5f1b1d","server_modified":"2025-03-02T09:12:00Z"}
   */
  async onFileModified(invocation) {
    return this.#runPollingTrigger(
      invocation,
      'fileModified',
      'onFileModified'
    )
  }

  // -------- polling trigger internals --------

  async #runPollingTrigger(invocation, triggerType, logTag) {
    const triggerData = invocation.triggerData || {}
    const folderPath = triggerData.folderPath || ''
    const recursive = triggerData.recursive ?? false

    // ---- Learning mode: surface a representative entry for UI binding ----
    if (invocation.learningMode === true) {
      const response = await this.#rpcRequest({
        endpoint: 'files/list_folder',
        body: {
          path: folderPath,
          recursive,
          include_deleted: false,
          include_media_info: false,
        },
        logTag: `${ logTag }:learning`,
      })

      const entries = response.entries || []
      const wantTag = triggerType === 'folder' ? 'folder' : 'file'
      const sample = entries.find(e => e['.tag'] === wantTag)

      return {
        events: sample ? [sample] : [],
        state: null,
      }
    }

    // ---- Bootstrap: snapshot the folder and remember the cursor ----
    if (!invocation.state?.cursor) {
      const bootstrap = await this.#bootstrapPollingState(
        folderPath,
        recursive,
        logTag
      )

      return {
        events: [],
        state: bootstrap,
      }
    }

    // ---- Normal tick: ask Dropbox what changed since the saved cursor ----
    let entries = []
    let nextCursor = invocation.state.cursor

    try {
      const collected = await this.#consumeContinue(nextCursor, logTag)

      entries = collected.entries
      nextCursor = collected.cursor
    } catch (error) {
      if (isCursorResetError(error)) {
        logger.warn(`${ logTag } - cursor reset, re-bootstrapping`)

        const rebuilt = await this.#bootstrapPollingState(
          folderPath,
          recursive,
          logTag
        )

        return {
          events: [],
          state: rebuilt,
        }
      }

      throw error
    }

    const knownIds = { ...(invocation.state.knownIds || {}) }
    const emitted = []

    for (const entry of entries) {
      const tag = entry['.tag']

      if (tag === 'deleted') {
        const key = entry.id || entry.path_lower

        if (key && knownIds[key]) {
          delete knownIds[key]
        } else if (entry.path_lower) {
          // Deleted entries often lack `id`; match by path_lower as a fallback.
          for (const k of Object.keys(knownIds)) {
            if (knownIds[k].path_lower === entry.path_lower) {
              delete knownIds[k]
            }
          }
        }

        continue
      }

      const key = entry.id || entry.path_lower

      if (!key) continue

      const previous = knownIds[key]

      if (tag === 'folder') {
        if (!previous && triggerType === 'folder') {
          emitted.push(entry)
        }

        knownIds[key] = {
          type: 'folder',
          path_lower: entry.path_lower,
        }
      } else if (tag === 'file') {
        if (!previous && triggerType === 'file') {
          emitted.push(entry)
        } else if (
          previous &&
          previous.type === 'file' &&
          entry.rev &&
          previous.rev &&
          entry.rev !== previous.rev &&
          triggerType === 'fileModified'
        ) {
          emitted.push(entry)
        }

        knownIds[key] = {
          type: 'file',
          rev: entry.rev,
          server_modified: entry.server_modified,
          path_lower: entry.path_lower,
        }
      }
    }

    return {
      events: emitted,
      state: {
        cursor: nextCursor,
        knownIds,
      },
    }
  }

  async #bootstrapPollingState(folderPath, recursive, logTag) {
    let response = await this.#rpcRequest({
      endpoint: 'files/list_folder',
      body: {
        path: folderPath,
        recursive,
        include_deleted: false,
        include_media_info: false,
      },
      logTag: `${ logTag }:bootstrap`,
    })

    const knownIds = {}
    const allEntries = [...(response.entries || [])]

    while (response.has_more) {
      response = await this.#rpcRequest({
        endpoint: 'files/list_folder/continue',
        body: { cursor: response.cursor },
        logTag: `${ logTag }:bootstrap:continue`,
      })

      allEntries.push(...(response.entries || []))
    }

    for (const entry of allEntries) {
      const tag = entry['.tag']
      const key = entry.id || entry.path_lower

      if (!key) continue

      if (tag === 'folder') {
        knownIds[key] = {
          type: 'folder',
          path_lower: entry.path_lower,
        }
      } else if (tag === 'file') {
        knownIds[key] = {
          type: 'file',
          rev: entry.rev,
          server_modified: entry.server_modified,
          path_lower: entry.path_lower,
        }
      }
    }

    return {
      cursor: response.cursor,
      knownIds,
    }
  }

  async #consumeContinue(initialCursor, logTag) {
    const entries = []
    let cursor = initialCursor
    let hasMore = true

    while (hasMore) {
      const response = await this.#rpcRequest({
        endpoint: 'files/list_folder/continue',
        body: { cursor },
        logTag: `${ logTag }:continue`,
      })

      entries.push(...(response.entries || []))
      cursor = response.cursor
      hasMore = !!response.has_more
    }

    return { entries, cursor }
  }
}

// ==================== Service Registration ====================

Flowrunner.ServerCode.addService(DropboxService, [
  {
    order: 0,
    name: 'clientId',
    displayName: 'App Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your App Key from the Dropbox App Console (https://www.dropbox.com/developers/apps).',
  },
  {
    order: 1,
    name: 'clientSecret',
    displayName: 'App Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your App Secret from the Dropbox App Console.',
  },
])

// ==================== Dictionary Payload Typedefs ====================

/**
 * @typedef {Object} getFoldersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring used to filter folders by name (case-insensitive)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous call to retrieve the next page of folders."}
 */

/**
 * @typedef {Object} getFilesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring used to filter files by name (case-insensitive)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous call to retrieve the next page of files."}
 * @paramDef {"type":"getFilesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional scoping criteria, such as a folder path to limit the listing."}
 */

/**
 * @typedef {Object} getSharedFoldersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring used to filter shared folders by name (case-insensitive)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous call to retrieve the next page of shared folders."}
 */
