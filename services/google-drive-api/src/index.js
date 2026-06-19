const Auth = require('@googleapis/oauth2')
const Drive = require('@googleapis/drive')
const { PassThrough } = require('stream')
const mimeTypes = require('mime-types')
const https = require('https')

const { assert, logMessage, getFilenameFromUrl } = require('./utils')

const DEFAULT_PAGE_SIZE = 10

const MY_DRIVE_ID = 'MY_GOOGLE_DRIVE'
const MY_DRIVE_LABEL = 'My Google Drive'

const Urls = {
  AUTHORIZATION: 'https://accounts.google.com/o/oauth2/v2/auth',
  TOKEN: 'https://oauth2.googleapis.com/token',
  PROFILE: 'https://www.googleapis.com/oauth2/v2/userinfo',
}

const MimeMapper = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'application/pdf',
  'application/vnd.google-apps.script': 'application/vnd.google-apps.script+json',
}

const ContentMimeMapper = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.script': 'application/vnd.google-apps.script+json',
}

const GoogleMimeTypes = {
  FOLDER: 'application/vnd.google-apps.folder',
  SHORTCUT: 'application/vnd.google-apps.shortcut',
  DOCUMENT: 'application/vnd.google-apps.document',
}

const TriggerConfiguration = {
  FILES_AND_FOLDERS: 'files_and_folders',
  FILES_ONLY: 'files_only',
  FOLDERS_ONLY: 'folders_only',
}

const DEFAULT_SCOPE_LIST = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

/**
 *  @requireOAuth
 *  @usesFileStorage
 *  @integrationName Google Drive
 *  @integrationIcon /icon.svg
 **/
class GoogleDrive {
  constructor(config, context) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret

    this.scope = DEFAULT_SCOPE_STRING
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  #initDrive() {
    const auth = new Auth.auth.OAuth2()

    auth.setCredentials({
      access_token: this.#getAccessToken(),
      scope: this.scope,
      token_type: 'Bearer',
    })

    return Drive.drive({ version: 'v3', auth })
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scope)
    params.append('access_type', 'offline')
    params.append('prompt', 'consent')

    return `${ Urls.AUTHORIZATION }?${ params.toString() }`
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
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
    try {
      const { access_token: token, expires_in: expirationInSeconds } = await Flowrunner.Request.post(Urls.TOKEN)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          client_id: this.clientId,
          scope: this.scope,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          client_secret: this.clientSecret,
        })

      return { token, expirationInSeconds }
    } catch (error) {
      console.error('Error refreshing token: ', error.message || error)

      if (error.body.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {Object} userData
   * @property {String} connectionIdentityName
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

    const { access_token, expires_in, refresh_token } = await Flowrunner.Request.post(Urls.TOKEN)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let identityName, identityImageURL

    try {
      const { name, email, picture } = await Flowrunner.Request.get(Urls.PROFILE)
        .set({ Authorization: `Bearer ${ access_token }` })
        .send()

      identityName = `${ name } (${ email })`
      identityImageURL = picture
    } catch (e) {
      logMessage("Can't load user profile", {
        error: e.body.error,
        currentScope: this.scope,
      })
    }

    return {
      token: access_token,
      refreshToken: refresh_token,
      expirationInSeconds: expires_in,
      overwrite: true,
      connectionIdentityName: identityName || 'Google Drive User',
      connectionIdentityImageURL: identityImageURL,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On New File
   * @category File Monitoring
   * @description Monitors Google Drive for new files and triggers AI workflows when content is added, uploaded, or moved. Perfect for automated processing of incoming documents, immediate analysis of uploaded files, or triggering workflows when users add new content to specific folders. Supports recursive scanning of subfolders with separate trigger calls for each new file/folder. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-file
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Drive to monitor for new files. Examples: 'My Drive', 'Marketing Team Drive', 'Client Upload Drive'. Leave blank to monitor your personal Drive."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":false,"dictionary":"getFoldersDictionary","description":"Specific folder to watch for new files. Examples: 'Client Uploads', 'Reports Inbox', 'Processing Queue'. Leave blank to monitor entire Drive."}
   * @paramDef {"type":"String","label":"Trigger Configuration","name":"triggerConfiguration","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["files_and_folders","files_only","folders_only"]}},"description":"Filter what triggers the workflow. Valid values: 'files_and_folders' (default - triggers for both), 'files_only' (triggers only for files), 'folders_only' (triggers only for folders)."}
   * @paramDef {"type":"Boolean","label":"Process Recursively","name":"processRecursively","uiComponent":{"type":"TOGGLE"},"description":"Set to true to scan all subfolders recursively. When enabled, the trigger fires separately for each new file/folder found in any subfolder level. Default is false."}
   *
   * @returns {Object}
   * @sampleResult {"kind":"drive#file","mimeType":"application/pdf","id":"1RlkPicKWIxdFqpSSFql2AvK2jaYJZNeGTDG7HnmlD_Q","name":"client-contract.pdf"}
   */
  async onNewFile(invocation) {
    const { sharedDriveId, folderId, triggerConfiguration, processRecursively } = invocation.triggerData

    const config = triggerConfiguration || TriggerConfiguration.FILES_AND_FOLDERS
    const recursive = processRecursively || false

    let files

    if (recursive) {
      files = await this.#getFilesRecursively({
        driveId: resolveSharedDriveId(sharedDriveId),
        folderId,
        config,
      })
    } else {
      const queryTokens = []

      if (folderId) {
        queryTokens.push(`'${ folderId }' in parents`)
      }

      if (config === TriggerConfiguration.FILES_ONLY) {
        queryTokens.push(`mimeType != '${ GoogleMimeTypes.FOLDER }'`)
      } else if (config === TriggerConfiguration.FOLDERS_ONLY) {
        queryTokens.push(`mimeType = '${ GoogleMimeTypes.FOLDER }'`)
      }

      files = await this.#getFilesList({
        driveId: resolveSharedDriveId(sharedDriveId),
        q: queryTokens.length ? queryTokens.join(' and ') : undefined,
        orderBy: 'createdTime desc',
      })
    }

    if (invocation.learningMode) {
      return {
        events: [files[0]],
        state: null,
      }
    }

    if (!invocation.state?.files) {
      return {
        events: [],
        state: { files },
      }
    }

    const prevIDs = new Set(invocation.state.files.map(({ id }) => id))

    return {
      events: files.filter(({ id }) => !prevIDs.has(id)),
      state: { files },
    }
  }

  /**
   * @operationName On New Folder
   * @category Folder Monitoring
   * @description Triggers when a new folder is created within the selected directory. Polling interval can be customized (minimum 30 seconds). Subfolders are not monitored.
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-folder
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Choose which drive to monitor. If left blank, your personal Google Drive will be used by default. If you’re part of any Google Shared Drives, you can select one from the list."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":false,"dictionary":"getFoldersDictionary","description":"Select a folder to monitor for newly created subfolders. Note: only folders created directly within the selected folder will trigger this event—folders created deeper in nested subfolders will not. If no folder is selected, the top-level directory will be used by default."}
   *
   * @returns {Object}
   * @sampleResult {"kind":"drive#file","mimeType":"application/vnd.google-apps.folder","id":"1OmthQQx7ss4CHw2ZaeuTOLGNOwaWjMXZ","name":"34"}
   */
  async onNewFolder(invocation) {
    const { sharedDriveId, folderId } = invocation.triggerData

    const queryTokens = [`mimeType = '${ GoogleMimeTypes.FOLDER }'`]

    if (folderId) {
      queryTokens.push(`'${ folderId }' in parents`)
    }

    const files = await this.#getFilesList({
      driveId: resolveSharedDriveId(sharedDriveId),
      q: queryTokens.join(' and '),
      orderBy: 'createdTime desc',
    })

    if (invocation.learningMode) {
      return {
        events: [files[0]],
        state: null,
      }
    }

    if (!invocation.state?.files) {
      return {
        events: [],
        state: { files },
      }
    }

    const prevIDs = new Set(invocation.state.files.map(({ id }) => id))

    return {
      events: files.filter(({ id }) => !prevIDs.has(id)),
      state: { files },
    }
  }

  /**
   * @operationName On File Updated
   * @category File Monitoring
   * @description Triggers when a file is modified within the selected folder. Polling interval can be customized (minimum 30 seconds). Subfolders are not monitored.
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-file-updated
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Choose which drive to monitor. If left blank, your personal Google Drive will be used by default. If you’re part of any Google Shared Drives, you can select one from the list."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":false,"dictionary":"getFoldersDictionary","description":"Select a folder to monitor for newly created subfolders. Note: only folders created directly within the selected folder will trigger this event—folders created deeper in nested subfolders will not. If no folder is selected, the top-level directory will be used by default."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1rtzMziUYoyobT39rwkacEZp1lKl-S7gR","name":"Image.png","modifiedTime":"2025-04-02T14:22:40.589Z"}
   */
  async onFileUpdated(invocation) {
    const { sharedDriveId, folderId } = invocation.triggerData

    const files = await this.#getFilesList({
      driveId: resolveSharedDriveId(sharedDriveId),
      orderBy: 'modifiedTime desc',
      q: folderId ? `'${ folderId }' in parents` : undefined,
      fields: 'files(id, name, modifiedTime)',
    })

    if (invocation.learningMode) {
      return {
        events: [files[0]],
        state: null,
      }
    }

    if (!invocation.state?.files) {
      return {
        events: [],
        state: { files },
      }
    }

    const prevFiles = new Map(invocation.state.files.map(file => [file.id, file.modifiedTime]))

    const updatedFiles = files.filter(file => prevFiles.has(file.id) && file.modifiedTime !== prevFiles.get(file.id))

    return {
      events: updatedFiles,
      state: { files },
    }
  }

  /**
   * @private
   */
  async #getFilesList({ driveId, q, pageSize, orderBy, fields }) {
    const drive = this.#initDrive()

    const res = await drive.files.list({
      driveId: driveId || undefined,
      includeItemsFromAllDrives: !driveId,
      corpora: driveId ? 'drive' : undefined,
      pageSize: pageSize || DEFAULT_PAGE_SIZE,
      q,
      supportsAllDrives: true,
      orderBy,
      fields,
    })

    return res.data.files
  }

  /**
   * @private
   */
  async #processFolder(parentFolderId, driveId, config, allFiles) {
    const queryTokens = []

    if (parentFolderId) {
      queryTokens.push(`'${ parentFolderId }' in parents`)
    }

    const items = await this.#getFilesList({
      driveId,
      q: queryTokens.length ? queryTokens.join(' and ') : undefined,
      pageSize: 1000,
    })

    const folders = []
    const files = []

    for (const item of items) {
      if (item.mimeType === GoogleMimeTypes.FOLDER) {
        folders.push(item)
      } else {
        files.push(item)
      }
    }

    if (config === TriggerConfiguration.FILES_AND_FOLDERS) {
      allFiles.push(...files, ...folders)
    } else if (config === TriggerConfiguration.FILES_ONLY) {
      allFiles.push(...files)
    } else if (config === TriggerConfiguration.FOLDERS_ONLY) {
      allFiles.push(...folders)
    }

    for (const folder of folders) {
      await this.#processFolder(folder.id, driveId, config, allFiles)
    }
  }

  /**
   * @private
   * Recursively gets all files and/or folders from a folder and its subfolders
   */
  async #getFilesRecursively({ driveId, folderId, config }) {
    const allFiles = []

    await this.#processFolder(folderId, driveId, config, allFiles)

    return allFiles
  }

  /**
   * @private
   */
  async getFileEntities({ query, cursor, criteria }) {
    const drive = this.#initDrive()

    const payload = {
      q: query,
      pageToken: cursor,
      fields: 'nextPageToken,files(id,name)',
    }

    const sharedDriveId = resolveSharedDriveId(criteria.sharedDriveId)

    if (sharedDriveId) {
      Object.assign(payload, {
        driveId: sharedDriveId,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      })
    }

    const res = await drive.files.list(payload)

    const { nextPageToken, files } = res.data

    return {
      items: files.map(({ id, name }) => ({
        label: name,
        value: id,
        note: `ID: ${ id }`,
      })),
      cursor: nextPageToken,
    }
  }

  /**
   * @private
   * Builds the full path of a file by traversing parent folders
   */
  async #buildFilePath(file, drive) {
    const pathParts = [file.name]
    let currentParentId = file.parents?.[0]

    while (currentParentId) {
      try {
        const parent = await drive.files.get({
          fileId: currentParentId,
          supportsAllDrives: true,
          fields: 'id,name,parents',
        })

        pathParts.unshift(parent.data.name)
        currentParentId = parent.data.parents?.[0]
      } catch (error) {
        logMessage('[buildFilePath] Reached root or encountered error', { error: error.message })

        break
      }
    }

    return pathParts.join('/')
  }

  /**
   * @private
   * Recursively gets files matching a query from a folder and its subfolders
   */
  async #getFolderListingRecursively({ driveId, folderId, query }) {
    const allFiles = []
    const fileIds = new Set()

    await this.#processFolderListing(folderId, driveId, query, allFiles, fileIds)

    return allFiles
  }

  /**
   * @private
   * Processes a folder and recursively processes its subfolders with a query filter
   */
  async #processFolderListing(parentFolderId, driveId, query, allFiles, fileIds) {
    const queryTokens = [query]

    if (parentFolderId) {
      queryTokens.push(`'${ parentFolderId }' in parents`)
    }

    const items = await this.#getFilesList({
      driveId,
      q: queryTokens.join(' and '),
      pageSize: 1000,
      fields: 'files(*)',
    })

    for (const item of items) {
      if (item.mimeType !== GoogleMimeTypes.FOLDER && !fileIds.has(item.id)) {
        fileIds.add(item.id)
        allFiles.push(item)
      }
    }

    const folderQueryTokens = [`mimeType = '${ GoogleMimeTypes.FOLDER }'`]

    if (parentFolderId) {
      folderQueryTokens.push(`'${ parentFolderId }' in parents`)
    }

    const folders = await this.#getFilesList({
      driveId,
      q: folderQueryTokens.join(' and '),
      pageSize: 1000,
      fields: 'files(id,mimeType)',
    })

    for (const folder of folders) {
      await this.#processFolderListing(folder.id, driveId, query, allFiles, fileIds)
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
   * @property {Object} [criteria]
   */

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
   * @typedef {Object} getDrivesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter Google Drives by their name. Filtering is performed on the server side."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results. Use the returned cursor to fetch additional drives."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Drives
   * @category Drive Management
   * @description Returns a paginated list of Google Drives (including My Drive and shared drives). Note: search functionality is performed on the server side. Use the cursor to paginate through all available drives.
   *
   * @route POST /get-drives
   *
   * @paramDef {"type":"getDrivesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination token for retrieving and filtering Google Drives."}
   *
   * @sampleResult {"cursor":"nextPageToken123","items":[{"label":"My Drive","value":"mydriveid","note":"ID: mydriveid"}]}
   * @returns {DictionaryResponse}
   */
  async getDrivesDictionary({ search, cursor }) {
    logMessage('[getDrivesDictionary] Payload', { search, cursor })

    const drive = this.#initDrive()

    const payload = {
      pageToken: cursor,
      q: search ? `name contains '${ search }'` : undefined,
    }

    let res

    try {
      res = await drive.drives.list({
        ...payload,
        useDomainAdminAccess: true,
      })
    } catch {
      res = await drive.drives.list(payload)
    }

    const { nextPageToken, drives: sharedDrives } = res.data

    const drives = [{ id: MY_DRIVE_ID, name: MY_DRIVE_LABEL }, ...sharedDrives]

    return {
      cursor: nextPageToken,
      items: drives.map(({ id, name }) => ({
        label: name,
        value: id,
        note: `ID: ${ id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getFoldersDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Drive ID","name":"sharedDriveId","description":"Optional identifier of the Google Shared Drive to list folders from. Leave blank to search in 'My Drive'."}
   */

  /**
   * @typedef {Object} getFoldersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter folders by their name. Filtering is performed on the server side."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results. Use the returned cursor to fetch additional folders."}
   * @paramDef {"type":"getFoldersDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional parameter to specify the Google Shared Drive."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Folders
   * @category Folder Operations
   * @description Returns a paginated list of folders from Google Drive. Note: search functionality is performed on the server side. Use the cursor to paginate through all available folders.
   *
   * @route POST /get-folders
   *
   * @paramDef {"type":"getFoldersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination token, and shared drive ID for retrieving and filtering folders."}
   *
   * @sampleResult {"cursor":"nextPageToken456","items":[{"label":"Contracts","note":"ID: 6A7B8C9D","value":"6A7B8C9D"}]}
   * @returns {DictionaryResponse}
   */
  async getFoldersDictionary({ search, cursor, criteria }) {
    logMessage('[getFoldersDictionary] Payload', { search, cursor })

    let query = `mimeType = '${ GoogleMimeTypes.FOLDER }'`

    if (search) {
      query += ` and name contains '${ search }'`
    }

    return this.getFileEntities({ query, cursor, criteria })
  }

  /**
   * @typedef {Object} getFilesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Drive ID","name":"sharedDriveId","description":"Optional identifier of the Google Shared Drive to list files from. Leave blank to search in 'My Drive'."}
   */

  /**
   * @typedef {Object} getFilesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter files by their name. Filtering is performed on the server side."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results. Use the returned cursor to fetch additional files."}
   * @paramDef {"type":"getFilesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional parameter to specify the Google Shared Drive."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Files
   * @category File Operations
   * @description Returns a paginated list of files from Google Drive. Note: search functionality is performed on the server side. Use the cursor to paginate through all available files.
   *
   * @route POST /get-files
   *
   * @paramDef {"type":"getFilesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination token, and shared drive ID for retrieving and filtering files."}
   *
   * @sampleResult {"cursor":"nextPageToken789","items":[{"label":"Report Q2.pdf","note":"ID: 7G8H9J0K","value":"7G8H9J0K"}]}
   * @returns {DictionaryResponse}
   */
  async getFilesDictionary({ search, cursor, criteria }) {
    logMessage('[getFilesDictionary] Payload', { search, cursor })

    let query = `mimeType != '${ GoogleMimeTypes.FOLDER }'`

    if (search) {
      query += ` and name contains '${ search }'`
    }

    return this.getFileEntities({ query, cursor, criteria })
  }

  /**
   * @typedef {Object} getFilesAndFoldersDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Drive ID","name":"sharedDriveId","description":"Optional identifier of the Google Shared Drive to list files and folders from."}
   */

  /**
   * @typedef {Object} getFilesAndFoldersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter files and folders by their name. Filtering is performed on the server side."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results. Use the returned cursor to fetch additional files and folders."}
   * @paramDef {"type":"getFilesAndFoldersDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional parameter to specify the Google Shared Drive."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Files and Folders
   * @category File Operations
   * @description Returns a paginated list of files and folders from Google Drive. Note: search functionality is performed on the server side. Use the cursor to paginate through all available files and folders.
   *
   * @route POST /get-files-and-folders
   *
   * @paramDef {"type":"getFilesAndFoldersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination token, and shared drive ID for retrieving and filtering files and folders."}
   *
   * @sampleResult {"cursor":"nextPageToken321","items":[{"label":"Invoices","note":"ID: 3F4D5E6G","value":"3F4D5E6G"}]}
   * @returns {DictionaryResponse}
   */
  async getFilesAndFoldersDictionary({ search, cursor, criteria }) {
    logMessage('[getFilesAndFoldersDictionary] Payload', { search, cursor })

    const query = search ? `name contains '${ search }'` : undefined

    return this.getFileEntities({ query, cursor, criteria })
  }

  // ======================================= END OF DICTIONARIES =======================================

  /**
   * @description Configures file sharing permissions for AI agents to control document access, collaborate with team members, or make files publicly available. Perfect for automated workflows that need to share generated reports, grant access to specific users, or create public links for content distribution.
   *
   * @route POST /add-sharing-preference
   * @operationName Add File Sharing Preference
   * @category File Sharing
   *
   * @appearanceColor #0066da #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.file
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The ID of the file to share. Examples: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', '1SeZVSZYS9KLYjQ8Fm7X3'. Use the file picker to select from your Drive."}
   * @paramDef {"type":"String","label":"Share for","name":"shareFor","uiComponent":{"type":"DROPDOWN","options":{"values":["group","user","domain","anyone"]}},"description":"Access scope: 'user' for individual email, 'group' for Google group, 'domain' for organization-wide access, 'anyone' for public access. Determines who can access the file."}
   * @paramDef {"type":"String","label":"Role","name":"role","uiComponent":{"type":"DROPDOWN","options":{"values":["writer","commenter","reader"]}},"description":"Permission level: 'reader' for view-only, 'commenter' for view and comment, 'writer' for full edit access. Controls what actions users can perform on the file."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address for user or group sharing. Examples: 'john.doe@company.com', 'marketing-team@company.com'. Required when Share for is 'user' or 'group'."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"Organization domain for domain-wide sharing. Examples: 'company.com', 'university.edu'. Required when Share for is 'domain'."}
   *
   * @returns {Object} URL for shared file
   * @sampleResult {"url": "https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view?usp=drivesdk"}
   */
  async addSharingPreference(fileId, shareFor, role, email, domain) {
    logMessage('[addSharingPreference] Payload', { fileId, shareFor, role, email, domain })

    const drive = this.#initDrive()

    assert(fileId, 'File ID is required.')
    assert(shareFor, 'Share For property is required.')
    assert(role, 'Role is required.')

    if (shareFor === 'group' || shareFor === 'user') {
      assert(email, 'Email is required is Share For property set to "user" or "group"')
    }

    if (shareFor === 'domain') {
      assert(domain, 'Domain is required is Share For property set to "domain"')
    }

    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: role,
        type: shareFor,
        domain,
        emailAddress: email,
      },
    })

    const file = await drive.files.get({
      fileId,
      fields: 'webViewLink',
      supportsAllDrives: true,
    })

    return { url: file.data.webViewLink }
  }

  /**
   * @description Creates file shortcuts for AI agents to organize content across multiple locations, create quick access links, or build dynamic file structures. Perfect for automated workflows that need to reference files in multiple folders without duplicating content.
   *
   * @route POST /create-shortcut
   * @operationName Create Shortcut
   * @category File Management
   *
   * @appearanceColor #0066da #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.file
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Target drive for the shortcut. Examples: 'My Drive', 'Sales Team Drive', 'Marketing Shared Drive'. Leave blank to use your personal Drive."}
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"Source file to create shortcut for. Examples: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'. The original file will remain in its current location."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getFoldersDictionary","description":"Destination folder for the shortcut. Examples: 'Quick Access', 'Project References', 'Client Documents'. Leave blank to place in Drive root."}
   *
   * @returns {Object} Link for the created shortcut.
   * @sampleResult {"url":"https://drive.google.com/file/d/1gO3ZmOhZ7x2KLmN5QrSt/view?usp=drivesdk"}
   */
  async createShortcut(sharedDriveId, fileId, folderId) {
    logMessage('[createShortcut] Payload', { sharedDriveId, fileId, folderId })

    const drive = this.#initDrive()

    const res = await drive.files.create({
      requestBody: {
        driveId: resolveSharedDriveId(sharedDriveId),
        mimeType: GoogleMimeTypes.SHORTCUT,
        parents: folderId && [folderId],
        shortcutDetails: { targetId: fileId },
      },
      fields: 'webViewLink',
    })

    return {
      url: res.data.webViewLink,
    }
  }

  /**
   * @description Retrieves a complete list of files from a Google Drive folder for AI agents to process directory contents, analyze file structures, or manage collections of documents. Perfect for automated workflows that need to iterate through files, generate reports on folder contents, or process multiple files in batch operations.
   *
   * @route GET /get-folder-listing
   * @operationName Get Folder Listing
   * @category File Operations
   *
   * @appearanceColor #0066da #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file | https://www.googleapis.com/auth/drive.metadata | https://www.googleapis.com/auth/drive.metadata.readonly | https://www.googleapis.com/auth/drive.readonly
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","dictionary":"getDrivesDictionary","description":"Drive to list files from. Leave blank to use your personal Drive."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getFoldersDictionary","description":"Folder to list files from. Leave blank to list from Drive root."}
   * @paramDef {"type":"String","label":"File Pattern or Type","name":"fileFilter","description":"Filter files by name pattern or MIME type. Examples: `report` (name contains), `application/pdf` (PDF files), `image/` (all images), `text/` (text files). Leave blank for all files."}
   * @paramDef {"type":"Boolean","label":"Recurring Retrieval","name":"recurringRetrieval","uiComponent":{"type":"TOGGLE"},"description":"Perform recurring retrieval to include files from all subfolders. When enabled, retrieves files from the specified folder and all its nested subfolders. Default is false."}
   * @paramDef {"type":"Boolean","label":"Verbose Response","name":"verboseResponse","uiComponent":{"type":"TOGGLE"},"description":"When enabled, returns all file properties. When disabled, returns only `id, name, mimeType, fullPath, webViewLink`. Default is false."}
   *
   * @returns {Array.<Object>} Complete list of files with detailed information.
   * @sampleResult [{"id":"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms","name":"quarterly-report.pdf","fullPath":"Reports/Q4/quarterly-report.pdf","mimeType":"application/pdf","webViewLink":"https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view"},{"id":"1SeZVSZYS9KLYjQ8Fm7X3","name":"budget.xlsx","fullPath":"Reports/Q4/budget.xlsx","mimeType":"application/vnd.ms-excel","size":"1234567","createdTime":"2025-01-10T08:20:15.123Z","modifiedTime":"2025-01-12T16:45:30.456Z","webViewLink":"https://drive.google.com/file/d/1SeZVSZYS9KLYjQ8Fm7X3/view"}]
   */
  async getFolderListing(sharedDriveId, folderId, fileFilter, recurringRetrieval, verboseResponse) {
    logMessage('[getFolderListing] Payload', { sharedDriveId, folderId, fileFilter, recurringRetrieval, verboseResponse })

    const drive = this.#initDrive()
    const driveId = resolveSharedDriveId(sharedDriveId)

    const queryTokens = [`mimeType != '${ GoogleMimeTypes.FOLDER }'`]

    if (fileFilter) {
      if (fileFilter.includes('/')) {
        queryTokens.push(`mimeType contains '${ fileFilter }'`)
      } else {
        queryTokens.push(`name contains '${ fileFilter }'`)
      }
    }

    let files

    if (recurringRetrieval) {
      files = await this.#getFolderListingRecursively({
        driveId,
        folderId,
        query: queryTokens.join(' and '),
      })
    } else {
      if (folderId) {
        queryTokens.push(`'${ folderId }' in parents`)
      } else {
        queryTokens.push('\'root\' in parents')
      }

      files = await this.#getFilesList({
        driveId,
        q: queryTokens.join(' and '),
        pageSize: 1000,
        fields: 'files(*)',
      })
    }

    return Promise.all(
      files.map(async file => {
        const fullPath = await this.#buildFilePath(file, drive)

        if (verboseResponse) {
          return {
            ...file,
            fullPath,
          }
        } else {
          return {
            fullPath,
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            webViewLink: file.webViewLink,
          }
        }
      })
    )
  }

  /**
   * @description Creates new files in Google Drive for AI agents to generate reports, save processed data, create documentation, or store AI outputs. Perfect for automated workflows that need to create text files, Google Docs, or store structured data directly in Drive.
   *
   * @route POST /create-file
   * @operationName Create File
   * @category File Operations
   *
   * @appearanceColor #0066da #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Target drive for the new file. Examples: 'My Drive', 'Company Shared Drive', 'Project Team Drive'. Leave blank to use your personal Drive."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":false,"dictionary":"getFoldersDictionary","description":"Destination folder for the file. Examples: 'Reports', 'AI Generated Content', 'Data Exports'. Leave blank to place in Drive root."}
   * @paramDef {"type":"String","label":"File Name","name":"name","required":false,"description":"Name for the new file. Examples: 'Monthly Report.txt', 'user-data.json', 'meeting-summary.txt'. Include file extension for plain text files."}
   * @paramDef {"type":"String","label":"File Content","name":"content","required":false,"description":"Text content for the file. Examples: JSON data, CSV content, plain text, markdown. For Google Docs, this becomes the initial document content.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"Boolean","label":"As Document","name":"asDocument","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Create as Google Document for rich text editing and collaboration. Enable for documents that need formatting, comments, or collaborative editing."}
   *
   * @returns {Object} ID of the created file.
   * @sampleResult {"id":"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"}
   */
  async createFile(sharedDriveId, folderId, name, content, asDocument) {
    logMessage('[createFile] Payload', { sharedDriveId, folderId, name, content, asDocument })

    const drive = this.#initDrive()

    const res = await drive.files.create({
      media: { mimeType: 'text/plain', body: content },
      requestBody: {
        driveId: resolveSharedDriveId(sharedDriveId),
        parents: [folderId],
        name,
        mimeType: asDocument ? GoogleMimeTypes.DOCUMENT : undefined,
      },
      supportsAllDrives: true,
    })

    return { id: res.data.id }
  }

  /**
   * @description Relocates files within Google Drive for AI agents to organize content, sort documents by category, or restructure file hierarchies automatically. Essential for automated workflows that need to maintain organized folder structures or move files based on content analysis.
   *
   * @route POST /move-file
   * @operationName Move File
   * @category File Management
   *
   * @appearanceColor #0066da #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Source drive containing the file. Examples: 'My Drive', 'Marketing Team Drive', 'Project Shared Drive'. Leave blank for personal Drive."}
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"File to move. Examples: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'. The file will be moved from its current location to the target folder."}
   * @paramDef {"type":"String","label":"Target Folder","name":"targetFolder","required":false,"dictionary":"getFoldersDictionary","description":"Destination folder ID. Examples: 'Archived Files', 'Processed Documents', 'Client Materials'. Leave blank to move to Drive root."}
   */
  async moveFile(sharedDriveId, fileId, targetFolder) {
    logMessage('[moveFile] Payload', { fileId, sharedDriveId, targetFolder })

    const drive = this.#initDrive()

    assert(fileId, 'File ID is required.')

    const file = await drive.files.get({ fileId, fields: 'parents' })

    await drive.files.update({
      fileId: fileId,
      requestBody: {
        driveId: resolveSharedDriveId(sharedDriveId),
      },
      addParents: targetFolder || 'root',
      removeParents: file.data.parents[0],
      fields: 'id',
    })
  }

  /**
   * @description Downloads files from URLs and uploads them to Google Drive, enabling AI agents to archive web content, save API responses, or collect files from external sources. Perfect for automated workflows that need to backup files from other services or capture generated content.
   *
   * @route POST /upload-file
   * @operationName Upload File
   * @category File Upload
   *
   * @appearanceColor #0066da #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Target drive for the uploaded file. Examples: 'My Drive', 'Content Archive Drive', 'Backup Drive'. Leave blank to use your personal Drive."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getFoldersDictionary","description":"Destination folder for the upload. Examples: 'Downloaded Files', 'API Responses', 'Archive'. Leave blank to place in Drive root."}
   * @paramDef {"type":"String","label":"File Name","name":"name","description":"Custom name for the uploaded file. Examples: 'report.pdf', 'api-response.json', 'user-avatar.png'. Leave blank to use the original filename from URL."}
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"Source URL of the file to upload. Examples: 'https://api.example.com/report.pdf', 'https://cdn.example.com/image.jpg'. Must be publicly accessible."}
   *
   * @returns {Object} ID of an uploaded file.
   * @sampleResult {"id":"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"}
   */
  async uploadFile(sharedDriveId, folderId, name, fileUrl) {
    logMessage('[uploadFile] Payload', { sharedDriveId, folderId, name, fileUrl })

    assert(fileUrl, 'File URL must be provided.')

    const drive = this.#initDrive()

    const passThroughStream = new PassThrough()

    https.get(fileUrl, response => {
      if (response.statusCode !== 200) {
        return new Error(`Failed to get file: ${ response.statusCode }`)
      }

      response.pipe(passThroughStream)
    })

    const res = await drive.files.create({
      media: { body: passThroughStream },
      requestBody: {
        driveId: resolveSharedDriveId(sharedDriveId),
        parents: [folderId],
        name: name || getFilenameFromUrl(fileUrl),
      },
      supportsAllDrives: true,
      fields: 'id',
    })

    return {
      id: res.data.id,
    }
  }

  /**
   * @description Retrieves file content for AI agents to analyze documents, process data, extract information, or use file contents in automated workflows. Perfect for reading text files, JSON data, CSV content, or any other text-based file format for further processing.
   *
   * @route GET /get-file-content
   * @operationName Get File Content
   * @category File Operations
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file | https://www.googleapis.com/auth/drive.meet.readonly | https://www.googleapis.com/auth/drive.metadata | https://www.googleapis.com/auth/drive.metadata.readonly | https://www.googleapis.com/auth/drive.photos.readonly | https://www.googleapis.com/auth/drive.readonly
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"File to read content from. Examples: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'. Works with text files, documents, spreadsheets, and other readable formats."}
   *
   * @returns {Object} Content of the requested file
   * @sampleResult {"content": "Monthly sales report\n\nQ1 Results:\n- Revenue: $125,000\n- Growth: 15%\n- New customers: 47"}
   */
  async getFileContent(fileId) {
    logMessage('[getFileContent] Payload', { fileId })

    assert(fileId, 'File ID must be provided.')

    const drive = this.#initDrive()

    const fileMeta = await drive.files.get({ fileId, supportsAllDrives: true, fields: 'name,mimeType' })
    const { mimeType } = fileMeta.data
    const contentMime = ContentMimeMapper[mimeType]
    logMessage('[getFileContent] contentMime', { contentMime })

    let res

    if (contentMime) {
      res = await drive.files.export({ fileId, mimeType: contentMime }, { responseType: 'text' })
    } else {
      const isTextFile = !!mimeTypes.charset(mimeType)

      if (!isTextFile) {
        throw new Error(
          `Cannot read text content from binary file (MIME type: ${ mimeType }). ` +
          'This file appears to be a binary format (PDF, image, video, etc.). ' +
          'Please use the "Download File" action to download binary files.'
        )
      }

      res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'text' })
    }

    return {
      content: res.data,
    }
  }

  /**
   * @description Retrieves file metadata for AI agents to analyze file properties, check modification dates, get sharing links, or gather file information for processing workflows. Essential for file management automation and content organization.
   *
   * @route GET /get-file-data
   * @operationName Get File Data
   * @category File Operations
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file | https://www.googleapis.com/auth/drive.metadata | https://www.googleapis.com/auth/drive.metadata.readonly | https://www.googleapis.com/auth/drive.readonly
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"File to get metadata from. Examples: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'. Returns file name, creation date, modification date, MIME type, and sharing link."}
   *
   * @returns {Object} The metadata of the requested file.
   * @sampleResult {"modifiedTime": "2025-01-15T14:30:22.497Z","parentFolderId": "1TUk9PVAa2bXxYz3FgHjK","name": "quarterly-report.pdf","createdTime": "2025-01-15T09:15:30.497Z","webViewLink": "https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view?usp=drivesdk","mimeType": "application/pdf","id": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"}
   */
  async getFileData(fileId) {
    logMessage('[getFileData] Payload', { fileId })

    assert(fileId, 'File ID must be provided.')

    const drive = this.#initDrive()

    const res = await drive.files.get({
      fileId,
      supportsAllDrives: true,
      fields: 'mimeType,id,webViewLink,parents,name,createdTime,modifiedTime',
    })

    const { mimeType, id, webViewLink, parents, name, createdTime, modifiedTime } = res.data

    return {
      mimeType,
      id,
      webViewLink,
      parentFolderId: parents?.[0] || null,
      name,
      createdTime,
      modifiedTime,
    }
  }

  /**
   * @description Downloads a file from Google Drive and saves it to the Files.
   *
   * @route POST /download-file
   * @operationName Download File
   * @category File Operations
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file | https://www.googleapis.com/auth/drive.readonly
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The ID of the file to download from Google Drive."}
   * @paramDef {"type":"String","label":"Target Directory","name":"targetDirectory","description":"The directory path in Flowrunner Files where the file will be saved. Example: `/downloads`. Leave blank to save in the root directory."}
   *
   * @returns {Object} Absolute URL of the saved file in the Files.
   * @sampleResult {"url":"https://backendlessappcontent.com/BD0C9B28-3B10-8A75-B871-988A37335001/567388F3-77A2-432F-45AE-E8F73572F2A7/files/downloads/report.pdf"}
   */
  async downloadFile(fileId, targetDirectory) {
    logMessage('[downloadFile] Payload', { fileId, targetDirectory })

    assert(fileId, 'File ID must be provided.')

    const drive = this.#initDrive()

    const fileMeta = await drive.files.get({ fileId, supportsAllDrives: true, fields: 'name,mimeType' })
    const { name, mimeType } = fileMeta.data

    logMessage('[downloadFile] File metadata', { name, mimeType })

    const mime = MimeMapper[mimeType]

    let file

    if (mime) {
      logMessage('[downloadFile] Exporting Google Workspace file', { mimeType, exportAs: mime })
      file = await drive.files.export({ fileId, mimeType: mime }, { responseType: 'arraybuffer' })
    } else {
      logMessage('[downloadFile] Downloading binary file', { mimeType })
      file = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' })
    }

    const { url } = await this.flowrunner.Files.uploadFile(Buffer.from(file.data), {
      filename: name,
      generateUrl: true,
      overwrite: true,
      scope: 'FLOW',
    })

    logMessage('[downloadFile] Saved file URL', { url })

    return {
      url,
    }
  }

  /**
   * @description Locates folders in Google Drive for AI agents to find target directories, verify folder existence, or get folder information for file organization workflows. Perfect for automated systems that need to find specific folders before performing file operations.
   *
   * @route GET /find-folder
   * @operationName Find Folder
   * @category File Search
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file
   *
   * @paramDef {"type":"String","label":"Drive","name":"toSharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Drive to search in. Examples: 'My Drive', 'Company Shared Drive', 'Marketing Team Drive'. Leave blank to search your personal Drive."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Folder name search term. Examples: 'Reports', 'Client Files', 'Archive'. Searches for folders containing this text in their name."}
   *
   * @returns {Object} Folder data object.
   * @sampleResult {"id":"1CLWc-NsjRtYxKmP5QoLf","name":"Monthly Reports","kind":"drive#file","mimeType":"application/vnd.google-apps.folder"}
   */
  async findFolder(sharedDriveId, search) {
    logMessage('[findFolder] Payload', { search, sharedDriveId })

    const queryTokens = [`mimeType = '${ GoogleMimeTypes.FOLDER }'`]

    if (search) {
      queryTokens.push(`name contains '${ search }'`)
    }

    const files = await this.#getFilesList({
      driveId: resolveSharedDriveId(sharedDriveId),
      q: queryTokens.join(' and '),
      pageSize: 1,
    })

    return files[0]
  }

  /**
   * @description Searches for specific files in Google Drive for AI agents to locate documents, verify file existence, or get file details for processing workflows. Essential for automated systems that need to find files by name, type, or location before performing operations.
   *
   * @route GET /find-file
   * @operationName Find File
   * @category File Search
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Drive to search in. Examples: 'My Drive', 'Team Shared Drive', 'Project Drive'. Leave blank to search your personal Drive."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"File name search term. Examples: 'report', 'invoice', 'contract'. Searches for files containing this text in their name."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getFoldersDictionary","description":"Specific folder to search within. Examples: 'Documents', 'Archives', 'Client Files'. Leave blank to search entire Drive."}
   * @paramDef {"type":"String","label":"File Type","name":"fileType","uiComponent":{"type":"DROPDOWN","options":{"values":["image/","video/","audio/","text/","application/pdf","application/vnd.google-apps.document","application/vnd.google-apps.drawing","application/vnd.google-apps.fusiontable","application/vnd.google-apps.presentation","application/vnd.google-apps.spreadsheet"]}},"description":"Filter by file type. Examples: 'application/pdf' for PDFs, 'image/' for images, 'text/' for text files. Leave blank to search all file types."}
   *
   * @returns {Object} A file matching the specified query parameters.
   * @sampleResult {"id":"1LWc-NsjRtYxKmP5QoLf","name":"quarterly-budget.xlsx","mimeType":"application/vnd.ms-excel","kind":"drive#file"}
   */
  async findFile(sharedDriveId, search, folderId, fileType) {
    logMessage('[findFile] Payload', { search, sharedDriveId, folderId, fileType })

    const queryTokens = []

    if (search) {
      queryTokens.push(`name contains '${ search }'`)
    }

    if (folderId) {
      queryTokens.push(`'${ folderId }' in parents`)
    }

    if (fileType) {
      queryTokens.push(`mimeType contains '${ fileType }'`)
    }

    const files = this.#getFilesList({
      driveId: resolveSharedDriveId(sharedDriveId),
      q: queryTokens.length ? queryTokens.join(' and ') : undefined,
      pageSize: 1,
    })

    return files[0]
  }

  /**
   * @description Retrieves a list of files from Google Drive based on the specified criteria.
   *
   * @route GET /find-files
   * @operationName Find Multiple Files
   * @category File Search
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"The ID of the shared drive to search within. Shared Drive formerly known as Team Drive. Uses the logged in account's drive when the parameter is missed."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search term for file names."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getFoldersDictionary","description":"The folder ID where it searches files."}
   * @paramDef {"type":"String","label":"File Type","name":"fileType","uiComponent":{"type":"DROPDOWN","options":{"values":["image/","video/","audio/","text/","application/pdf","application/vnd.google-apps.document","application/vnd.google-apps.drawing","application/vnd.google-apps.fusiontable","application/vnd.google-apps.presentation","application/vnd.google-apps.spreadsheet"]}},"description":"Restrict the search to specific file type."}
   *
   * @returns {Array} A list of files matching the specified query parameters, including file details such as IDs, names, metadata, and file paths.
   * @sampleResult [{"id":"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms","filePath":"My Drive/Documents/quarterly-report.pdf","kind":"drive#file","mimeType":"application/pdf","name":"quarterly-report.pdf","parents":["1TUk9PVAa2bXxYz3FgHjK"]}]
   */
  async findMultipleFiles(sharedDriveId, search, folderId, fileType) {
    logMessage('[findMultipleFiles] Payload', {
      search,
      sharedDriveId,
      folderId,
      fileType,
    })

    const queryTokens = ['trashed = false']

    if (search) {
      queryTokens.push(`name contains '${ search }'`)
    }

    if (folderId) {
      queryTokens.push(`'${ folderId }' in parents`)
    }

    if (fileType) {
      queryTokens.push(`mimeType contains '${ fileType }'`)
    }

    const drive = this.#initDrive()

    const files = await this.#getFilesList({
      driveId: resolveSharedDriveId(sharedDriveId),
      fields: 'files(id,kind,mimeType,name,parents)',
      q: queryTokens.join(' and '),
      pageSize: 1000,
    })

    return Promise.all(
      files.map(async file => {
        const filePath = await this.#buildFilePath(file, drive)

        return {
          ...file,
          filePath,
        }
      })
    )
  }

  /**
   * @description Updates a file or folder name.
   *
   * @route POST /rename-entity
   * @operationName Rename File/Folder
   * @category File Management
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file | https://www.googleapis.com/auth/drive.metadata | https://www.googleapis.com/auth/drive.scripts
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"required":false,"dictionary":"getDrivesDictionary","description":"The ID of the shared drive to search within. Shared Drive formerly known as Team Drive. Uses the logged in account's drive when the parameter is missed."}
   * @paramDef {"type":"String","label":"File or Folder","name":"fileId","required":true,"dictionary":"getFilesAndFoldersDictionary","description":"The ID of the file to update."}
   * @paramDef {"type":"String","label":"New Name","name":"newName","required":true,"description":"The new name of file/folder."}
   */
  async renameEntity(sharedDriveId, fileId, newName) {
    logMessage('[renameEntity] Payload', { sharedDriveId, fileId, newName })

    const drive = this.#initDrive()

    await drive.files.update({
      fileId,
      supportsAllDrives: true,
      requestBody: {
        driveId: resolveSharedDriveId(sharedDriveId),
        name: newName,
      },
    })
  }

  /**
   * @description Permanently deletes a file owned by the user without moving it to the trash. If the file belongs to a shared drive, the user must be an `organizer` on the parent folder. If the target is a folder, all descendants owned by the user are also deleted.
   *
   * @route DELETE /delete-file
   * @operationName Delete File
   * @category File Management
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The ID of the file to be permanently deleted."}
   */
  async deleteFile(fileId) {
    logMessage('[deleteFile] Payload', { fileId })

    const drive = this.#initDrive()

    await drive.files.delete({
      fileId,
      supportsAllDrives: true,
    })
  }

  /**
   * @description Creates a copy of a file in Google Drive.
   * This method creates a copy of an existing file by its file ID. The copied file will be owned by the user who makes the request. If the file belongs to a shared drive, the user must have sufficient permissions to copy the file.
   *
   * @route POST /copy-file
   * @operationName Copy File
   * @category File Management
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file | https://www.googleapis.com/auth/drive.photos.readonly
   *
   * @paramDef {"type":"String","label":"Drive","name":"fromSharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Unique identifier for the drive. Uses the logged in account's drive when the parameter is missed."}
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The ID of the file to be copied."}
   * @paramDef {"type":"String","label":"New Name","name":"newName","description":"The new name for the copy."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getFoldersDictionary","description":"The ID of the folder to place the copy."}
   *
   *
   * @returns {Object} The ID of the newly created file (the copy).
   * @sampleResult {"id":"example_id_klfeyz145"}
   */
  async copyFile(sharedDriveId, fileId, newName, folderId) {
    logMessage('[copyFile] Payload', { fileId, sharedDriveId, folderId, newName })

    const drive = this.#initDrive()

    const res = await drive.files.copy({
      fileId,
      requestBody: {
        driveId: resolveSharedDriveId(sharedDriveId),
        name: newName || undefined,
        parents: folderId ? [folderId] : undefined,
      },
      supportsAllDrives: true,
    })

    return {
      id: res.data.id,
    }
  }

  /**
   * @description Exports a Google Workspace document to the requested MIME type and returns the exported byte content. Note that the exported content is limited to 10MB.
   *
   * @route POST /export-file
   * @operationName Export File
   * @category File Export
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The ID of the file to be exported."}
   * @paramDef {"type":"String","label":"Target File Path","name":"targetFilePath","description":"The path where the exported file will be saved in Flowrunner Files. If it is empty the file will be export to the root folder."}
   * @paramDef {"type":"String","label":"Target File Name","name":"targetFileName","description":"The name to give to the exported file. Defaults to the original file name if not provided."}
   *
   * @returns {Object} File URL in Flowrunner files.
   * @sampleResult {"url":"https://test.comfile/exported-file.pdf"}
   */
  async exportFile(fileId, targetFilePath, targetFileName) {
    logMessage('[exportFile] Payload', { fileId, targetFilePath, targetFileName })

    assert(fileId, 'File ID must be provided.')

    const drive = this.#initDrive()

    const fileMeta = await drive.files.get({ fileId, supportsAllDrives: true, fields: 'name,mimeType' })

    const { name, mimeType } = fileMeta.data

    const mime = MimeMapper[mimeType]

    let file

    if (mime) {
      file = await drive.files.export({ fileId, mimeType: mime }, { responseType: 'arraybuffer' })
    } else {
      file = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' })
    }

    const { url } = await this.flowrunner.Files.uploadFile(Buffer.from(file.data), {
      filename: targetFileName || name,
      generateUrl: true,
      overwrite: true,
      scope: 'FLOW',
    })

    return {
      url,
    }
  }

  /**
   * @description Creates a new folder in Google Drive.
   *
   * @route POST /create-folder
   * @operationName Create Folder
   * @category Folder Operations
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.appdata | https://www.googleapis.com/auth/drive.file
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Unique identifier for the drive. Uses the logged in account's drive when the parameter is missed."}
   * @paramDef {"type":"String","label":"Parent Folder","name":"parentFolderId","dictionary":"getFoldersDictionary","description":"The ID of the parent folder(or Shared Drive ID) where the new folder should be created. If not provided, the folder will be created in the root directory."}
   * @paramDef {"type":"String","label":"Folder Name","name":"name","required":true,"description":"The name of the new folder to be created."}
   *
   * @returns {Object} The ID of the created folder.
   * @sampleResult {"id": "example_id_0APRUk9PVA"}
   */
  async createFolder(sharedDriveId, parentFolderId, name) {
    logMessage('[createFolder] Payload', { sharedDriveId, name, parentFolderId })

    const drive = this.#initDrive()

    const response = await drive.files.create({
      requestBody: {
        driveId: resolveSharedDriveId(sharedDriveId),
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentFolderId ? [parentFolderId] : undefined,
      },
      supportsAllDrives: true,
    })

    return { id: response.data.id }
  }
}

Flowrunner.ServerCode.addService(GoogleDrive, [
  {
    order: 0,
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your OAuth 2.0 Client ID from the Google Cloud Console (APIs & Services > Credentials).',
    shared: true,
  },
  {
    order: 1,
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your OAuth 2.0 Client Secret from the Google Cloud Console (APIs & Services > Credentials).',
    shared: true,
  },
])

function resolveSharedDriveId(id) {
  return (id !== MY_DRIVE_ID && id) || undefined
}
