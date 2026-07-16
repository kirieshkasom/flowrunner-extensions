const logger = {
  info: (...args) => console.log('[Nextcloud] info:', ...args),
  debug: (...args) => console.log('[Nextcloud] debug:', ...args),
  error: (...args) => console.log('[Nextcloud] error:', ...args),
  warn: (...args) => console.log('[Nextcloud] warn:', ...args),
}

/**
 * Permission bitmask values for the OCS Share API.
 * 1=read, 2=update, 4=create, 8=delete, 16=share, 31=all.
 */
const PERMISSIONS_MAP = {
  Read: 1,
  Edit: 3,
  'Create Only': 4,
  'Read & Share': 17,
  'All Permissions': 31,
}

const SHARE_TYPE_MAP = {
  User: 0,
  Group: 1,
  'Public Link': 3,
  Email: 4,
}

/**
 * Normalizes a user-supplied remote path into a clean, slash-delimited,
 * percent-encoded WebDAV path segment (without a leading slash).
 */
function normalizePath(path) {
  if (!path) {
    return ''
  }

  return String(path)
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

/**
 * Minimal, zero-dependency extractor for the text content of the first
 * occurrence of an XML tag (namespace-agnostic) within a fragment.
 */
function extractTag(fragment, localName) {
  const match = fragment.match(new RegExp(`<[^>]*?:?${ localName }[^>]*?>([\\s\\S]*?)<\\/[^>]*?:?${ localName }>`, 'i'))

  return match ? match[1].trim() : undefined
}

/**
 * Detects a self-closing or nested tag presence (e.g. <d:collection/>).
 */
function hasTag(fragment, localName) {
  return new RegExp(`<[^>]*?:?${ localName }[^>]*?\\/?>`, 'i').test(fragment)
}

/**
 * Hand-rolled parser for a WebDAV PROPFIND multistatus XML body. Splits the
 * document into <d:response> blocks and reads the common file properties out
 * of each one. Namespace-agnostic so it works regardless of the prefix
 * (d:, D:, or none) that a given Nextcloud instance emits.
 */
function parseMultistatus(xml, basePath) {
  if (!xml || typeof xml !== 'string') {
    return []
  }

  const responseBlocks = xml.match(/<[^>]*?:?response[\s>][\s\S]*?<\/[^>]*?:?response>/gi) || []
  const entries = []

  for (const block of responseBlocks) {
    const rawHref = extractTag(block, 'href')

    if (!rawHref) {
      continue
    }

    let href = rawHref

    try {
      href = decodeURIComponent(rawHref)
    } catch (error) {
      href = rawHref
    }

    // Derive the path relative to the WebDAV files root for this user.
    const marker = basePath
    const idx = href.indexOf(marker)
    const relativePath = idx >= 0 ? href.slice(idx + marker.length).replace(/^\/+/, '').replace(/\/+$/, '') : href
    const resourceType = extractTag(block, 'resourcetype') || ''
    const isFolder = hasTag(resourceType, 'collection')
    const name = relativePath.split('/').filter(Boolean).pop() || ''

    entries.push({
      name,
      path: relativePath,
      href,
      isFolder,
      contentLength: isFolder ? undefined : Number(extractTag(block, 'getcontentlength')) || 0,
      contentType: extractTag(block, 'getcontenttype'),
      lastModified: extractTag(block, 'getlastmodified'),
      etag: extractTag(block, 'getetag'),
    })
  }

  return entries
}

/**
 * @integrationName Nextcloud
 * @integrationIcon /icon.svg
 * @usesFileStorage
 */
class NextcloudService {
  constructor(config) {
    this.serverUrl = (config.serverUrl || '').replace(/\/+$/, '')
    this.username = config.username
    this.appPassword = config.appPassword

    const token = Buffer.from(`${ this.username }:${ this.appPassword }`).toString('base64')

    this.authHeader = `Basic ${ token }`
    this.davRoot = `${ this.serverUrl }/remote.php/dav/files/${ encodeURIComponent(this.username) }`
    this.ocsBase = `${ this.serverUrl }/ocs/v2.php`
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * Executes a WebDAV request. Standard verbs (GET/PUT/DELETE) use the
   * superagent bracket form; custom WebDAV verbs (PROPFIND/MKCOL/MOVE/COPY)
   * use the superagent two-argument functional form Flowrunner.Request(method, url),
   * which accepts any HTTP method string. Binary bodies are sent as-is and,
   * when downloadBinary is set, the response is returned as a Buffer.
   */
  async #davRequest({ method, url, headers, body, downloadBinary, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method }::${ url }]`)

      const upper = method.toUpperCase()
      const standard = ['GET', 'PUT', 'POST', 'DELETE', 'HEAD', 'PATCH']
      const request = standard.includes(upper)
        ? Flowrunner.Request[upper.toLowerCase()](url)
        : Flowrunner.Request(upper, url)

      request.set({ Authorization: this.authHeader, ...(headers || {}) })

      if (downloadBinary) {
        request.setEncoding(null)
      }

      const response = body !== undefined ? await request.send(body) : await request

      return response
    } catch (error) {
      const status = error.status || error.statusCode
      const xmlMessage = typeof error.body === 'string'
        ? extractTag(error.body, 'message') || extractTag(error.body, 'exception')
        : undefined
      const message = xmlMessage || error.body?.message || error.message || 'Unknown WebDAV error'

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`Nextcloud WebDAV error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * Executes an OCS API request, always attaching the mandatory
   * OCS-APIRequest header and format=json query param, then unwrapping the
   * {ocs:{meta,data}} envelope. Accepts statuscode 100 (OCS v1) and 200
   * (OCS v2) as success and throws meta.message otherwise.
   */
  async #ocsRequest({ method = 'get', url, query, body, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          Authorization: this.authHeader,
          'OCS-APIRequest': 'true',
          Accept: 'application/json',
        })
        .query({ format: 'json', ...(query || {}) })

      const response = body !== undefined ? await request.send(body) : await request
      const ocs = response?.ocs || {}
      const meta = ocs.meta || {}

      if (meta.statuscode !== undefined && meta.statuscode !== 100 && meta.statuscode !== 200) {
        throw new Error(`Nextcloud OCS error (${ meta.statuscode }): ${ meta.message || 'Request failed' }`)
      }

      return ocs.data !== undefined ? ocs.data : ocs
    } catch (error) {
      if (error.message && error.message.startsWith('Nextcloud OCS error')) {
        throw error
      }

      const status = error.status || error.statusCode
      const ocsMessage = error.body?.ocs?.meta?.message
      const message = ocsMessage || error.body?.message || error.message || 'Unknown OCS error'

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`Nextcloud OCS error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  #cleanQuery(obj) {
    const result = {}

    for (const key in obj) {
      const value = obj[key]

      if (value !== undefined && value !== null && value !== '') {
        result[key] = value
      }
    }

    return result
  }

  /* ------------------------------------------------------------------ */
  /* Files (WebDAV)                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * @operationName Upload File
   * @category Files
   * @description Uploads a file to Nextcloud via WebDAV. Fetches the binary contents from a publicly accessible source URL and stores them at the given remote path (e.g. "Documents/report.pdf"), overwriting any existing file. Parent folders are created automatically. Returns the stored path and metadata.
   * @route POST /files/upload
   *
   * @paramDef {"type":"String","label":"Source URL","name":"sourceUrl","required":true,"description":"Public URL of the file to fetch and upload."}
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","required":true,"description":"Destination path within the user's Nextcloud files, e.g. Documents/report.pdf. Leading slash optional."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","description":"Optional MIME type to store the file as. If omitted, the source response content type is used."}
   *
   * @returns {Object}
   * @sampleResult {"path":"Documents/report.pdf","name":"report.pdf","size":20841,"contentType":"application/pdf","etag":"\"6a1f...\"","uploaded":true}
   */
  async uploadFile(sourceUrl, remotePath, contentType) {
    const logTag = '[uploadFile]'
    const fetched = await Flowrunner.Request.get(sourceUrl).setEncoding(null)
    const buffer = Buffer.isBuffer(fetched) ? fetched : Buffer.from(fetched)
    const cleanPath = normalizePath(remotePath)
    const url = `${ this.davRoot }/${ cleanPath }`

    await this.#davRequest({
      logTag,
      method: 'PUT',
      url,
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'X-NC-WebDAV-AutoMkcol': 'true',
      },
      body: buffer,
    })

    return {
      path: cleanPath.split('/').map(decodeURIComponent).join('/'),
      name: decodeURIComponent(cleanPath.split('/').pop() || ''),
      size: buffer.length,
      contentType: contentType || undefined,
      uploaded: true,
    }
  }

  /**
   * @operationName Download File
   * @category Files
   * @description Downloads a file from Nextcloud via WebDAV and saves it to FlowRunner file storage, returning a URL to the stored copy. Use this to bring Nextcloud files into a flow for further processing.
   * @route POST /files/download
   *
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","required":true,"description":"Path of the file within the user's Nextcloud files, e.g. Documents/report.pdf."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope","filename"],"description":"Where and how to store the downloaded file in FlowRunner storage."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.io/abc/report.pdf","filename":"report.pdf","path":"Documents/report.pdf","size":20841}
   */
  async downloadFile(remotePath, fileOptions) {
    const logTag = '[downloadFile]'
    const cleanPath = normalizePath(remotePath)
    const url = `${ this.davRoot }/${ cleanPath }`
    const filename = decodeURIComponent(cleanPath.split('/').pop() || `download_${ Date.now() }`)

    const bytes = await this.#davRequest({
      logTag,
      method: 'GET',
      url,
      downloadBinary: true,
    })
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

    const uploaded = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      url: uploaded.url,
      filename,
      path: cleanPath.split('/').map(decodeURIComponent).join('/'),
      size: buffer.length,
    }
  }

  /**
   * @operationName List Folder
   * @category Files
   * @description Lists the immediate contents of a Nextcloud folder via a WebDAV PROPFIND (Depth 1). Returns each child file and folder with its name, path, type, size, content type, and last-modified time. Leave the path empty to list the root of the user's files.
   * @route GET /files/list
   *
   * @paramDef {"type":"String","label":"Folder Path","name":"folderPath","description":"Path of the folder to list, e.g. Documents. Leave empty for the files root."}
   *
   * @returns {Object}
   * @sampleResult {"path":"Documents","count":2,"entries":[{"name":"report.pdf","path":"Documents/report.pdf","isFolder":false,"contentLength":20841,"contentType":"application/pdf","lastModified":"Mon, 14 Jul 2026 09:12:00 GMT","etag":"\"6a1f\""},{"name":"Archive","path":"Documents/Archive","isFolder":true,"lastModified":"Mon, 14 Jul 2026 08:00:00 GMT"}]}
   */
  async listFolder(folderPath) {
    const logTag = '[listFolder]'
    const cleanPath = normalizePath(folderPath)
    const url = cleanPath ? `${ this.davRoot }/${ cleanPath }/` : `${ this.davRoot }/`
    const propfindBody = '<?xml version="1.0"?>' +
      '<d:propfind xmlns:d="DAV:">' +
      '<d:prop>' +
      '<d:resourcetype/><d:getcontentlength/><d:getcontenttype/>' +
      '<d:getlastmodified/><d:getetag/>' +
      '</d:prop>' +
      '</d:propfind>'

    const xml = await this.#davRequest({
      logTag,
      method: 'PROPFIND',
      url,
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      body: propfindBody,
    })

    const basePath = `/remote.php/dav/files/${ encodeURIComponent(this.username) }`
    const requestedRelative = cleanPath.split('/').map(decodeURIComponent).join('/')
    const all = parseMultistatus(typeof xml === 'string' ? xml : String(xml), basePath)
    // Drop the folder itself (PROPFIND returns the target as the first entry).
    const entries = all.filter(entry => entry.path !== requestedRelative)

    return {
      path: requestedRelative,
      count: entries.length,
      entries,
    }
  }

  /**
   * @operationName Create Folder
   * @category Files
   * @description Creates a new folder in Nextcloud via WebDAV (MKCOL). The immediate parent folder must already exist. Returns the created folder path.
   * @route POST /files/create-folder
   *
   * @paramDef {"type":"String","label":"Folder Path","name":"folderPath","required":true,"description":"Path of the folder to create, e.g. Documents/Archive. The parent folder must exist."}
   *
   * @returns {Object}
   * @sampleResult {"path":"Documents/Archive","created":true}
   */
  async createFolder(folderPath) {
    const logTag = '[createFolder]'
    const cleanPath = normalizePath(folderPath)
    const url = `${ this.davRoot }/${ cleanPath }`

    await this.#davRequest({ logTag, method: 'MKCOL', url })

    return {
      path: cleanPath.split('/').map(decodeURIComponent).join('/'),
      created: true,
    }
  }

  /**
   * @operationName Delete
   * @category Files
   * @description Deletes a file or folder in Nextcloud via WebDAV (DELETE). Deleting a folder removes all of its contents recursively. The item is moved to the trash bin per the account's retention settings.
   * @route DELETE /files/delete
   *
   * @paramDef {"type":"String","label":"Path","name":"remotePath","required":true,"description":"Path of the file or folder to delete, e.g. Documents/old.pdf."}
   *
   * @returns {Object}
   * @sampleResult {"path":"Documents/old.pdf","deleted":true}
   */
  async deleteItem(remotePath) {
    const logTag = '[deleteItem]'
    const cleanPath = normalizePath(remotePath)
    const url = `${ this.davRoot }/${ cleanPath }`

    await this.#davRequest({ logTag, method: 'DELETE', url })

    return {
      path: cleanPath.split('/').map(decodeURIComponent).join('/'),
      deleted: true,
    }
  }

  /**
   * @operationName Move
   * @category Files
   * @description Moves or renames a file or folder in Nextcloud via WebDAV (MOVE). Set the destination to the new full path, which also serves to rename the item. By default an existing item at the destination is overwritten.
   * @route POST /files/move
   *
   * @paramDef {"type":"String","label":"Source Path","name":"sourcePath","required":true,"description":"Current path of the file or folder, e.g. Documents/report.pdf."}
   * @paramDef {"type":"String","label":"Destination Path","name":"destinationPath","required":true,"description":"New path for the item, e.g. Archive/report-2026.pdf."}
   * @paramDef {"type":"Boolean","label":"Overwrite","name":"overwrite","uiComponent":{"type":"TOGGLE"},"description":"Whether to overwrite an item already at the destination. Defaults to true."}
   *
   * @returns {Object}
   * @sampleResult {"source":"Documents/report.pdf","destination":"Archive/report-2026.pdf","moved":true}
   */
  async moveItem(sourcePath, destinationPath, overwrite) {
    const logTag = '[moveItem]'
    const source = normalizePath(sourcePath)
    const destination = normalizePath(destinationPath)
    const url = `${ this.davRoot }/${ source }`

    await this.#davRequest({
      logTag,
      method: 'MOVE',
      url,
      headers: {
        Destination: `${ this.davRoot }/${ destination }`,
        Overwrite: overwrite === false ? 'F' : 'T',
      },
    })

    return {
      source: source.split('/').map(decodeURIComponent).join('/'),
      destination: destination.split('/').map(decodeURIComponent).join('/'),
      moved: true,
    }
  }

  /**
   * @operationName Copy
   * @category Files
   * @description Copies a file or folder in Nextcloud via WebDAV (COPY) to a new full path. Copying a folder duplicates its contents recursively. By default an existing item at the destination is overwritten.
   * @route POST /files/copy
   *
   * @paramDef {"type":"String","label":"Source Path","name":"sourcePath","required":true,"description":"Path of the file or folder to copy, e.g. Documents/report.pdf."}
   * @paramDef {"type":"String","label":"Destination Path","name":"destinationPath","required":true,"description":"Path for the copy, e.g. Backups/report.pdf."}
   * @paramDef {"type":"Boolean","label":"Overwrite","name":"overwrite","uiComponent":{"type":"TOGGLE"},"description":"Whether to overwrite an item already at the destination. Defaults to true."}
   *
   * @returns {Object}
   * @sampleResult {"source":"Documents/report.pdf","destination":"Backups/report.pdf","copied":true}
   */
  async copyItem(sourcePath, destinationPath, overwrite) {
    const logTag = '[copyItem]'
    const source = normalizePath(sourcePath)
    const destination = normalizePath(destinationPath)
    const url = `${ this.davRoot }/${ source }`

    await this.#davRequest({
      logTag,
      method: 'COPY',
      url,
      headers: {
        Destination: `${ this.davRoot }/${ destination }`,
        Overwrite: overwrite === false ? 'F' : 'T',
      },
    })

    return {
      source: source.split('/').map(decodeURIComponent).join('/'),
      destination: destination.split('/').map(decodeURIComponent).join('/'),
      copied: true,
    }
  }

  /* ------------------------------------------------------------------ */
  /* Shares (OCS)                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * @operationName Create Share
   * @category Shares
   * @description Creates a share for a file or folder using the Nextcloud OCS Sharing API. Supports sharing with a user, group, by email, or as a public link. For public links a public URL and token are returned; you can optionally set a password and expiration. Permissions control what recipients may do.
   * @route POST /shares/create
   *
   * @paramDef {"type":"String","label":"Path","name":"path","required":true,"description":"Path of the file or folder to share, relative to the user's files root, e.g. Documents/report.pdf."}
   * @paramDef {"type":"String","label":"Share Type","name":"shareType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["User","Group","Public Link","Email"]}},"description":"Who the item is shared with."}
   * @paramDef {"type":"String","label":"Share With","name":"shareWith","description":"The recipient: a username (User), group id (Group), or email address (Email). Not required for a Public Link."}
   * @paramDef {"type":"String","label":"Permissions","name":"permissions","uiComponent":{"type":"DROPDOWN","options":{"values":["Read","Edit","Create Only","Read & Share","All Permissions"]}},"description":"What the recipient may do. Defaults to Read."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"Optional password to protect a public link or email share."}
   * @paramDef {"type":"String","label":"Expiration Date","name":"expireDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional expiration date (YYYY-MM-DD) after which the share is removed."}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"Optional note shown to the recipient."}
   *
   * @returns {Object}
   * @sampleResult {"id":"42","share_type":3,"path":"/Documents/report.pdf","permissions":1,"url":"https://cloud.example.com/s/abc123XYZ","token":"abc123XYZ","expiration":"2026-08-01 00:00:00"}
   */
  async createShare(path, shareType, shareWith, permissions, password, expireDate, note) {
    const logTag = '[createShare]'
    const body = this.#cleanQuery({
      path: `/${ String(path || '').replace(/^\/+/, '') }`,
      shareType: this.#resolveChoice(shareType, SHARE_TYPE_MAP),
      shareWith,
      permissions: this.#resolveChoice(permissions, PERMISSIONS_MAP),
      password,
      expireDate,
      note,
    })

    return await this.#ocsRequest({
      logTag,
      method: 'post',
      url: `${ this.ocsBase }/apps/files_sharing/api/v1/shares`,
      body,
    })
  }

  /**
   * @operationName List Shares
   * @category Shares
   * @description Lists shares created by the account using the OCS Sharing API. Optionally filter by a specific file or folder path. Returns each share with its id, type, recipient, permissions, and (for public links) URL and token.
   * @route GET /shares/list
   *
   * @paramDef {"type":"String","label":"Path","name":"path","description":"Optional path to list shares for a specific file or folder, e.g. Documents/report.pdf."}
   * @paramDef {"type":"Boolean","label":"Include Reshares","name":"reshares","uiComponent":{"type":"TOGGLE"},"description":"Also return shares created by other users that reshare this item."}
   * @paramDef {"type":"Boolean","label":"Subfiles","name":"subfiles","uiComponent":{"type":"TOGGLE"},"description":"When the path is a folder, return shares of items inside it instead of the folder itself."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"42","share_type":3,"path":"/Documents/report.pdf","permissions":1,"url":"https://cloud.example.com/s/abc123XYZ","token":"abc123XYZ"}]
   */
  async listShares(path, reshares, subfiles) {
    const logTag = '[listShares]'
    const query = this.#cleanQuery({
      path: path ? `/${ String(path).replace(/^\/+/, '') }` : undefined,
      reshares: reshares === true ? 'true' : undefined,
      subfiles: subfiles === true ? 'true' : undefined,
    })

    return await this.#ocsRequest({
      logTag,
      method: 'get',
      url: `${ this.ocsBase }/apps/files_sharing/api/v1/shares`,
      query,
    })
  }

  /**
   * @operationName Get Share
   * @category Shares
   * @description Retrieves the details of a single share by its numeric share id using the OCS Sharing API.
   * @route GET /shares/get
   *
   * @paramDef {"type":"String","label":"Share ID","name":"shareId","required":true,"description":"Numeric id of the share to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"42","share_type":3,"path":"/Documents/report.pdf","permissions":1,"url":"https://cloud.example.com/s/abc123XYZ","token":"abc123XYZ"}
   */
  async getShare(shareId) {
    const logTag = '[getShare]'
    const data = await this.#ocsRequest({
      logTag,
      method: 'get',
      url: `${ this.ocsBase }/apps/files_sharing/api/v1/shares/${ encodeURIComponent(shareId) }`,
    })

    // A single-share lookup is returned as a one-element array.
    return Array.isArray(data) ? data[0] : data
  }

  /**
   * @operationName Update Share
   * @category Shares
   * @description Updates an existing share by id using the OCS Sharing API. You can change permissions, set or clear a password, set an expiration date, or update the note. Only the fields you provide are changed.
   * @route PUT /shares/update
   *
   * @paramDef {"type":"String","label":"Share ID","name":"shareId","required":true,"description":"Numeric id of the share to update."}
   * @paramDef {"type":"String","label":"Permissions","name":"permissions","uiComponent":{"type":"DROPDOWN","options":{"values":["Read","Edit","Create Only","Read & Share","All Permissions"]}},"description":"New permissions for the recipient."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"New password for a public link or email share. Leave empty to keep unchanged."}
   * @paramDef {"type":"String","label":"Expiration Date","name":"expireDate","uiComponent":{"type":"DATE_PICKER"},"description":"New expiration date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"New note shown to the recipient."}
   *
   * @returns {Object}
   * @sampleResult {"id":"42","share_type":3,"path":"/Documents/report.pdf","permissions":3,"url":"https://cloud.example.com/s/abc123XYZ","token":"abc123XYZ"}
   */
  async updateShare(shareId, permissions, password, expireDate, note) {
    const logTag = '[updateShare]'
    const body = this.#cleanQuery({
      permissions: this.#resolveChoice(permissions, PERMISSIONS_MAP),
      password,
      expireDate,
      note,
    })

    return await this.#ocsRequest({
      logTag,
      method: 'put',
      url: `${ this.ocsBase }/apps/files_sharing/api/v1/shares/${ encodeURIComponent(shareId) }`,
      body,
    })
  }

  /**
   * @operationName Delete Share
   * @category Shares
   * @description Removes a share by its numeric id using the OCS Sharing API. This revokes access for the recipient; the underlying file or folder is not deleted.
   * @route DELETE /shares/delete
   *
   * @paramDef {"type":"String","label":"Share ID","name":"shareId","required":true,"description":"Numeric id of the share to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"42","deleted":true}
   */
  async deleteShare(shareId) {
    const logTag = '[deleteShare]'

    await this.#ocsRequest({
      logTag,
      method: 'delete',
      url: `${ this.ocsBase }/apps/files_sharing/api/v1/shares/${ encodeURIComponent(shareId) }`,
    })

    return { id: String(shareId), deleted: true }
  }

  /* ------------------------------------------------------------------ */
  /* Users (OCS provisioning)                                           */
  /* ------------------------------------------------------------------ */

  /**
   * @operationName Get Current User
   * @category Users
   * @description Returns the profile of the authenticated account via the OCS provisioning API. Useful as a connection check to verify the server URL and app password are valid.
   * @route GET /users/current
   *
   * @returns {Object}
   * @sampleResult {"id":"alice","displayname":"Alice Example","email":"alice@example.com","enabled":true,"quota":{"free":10737418240,"used":2841,"total":10737421081}}
   */
  async getCurrentUser() {
    const logTag = '[getCurrentUser]'

    return await this.#ocsRequest({
      logTag,
      method: 'get',
      url: `${ this.ocsBase }/cloud/user`,
    })
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Returns the profile of a specific user by their user id via the OCS provisioning API. Requires the authenticated account to have permission to view the user (e.g. an admin or group subadmin).
   * @route GET /users/get
   *
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The user id (login name) to look up."}
   *
   * @returns {Object}
   * @sampleResult {"id":"bob","displayname":"Bob Example","email":"bob@example.com","enabled":true,"groups":["users"]}
   */
  async getUser(userId) {
    const logTag = '[getUser]'

    return await this.#ocsRequest({
      logTag,
      method: 'get',
      url: `${ this.ocsBase }/cloud/users/${ encodeURIComponent(userId) }`,
    })
  }

  /**
   * @operationName List Users
   * @category Users
   * @description Lists user ids on the Nextcloud instance via the OCS provisioning API, optionally filtered by a search term. Requires the authenticated account to have permission to list users. Supports limit and offset for pagination.
   * @route GET /users/list
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional term to filter users by id or display name."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of user ids to return."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to skip, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"users":["alice","bob","carol"]}
   */
  async listUsers(search, limit, offset) {
    const logTag = '[listUsers]'
    const query = this.#cleanQuery({
      search,
      limit,
      offset,
    })

    return await this.#ocsRequest({
      logTag,
      method: 'get',
      url: `${ this.ocsBase }/cloud/users`,
      query,
    })
  }
}

Flowrunner.ServerCode.addService(NextcloudService, [
  {
    name: 'serverUrl',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Nextcloud URL, e.g. https://cloud.example.com (no trailing slash).',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Nextcloud username.',
  },
  {
    name: 'appPassword',
    displayName: 'App Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Create one in Nextcloud under Settings -> Security -> Devices & sessions -> "Create new app password".',
  },
])
