const crypto = require('crypto')
const https = require('https')

const logger = {
  info: (...args) => console.log('[Azure Blob Storage] info:', ...args),
  debug: (...args) => console.log('[Azure Blob Storage] debug:', ...args),
  error: (...args) => console.log('[Azure Blob Storage] error:', ...args),
  warn: (...args) => console.log('[Azure Blob Storage] warn:', ...args),
}

// REST API version the signature string is built against (2015-02-21+ uses empty Content-Length for zero).
const API_VERSION = '2021-08-06'

/**
 * @usesFileStorage
 * @integrationName Azure Blob Storage
 * @integrationIcon /icon.svg
 */
class AzureBlobStorage {
  constructor(config) {
    this.accountName = (config.accountName || '').trim()
    this.accountKey = (config.accountKey || '').trim()
    this.baseUrl = `https://${ this.accountName }.blob.core.windows.net`
  }

  // ---------------------------------------------------------------------------
  // Shared Key (HMAC-SHA256) request signing — hand-rolled, zero dependencies.
  // See https://learn.microsoft.com/en-us/rest/api/storageservices/authorize-with-shared-key
  // ---------------------------------------------------------------------------

  /**
   * Builds the CanonicalizedHeaders segment: every request header whose name
   * starts with "x-ms-", lowercased, sorted ascending by name, each rendered as
   * "name:value\n" with the value trimmed and internal linear whitespace
   * collapsed to a single space.
   */
  #canonicalizedHeaders(headers) {
    const msHeaders = Object.keys(headers)
      .map(name => ({ name: name.toLowerCase(), value: headers[name] }))
      .filter(h => h.name.startsWith('x-ms-'))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    return msHeaders
      .map(h => `${ h.name }:${ String(h.value).replace(/[\r\n\t ]+/g, ' ').trim() }\n`)
      .join('')
  }

  /**
   * Builds the CanonicalizedResource segment: "/{account}{urlPath}" followed by
   * one "\n{name}:{value}" line per query param, param names lowercased and
   * sorted ascending, multi-valued params joined with commas (values sorted).
   * Names and values are the decoded (raw) forms.
   */
  #canonicalizedResource(urlPath, query) {
    let resource = `/${ this.accountName }${ urlPath }`
    const keys = Object.keys(query || {})

    if (keys.length === 0) return resource

    const lowered = {}

    for (const key of keys) {
      const lowerKey = key.toLowerCase()
      const raw = query[key]
      const values = Array.isArray(raw) ? raw.slice() : [raw]

      lowered[lowerKey] = values.map(v => (v === undefined || v === null ? '' : String(v)))
    }

    const sortedNames = Object.keys(lowered).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    for (const name of sortedNames) {
      const value = lowered[name].sort().join(',')

      resource += `\n${ name }:${ value }`
    }

    return resource
  }

  /**
   * Produces the Authorization header value for a request. The caller passes the
   * verb, the raw (decoded) URL path, the query object, and all request headers
   * (which must already contain x-ms-date and x-ms-version). contentLength is the
   * numeric body byte length ("" is emitted for 0/empty, per API 2015-02-21+).
   */
  #sign(verb, urlPath, query, headers, contentLength, contentType) {
    const lengthField = contentLength ? String(contentLength) : ''
    const stringToSign = [
      verb.toUpperCase(),
      '', // Content-Encoding
      '', // Content-Language
      lengthField, // Content-Length ("" when zero/empty)
      '', // Content-MD5
      contentType || '', // Content-Type
      '', // Date (empty — x-ms-date is used instead)
      '', // If-Modified-Since
      '', // If-Match
      '', // If-None-Match
      '', // If-Unmodified-Since
      '', // Range
      this.#canonicalizedHeaders(headers) + this.#canonicalizedResource(urlPath, query),
    ].join('\n')

    const signature = crypto
      .createHmac('sha256', Buffer.from(this.accountKey, 'base64'))
      .update(stringToSign, 'utf8')
      .digest('base64')

    return `SharedKey ${ this.accountName }:${ signature }`
  }

  // ---------------------------------------------------------------------------
  // Request execution
  // ---------------------------------------------------------------------------

  /**
   * Executes a signed request against the Blob service over Node's native https.
   * A native request is used (rather than Flowrunner.Request) because Azure returns
   * most operation results — ETag, metadata, copy status, snapshot id — in response
   * headers, and the raw transport gives reliable access to status, headers, and the
   * binary body. urlPath is the raw (decoded) path beginning with "/". query is a
   * plain object of query params. body may be a Buffer; extraHeaders carries the
   * per-operation x-ms-* headers. Resolves to { statusCode, headers, body: Buffer }.
   */
  async #request({ verb, urlPath, query, body, contentType, extraHeaders, logTag }) {
    const method = verb.toUpperCase()
    const headers = {
      'x-ms-date': new Date().toUTCString(),
      'x-ms-version': API_VERSION,
      ...(extraHeaders || {}),
    }

    let bodyBuffer

    if (body !== undefined && body !== null) {
      bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8')
    }

    const contentLength = bodyBuffer ? bodyBuffer.length : 0

    if (contentType) headers['Content-Type'] = contentType
    // Always send an explicit Content-Length so the wire length matches the signature.
    headers['Content-Length'] = contentLength

    headers['Authorization'] = this.#sign(method, urlPath, query, headers, contentLength, contentType)

    logger.debug(`${ method }::${ urlPath } - ${ logTag }`)

    const response = await this.#send(method, urlPath, query, headers, bodyBuffer)

    if (response.statusCode >= 300) {
      throw this.#toError(response, logTag)
    }

    return response
  }

  // Issues the actual HTTPS request, collecting the response as a Buffer.
  #send(method, urlPath, query, headers, bodyBuffer) {
    const search = this.#buildQueryString(query)
    const options = {
      hostname: `${ this.accountName }.blob.core.windows.net`,
      port: 443,
      path: `${ this.#encodePath(urlPath) }${ search }`,
      method,
      headers,
    }

    return new Promise((resolve, reject) => {
      const req = https.request(options, res => {
        const chunks = []

        res.on('data', chunk => chunks.push(chunk))
        res.on('error', reject)

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: this.#lowerKeys(res.headers),
            body: Buffer.concat(chunks),
          })
        })
      })

      req.on('error', reject)
      req.setTimeout(60000, () => req.destroy(new Error('Request timed out')))

      if (bodyBuffer) req.write(bodyBuffer)

      req.end()
    })
  }

  // Percent-encodes each path segment while preserving the "/" separators.
  #encodePath(urlPath) {
    return String(urlPath)
      .split('/')
      .map(part => encodeURIComponent(decodeURIComponent(part)))
      .join('/')
  }

  // Builds a "?a=1&b=2" query string with encoded values; returns "" when empty.
  #buildQueryString(query) {
    const keys = Object.keys(query || {}).filter(k => query[k] !== undefined && query[k] !== null && query[k] !== '')

    if (keys.length === 0) return ''

    return '?' + keys.map(k => `${ encodeURIComponent(k) }=${ encodeURIComponent(String(query[k])) }`).join('&')
  }

  /**
   * Normalizes a non-2xx Azure response into a thrown Error. Azure returns an XML
   * <Error><Code>..<Message>.. document plus an HTTP status; both are surfaced.
   * The status code (403 auth, 404 not found, 409 conflict, etc.) is attached to
   * the thrown error as statusCode. HEAD requests carry the error code in the
   * x-ms-error-code header instead of a body.
   */
  #toError(response, logTag) {
    const status = response.statusCode
    const xml = this.#asText(response)
    const code = this.#tagText(xml, 'Code') || (response.headers && response.headers['x-ms-error-code']) || null
    let message = this.#tagText(xml, 'Message')

    if (message && message.includes('\n')) message = message.split('\n')[0].trim()

    const detail = message || code || 'Request failed'
    const prefix = code ? `${ code }: ` : ''
    const suffix = status ? ` (status ${ status })` : ''

    logger.error(`${ logTag } - failed: ${ prefix }${ detail }${ suffix }`)

    const wrapped = new Error(`Azure Blob Storage API error: ${ prefix }${ detail }${ suffix }`)

    wrapped.statusCode = status
    wrapped.code = code

    return wrapped
  }

  // ---------------------------------------------------------------------------
  // Minimal zero-dependency XML helpers
  // ---------------------------------------------------------------------------

  // Returns the inner text of the first <tag>..</tag>, or null when absent.
  #tagText(xml, tag) {
    if (!xml) return null
    const match = xml.match(new RegExp(`<${ tag }(?:\\s[^>]*)?>([\\s\\S]*?)</${ tag }>`))

    return match ? this.#decodeEntities(match[1]) : null
  }

  // Returns the raw inner content (not entity-decoded) of every <tag>..</tag>.
  #tagBlocks(xml, tag) {
    if (!xml) return []
    const re = new RegExp(`<${ tag }(?:\\s[^>]*)?>([\\s\\S]*?)</${ tag }>`, 'g')
    const blocks = []
    let match

    while ((match = re.exec(xml)) !== null) blocks.push(match[1])

    return blocks
  }

  #decodeEntities(value) {
    if (value === null || value === undefined) return value

    return String(value)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
  }

  // Returns the response body decoded as UTF-8 text.
  #asText(response) {
    const body = response && response.body

    if (Buffer.isBuffer(body)) return body.toString('utf8')

    return body ? String(body) : ''
  }

  // Resolves a friendly dropdown label to its API value; passes through unknowns.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ===========================================================================
  // Containers
  // ===========================================================================

  /**
   * @operationName List Containers
   * @description Lists the blob containers in the storage account. Supports an optional name prefix filter, a page size, and a continuation marker for paging through large accounts. Returns each container's name, last-modified time, and lease state, plus a nextMarker to fetch the following page when the result set is truncated.
   * @category Containers
   * @route GET /list-containers
   * @paramDef {"type":"String","label":"Prefix","name":"prefix","required":false,"description":"Return only containers whose name begins with this prefix."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of containers to return per page (1-5000, default 5000)."}
   * @paramDef {"type":"String","label":"Marker","name":"marker","required":false,"description":"Continuation token returned by a previous call to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"containers":[{"name":"documents","lastModified":"Mon, 14 Jul 2025 10:00:00 GMT","leaseState":"available","leaseStatus":"unlocked"}],"nextMarker":""}
   */
  async listContainers(prefix, maxResults, marker) {
    const query = { comp: 'list' }

    if (prefix) query.prefix = prefix
    if (maxResults) query.maxresults = maxResults
    if (marker) query.marker = marker

    const response = await this.#request({
      verb: 'GET',
      urlPath: '/',
      query,
      logTag: 'listContainers',
    })

    const xml = this.#asText(response)
    const containers = this.#tagBlocks(xml, 'Container').map(block => this.#shapeContainer(block))
    const nextMarker = this.#tagText(xml, 'NextMarker') || ''

    return { containers, nextMarker }
  }

  #shapeContainer(block) {
    const props = this.#tagBlocks(block, 'Properties')[0] || block

    return {
      name: this.#tagText(block, 'Name'),
      lastModified: this.#tagText(props, 'Last-Modified'),
      etag: this.#tagText(props, 'Etag'),
      leaseState: this.#tagText(props, 'LeaseState'),
      leaseStatus: this.#tagText(props, 'LeaseStatus'),
      publicAccess: this.#tagText(props, 'PublicAccess'),
    }
  }

  /**
   * @operationName Create Container
   * @description Creates a new container in the storage account under the given name. Optionally sets the anonymous public access level (private, blob-level, or full container-level) and custom metadata name/value pairs. Container names must be lowercase, 3-63 characters, and unique within the account; creating a container that already exists returns a conflict error.
   * @category Containers
   * @route POST /create-container
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"description":"Name of the container to create (lowercase, 3-63 chars)."}
   * @paramDef {"type":"String","label":"Public Access","name":"publicAccess","required":false,"defaultValue":"Private","uiComponent":{"type":"DROPDOWN","options":{"values":["Private","Blob","Container"]}},"description":"Anonymous access level: Private (no anonymous access), Blob (anonymous read of blobs only), or Container (anonymous read of blobs and container listing)."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional custom metadata as name/value string pairs stored on the container."}
   * @returns {Object}
   * @sampleResult {"container":"documents","created":true,"etag":"\"0x8D...\"","lastModified":"Mon, 14 Jul 2025 10:00:00 GMT"}
   */
  async createContainer(container, publicAccess, metadata) {
    const extraHeaders = this.#metadataHeaders(metadata)
    const access = this.#resolveChoice(publicAccess, { Private: undefined, Blob: 'blob', Container: 'container' })

    if (access) extraHeaders['x-ms-blob-public-access'] = access

    const response = await this.#request({
      verb: 'PUT',
      urlPath: `/${ container }`,
      query: { restype: 'container' },
      extraHeaders,
      logTag: 'createContainer',
    })

    const resHeaders = response.headers

    return {
      container,
      created: true,
      etag: resHeaders.etag,
      lastModified: resHeaders['last-modified'],
    }
  }

  /**
   * @operationName Get Container Properties
   * @description Retrieves the system properties and any custom metadata for a container, including its ETag, last-modified time, lease state, and public access level. Use this to confirm a container exists and to inspect its configuration. Returns a 404 error when the container does not exist.
   * @category Containers
   * @route GET /get-container-properties
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"description":"Name of the container to inspect."}
   * @returns {Object}
   * @sampleResult {"container":"documents","etag":"\"0x8D...\"","lastModified":"Mon, 14 Jul 2025 10:00:00 GMT","leaseState":"available","leaseStatus":"unlocked","publicAccess":null,"metadata":{"team":"ops"}}
   */
  async getContainerProperties(container) {
    const response = await this.#request({
      verb: 'HEAD',
      urlPath: `/${ container }`,
      query: { restype: 'container' },
      logTag: 'getContainerProperties',
    })

    const resHeaders = response.headers

    return {
      container,
      etag: resHeaders.etag,
      lastModified: resHeaders['last-modified'],
      leaseState: resHeaders['x-ms-lease-state'],
      leaseStatus: resHeaders['x-ms-lease-status'],
      publicAccess: resHeaders['x-ms-blob-public-access'] || null,
      metadata: this.#extractMetadata(resHeaders),
    }
  }

  /**
   * @operationName Delete Container
   * @description Marks a container and all of the blobs it contains for deletion. The container is immediately made inaccessible and is asynchronously purged by Azure. This operation cannot be undone. Returns a 404 error when the container does not exist.
   * @category Containers
   * @route DELETE /delete-container
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"description":"Name of the container to delete."}
   * @returns {Object}
   * @sampleResult {"container":"documents","deleted":true}
   */
  async deleteContainer(container) {
    await this.#request({
      verb: 'DELETE',
      urlPath: `/${ container }`,
      query: { restype: 'container' },
      logTag: 'deleteContainer',
    })

    return { container, deleted: true }
  }

  /**
   * @operationName List Blobs
   * @description Lists the blobs inside a container, optionally filtered by a name prefix and limited to a page size. Returns each blob's name, size, content type, last-modified time, ETag, and blob type, plus a nextMarker continuation token for paging through large containers. Use the marker parameter to fetch subsequent pages.
   * @category Containers
   * @route GET /list-blobs
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"description":"Name of the container whose blobs are listed."}
   * @paramDef {"type":"String","label":"Prefix","name":"prefix","required":false,"description":"Return only blobs whose name begins with this prefix (useful for virtual folders)."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of blobs to return per page (1-5000, default 5000)."}
   * @paramDef {"type":"String","label":"Marker","name":"marker","required":false,"description":"Continuation token returned by a previous call to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"blobs":[{"name":"reports/q1.pdf","blobType":"BlockBlob","contentType":"application/pdf","contentLength":10240,"lastModified":"Mon, 14 Jul 2025 10:00:00 GMT","etag":"\"0x8D...\""}],"nextMarker":""}
   */
  async listBlobs(container, prefix, maxResults, marker) {
    const query = { restype: 'container', comp: 'list' }

    if (prefix) query.prefix = prefix
    if (maxResults) query.maxresults = maxResults
    if (marker) query.marker = marker

    const response = await this.#request({
      verb: 'GET',
      urlPath: `/${ container }`,
      query,
      logTag: 'listBlobs',
    })

    const xml = this.#asText(response)
    const blobs = this.#tagBlocks(xml, 'Blob').map(block => this.#shapeBlob(block))
    const nextMarker = this.#tagText(xml, 'NextMarker') || ''

    return { blobs, nextMarker }
  }

  #shapeBlob(block) {
    const props = this.#tagBlocks(block, 'Properties')[0] || ''
    const length = this.#tagText(props, 'Content-Length')

    return {
      name: this.#tagText(block, 'Name'),
      blobType: this.#tagText(props, 'BlobType'),
      contentType: this.#tagText(props, 'Content-Type'),
      contentLength: length === null ? null : Number(length),
      lastModified: this.#tagText(props, 'Last-Modified'),
      etag: this.#tagText(props, 'Etag'),
      creationTime: this.#tagText(props, 'Creation-Time'),
    }
  }

  // ===========================================================================
  // Blobs
  // ===========================================================================

  /**
   * @operationName Upload Blob
   * @description Uploads a block blob to a container. Provide the content either inline as text or by supplying a source URL, in which case the file at that URL is downloaded and streamed into the blob. Sets the blob's content type and any custom metadata. Overwrites an existing blob of the same name. Suited to files that fit in a single request (up to several hundred MB); very large files should use staged block uploads.
   * @category Blobs
   * @route POST /upload-blob
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"description":"Name of the destination container."}
   * @paramDef {"type":"String","label":"Blob Name","name":"blob","required":true,"description":"Name (path) of the blob to create, e.g. reports/q1.pdf."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Inline text content to upload. Ignored when a Source URL is provided."}
   * @paramDef {"type":"String","label":"Source URL","name":"sourceUrl","required":false,"description":"Public URL of a file to download and upload as the blob contents. Takes precedence over inline Content."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","required":false,"description":"MIME type stored on the blob (default application/octet-stream)."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional custom metadata as name/value string pairs stored on the blob."}
   * @returns {Object}
   * @sampleResult {"container":"documents","blob":"reports/q1.pdf","uploaded":true,"contentLength":10240,"etag":"\"0x8D...\"","lastModified":"Mon, 14 Jul 2025 10:00:00 GMT"}
   */
  async uploadBlob(container, blob, content, sourceUrl, contentType, metadata) {
    let body
    let effectiveType = contentType

    if (sourceUrl) {
      const bytes = await Flowrunner.Request.get(sourceUrl).setEncoding(null)

      body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    } else {
      body = Buffer.from(content === undefined || content === null ? '' : String(content), 'utf8')
      if (!effectiveType) effectiveType = 'text/plain; charset=UTF-8'
    }

    if (!effectiveType) effectiveType = 'application/octet-stream'

    const extraHeaders = { 'x-ms-blob-type': 'BlockBlob', ...this.#metadataHeaders(metadata) }

    const response = await this.#request({
      verb: 'PUT',
      urlPath: `/${ container }/${ blob }`,
      query: {},
      body,
      contentType: effectiveType,
      extraHeaders,
      logTag: 'uploadBlob',
    })

    const resHeaders = response.headers

    return {
      container,
      blob,
      uploaded: true,
      contentLength: body.length,
      etag: resHeaders.etag,
      lastModified: resHeaders['last-modified'],
    }
  }

  /**
   * @operationName Get Blob
   * @description Downloads a blob's binary contents and stores the file in FlowRunner file storage, returning a URL that downstream steps can use. Use this to bring an Azure blob into a FlowRunner flow (for example to attach, forward, or process it). The file scope can be controlled via File Settings. Returns a 404 error when the blob does not exist.
   * @category Blobs
   * @route POST /get-blob
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"description":"Name of the container holding the blob."}
   * @paramDef {"type":"String","label":"Blob Name","name":"blob","required":true,"description":"Name (path) of the blob to download."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope","filename"]}
   * @returns {Object}
   * @sampleResult {"container":"documents","blob":"reports/q1.pdf","url":"https://files.flowrunner.io/.../q1.pdf","contentType":"application/pdf","contentLength":10240}
   */
  async getBlob(container, blob, fileOptions) {
    const response = await this.#request({
      verb: 'GET',
      urlPath: `/${ container }/${ blob }`,
      query: {},
      logTag: 'getBlob',
    })

    const bytes = response.body
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '')
    const resHeaders = response.headers
    const contentType = resHeaders['content-type'] || 'application/octet-stream'
    const defaultName = blob.split('/').pop() || `blob_${ Date.now() }`

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: defaultName,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      container,
      blob,
      url,
      contentType,
      contentLength: buffer.length,
    }
  }

  /**
   * @operationName Get Blob Properties
   * @description Retrieves the system properties and custom metadata for a blob without downloading its contents, including content type, size, ETag, last-modified time, blob type, and lease state. Use this to inspect a blob before deciding whether to download it. Returns a 404 error when the blob does not exist.
   * @category Blobs
   * @route GET /get-blob-properties
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"description":"Name of the container holding the blob."}
   * @paramDef {"type":"String","label":"Blob Name","name":"blob","required":true,"description":"Name (path) of the blob to inspect."}
   * @returns {Object}
   * @sampleResult {"container":"documents","blob":"reports/q1.pdf","contentType":"application/pdf","contentLength":10240,"etag":"\"0x8D...\"","lastModified":"Mon, 14 Jul 2025 10:00:00 GMT","blobType":"BlockBlob","metadata":{"team":"ops"}}
   */
  async getBlobProperties(container, blob) {
    const response = await this.#request({
      verb: 'HEAD',
      urlPath: `/${ container }/${ blob }`,
      query: {},
      logTag: 'getBlobProperties',
    })

    const resHeaders = response.headers
    const length = resHeaders['content-length']

    return {
      container,
      blob,
      contentType: resHeaders['content-type'],
      contentLength: length === undefined ? null : Number(length),
      etag: resHeaders.etag,
      lastModified: resHeaders['last-modified'],
      blobType: resHeaders['x-ms-blob-type'],
      leaseState: resHeaders['x-ms-lease-state'],
      metadata: this.#extractMetadata(resHeaders),
    }
  }

  /**
   * @operationName Delete Blob
   * @description Deletes a blob from a container. By default the blob and its snapshots are removed. This operation marks the blob for immediate deletion; if soft-delete is enabled on the account the blob is retained for the configured retention period before being permanently purged. Returns a 404 error when the blob does not exist.
   * @category Blobs
   * @route DELETE /delete-blob
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"description":"Name of the container holding the blob."}
   * @paramDef {"type":"String","label":"Blob Name","name":"blob","required":true,"description":"Name (path) of the blob to delete."}
   * @returns {Object}
   * @sampleResult {"container":"documents","blob":"reports/q1.pdf","deleted":true}
   */
  async deleteBlob(container, blob) {
    await this.#request({
      verb: 'DELETE',
      urlPath: `/${ container }/${ blob }`,
      query: {},
      extraHeaders: { 'x-ms-delete-snapshots': 'include' },
      logTag: 'deleteBlob',
    })

    return { container, blob, deleted: true }
  }

  /**
   * @operationName Copy Blob
   * @description Copies a blob into the destination container from a source URL that points to another Azure blob (or any accessible URL). The copy runs server-side and is asynchronous; the returned copy status is typically "success" for small blobs or "pending" for larger ones. The source must be publicly accessible or reachable by the storage account.
   * @category Blobs
   * @route POST /copy-blob
   * @paramDef {"type":"String","label":"Destination Container","name":"container","required":true,"description":"Name of the container to copy the blob into."}
   * @paramDef {"type":"String","label":"Destination Blob Name","name":"blob","required":true,"description":"Name (path) of the new blob to create."}
   * @paramDef {"type":"String","label":"Source URL","name":"sourceUrl","required":true,"description":"Full URL of the source blob to copy from, e.g. https://acct.blob.core.windows.net/src/file.pdf."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional custom metadata to apply to the destination blob instead of copying the source metadata."}
   * @returns {Object}
   * @sampleResult {"container":"documents","blob":"reports/copy.pdf","copyStatus":"success","copyId":"1f3b...","etag":"\"0x8D...\"","lastModified":"Mon, 14 Jul 2025 10:00:00 GMT"}
   */
  async copyBlob(container, blob, sourceUrl, metadata) {
    const extraHeaders = { 'x-ms-copy-source': sourceUrl, ...this.#metadataHeaders(metadata) }

    const response = await this.#request({
      verb: 'PUT',
      urlPath: `/${ container }/${ blob }`,
      query: {},
      extraHeaders,
      logTag: 'copyBlob',
    })

    const resHeaders = response.headers

    return {
      container,
      blob,
      copyStatus: resHeaders['x-ms-copy-status'],
      copyId: resHeaders['x-ms-copy-id'],
      etag: resHeaders.etag,
      lastModified: resHeaders['last-modified'],
    }
  }

  /**
   * @operationName Set Blob Metadata
   * @description Replaces all custom metadata on an existing blob with the supplied name/value pairs. Any metadata not included in the call is removed. Metadata names must be valid HTTP header identifiers. Returns a 404 error when the blob does not exist.
   * @category Blobs
   * @route POST /set-blob-metadata
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"description":"Name of the container holding the blob."}
   * @paramDef {"type":"String","label":"Blob Name","name":"blob","required":true,"description":"Name (path) of the blob to update."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":true,"description":"Custom metadata as name/value string pairs. Replaces all existing metadata on the blob."}
   * @returns {Object}
   * @sampleResult {"container":"documents","blob":"reports/q1.pdf","updated":true,"etag":"\"0x8D...\"","lastModified":"Mon, 14 Jul 2025 10:00:00 GMT"}
   */
  async setBlobMetadata(container, blob, metadata) {
    const response = await this.#request({
      verb: 'PUT',
      urlPath: `/${ container }/${ blob }`,
      query: { comp: 'metadata' },
      extraHeaders: this.#metadataHeaders(metadata),
      logTag: 'setBlobMetadata',
    })

    const resHeaders = response.headers

    return {
      container,
      blob,
      updated: true,
      etag: resHeaders.etag,
      lastModified: resHeaders['last-modified'],
    }
  }

  /**
   * @operationName Get Blob Metadata
   * @description Retrieves only the custom metadata name/value pairs stored on a blob, without its contents or full system properties. Use this for a lightweight read of user-defined tags on a blob. Returns a 404 error when the blob does not exist.
   * @category Blobs
   * @route GET /get-blob-metadata
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"description":"Name of the container holding the blob."}
   * @paramDef {"type":"String","label":"Blob Name","name":"blob","required":true,"description":"Name (path) of the blob to read metadata from."}
   * @returns {Object}
   * @sampleResult {"container":"documents","blob":"reports/q1.pdf","metadata":{"team":"ops","reviewed":"true"}}
   */
  async getBlobMetadata(container, blob) {
    const response = await this.#request({
      verb: 'HEAD',
      urlPath: `/${ container }/${ blob }`,
      query: { comp: 'metadata' },
      logTag: 'getBlobMetadata',
    })

    const resHeaders = response.headers

    return { container, blob, metadata: this.#extractMetadata(resHeaders) }
  }

  /**
   * @operationName Snapshot Blob
   * @description Creates a read-only, point-in-time snapshot of a blob. Snapshots let you preserve a version of the blob before modifying or deleting it, and are addressed by the returned snapshot timestamp appended as a query parameter. Snapshots share storage with the base blob until they diverge. Returns a 404 error when the blob does not exist.
   * @category Blobs
   * @route POST /snapshot-blob
   * @paramDef {"type":"String","label":"Container","name":"container","required":true,"description":"Name of the container holding the blob."}
   * @paramDef {"type":"String","label":"Blob Name","name":"blob","required":true,"description":"Name (path) of the blob to snapshot."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional custom metadata to attach to the snapshot instead of copying the base blob's metadata."}
   * @returns {Object}
   * @sampleResult {"container":"documents","blob":"reports/q1.pdf","snapshot":"2025-07-14T10:00:00.0000000Z","etag":"\"0x8D...\"","lastModified":"Mon, 14 Jul 2025 10:00:00 GMT"}
   */
  async snapshotBlob(container, blob, metadata) {
    const response = await this.#request({
      verb: 'PUT',
      urlPath: `/${ container }/${ blob }`,
      query: { comp: 'snapshot' },
      extraHeaders: this.#metadataHeaders(metadata),
      logTag: 'snapshotBlob',
    })

    const resHeaders = response.headers

    return {
      container,
      blob,
      snapshot: resHeaders['x-ms-snapshot'],
      etag: resHeaders.etag,
      lastModified: resHeaders['last-modified'],
    }
  }

  // ===========================================================================
  // Dictionaries
  // ===========================================================================

  /**
   * @typedef {Object} getContainersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional prefix filter applied to container names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Continuation token from a previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Containers Dictionary
   * @description Lists blob containers for selection in dependent parameters, with optional prefix search and pagination.
   * @category Containers
   * @route POST /get-containers-dictionary
   * @paramDef {"type":"getContainersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"documents","value":"documents","note":"Container"}],"cursor":""}
   */
  async getContainersDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { comp: 'list', maxresults: 100 }

    if (search) query.prefix = search
    if (cursor) query.marker = cursor

    const response = await this.#request({
      verb: 'GET',
      urlPath: '/',
      query,
      logTag: 'getContainersDictionary',
    })

    const xml = this.#asText(response)
    const items = this.#tagBlocks(xml, 'Container').map(block => {
      const name = this.#tagText(block, 'Name')

      return { label: name, value: name, note: 'Container' }
    })
    const nextMarker = this.#tagText(xml, 'NextMarker') || ''

    return { items, cursor: nextMarker }
  }

  // ===========================================================================
  // Shared helpers for metadata + response header extraction
  // ===========================================================================

  // Converts a { name: value } metadata object into x-ms-meta-{name} headers.
  #metadataHeaders(metadata) {
    const headers = {}

    if (metadata && typeof metadata === 'object') {
      for (const key of Object.keys(metadata)) {
        const value = metadata[key]

        if (value !== undefined && value !== null) {
          headers[`x-ms-meta-${ key }`] = String(value)
        }
      }
    }

    return headers
  }

  // Collects x-ms-meta-* response headers back into a { name: value } object.
  #extractMetadata(resHeaders) {
    const metadata = {}

    for (const key of Object.keys(resHeaders || {})) {
      const lower = key.toLowerCase()

      if (lower.startsWith('x-ms-meta-')) {
        metadata[lower.slice('x-ms-meta-'.length)] = resHeaders[key]
      }
    }

    return metadata
  }

  #lowerKeys(obj) {
    const out = {}

    for (const key of Object.keys(obj || {})) out[key.toLowerCase()] = obj[key]

    return out
  }
}

Flowrunner.ServerCode.addService(AzureBlobStorage, [
  {
    name: 'accountName',
    displayName: 'Account Name',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Azure Storage account name, e.g. mystorageacct.',
  },
  {
    name: 'accountKey',
    displayName: 'Account Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Azure Portal → Storage account → Security + networking → Access keys → key1 (base64).',
  },
])
