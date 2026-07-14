const OAUTH_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE_URL = 'https://graph.microsoft.com/v1.0'
const DRIVE_BASE_URL = `${ API_BASE_URL }/me/drive`
const PAGE_SIZE_DICTIONARY = 50
const DEFAULT_LIST_TOP = 50
// Graph small-file upload cap: files up to 4 MB may be sent in a single PUT; anything larger
// must go through a resumable upload session.
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024
// Byte-range size for large-file upload sessions. Graph requires every chunk but the last to be a
// multiple of 320 KiB (327,680 bytes); 5 MiB is exactly 16 x 320 KiB and sits in Graph's
// recommended 5-10 MiB range.
const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024

const DEFAULT_SCOPE_LIST = [
  'offline_access',
  'User.Read',
  'Files.ReadWrite.All',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[Microsoft OneDrive] info:', ...args),
  debug: (...args) => console.log('[Microsoft OneDrive] debug:', ...args),
  error: (...args) => console.log('[Microsoft OneDrive] error:', ...args),
  warn: (...args) => console.log('[Microsoft OneDrive] warn:', ...args),
}

/**
 * @usesFileStorage
 * @requireOAuth
 * @integrationName Microsoft OneDrive
 * @integrationIcon /icon.svg
 **/
class MicrosoftOneDriveService {
  /**
   * @typedef {Object} getFoldersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string. When provided, folders across the whole drive are searched by name; otherwise the folders at the drive root are listed."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getItemsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string. When provided, files and folders across the whole drive are searched by name and content; otherwise the items at the drive root are listed."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   */
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ this.request.headers['oauth-access-token'] || accessToken }`,
    }
  }

  async #apiRequest({ url, method, body, query, headers, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set({ ...this.#getAccessTokenHeader(), ...(headers || {}) })
        .query(query)
        .send(body)
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - error: ${ message }`)

      throw new Error(`Microsoft OneDrive API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
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

  #mapItem(item) {
    return {
      id: item.id,
      name: item.name,
      type: item.folder ? 'folder' : 'file',
      size: item.size ?? null,
      webUrl: item.webUrl || null,
      lastModifiedDateTime: item.lastModifiedDateTime || null,
      createdDateTime: item.createdDateTime || null,
      mimeType: item.file?.mimeType || null,
      childCount: item.folder?.childCount ?? null,
      parentPath: item.parentReference?.path || null,
    }
  }

  // Builds a Graph search URL over the whole drive. Single quotes inside the query must be
  // doubled per OData string-literal escaping rules.
  #buildSearchUrl(query) {
    return `${ DRIVE_BASE_URL }/root/search(q='${ encodeURIComponent(String(query).replace(/'/g, "''")) }')`
  }

  // Builds a path-addressed upload URL: by parent folder ID, by folder path under the drive
  // root, or at the root itself. Each path segment is URL-encoded individually so slashes keep
  // separating folders.
  #buildUploadUrl(parentFolderId, folderPath, fileName, suffix) {
    const encodedName = encodeURIComponent(fileName)

    if (parentFolderId) {
      return `${ DRIVE_BASE_URL }/items/${ parentFolderId }:/${ encodedName }:/${ suffix }`
    }

    if (folderPath) {
      const encodedPath = folderPath
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .map(encodeURIComponent)
        .join('/')

      return `${ DRIVE_BASE_URL }/root:/${ encodedPath }/${ encodedName }:/${ suffix }`
    }

    return `${ DRIVE_BASE_URL }/root:/${ encodedName }:/${ suffix }`
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('response_mode', 'query')

    return `${ OAUTH_BASE_URL }/authorize?${ params.toString() }`
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {Object} userData
   * @property {String} connectionIdentityName
   * @property {Boolean} overwrite
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const code = callbackObject.code
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('code', code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)

    const response = await Flowrunner.Request.post(url)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}

    try {
      userData = await Flowrunner.Request.get(`${ API_BASE_URL }/me`).set({
        Authorization: `Bearer ${ response.access_token }`,
        'Content-Type': 'application/json',
      })

      logger.debug(`[executeCallback] userData response: ${ JSON.stringify(userData, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] getUserProfile error: ${ error.message }`)
    }

    return {
      token: response.access_token,
      refreshToken: response.refresh_token,
      expirationInSeconds: response.expires_in,
      connectionIdentityName: constructIdentityName(userData),
      overwrite: true,
      userData: userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   * @property {String} refreshToken
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')
    params.append('client_secret', this.clientSecret)

    try {
      const response = await Flowrunner.Request.post(url)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        // Entra ID may omit refresh_token on a refresh; fall back to the current one so we never
        // overwrite the stored refresh token with undefined and break the connection.
        refreshToken: response.refresh_token || refreshToken,
        expirationInSeconds: response.expires_in,
      }
    } catch (error) {
      logger.error('Error refreshing token: ', error.message || error)
      throw error
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Folders Dictionary
   * @description Provides a searchable list of OneDrive folders for dynamic parameter selection. Without a search string, folders at the drive root are listed; with one, folders across the whole drive are matched by name.
   * @route POST /get-folders-dictionary
   * @paramDef {"type":"getFoldersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering folders."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Documents","value":"01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36K","note":"12 items"}],"cursor":null}
   */
  async getFoldersDictionary(payload) {
    const { search, cursor } = payload || {}

    const url = cursor
      ? cursor
      : (search ? this.#buildSearchUrl(search) : `${ DRIVE_BASE_URL }/root/children`)

    const response = await this.#apiRequest({
      url,
      query: cursor ? undefined : { $top: PAGE_SIZE_DICTIONARY },
      logTag: 'getFoldersDictionary',
    })

    const folders = (response.value || []).filter(item => item.folder)

    return {
      cursor: response['@odata.nextLink'] || null,
      items: folders.map(item => ({
        label: item.name,
        value: item.id,
        note: item.folder.childCount !== undefined
          ? `${ item.folder.childCount } item${ item.folder.childCount === 1 ? '' : 's' }`
          : (item.parentReference?.path || 'Folder'),
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Items Dictionary
   * @description Provides a searchable list of OneDrive files and folders for dynamic parameter selection. Without a search string, items at the drive root are listed; with one, items across the whole drive are matched by name and content.
   * @route POST /get-items-dictionary
   * @paramDef {"type":"getItemsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering drive items."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"report.pdf","value":"01BYE5RZ4RLLW3W2VMKFELS3EKFXAYGGDR","note":"File, 24576 bytes"}],"cursor":null}
   */
  async getItemsDictionary(payload) {
    const { search, cursor } = payload || {}

    const url = cursor
      ? cursor
      : (search ? this.#buildSearchUrl(search) : `${ DRIVE_BASE_URL }/root/children`)

    const response = await this.#apiRequest({
      url,
      query: cursor ? undefined : { $top: PAGE_SIZE_DICTIONARY },
      logTag: 'getItemsDictionary',
    })

    return {
      cursor: response['@odata.nextLink'] || null,
      items: (response.value || []).map(item => ({
        label: item.name,
        value: item.id,
        note: item.folder
          ? `Folder, ${ item.folder.childCount ?? 0 } items`
          : `File, ${ item.size ?? 0 } bytes`,
      })),
    }
  }

  /**
   * @operationName List Items In Folder
   * @category Items
   * @appearanceColor #0364B8 #28A8EA
   * @description Lists the files and folders inside a OneDrive folder (or the drive root when no folder is selected). Each item includes its ID, name, type (file or folder), size, web URL, and last-modified timestamp. Results are paginated; pass the returned nextLink to fetch the next page.
   * @route GET /list-items-in-folder
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getFoldersDictionary","description":"The folder whose contents to list. Choose a folder, paste a folder ID, or leave blank for the drive root."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of items to return per page. Defaults to 50, maximum 200."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"01BYE5RZ4RLLW3W2VMKFELS3EKFXAYGGDR","name":"report.pdf","type":"file","size":24576,"webUrl":"https://onedrive.live.com/...","lastModifiedDateTime":"2026-07-13T10:00:00Z","createdDateTime":"2026-07-01T09:00:00Z","mimeType":"application/pdf","childCount":null,"parentPath":"/drive/root:"}],"nextLink":null}
   */
  async listItemsInFolder(folderId, top, nextLink) {
    const response = await this.#apiRequest({
      url: nextLink
        ? nextLink
        : (folderId ? `${ DRIVE_BASE_URL }/items/${ folderId }/children` : `${ DRIVE_BASE_URL }/root/children`),
      query: nextLink ? undefined : { $top: Math.min(top || DEFAULT_LIST_TOP, 200) },
      logTag: 'listItemsInFolder',
    })

    return {
      items: (response.value || []).map(item => this.#mapItem(item)),
      nextLink: response['@odata.nextLink'] || null,
    }
  }

  /**
   * @operationName Search Items
   * @category Items
   * @appearanceColor #0364B8 #28A8EA
   * @description Searches the whole OneDrive for files and folders matching a text query. Matches item names and, for files, indexed content. Results are paginated; pass the returned nextLink to fetch the next page.
   * @route GET /search-items
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The text to search for, e.g. a file name or a phrase contained in a document."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of items to return per page. Defaults to 50, maximum 200."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"01BYE5RZ4RLLW3W2VMKFELS3EKFXAYGGDR","name":"Q1-report.pdf","type":"file","size":24576,"webUrl":"https://onedrive.live.com/...","lastModifiedDateTime":"2026-07-13T10:00:00Z","createdDateTime":"2026-07-01T09:00:00Z","mimeType":"application/pdf","childCount":null,"parentPath":"/drive/root:/Reports"}],"nextLink":null}
   */
  async searchItems(query, top, nextLink) {
    if (!nextLink && !query) {
      throw new Error('Parameter "Query" is required')
    }

    const response = await this.#apiRequest({
      url: nextLink ? nextLink : this.#buildSearchUrl(query),
      query: nextLink ? undefined : { $top: Math.min(top || DEFAULT_LIST_TOP, 200) },
      logTag: 'searchItems',
    })

    return {
      items: (response.value || []).map(item => this.#mapItem(item)),
      nextLink: response['@odata.nextLink'] || null,
    }
  }

  /**
   * @operationName Get Item
   * @category Items
   * @appearanceColor #0364B8 #28A8EA
   * @description Retrieves the metadata of a single file or folder, either by its item ID or by its path under the drive root (e.g. Reports/Q1/summary.pdf). Returns the full Microsoft Graph driveItem including size, timestamps, web URL, and file or folder facets.
   * @route GET /get-item
   * @paramDef {"type":"String","label":"Item","name":"itemId","dictionary":"getItemsDictionary","description":"The file or folder to retrieve, by ID. Either this or Path must be provided; the ID takes precedence."}
   * @paramDef {"type":"String","label":"Path","name":"path","description":"The path of the item relative to the drive root, e.g. Reports/Q1/summary.pdf. Used when no Item ID is provided."}
   * @returns {Object}
   * @sampleResult {"id":"01BYE5RZ4RLLW3W2VMKFELS3EKFXAYGGDR","name":"summary.pdf","size":24576,"webUrl":"https://onedrive.live.com/...","lastModifiedDateTime":"2026-07-13T10:00:00Z","file":{"mimeType":"application/pdf"},"parentReference":{"path":"/drive/root:/Reports/Q1"}}
   */
  async getItem(itemId, path) {
    if (!itemId && !path) {
      throw new Error('One of "Item" or "Path" must be provided')
    }

    let url

    if (itemId) {
      url = `${ DRIVE_BASE_URL }/items/${ itemId }`
    } else {
      const encodedPath = path
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .map(encodeURIComponent)
        .join('/')

      url = `${ DRIVE_BASE_URL }/root:/${ encodedPath }`
    }

    return this.#apiRequest({
      url,
      logTag: 'getItem',
    })
  }

  /**
   * @operationName Download File
   * @category Files
   * @appearanceColor #0364B8 #28A8EA
   * @description Downloads a file from OneDrive and saves it to FlowRunner file storage, returning a URL to the stored copy. The stored file keeps the original OneDrive file name. The whole file is loaded into memory during transfer, so keep files within the memory available to this function.
   * @route POST /download-file
   * @executionTimeoutInSeconds 300
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The file to download. Choose a file or paste its item ID. Folders cannot be downloaded."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the downloaded file in FlowRunner. Defaults to the FLOW scope."}
   * @returns {Object}
   * @sampleResult {"fileUrl":"https://storage.flowrunner.com/files/flow/report.pdf","fileName":"report.pdf","size":24576,"mimeType":"application/pdf","itemId":"01BYE5RZ4RLLW3W2VMKFELS3EKFXAYGGDR"}
   */
  async downloadFile(itemId, fileOptions) {
    if (!itemId) {
      throw new Error('Parameter "Item" is required')
    }

    const item = await this.#apiRequest({
      url: `${ DRIVE_BASE_URL }/items/${ itemId }`,
      query: { $select: 'id,name,size,file,folder' },
      logTag: 'downloadFile',
    })

    if (item.folder) {
      throw new Error('The selected item is a folder - only files can be downloaded')
    }

    let bytes

    try {
      // Graph answers /content with a 302 redirect to a short-lived, pre-authenticated
      // download URL; the request follows it and returns the raw bytes.
      bytes = await Flowrunner.Request.get(`${ DRIVE_BASE_URL }/items/${ itemId }/content`)
        .set(this.#getAccessTokenHeader())
        .setEncoding(null)
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`downloadFile - error: ${ message }`)

      throw new Error(`Microsoft OneDrive API error: ${ message }`)
    }

    const buffer = this.#toBuffer(bytes)

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: item.name,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      fileUrl: url,
      fileName: item.name,
      size: buffer.length,
      mimeType: item.file?.mimeType || null,
      itemId: item.id,
    }
  }

  /**
   * @operationName Upload File
   * @category Files
   * @appearanceColor #0364B8 #28A8EA
   * @description Uploads a file to OneDrive from a FlowRunner file URL or any external URL. Files up to 4 MB are sent in a single request; larger files are automatically transferred through a resumable upload session in 5 MB chunks. The destination can be a folder picked from the drive, a folder path under the drive root, or the root itself. The whole file is loaded into memory before it is sent, so keep files within the memory available to this function.
   * @route POST /upload-file
   * @executionTimeoutInSeconds 900
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The source file to upload (its URL). Accepts a FlowRunner file or any publicly reachable URL."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"The name the file should have in OneDrive, including its extension, e.g. report.pdf."}
   * @paramDef {"type":"String","label":"Destination Folder","name":"parentFolderId","dictionary":"getFoldersDictionary","description":"The folder to upload into. Choose a folder or paste a folder ID. Takes precedence over Destination Path."}
   * @paramDef {"type":"String","label":"Destination Path","name":"folderPath","description":"Alternative destination: a folder path under the drive root, e.g. Reports/Q1. Used when no Destination Folder is selected. Leave both blank to upload to the drive root."}
   * @paramDef {"type":"String","label":"On Conflict","name":"conflictBehavior","defaultValue":"Rename","uiComponent":{"type":"DROPDOWN","options":{"values":["Rename","Replace","Fail"]}},"description":"What to do if a file with this name already exists at the destination. Defaults to Rename."}
   * @returns {Object}
   * @sampleResult {"id":"01BYE5RZ4RLLW3W2VMKFELS3EKFXAYGGDR","name":"report.pdf","size":104857600,"file":{"mimeType":"application/pdf"},"webUrl":"https://onedrive.live.com/...","parentReference":{"path":"/drive/root:/Reports"}}
   */
  async uploadFile(fileUrl, fileName, parentFolderId, folderPath, conflictBehavior) {
    if (!fileUrl) {
      throw new Error('Parameter "File" is required')
    }

    if (!fileName) {
      throw new Error('Parameter "File Name" is required')
    }

    let buffer

    try {
      buffer = this.#toBuffer(await Flowrunner.Request.get(fileUrl).setEncoding(null))
    } catch (error) {
      logger.error(`uploadFile - failed to fetch source file: ${ error.message }`)
      throw new Error(`Failed to fetch the source file: ${ error.message }`)
    }

    if (!buffer.length) {
      throw new Error('The source file is empty.')
    }

    const conflict = this.#resolveChoice(conflictBehavior, {
      Rename: 'rename',
      Replace: 'replace',
      Fail: 'fail',
    }) || 'rename'

    if (buffer.length <= SIMPLE_UPLOAD_LIMIT) {
      const url = `${ this.#buildUploadUrl(parentFolderId, folderPath, fileName, 'content') }?@microsoft.graph.conflictBehavior=${ conflict }`

      try {
        logger.debug(`uploadFile - simple upload of ${ buffer.length } bytes`)

        return await Flowrunner.Request.put(url)
          .set({
            ...this.#getAccessTokenHeader(),
            'Content-Type': 'application/octet-stream',
          })
          .send(buffer)
      } catch (error) {
        const message = error.body?.error?.message || error.message

        logger.error(`uploadFile - error: ${ message }`)

        throw new Error(`Microsoft OneDrive API error: ${ message }`)
      }
    }

    return this.#uploadLargeFile(parentFolderId, folderPath, fileName, conflict, buffer)
  }

  // Resumable upload for files over 4 MB: create an upload session, then PUT sequential 5 MiB
  // byte ranges to the returned pre-authenticated URL. Those PUTs must NOT carry an
  // Authorization header - a bearer token there makes Graph reject the chunk. The response to
  // the final byte range is the finished driveItem.
  async #uploadLargeFile(parentFolderId, folderPath, fileName, conflict, buffer) {
    const session = await this.#apiRequest({
      url: this.#buildUploadUrl(parentFolderId, folderPath, fileName, 'createUploadSession'),
      method: 'post',
      body: {
        item: {
          '@microsoft.graph.conflictBehavior': conflict,
          name: fileName,
        },
      },
      logTag: 'uploadFile',
    })

    const total = buffer.length
    let last

    try {
      for (let start = 0; start < total; start += UPLOAD_CHUNK_SIZE) {
        const end = Math.min(start + UPLOAD_CHUNK_SIZE, total)

        logger.debug(`uploadFile - PUT bytes ${ start }-${ end - 1 }/${ total }`)

        last = await Flowrunner.Request.put(session.uploadUrl)
          .set({
            'Content-Type': 'application/octet-stream',
            'Content-Range': `bytes ${ start }-${ end - 1 }/${ total }`,
          })
          .send(buffer.subarray(start, end))
      }
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`uploadFile - chunk upload error: ${ message }`)

      throw new Error(`Microsoft OneDrive API error: ${ message }`)
    }

    return last
  }

  /**
   * @operationName Create Folder
   * @category Folders
   * @appearanceColor #0364B8 #28A8EA
   * @description Creates a new folder in OneDrive, either inside a selected parent folder or at the drive root. Returns the created folder's metadata including its ID.
   * @route POST /create-folder
   * @paramDef {"type":"String","label":"Folder Name","name":"folderName","required":true,"description":"The name of the new folder."}
   * @paramDef {"type":"String","label":"Parent Folder","name":"parentFolderId","dictionary":"getFoldersDictionary","description":"The folder to create the new folder in. Leave blank to create it at the drive root."}
   * @paramDef {"type":"String","label":"On Conflict","name":"conflictBehavior","defaultValue":"Fail","uiComponent":{"type":"DROPDOWN","options":{"values":["Rename","Replace","Fail"]}},"description":"What to do if a folder with this name already exists. Defaults to Fail."}
   * @returns {Object}
   * @sampleResult {"id":"01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36K","name":"Reports","folder":{"childCount":0},"webUrl":"https://onedrive.live.com/...","createdDateTime":"2026-07-13T10:00:00Z"}
   */
  async createFolder(folderName, parentFolderId, conflictBehavior) {
    if (!folderName) {
      throw new Error('Parameter "Folder Name" is required')
    }

    const conflict = this.#resolveChoice(conflictBehavior, {
      Rename: 'rename',
      Replace: 'replace',
      Fail: 'fail',
    }) || 'fail'

    return this.#apiRequest({
      url: parentFolderId
        ? `${ DRIVE_BASE_URL }/items/${ parentFolderId }/children`
        : `${ DRIVE_BASE_URL }/root/children`,
      method: 'post',
      body: {
        name: folderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': conflict,
      },
      logTag: 'createFolder',
    })
  }

  /**
   * @operationName Move Item
   * @category Items
   * @appearanceColor #0364B8 #28A8EA
   * @description Moves a file or folder into a different folder within the drive, optionally renaming it in the same step. Returns the updated item metadata.
   * @route PATCH /move-item
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The file or folder to move. Choose an item or paste its ID."}
   * @paramDef {"type":"String","label":"New Parent Folder","name":"newParentFolderId","required":true,"dictionary":"getFoldersDictionary","description":"The destination folder. Choose a folder or paste a folder ID."}
   * @paramDef {"type":"String","label":"New Name","name":"newName","description":"Optional new name for the item, including the file extension for files."}
   * @returns {Object}
   * @sampleResult {"id":"01BYE5RZ4RLLW3W2VMKFELS3EKFXAYGGDR","name":"report.pdf","parentReference":{"id":"01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36K","path":"/drive/root:/Archive"},"webUrl":"https://onedrive.live.com/..."}
   */
  async moveItem(itemId, newParentFolderId, newName) {
    if (!itemId) {
      throw new Error('Parameter "Item" is required')
    }

    if (!newParentFolderId) {
      throw new Error('Parameter "New Parent Folder" is required')
    }

    const body = {
      parentReference: { id: newParentFolderId },
    }

    if (newName) {
      body.name = newName
    }

    return this.#apiRequest({
      url: `${ DRIVE_BASE_URL }/items/${ itemId }`,
      method: 'patch',
      body,
      logTag: 'moveItem',
    })
  }

  /**
   * @operationName Rename Item
   * @category Items
   * @appearanceColor #0364B8 #28A8EA
   * @description Renames a file or folder in place, keeping it in its current folder. To move an item to a different folder, use Move Item instead.
   * @route PATCH /rename-item
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The file or folder to rename. Choose an item or paste its ID."}
   * @paramDef {"type":"String","label":"New Name","name":"newName","required":true,"description":"The new name for the item, including the file extension for files, e.g. Q1-report.pdf."}
   * @returns {Object}
   * @sampleResult {"id":"01BYE5RZ4RLLW3W2VMKFELS3EKFXAYGGDR","name":"Q1-report.pdf","file":{"mimeType":"application/pdf"},"webUrl":"https://onedrive.live.com/..."}
   */
  async renameItem(itemId, newName) {
    if (!itemId) {
      throw new Error('Parameter "Item" is required')
    }

    if (!newName) {
      throw new Error('Parameter "New Name" is required')
    }

    return this.#apiRequest({
      url: `${ DRIVE_BASE_URL }/items/${ itemId }`,
      method: 'patch',
      body: { name: newName },
      logTag: 'renameItem',
    })
  }

  /**
   * @operationName Copy Item
   * @category Items
   * @appearanceColor #0364B8 #28A8EA
   * @description Starts an asynchronous copy of a file or folder to another folder, optionally under a new name. Microsoft Graph performs the copy in the background and this action returns immediately with an accepted status - the copy is usually done within seconds. To verify completion, list or search the destination folder afterwards.
   * @route POST /copy-item
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The file or folder to copy. Choose an item or paste its ID."}
   * @paramDef {"type":"String","label":"Destination Folder","name":"targetParentFolderId","dictionary":"getFoldersDictionary","description":"The folder to copy the item into. Leave blank to copy within the current folder (a New Name is then required)."}
   * @paramDef {"type":"String","label":"New Name","name":"newName","description":"Optional new name for the copy, including the file extension for files."}
   * @paramDef {"type":"String","label":"On Conflict","name":"conflictBehavior","defaultValue":"Rename","uiComponent":{"type":"DROPDOWN","options":{"values":["Rename","Replace","Fail"]}},"description":"What to do if an item with this name already exists at the destination. Defaults to Rename."}
   * @returns {Object}
   * @sampleResult {"status":"accepted","message":"The copy was accepted and runs in the background. List or search the destination folder in a few seconds to confirm the new item."}
   */
  async copyItem(itemId, targetParentFolderId, newName, conflictBehavior) {
    if (!itemId) {
      throw new Error('Parameter "Item" is required')
    }

    if (!targetParentFolderId && !newName) {
      throw new Error('Provide a "Destination Folder", a "New Name", or both - copying an item onto itself is not possible')
    }

    const conflict = this.#resolveChoice(conflictBehavior, {
      Rename: 'rename',
      Replace: 'replace',
      Fail: 'fail',
    }) || 'rename'

    const body = {}

    if (targetParentFolderId) {
      body.parentReference = { id: targetParentFolderId }
    }

    if (newName) {
      body.name = newName
    }

    await this.#apiRequest({
      url: `${ DRIVE_BASE_URL }/items/${ itemId }/copy?@microsoft.graph.conflictBehavior=${ conflict }`,
      method: 'post',
      body,
      logTag: 'copyItem',
    })

    return {
      status: 'accepted',
      message: 'The copy was accepted and runs in the background. List or search the destination folder in a few seconds to confirm the new item.',
    }
  }

  /**
   * @operationName Delete Item
   * @category Items
   * @appearanceColor #0364B8 #28A8EA
   * @description Deletes a file or folder from OneDrive. The item is moved to the OneDrive recycle bin, from which it can be restored by the user.
   * @route DELETE /delete-item
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The file or folder to delete. Choose an item or paste its ID."}
   * @returns {Object}
   * @sampleResult {"message":"Item deleted successfully"}
   */
  async deleteItem(itemId) {
    if (!itemId) {
      throw new Error('Parameter "Item" is required')
    }

    await this.#apiRequest({
      url: `${ DRIVE_BASE_URL }/items/${ itemId }`,
      method: 'delete',
      logTag: 'deleteItem',
    })

    return { message: 'Item deleted successfully' }
  }

  /**
   * @operationName Create Sharing Link
   * @category Sharing
   * @appearanceColor #0364B8 #28A8EA
   * @description Creates a shareable link to a file or folder and returns its web URL. Choose whether the link grants view or edit access and whether it works for anyone (anonymous) or only for people in your organization. Anonymous links may be disabled by your organization's sharing policy; organization scope is not available on personal OneDrive accounts.
   * @route POST /create-sharing-link
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The file or folder to share. Choose an item or paste its ID."}
   * @paramDef {"type":"String","label":"Link Type","name":"linkType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["View","Edit"]}},"description":"The permission granted by the link: View for read-only access, Edit for read-write access."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","defaultValue":"Anonymous","uiComponent":{"type":"DROPDOWN","options":{"values":["Anonymous","Organization"]}},"description":"Who can use the link: Anonymous for anyone with the link, Organization for signed-in members of your organization only. Defaults to Anonymous."}
   * @returns {Object}
   * @sampleResult {"id":"123ABC","roles":["read"],"link":{"type":"view","scope":"anonymous","webUrl":"https://1drv.ms/b/s!AkD..."}}
   */
  async createSharingLink(itemId, linkType, scope) {
    if (!itemId) {
      throw new Error('Parameter "Item" is required')
    }

    if (!linkType) {
      throw new Error('Parameter "Link Type" is required')
    }

    return this.#apiRequest({
      url: `${ DRIVE_BASE_URL }/items/${ itemId }/createLink`,
      method: 'post',
      body: {
        type: this.#resolveChoice(linkType, { View: 'view', Edit: 'edit' }),
        scope: this.#resolveChoice(scope, { Anonymous: 'anonymous', Organization: 'organization' }) || 'anonymous',
      },
      logTag: 'createSharingLink',
    })
  }

  /**
   * @operationName Get Drive Info
   * @category Drive
   * @appearanceColor #0364B8 #28A8EA
   * @description Retrieves information about the connected user's OneDrive, including its ID, type, owner, and storage quota (total, used, and remaining bytes). Useful for verifying the connection and monitoring storage usage.
   * @route GET /get-drive-info
   * @returns {Object}
   * @sampleResult {"id":"b!CbtYWrofwUGBJWnaJkNwoNrBLp_kC3RKklSXPwrdeP3yH8_qmH5xT5OTJ17TO6yU","driveType":"business","owner":{"user":{"displayName":"John Smith"}},"quota":{"total":1099511627776,"used":532155,"remaining":1099511095621,"state":"normal"}}
   */
  getDriveInfo() {
    return this.#apiRequest({
      url: DRIVE_BASE_URL,
      logTag: 'getDriveInfo',
    })
  }
}

Flowrunner.ServerCode.addService(MicrosoftOneDriveService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID (Application ID) of your Microsoft Entra app registration.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret of your Microsoft Entra app registration.',
  },
])

function cleanupObject(data) {
  if (!data) {
    return
  }

  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function constructIdentityName(user) {
  const email = user.mail || user.userPrincipalName

  if (email && user.displayName) {
    return `${ email } (${ user.displayName })`
  }

  return email || user.displayName || 'Microsoft OneDrive Connection'
}
