'use strict'

const crypto = require('node:crypto')

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const TOKEN_LIFETIME_SECONDS = 3600
const TOKEN_REFRESH_MARGIN_MS = 60000

const STORAGE_BASE_URL = 'https://storage.googleapis.com/storage/v1'
const UPLOAD_BASE_URL = 'https://storage.googleapis.com/upload/storage/v1'
const SIGNED_URL_HOST = 'storage.googleapis.com'
const MAX_SIGNED_URL_EXPIRATION_SECONDS = 604800

const STORAGE_CLASS_MAP = {
  'Standard': 'STANDARD',
  'Nearline': 'NEARLINE',
  'Coldline': 'COLDLINE',
  'Archive': 'ARCHIVE',
}

const MIME_TYPES = {
  'txt': 'text/plain',
  'csv': 'text/csv',
  'html': 'text/html',
  'css': 'text/css',
  'js': 'text/javascript',
  'json': 'application/json',
  'xml': 'application/xml',
  'pdf': 'application/pdf',
  'zip': 'application/zip',
  'gz': 'application/gzip',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'svg': 'image/svg+xml',
  'ico': 'image/x-icon',
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'mp4': 'video/mp4',
  'webm': 'video/webm',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ppt': 'application/vnd.ms-powerpoint',
  'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const logger = {
  info: (...args) => console.log('[Google Cloud Storage] info:', ...args),
  debug: (...args) => console.log('[Google Cloud Storage] debug:', ...args),
  error: (...args) => console.log('[Google Cloud Storage] error:', ...args),
  warn: (...args) => console.log('[Google Cloud Storage] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getBucketsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter buckets by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for the next page of results."}
 */

/**
 * @typedef {Object} getObjectsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Bucket","name":"bucket","description":"The bucket whose objects populate the list."}
 * @paramDef {"type":"String","label":"Source Bucket","name":"sourceBucket","description":"Alternative bucket criteria used by the Copy Object action."}
 */

/**
 * @typedef {Object} getObjectsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional name prefix to filter objects (applied as the GCS 'prefix' filter)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for the next page of results."}
 * @paramDef {"type":"getObjectsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The bucket whose objects to list."}
 */

/**
 * @usesFileStorage
 * @integrationName Google Cloud Storage
 * @integrationIcon /icon.svg
 */
class GoogleCloudStorage {
  constructor(config) {
    this.serviceAccountKeyRaw = config.serviceAccountKey
    this.configuredProjectId = config.projectId

    this.accessToken = null
    this.accessTokenExpiresAt = 0
  }

  #getServiceAccountKey() {
    if (this.serviceAccountKey) {
      return this.serviceAccountKey
    }

    if (!this.serviceAccountKeyRaw) {
      throw new Error('Service account key is not configured')
    }

    let key

    try {
      key = JSON.parse(this.serviceAccountKeyRaw)
    } catch (error) {
      throw new Error('Service account key is not valid JSON. Paste the full contents of the JSON key file downloaded from Google Cloud.')
    }

    if (!key.client_email || !key.private_key) {
      throw new Error('Service account key is missing "client_email" or "private_key". Make sure you pasted the complete JSON key file.')
    }

    // Recover real newlines if the key was pasted with escaped "\n" sequences.
    if (!key.private_key.includes('\n')) {
      key.private_key = key.private_key.replace(/\\n/g, '\n')
    }

    this.serviceAccountKey = key

    return key
  }

  #getProjectId() {
    const project = this.configuredProjectId?.trim() || this.#getServiceAccountKey().project_id

    if (!project) {
      throw new Error('Project ID could not be determined. Set the Project ID config item or use a key file containing "project_id".')
    }

    return project
  }

  #base64UrlEncode(input) {
    const base64 = Buffer.isBuffer(input) ? input.toString('base64') : Buffer.from(input).toString('base64')

    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  #buildSignedJwt(key) {
    const nowSeconds = Math.floor(Date.now() / 1000)

    const header = this.#base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = this.#base64UrlEncode(JSON.stringify({
      iss: key.client_email,
      scope: CLOUD_PLATFORM_SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
    }))

    const signingInput = `${ header }.${ claims }`
    const signatureBase64 = crypto.createSign('RSA-SHA256').update(signingInput).sign(key.private_key, 'base64')
    const signature = signatureBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    return `${ signingInput }.${ signature }`
  }

  async #getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.accessToken
    }

    const key = this.#getServiceAccountKey()

    logger.debug(`requesting access token for ${ key.client_email }`)

    let jwt

    try {
      jwt = this.#buildSignedJwt(key)
    } catch (error) {
      throw new Error(`Failed to sign the service account JWT: ${ error.message }. Check that "private_key" in the key file is intact.`)
    }

    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    })

    let response

    try {
      response = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())
    } catch (error) {
      const message = error.body?.error_description || error.body?.error || error.message

      throw new Error(`Failed to obtain an access token from Google: ${ message }`)
    }

    if (!response.access_token) {
      throw new Error('Google token endpoint did not return an access token')
    }

    this.accessToken = response.access_token
    this.accessTokenExpiresAt = Date.now() + (response.expires_in || TOKEN_LIFETIME_SECONDS) * 1000

    return this.accessToken
  }

  #mapApiError(error, logTag) {
    const googleError = error.body?.error
    const reason = googleError?.errors?.[0]?.reason
    const message = googleError?.message || error.body?.message || error.message || 'API request failed'

    logger.error(`${ logTag } - error: ${ message }${ reason ? ` (reason: ${ reason })` : '' }`)

    return new Error(`Google Cloud Storage API error: ${ message }${ reason ? ` (reason: ${ reason })` : '' }`)
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    const accessToken = await this.#getAccessToken()

    try {
      logger.debug(`${ logTag } - api request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method](url)
        .set({ 'Authorization': `Bearer ${ accessToken }`, 'Content-Type': 'application/json' })
        .query(this.#compactObject(query))

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      throw this.#mapApiError(error, logTag)
    }
  }

  async #downloadBytes({ url, headers, query, logTag }) {
    try {
      logger.debug(`${ logTag } - binary download: [GET::${ url }]`)

      const bytes = await Flowrunner.Request.get(url)
        .set(headers || {})
        .query(this.#compactObject(query))
        .setEncoding(null)

      return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    } catch (error) {
      throw this.#mapApiError(error, logTag)
    }
  }

  #compactObject(object) {
    const result = {}

    for (const [key, value] of Object.entries(object || {})) {
      if (value !== undefined && value !== null && value !== '') {
        result[key] = value
      }
    }

    return result
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #trimBucket(bucket) {
    return {
      name: bucket.name || null,
      location: bucket.location || null,
      locationType: bucket.locationType || null,
      storageClass: bucket.storageClass || null,
      timeCreated: bucket.timeCreated || null,
      updated: bucket.updated || null,
      versioningEnabled: bucket.versioning?.enabled ?? false,
      labels: bucket.labels || {},
      selfLink: bucket.selfLink || null,
    }
  }

  #trimObject(object) {
    return {
      name: object.name || null,
      bucket: object.bucket || null,
      size: object.size !== undefined ? Number(object.size) : null,
      contentType: object.contentType || null,
      storageClass: object.storageClass || null,
      timeCreated: object.timeCreated || null,
      updated: object.updated || null,
      generation: object.generation || null,
      md5Hash: object.md5Hash || null,
      crc32c: object.crc32c || null,
      etag: object.etag || null,
      cacheControl: object.cacheControl || null,
      contentEncoding: object.contentEncoding || null,
      metadata: object.metadata || {},
      mediaLink: object.mediaLink || null,
    }
  }

  #inferContentType(name) {
    const extension = (name || '').split('.').pop().toLowerCase()

    return MIME_TYPES[extension] || 'application/octet-stream'
  }

  // Percent-encode per RFC 3986: everything except A-Z a-z 0-9 - _ . ~
  #rfc3986Encode(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${ char.charCodeAt(0).toString(16).toUpperCase() }`)
  }

  #objectUrl(bucket, objectName) {
    return `${ STORAGE_BASE_URL }/b/${ encodeURIComponent(bucket) }/o/${ encodeURIComponent(objectName) }`
  }

  // ==========================================================================
  //  BUCKETS
  // ==========================================================================

  /**
   * @operationName List Buckets
   * @category Buckets
   * @description Lists the buckets in the project, returning each bucket's name, location, storage class, and timestamps. Supports filtering by name prefix and pagination for projects with many buckets.
   * @route GET /list-buckets
   *
   * @paramDef {"type":"String","label":"Name Prefix","name":"prefix","description":"Only return buckets whose names begin with this prefix."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of buckets to return in this page (default 1000)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous 'List Buckets' call to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"buckets":[{"name":"my-app-assets","location":"US","locationType":"multi-region","storageClass":"STANDARD","timeCreated":"2026-01-15T10:00:00.000Z","updated":"2026-01-15T10:00:00.000Z","versioningEnabled":false,"labels":{},"selfLink":"https://www.googleapis.com/storage/v1/b/my-app-assets"}],"pageToken":null}
   */
  async listBuckets(prefix, maxResults, pageToken) {
    const response = await this.#apiRequest({
      url: `${ STORAGE_BASE_URL }/b`,
      query: { project: this.#getProjectId(), prefix, maxResults, pageToken },
      logTag: 'listBuckets',
    })

    return {
      buckets: (response.items || []).map(bucket => this.#trimBucket(bucket)),
      pageToken: response.nextPageToken || null,
    }
  }

  /**
   * @operationName Get Bucket
   * @category Buckets
   * @description Retrieves a bucket's metadata: location, storage class, versioning state, labels, and timestamps. Does not list the bucket's objects — use 'List Objects' for that.
   * @route GET /get-bucket
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucket","required":true,"dictionary":"getBucketsDictionary","description":"The bucket to inspect."}
   *
   * @returns {Object}
   * @sampleResult {"name":"my-app-assets","location":"US","locationType":"multi-region","storageClass":"STANDARD","timeCreated":"2026-01-15T10:00:00.000Z","updated":"2026-01-15T10:00:00.000Z","versioningEnabled":false,"labels":{"env":"prod"},"selfLink":"https://www.googleapis.com/storage/v1/b/my-app-assets"}
   */
  async getBucket(bucket) {
    const response = await this.#apiRequest({
      url: `${ STORAGE_BASE_URL }/b/${ encodeURIComponent(bucket) }`,
      logTag: 'getBucket',
    })

    return this.#trimBucket(response)
  }

  /**
   * @operationName Create Bucket
   * @category Buckets
   * @description Creates a new bucket in the project. Bucket names are GLOBALLY unique across all of Google Cloud, must be 3-63 characters of lowercase letters, numbers, hyphens, and underscores, and cannot be changed later. The location (e.g. 'US', 'EU', or a region like 'us-central1') is fixed at creation time. The default storage class applies to objects that do not specify their own.
   * @route POST /create-bucket
   *
   * @paramDef {"type":"String","label":"Bucket Name","name":"name","required":true,"description":"Globally unique name for the new bucket, e.g. 'my-app-assets'. Lowercase letters, numbers, hyphens, and underscores only."}
   * @paramDef {"type":"String","label":"Location","name":"location","description":"Geographic location for the bucket's data, e.g. 'US', 'EU', or a region like 'us-central1'. Defaults to 'US'. Cannot be changed after creation."}
   * @paramDef {"type":"String","label":"Storage Class","name":"storageClass","defaultValue":"Standard","uiComponent":{"type":"DROPDOWN","options":{"values":["Standard","Nearline","Coldline","Archive"]}},"description":"Default storage class for objects in the bucket. 'Standard' for frequently accessed data, 'Nearline' for data accessed less than once a month, 'Coldline' less than once a quarter, 'Archive' less than once a year."}
   *
   * @returns {Object}
   * @sampleResult {"name":"my-app-assets","location":"US","locationType":"multi-region","storageClass":"STANDARD","timeCreated":"2026-01-15T10:00:00.000Z","updated":"2026-01-15T10:00:00.000Z","versioningEnabled":false,"labels":{},"selfLink":"https://www.googleapis.com/storage/v1/b/my-app-assets"}
   */
  async createBucket(name, location, storageClass) {
    const body = this.#compactObject({
      name,
      location: location || undefined,
      storageClass: this.#resolveChoice(storageClass, STORAGE_CLASS_MAP),
    })

    const response = await this.#apiRequest({
      url: `${ STORAGE_BASE_URL }/b`,
      method: 'post',
      body,
      query: { project: this.#getProjectId() },
      logTag: 'createBucket',
    })

    return this.#trimBucket(response)
  }

  /**
   * @operationName Delete Bucket
   * @category Buckets
   * @description Permanently deletes an EMPTY bucket. THIS CANNOT BE UNDONE. The request fails if the bucket still contains objects — delete them first with 'Delete Object' or 'List Objects' + iteration.
   * @route DELETE /delete-bucket
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucket","required":true,"dictionary":"getBucketsDictionary","description":"The empty bucket to delete permanently."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"bucket":"my-app-assets"}
   */
  async deleteBucket(bucket) {
    await this.#apiRequest({
      url: `${ STORAGE_BASE_URL }/b/${ encodeURIComponent(bucket) }`,
      method: 'delete',
      logTag: 'deleteBucket',
    })

    return { success: true, bucket }
  }

  // ==========================================================================
  //  OBJECTS
  // ==========================================================================

  /**
   * @operationName List Objects
   * @category Objects
   * @description Lists the objects in a bucket, returning each object's name, size, content type, and timestamps. Supports filtering by name prefix and folder-style browsing: set Delimiter to '/' to list only the objects and 'subfolders' (returned in prefixes) directly under the given prefix. Paginated via pageToken.
   * @route GET /list-objects
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucket","required":true,"dictionary":"getBucketsDictionary","description":"The bucket whose objects to list."}
   * @paramDef {"type":"String","label":"Prefix","name":"prefix","description":"Only return objects whose names begin with this prefix, e.g. 'reports/2026/'."}
   * @paramDef {"type":"String","label":"Delimiter","name":"delimiter","description":"Folder-style grouping character, usually '/'. Object names containing the delimiter after the prefix are rolled up into the 'prefixes' list instead of being returned individually."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of objects to return in this page (default 1000)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous 'List Objects' call to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"objects":[{"name":"reports/2026/summary.pdf","bucket":"my-app-assets","size":204800,"contentType":"application/pdf","storageClass":"STANDARD","timeCreated":"2026-02-01T09:30:00.000Z","updated":"2026-02-01T09:30:00.000Z","generation":"1738402200000000","md5Hash":"XrY7u+Ae7tCTyyK7j1rNww==","crc32c":"AAAAAA==","etag":"CJDs0uOr5\/8CEAE=","cacheControl":null,"contentEncoding":null,"metadata":{},"mediaLink":"https://storage.googleapis.com/download/storage/v1/b/my-app-assets/o/reports%2F2026%2Fsummary.pdf?generation=1738402200000000&alt=media"}],"prefixes":["reports/2026/archive/"],"pageToken":null}
   */
  async listObjects(bucket, prefix, delimiter, maxResults, pageToken) {
    const response = await this.#apiRequest({
      url: `${ STORAGE_BASE_URL }/b/${ encodeURIComponent(bucket) }/o`,
      query: { prefix, delimiter, maxResults, pageToken },
      logTag: 'listObjects',
    })

    return {
      objects: (response.items || []).map(object => this.#trimObject(object)),
      prefixes: response.prefixes || [],
      pageToken: response.nextPageToken || null,
    }
  }

  /**
   * @operationName Get Object Metadata
   * @category Objects
   * @description Retrieves an object's metadata: size, content type, storage class, MD5/CRC32C checksums, cache control, custom metadata, and timestamps. Does not download the object's data — use 'Download Object' for that.
   * @route GET /get-object-metadata
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucket","required":true,"dictionary":"getBucketsDictionary","description":"The bucket containing the object."}
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getObjectsDictionary","dependsOn":["bucket"],"description":"Full name (path) of the object, e.g. 'reports/2026/summary.pdf'. Choose a bucket above to pick from its objects."}
   *
   * @returns {Object}
   * @sampleResult {"name":"reports/2026/summary.pdf","bucket":"my-app-assets","size":204800,"contentType":"application/pdf","storageClass":"STANDARD","timeCreated":"2026-02-01T09:30:00.000Z","updated":"2026-02-01T09:30:00.000Z","generation":"1738402200000000","md5Hash":"XrY7u+Ae7tCTyyK7j1rNww==","crc32c":"AAAAAA==","etag":"CJDs0uOr5\/8CEAE=","cacheControl":"public, max-age=3600","contentEncoding":null,"metadata":{"source":"invoicing"},"mediaLink":"https://storage.googleapis.com/download/storage/v1/b/my-app-assets/o/reports%2F2026%2Fsummary.pdf?generation=1738402200000000&alt=media"}
   */
  async getObjectMetadata(bucket, objectName) {
    const response = await this.#apiRequest({
      url: this.#objectUrl(bucket, objectName),
      logTag: 'getObjectMetadata',
    })

    return this.#trimObject(response)
  }

  /**
   * @operationName Download Object
   * @category Objects
   * @description Downloads an object's data from Cloud Storage and saves it to FlowRunner file storage, returning a URL for use in subsequent flow steps. The file name defaults to the last path segment of the object name. Best suited for files up to a few hundred MB.
   * @route POST /download-object
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucket","required":true,"dictionary":"getBucketsDictionary","description":"The bucket containing the object."}
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getObjectsDictionary","dependsOn":["bucket"],"description":"Full name (path) of the object to download, e.g. 'reports/2026/summary.pdf'. Choose a bucket above to pick from its objects."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope","filename"],"description":"Where to store the downloaded file in FlowRunner and under what name."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.com/files/flow/summary.pdf","fileName":"summary.pdf","size":204800,"contentType":"application/pdf","bucket":"my-app-assets","objectName":"reports/2026/summary.pdf"}
   */
  async downloadObject(bucket, objectName, fileOptions) {
    const metadata = await this.getObjectMetadata(bucket, objectName)

    const accessToken = await this.#getAccessToken()

    const buffer = await this.#downloadBytes({
      url: this.#objectUrl(bucket, objectName),
      headers: { 'Authorization': `Bearer ${ accessToken }` },
      query: { alt: 'media' },
      logTag: 'downloadObject',
    })

    const defaultFileName = objectName.split('/').filter(Boolean).pop() || `object_${ Date.now() }`

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: defaultFileName,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      url,
      fileName: fileOptions?.filename || defaultFileName,
      size: buffer.length,
      contentType: metadata.contentType,
      bucket,
      objectName,
    }
  }

  /**
   * @operationName Upload Object
   * @category Objects
   * @description Uploads a file to a Cloud Storage bucket. The file is fetched from the given URL (a FlowRunner file URL from a previous step, or any publicly accessible external URL) and written to the bucket under the given object name; an existing object with the same name is overwritten. The content type is inferred from the object name's extension unless specified explicitly. Best suited for files up to a few hundred MB.
   * @route POST /upload-object
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucket","required":true,"dictionary":"getBucketsDictionary","description":"The bucket to upload into."}
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"description":"Full name (path) to store the object under, e.g. 'reports/2026/summary.pdf'. Use '/' to organize objects into folder-like prefixes."}
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"URL of the file to upload: a FlowRunner file URL produced by a previous step, or any publicly accessible URL."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","description":"MIME type to store with the object, e.g. 'application/pdf'. Defaults to a type inferred from the object name's extension, or 'application/octet-stream'."}
   *
   * @returns {Object}
   * @sampleResult {"name":"reports/2026/summary.pdf","bucket":"my-app-assets","size":204800,"contentType":"application/pdf","storageClass":"STANDARD","timeCreated":"2026-02-01T09:30:00.000Z","updated":"2026-02-01T09:30:00.000Z","generation":"1738402200000000","md5Hash":"XrY7u+Ae7tCTyyK7j1rNww==","crc32c":"AAAAAA==","etag":"CJDs0uOr5\/8CEAE=","cacheControl":null,"contentEncoding":null,"metadata":{},"mediaLink":"https://storage.googleapis.com/download/storage/v1/b/my-app-assets/o/reports%2F2026%2Fsummary.pdf?generation=1738402200000000&alt=media"}
   */
  async uploadObject(bucket, objectName, fileUrl, contentType) {
    let buffer

    try {
      logger.debug(`uploadObject - fetching source file: ${ fileUrl }`)

      const bytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)

      buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    } catch (error) {
      throw new Error(`Failed to fetch the source file from the provided URL: ${ error.message }`)
    }

    const accessToken = await this.#getAccessToken()
    const resolvedContentType = contentType || this.#inferContentType(objectName)

    try {
      logger.debug(`uploadObject - uploading ${ buffer.length } bytes to gs://${ bucket }/${ objectName }`)

      const response = await Flowrunner.Request.post(`${ UPLOAD_BASE_URL }/b/${ encodeURIComponent(bucket) }/o`)
        .set({ 'Authorization': `Bearer ${ accessToken }`, 'Content-Type': resolvedContentType })
        .query({ uploadType: 'media', name: objectName })
        .send(buffer)

      return this.#trimObject(response)
    } catch (error) {
      throw this.#mapApiError(error, 'uploadObject')
    }
  }

  /**
   * @operationName Delete Object
   * @category Objects
   * @description Permanently deletes an object from a bucket. THIS CANNOT BE UNDONE unless the bucket has object versioning enabled (in which case a noncurrent version is retained per the bucket's lifecycle rules).
   * @route DELETE /delete-object
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucket","required":true,"dictionary":"getBucketsDictionary","description":"The bucket containing the object."}
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getObjectsDictionary","dependsOn":["bucket"],"description":"Full name (path) of the object to delete, e.g. 'reports/2026/summary.pdf'. Choose a bucket above to pick from its objects."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"bucket":"my-app-assets","objectName":"reports/2026/summary.pdf"}
   */
  async deleteObject(bucket, objectName) {
    await this.#apiRequest({
      url: this.#objectUrl(bucket, objectName),
      method: 'delete',
      logTag: 'deleteObject',
    })

    return { success: true, bucket, objectName }
  }

  /**
   * @operationName Copy Object
   * @category Objects
   * @description Copies an object to another name and/or bucket within Cloud Storage — the data never leaves Google's servers, so copies are fast regardless of size (objects over ~5 GB may require multiple internal rewrite steps and can fail via this simple copy; they are rare in automation flows). An existing object at the destination is overwritten. The source object is left untouched; combine with 'Delete Object' to implement a move/rename.
   * @route POST /copy-object
   *
   * @paramDef {"type":"String","label":"Source Bucket","name":"sourceBucket","required":true,"dictionary":"getBucketsDictionary","description":"The bucket containing the object to copy."}
   * @paramDef {"type":"String","label":"Source Object Name","name":"sourceObject","required":true,"dictionary":"getObjectsDictionary","dependsOn":["sourceBucket"],"description":"Full name (path) of the object to copy. Choose a source bucket above to pick from its objects."}
   * @paramDef {"type":"String","label":"Destination Bucket","name":"destinationBucket","required":true,"dictionary":"getBucketsDictionary","description":"The bucket to copy the object into (may be the same as the source bucket)."}
   * @paramDef {"type":"String","label":"Destination Object Name","name":"destinationObject","required":true,"description":"Full name (path) for the copy, e.g. 'archive/2026/summary.pdf'."}
   *
   * @returns {Object}
   * @sampleResult {"name":"archive/2026/summary.pdf","bucket":"my-backup-bucket","size":204800,"contentType":"application/pdf","storageClass":"STANDARD","timeCreated":"2026-02-02T11:00:00.000Z","updated":"2026-02-02T11:00:00.000Z","generation":"1738494000000000","md5Hash":"XrY7u+Ae7tCTyyK7j1rNww==","crc32c":"AAAAAA==","etag":"CJDs0uOr5\/8CEAE=","cacheControl":null,"contentEncoding":null,"metadata":{},"mediaLink":"https://storage.googleapis.com/download/storage/v1/b/my-backup-bucket/o/archive%2F2026%2Fsummary.pdf?generation=1738494000000000&alt=media"}
   */
  async copyObject(sourceBucket, sourceObject, destinationBucket, destinationObject) {
    const url = `${ STORAGE_BASE_URL }/b/${ encodeURIComponent(sourceBucket) }/o/${ encodeURIComponent(sourceObject) }` +
      `/copyTo/b/${ encodeURIComponent(destinationBucket) }/o/${ encodeURIComponent(destinationObject) }`

    const response = await this.#apiRequest({
      url,
      method: 'post',
      body: {},
      logTag: 'copyObject',
    })

    return this.#trimObject(response)
  }

  /**
   * @operationName Update Object Metadata
   * @category Objects
   * @description Updates an object's mutable metadata without touching its data: the content type, the Cache-Control header served with downloads, and custom key/value metadata. Only the fields you provide are changed (PATCH semantics); note that the custom metadata object replaces the existing custom metadata as a whole.
   * @route PATCH /update-object-metadata
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucket","required":true,"dictionary":"getBucketsDictionary","description":"The bucket containing the object."}
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getObjectsDictionary","dependsOn":["bucket"],"description":"Full name (path) of the object to update. Choose a bucket above to pick from its objects."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","description":"New MIME type for the object, e.g. 'application/pdf'."}
   * @paramDef {"type":"String","label":"Cache Control","name":"cacheControl","description":"Cache-Control header value served with the object, e.g. 'public, max-age=3600' or 'no-cache'."}
   * @paramDef {"type":"Object","label":"Custom Metadata","name":"metadata","description":"Custom key/value metadata to store on the object, e.g. {\"source\":\"invoicing\"}. Replaces the object's existing custom metadata."}
   *
   * @returns {Object}
   * @sampleResult {"name":"reports/2026/summary.pdf","bucket":"my-app-assets","size":204800,"contentType":"application/pdf","storageClass":"STANDARD","timeCreated":"2026-02-01T09:30:00.000Z","updated":"2026-02-03T08:15:00.000Z","generation":"1738402200000000","md5Hash":"XrY7u+Ae7tCTyyK7j1rNww==","crc32c":"AAAAAA==","etag":"CJDs0uOr5\/8CEAI=","cacheControl":"public, max-age=3600","contentEncoding":null,"metadata":{"source":"invoicing"},"mediaLink":"https://storage.googleapis.com/download/storage/v1/b/my-app-assets/o/reports%2F2026%2Fsummary.pdf?generation=1738402200000000&alt=media"}
   */
  async updateObjectMetadata(bucket, objectName, contentType, cacheControl, metadata) {
    const body = this.#compactObject({ contentType, cacheControl, metadata })

    if (!Object.keys(body).length) {
      throw new Error('Provide at least one of Content Type, Cache Control, or Custom Metadata to update')
    }

    const response = await this.#apiRequest({
      url: this.#objectUrl(bucket, objectName),
      method: 'patch',
      body,
      logTag: 'updateObjectMetadata',
    })

    return this.#trimObject(response)
  }

  // ==========================================================================
  //  SIGNED URLS
  // ==========================================================================

  /**
   * @operationName Generate Signed URL
   * @category Signed URLs
   * @description Generates a V4 signed URL that grants time-limited access to a single object without requiring Google credentials — ideal for sharing private files or letting external systems upload directly. The URL is signed locally with the service account's private key (no API call is made, and the object does not need to exist yet for PUT). Choose GET to allow downloading the object or PUT to allow uploading/overwriting it. Maximum expiration is 604800 seconds (7 days). The signing service account must itself have permission on the object (e.g. Storage Object Admin) for the URL to work when used.
   * @route POST /generate-signed-url
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucket","required":true,"dictionary":"getBucketsDictionary","description":"The bucket containing (or that will contain) the object."}
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"description":"Full name (path) of the object the URL grants access to, e.g. 'reports/2026/summary.pdf'. For PUT URLs the object does not need to exist yet."}
   * @paramDef {"type":"String","label":"Method","name":"method","required":true,"defaultValue":"GET","uiComponent":{"type":"DROPDOWN","options":{"values":["GET","PUT"]}},"description":"HTTP method the URL permits: GET to download the object, PUT to upload or overwrite it."}
   * @paramDef {"type":"Number","label":"Expires In (Seconds)","name":"expiresSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How long the URL stays valid, in seconds. Defaults to 3600 (1 hour); maximum 604800 (7 days)."}
   *
   * @returns {Object}
   * @sampleResult {"signedUrl":"https://storage.googleapis.com/my-app-assets/reports/2026/summary.pdf?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=sa%40my-project.iam.gserviceaccount.com%2F20260201%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20260201T093000Z&X-Goog-Expires=3600&X-Goog-SignedHeaders=host&X-Goog-Signature=6f2a...","method":"GET","bucket":"my-app-assets","objectName":"reports/2026/summary.pdf","expiresAt":"2026-02-01T10:30:00.000Z"}
   */
  async generateSignedUrl(bucket, objectName, method, expiresSeconds) {
    const key = this.#getServiceAccountKey()

    const httpMethod = (method || 'GET').toUpperCase()

    if (!['GET', 'PUT'].includes(httpMethod)) {
      throw new Error('Method must be GET or PUT')
    }

    const expiration = expiresSeconds ?? 3600

    if (!Number.isFinite(expiration) || expiration < 1 || expiration > MAX_SIGNED_URL_EXPIRATION_SECONDS) {
      throw new Error(`Expires In must be between 1 and ${ MAX_SIGNED_URL_EXPIRATION_SECONDS } seconds (7 days)`)
    }

    const now = new Date()
    const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') // e.g. 20260201T093000Z
    const datestamp = timestamp.slice(0, 8)

    const credentialScope = `${ datestamp }/auto/storage/goog4_request`
    const credential = `${ key.client_email }/${ credentialScope }`

    // Canonical URI: percent-encode each path segment, preserving '/'.
    const canonicalUri = `/${ this.#rfc3986Encode(bucket) }/${ objectName.split('/').map(segment => this.#rfc3986Encode(segment)).join('/') }`

    const queryParams = {
      'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
      'X-Goog-Credential': credential,
      'X-Goog-Date': timestamp,
      'X-Goog-Expires': String(expiration),
      'X-Goog-SignedHeaders': 'host',
    }

    const canonicalQueryString = Object.keys(queryParams)
      .sort()
      .map(name => `${ this.#rfc3986Encode(name) }=${ this.#rfc3986Encode(queryParams[name]) }`)
      .join('&')

    const canonicalRequest = [
      httpMethod,
      canonicalUri,
      canonicalQueryString,
      `host:${ SIGNED_URL_HOST }\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n')

    const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest).digest('hex')

    const stringToSign = [
      'GOOG4-RSA-SHA256',
      timestamp,
      credentialScope,
      canonicalRequestHash,
    ].join('\n')

    let signature

    try {
      signature = crypto.createSign('RSA-SHA256').update(stringToSign).sign(key.private_key, 'hex')
    } catch (error) {
      throw new Error(`Failed to sign the URL with the service account private key: ${ error.message }`)
    }

    logger.debug(`generateSignedUrl - signed ${ httpMethod } URL for gs://${ bucket }/${ objectName }, expires in ${ expiration }s`)

    return {
      signedUrl: `https://${ SIGNED_URL_HOST }${ canonicalUri }?${ canonicalQueryString }&X-Goog-Signature=${ signature }`,
      method: httpMethod,
      bucket,
      objectName,
      expiresAt: new Date(now.getTime() + expiration * 1000).toISOString(),
    }
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Buckets Dictionary
   * @description Lists the project's buckets for selection in dependent parameters.
   * @route POST /get-buckets-dictionary
   * @paramDef {"type":"getBucketsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"my-app-assets","value":"my-app-assets","note":"US / STANDARD"}],"cursor":null}
   */
  async getBucketsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ STORAGE_BASE_URL }/b`,
      query: { project: this.#getProjectId(), maxResults: 1000, pageToken: cursor, prefix: search || undefined },
      logTag: 'getBucketsDictionary',
    })

    const items = (response.items || []).map(bucket => ({
      label: bucket.name || '',
      value: bucket.name || '',
      note: [bucket.location, bucket.storageClass].filter(Boolean).join(' / '),
    }))

    return { items, cursor: response.nextPageToken || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Objects Dictionary
   * @description Lists the objects of a chosen bucket for selection in dependent parameters, using the search text as a name prefix filter.
   * @route POST /get-objects-dictionary
   * @paramDef {"type":"getObjectsDictionary__payload","label":"Payload","name":"payload","description":"Search prefix, pagination cursor, and the bucket criteria whose objects to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"reports/2026/summary.pdf","value":"reports/2026/summary.pdf","note":"application/pdf, 204800 bytes"}],"cursor":null}
   */
  async getObjectsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    // 'sourceBucket' covers the Copy Object action, whose bucket parameter is named sourceBucket.
    const bucket = criteria?.bucket || criteria?.sourceBucket

    if (!bucket) {
      return { items: [] }
    }

    const response = await this.#apiRequest({
      url: `${ STORAGE_BASE_URL }/b/${ encodeURIComponent(bucket) }/o`,
      query: { maxResults: 1000, pageToken: cursor, prefix: search || undefined },
      logTag: 'getObjectsDictionary',
    })

    const items = (response.items || []).map(object => ({
      label: object.name || '',
      value: object.name || '',
      note: [object.contentType, object.size !== undefined ? `${ object.size } bytes` : null].filter(Boolean).join(', '),
    }))

    return { items, cursor: response.nextPageToken || null }
  }

}

Flowrunner.ServerCode.addService(GoogleCloudStorage, [
  {
    name: 'serviceAccountKey',
    displayName: 'Service Account Key (JSON)',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.TEXT,
    required: true,
    shared: false,
    hint: 'Paste the full JSON key file of a Google Cloud service account with the "Storage Admin" role (or "Storage Object Admin" for object-only access). Create one under IAM & Admin > Service Accounts > Keys.',
  },
  {
    name: 'projectId',
    displayName: 'Project ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Google Cloud project ID that owns the buckets. Defaults to the "project_id" from the service account key file.',
  },
])
