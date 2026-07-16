const logger = {
  info: (...args) => console.log('[Contentful] info:', ...args),
  debug: (...args) => console.log('[Contentful] debug:', ...args),
  error: (...args) => console.log('[Contentful] error:', ...args),
  warn: (...args) => console.log('[Contentful] warn:', ...args),
}

const CMA_BASE_URL = 'https://api.contentful.com'
const CDA_BASE_URL = 'https://cdn.contentful.com'

/**
 * Removes undefined, null, and empty-string values from a flat object so they
 * are not sent as query parameters or request body keys.
 */
function clean(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Contentful
 * @integrationIcon /icon.svg
 */
class ContentfulService {
  constructor(config) {
    this.spaceId = config.spaceId
    this.environmentId = config.environmentId || 'master'
    this.managementToken = config.managementToken
    this.deliveryToken = config.deliveryToken
    this.defaultLocale = config.defaultLocale || 'en-US'
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  #envPath() {
    return `/spaces/${ this.spaceId }/environments/${ this.environmentId }`
  }

  #cmaUrl(path) {
    return `${ CMA_BASE_URL }${ this.#envPath() }${ path }`
  }

  #cdaUrl(path) {
    return `${ CDA_BASE_URL }${ this.#envPath() }${ path }`
  }

  /**
   * Wraps a simple { field: value } map into Contentful's localized field shape
   * { field: { 'en-US': value } }. If a value is already an object keyed by a
   * locale code (e.g. { 'en-US': ... }), it is passed through unchanged.
   */
  #localizeFields(fieldMap, locale) {
    const targetLocale = locale || this.defaultLocale

    if (!fieldMap || typeof fieldMap !== 'object') {
      return {}
    }

    const localized = {}

    for (const key in fieldMap) {
      const value = fieldMap[key]

      if (value && typeof value === 'object' && !Array.isArray(value) && this.#looksLocalized(value)) {
        localized[key] = value
      } else {
        localized[key] = { [targetLocale]: value }
      }
    }

    return localized
  }

  /**
   * Heuristic: treats an object as already-localized when every top-level key
   * looks like a locale code (e.g. "en-US", "de", "fr-CA").
   */
  #looksLocalized(value) {
    const keys = Object.keys(value)

    if (keys.length === 0) {
      return false
    }

    return keys.every(key => /^[a-z]{2}(-[A-Z]{2})?$/.test(key))
  }

  async #apiRequest({ base = 'cma', url, method = 'get', body, query, headers, logTag }) {
    try {
      const token = base === 'cda' ? this.deliveryToken : this.managementToken

      if (!token) {
        const missing = base === 'cda' ? 'Delivery Token' : 'Management Token'

        throw new Error(`Contentful API error: ${ missing } is required for this operation but is not configured.`)
      }

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(clean({
          'Authorization': `Bearer ${ token }`,
          'Content-Type': 'application/vnd.contentful.management.v1+json',
          ...headers,
        }))
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      if (error.message && error.message.startsWith('Contentful API error:')) {
        throw error
      }

      const responseBody = error.body || {}
      const errorType = responseBody.sys?.id
      const details = responseBody.details ? ` (${ JSON.stringify(responseBody.details) })` : ''
      const message = responseBody.message || error.message || 'Unknown error'

      logger.error(`${ logTag } - failed: ${ message }${ errorType ? ` [${ errorType }]` : '' }`)

      throw new Error(`Contentful API error: ${ message }${ errorType ? ` [${ errorType }]` : '' }${ details }`)
    }
  }

  /**
   * Fetches the current sys.version for an entry or asset so it can be supplied
   * in the X-Contentful-Version header for a subsequent write.
   */
  async #getCurrentVersion(path, logTag) {
    const resource = await this.#apiRequest({ base: 'cma', url: this.#cmaUrl(path), method: 'get', logTag })

    return resource?.sys?.version
  }

  // ---------------------------------------------------------------------------
  // Entries (CMA)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Entry
   * @category Entries
   * @description Creates a new entry of a given content type in the configured space and environment via the Content Management API. Provide field values as a simple map (e.g. {"title":"Hello","slug":"hello"}); values are automatically wrapped into Contentful's localized shape using the default locale, unless a value is already an object keyed by locale codes, in which case it is passed through as-is. The new entry starts as a draft and is not published.
   * @route POST /entries
   * @paramDef {"type":"String","label":"Content Type ID","name":"contentTypeId","required":true,"dictionary":"getContentTypesDictionary","description":"The content type ID the new entry should be based on."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Field values as a simple map, e.g. {\"title\":\"Hello\",\"body\":\"World\"}. Wrapped into the localized shape using the locale below."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Locale code to store the field values under (e.g. en-US). Defaults to the configured default locale."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"6dbjWqNd9SqccegcqYq224","type":"Entry","version":1,"contentType":{"sys":{"id":"blogPost"}}},"fields":{"title":{"en-US":"Hello"},"slug":{"en-US":"hello"}}}
   */
  async createEntry(contentTypeId, fields, locale) {
    const logTag = '[createEntry]'

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl('/entries'),
      method: 'post',
      headers: { 'X-Contentful-Content-Type': contentTypeId },
      body: { fields: this.#localizeFields(fields, locale) },
      logTag,
    })
  }

  /**
   * @operationName Get Entry
   * @category Entries
   * @description Retrieves a single entry (including drafts and unpublished changes) by its ID from the Content Management API. Returns the full entry with its sys metadata and localized fields.
   * @route GET /entries/{id}
   * @paramDef {"type":"String","label":"Entry ID","name":"entryId","required":true,"description":"The ID of the entry to retrieve."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"6dbjWqNd9SqccegcqYq224","type":"Entry","version":3,"contentType":{"sys":{"id":"blogPost"}}},"fields":{"title":{"en-US":"Hello"}}}
   */
  async getEntry(entryId) {
    const logTag = '[getEntry]'

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/entries/${ entryId }`),
      method: 'get',
      logTag,
    })
  }

  /**
   * @operationName List Entries
   * @category Entries
   * @description Lists entries from the Content Management API, including drafts and unpublished content. Pass any Contentful search query parameters as a map, for example {"content_type":"blogPost","limit":25,"skip":0,"order":"-sys.createdAt","fields.slug":"hello"}. Supports full-text search via "query", ordering, offset pagination, and field-level filters.
   * @route GET /entries
   * @paramDef {"type":"Object","label":"Query","name":"query","description":"Contentful query parameters as a map, e.g. {\"content_type\":\"blogPost\",\"limit\":25,\"order\":\"-sys.createdAt\"}."}
   * @returns {Object}
   * @sampleResult {"sys":{"type":"Array"},"total":1,"skip":0,"limit":100,"items":[{"sys":{"id":"6dbjWqNd9SqccegcqYq224","type":"Entry"},"fields":{"title":{"en-US":"Hello"}}}]}
   */
  async listEntries(query) {
    const logTag = '[listEntries]'

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl('/entries'),
      method: 'get',
      query: query || {},
      logTag,
    })
  }

  /**
   * @operationName Update Entry
   * @category Entries
   * @description Updates an existing entry's fields via the Content Management API. Provide field values as a simple map; they are wrapped into the localized shape using the default locale. The current entry version is required in the X-Contentful-Version header — if you leave the version blank it is fetched automatically. Note that field values fully replace the values for the given locale; fields not included keep their existing values only if you merge them in yourself.
   * @route PUT /entries/{id}
   * @paramDef {"type":"String","label":"Entry ID","name":"entryId","required":true,"description":"The ID of the entry to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Field values as a simple map, wrapped into the localized shape using the locale below."}
   * @paramDef {"type":"Number","label":"Version","name":"version","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The current sys.version of the entry. Leave blank to fetch it automatically before updating."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Locale code to store the field values under. Defaults to the configured default locale."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"6dbjWqNd9SqccegcqYq224","type":"Entry","version":4},"fields":{"title":{"en-US":"Updated"}}}
   */
  async updateEntry(entryId, fields, version, locale) {
    const logTag = '[updateEntry]'
    const currentVersion = version != null ? version : await this.#getCurrentVersion(`/entries/${ entryId }`, logTag)

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/entries/${ entryId }`),
      method: 'put',
      headers: { 'X-Contentful-Version': `${ currentVersion }` },
      body: { fields: this.#localizeFields(fields, locale) },
      logTag,
    })
  }

  /**
   * @operationName Delete Entry
   * @category Entries
   * @description Permanently deletes an entry via the Content Management API. Published entries cannot be deleted directly, so this operation automatically unpublishes the entry first (ignoring the "not published" case) and then deletes it. This action cannot be undone.
   * @route DELETE /entries/{id}
   * @paramDef {"type":"String","label":"Entry ID","name":"entryId","required":true,"description":"The ID of the entry to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"entryId":"6dbjWqNd9SqccegcqYq224"}
   */
  async deleteEntry(entryId) {
    const logTag = '[deleteEntry]'

    try {
      await this.#apiRequest({
        base: 'cma',
        url: this.#cmaUrl(`/entries/${ entryId }/published`),
        method: 'delete',
        logTag,
      })
    } catch (error) {
      // Entry was not published — safe to continue with deletion.
      logger.debug(`${ logTag } - unpublish skipped: ${ error.message }`)
    }

    await this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/entries/${ entryId }`),
      method: 'delete',
      logTag,
    })

    return { success: true, entryId }
  }

  /**
   * @operationName Publish Entry
   * @category Entries
   * @description Publishes an entry via the Content Management API, making its current draft state available through the Content Delivery API. The current entry version is required and is fetched automatically when the version parameter is left blank.
   * @route PUT /entries/{id}/published
   * @paramDef {"type":"String","label":"Entry ID","name":"entryId","required":true,"description":"The ID of the entry to publish."}
   * @paramDef {"type":"Number","label":"Version","name":"version","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The current sys.version of the entry. Leave blank to fetch it automatically."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"6dbjWqNd9SqccegcqYq224","type":"Entry","version":5,"publishedVersion":4}}
   */
  async publishEntry(entryId, version) {
    const logTag = '[publishEntry]'
    const currentVersion = version != null ? version : await this.#getCurrentVersion(`/entries/${ entryId }`, logTag)

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/entries/${ entryId }/published`),
      method: 'put',
      headers: { 'X-Contentful-Version': `${ currentVersion }` },
      logTag,
    })
  }

  /**
   * @operationName Unpublish Entry
   * @category Entries
   * @description Unpublishes an entry via the Content Management API, removing it from the Content Delivery API while keeping the draft. The entry itself is not deleted.
   * @route DELETE /entries/{id}/published
   * @paramDef {"type":"String","label":"Entry ID","name":"entryId","required":true,"description":"The ID of the entry to unpublish."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"6dbjWqNd9SqccegcqYq224","type":"Entry","version":6}}
   */
  async unpublishEntry(entryId) {
    const logTag = '[unpublishEntry]'

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/entries/${ entryId }/published`),
      method: 'delete',
      logTag,
    })
  }

  /**
   * @operationName Archive Entry
   * @category Entries
   * @description Archives an entry via the Content Management API. Archived entries are hidden from the default entry list and cannot be edited until unarchived. Only unpublished entries can be archived. The current version is fetched automatically when the version parameter is left blank.
   * @route PUT /entries/{id}/archived
   * @paramDef {"type":"String","label":"Entry ID","name":"entryId","required":true,"description":"The ID of the entry to archive."}
   * @paramDef {"type":"Number","label":"Version","name":"version","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The current sys.version of the entry. Leave blank to fetch it automatically."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"6dbjWqNd9SqccegcqYq224","type":"Entry","version":7,"archivedVersion":6}}
   */
  async archiveEntry(entryId, version) {
    const logTag = '[archiveEntry]'
    const currentVersion = version != null ? version : await this.#getCurrentVersion(`/entries/${ entryId }`, logTag)

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/entries/${ entryId }/archived`),
      method: 'put',
      headers: { 'X-Contentful-Version': `${ currentVersion }` },
      logTag,
    })
  }

  /**
   * @operationName Unarchive Entry
   * @category Entries
   * @description Unarchives a previously archived entry via the Content Management API, restoring it to the normal draft state so it can be edited and published again.
   * @route DELETE /entries/{id}/archived
   * @paramDef {"type":"String","label":"Entry ID","name":"entryId","required":true,"description":"The ID of the entry to unarchive."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"6dbjWqNd9SqccegcqYq224","type":"Entry","version":8}}
   */
  async unarchiveEntry(entryId) {
    const logTag = '[unarchiveEntry]'

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/entries/${ entryId }/archived`),
      method: 'delete',
      logTag,
    })
  }

  // ---------------------------------------------------------------------------
  // Published content (CDA)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Published Entries
   * @category Delivery
   * @description Retrieves published entries through the Content Delivery API (cdn.contentful.com), which is faster and cached compared to the management API but only returns published content. Requires the Delivery Token to be configured. Pass Contentful query parameters as a map, e.g. {"content_type":"blogPost","limit":10,"order":"-sys.createdAt","fields.slug":"hello"}.
   * @route GET /entries
   * @paramDef {"type":"Object","label":"Query","name":"query","description":"Contentful delivery query parameters as a map, e.g. {\"content_type\":\"blogPost\",\"limit\":10}."}
   * @returns {Object}
   * @sampleResult {"sys":{"type":"Array"},"total":1,"skip":0,"limit":100,"items":[{"sys":{"id":"6dbjWqNd9SqccegcqYq224","type":"Entry"},"fields":{"title":"Hello"}}]}
   */
  async getPublishedEntries(query) {
    const logTag = '[getPublishedEntries]'

    return this.#apiRequest({
      base: 'cda',
      url: this.#cdaUrl('/entries'),
      method: 'get',
      query: query || {},
      logTag,
    })
  }

  /**
   * @operationName Get Published Entry
   * @category Delivery
   * @description Retrieves a single published entry by ID through the Content Delivery API (cdn.contentful.com). Faster and cached, but only returns content that has been published. Requires the Delivery Token to be configured.
   * @route GET /entries/{id}
   * @paramDef {"type":"String","label":"Entry ID","name":"entryId","required":true,"description":"The ID of the published entry to retrieve."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Optional locale to return field values for (e.g. en-US, or * for all locales)."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"6dbjWqNd9SqccegcqYq224","type":"Entry"},"fields":{"title":"Hello","slug":"hello"}}
   */
  async getPublishedEntry(entryId, locale) {
    const logTag = '[getPublishedEntry]'

    return this.#apiRequest({
      base: 'cda',
      url: this.#cdaUrl(`/entries/${ entryId }`),
      method: 'get',
      query: { locale },
      logTag,
    })
  }

  // ---------------------------------------------------------------------------
  // Assets (CMA)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Asset
   * @category Assets
   * @description Creates a new asset (image, document, or other file) via the Content Management API. Provide fields as a simple map; the "file" field must describe the upload for each locale, e.g. {"title":"My image","file":{"contentType":"image/png","fileName":"pic.png","upload":"https://example.com/pic.png"}}. The asset is created in a draft state and must be processed (Process Asset) and then published before it is delivered. Non-file fields are localized using the default locale, while a file value is stored under that locale as-is.
   * @route POST /assets
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Asset fields as a simple map including a file descriptor, e.g. {\"title\":\"Pic\",\"file\":{\"contentType\":\"image/png\",\"fileName\":\"p.png\",\"upload\":\"https://...\"}}."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Locale code to store the field values under. Defaults to the configured default locale."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"3Yd6mQj2p2ImIqcAMcee0i","type":"Asset","version":1},"fields":{"title":{"en-US":"Pic"},"file":{"en-US":{"contentType":"image/png","fileName":"p.png","upload":"https://..."}}}}
   */
  async createAsset(fields, locale) {
    const logTag = '[createAsset]'

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl('/assets'),
      method: 'post',
      body: { fields: this.#localizeFields(fields, locale) },
      logTag,
    })
  }

  /**
   * @operationName Get Asset
   * @category Assets
   * @description Retrieves a single asset by ID from the Content Management API, including its processing state, file details, and localized metadata.
   * @route GET /assets/{id}
   * @paramDef {"type":"String","label":"Asset ID","name":"assetId","required":true,"description":"The ID of the asset to retrieve."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"3Yd6mQj2p2ImIqcAMcee0i","type":"Asset","version":3},"fields":{"title":{"en-US":"Pic"},"file":{"en-US":{"url":"//images.ctfassets.net/.../p.png","contentType":"image/png"}}}}
   */
  async getAsset(assetId) {
    const logTag = '[getAsset]'

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/assets/${ assetId }`),
      method: 'get',
      logTag,
    })
  }

  /**
   * @operationName List Assets
   * @category Assets
   * @description Lists assets from the Content Management API, including unprocessed and unpublished assets. Pass Contentful query parameters as a map, e.g. {"limit":25,"skip":0,"order":"-sys.createdAt"}.
   * @route GET /assets
   * @paramDef {"type":"Object","label":"Query","name":"query","description":"Contentful query parameters as a map, e.g. {\"limit\":25,\"order\":\"-sys.updatedAt\"}."}
   * @returns {Object}
   * @sampleResult {"sys":{"type":"Array"},"total":1,"skip":0,"limit":100,"items":[{"sys":{"id":"3Yd6mQj2p2ImIqcAMcee0i","type":"Asset"}}]}
   */
  async listAssets(query) {
    const logTag = '[listAssets]'

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl('/assets'),
      method: 'get',
      query: query || {},
      logTag,
    })
  }

  /**
   * @operationName Process Asset
   * @category Assets
   * @description Triggers processing of an asset's uploaded file for a given locale via the Content Management API. Processing downloads the file from its upload source and prepares it for delivery. This must be done after Create Asset and before Publish Asset. Returns a success acknowledgement since the API responds with no body.
   * @route PUT /assets/{id}/files/{locale}/process
   * @paramDef {"type":"String","label":"Asset ID","name":"assetId","required":true,"description":"The ID of the asset to process."}
   * @paramDef {"type":"Number","label":"Version","name":"version","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The current sys.version of the asset. Leave blank to fetch it automatically."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Locale of the file to process (e.g. en-US). Defaults to the configured default locale."}
   * @returns {Object}
   * @sampleResult {"success":true,"assetId":"3Yd6mQj2p2ImIqcAMcee0i","locale":"en-US"}
   */
  async processAsset(assetId, version, locale) {
    const logTag = '[processAsset]'
    const targetLocale = locale || this.defaultLocale
    const currentVersion = version != null ? version : await this.#getCurrentVersion(`/assets/${ assetId }`, logTag)

    await this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/assets/${ assetId }/files/${ targetLocale }/process`),
      method: 'put',
      headers: { 'X-Contentful-Version': `${ currentVersion }` },
      logTag,
    })

    return { success: true, assetId, locale: targetLocale }
  }

  /**
   * @operationName Publish Asset
   * @category Assets
   * @description Publishes an asset via the Content Management API, making it available through the Content Delivery API. The asset must be processed first. The current version is fetched automatically when the version parameter is left blank.
   * @route PUT /assets/{id}/published
   * @paramDef {"type":"String","label":"Asset ID","name":"assetId","required":true,"description":"The ID of the asset to publish."}
   * @paramDef {"type":"Number","label":"Version","name":"version","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The current sys.version of the asset. Leave blank to fetch it automatically."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"3Yd6mQj2p2ImIqcAMcee0i","type":"Asset","version":5,"publishedVersion":4}}
   */
  async publishAsset(assetId, version) {
    const logTag = '[publishAsset]'
    const currentVersion = version != null ? version : await this.#getCurrentVersion(`/assets/${ assetId }`, logTag)

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/assets/${ assetId }/published`),
      method: 'put',
      headers: { 'X-Contentful-Version': `${ currentVersion }` },
      logTag,
    })
  }

  /**
   * @operationName Delete Asset
   * @category Assets
   * @description Permanently deletes an asset via the Content Management API. Published assets cannot be deleted directly, so this operation automatically unpublishes the asset first (ignoring the "not published" case) and then deletes it. This action cannot be undone.
   * @route DELETE /assets/{id}
   * @paramDef {"type":"String","label":"Asset ID","name":"assetId","required":true,"description":"The ID of the asset to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"assetId":"3Yd6mQj2p2ImIqcAMcee0i"}
   */
  async deleteAsset(assetId) {
    const logTag = '[deleteAsset]'

    try {
      await this.#apiRequest({
        base: 'cma',
        url: this.#cmaUrl(`/assets/${ assetId }/published`),
        method: 'delete',
        logTag,
      })
    } catch (error) {
      logger.debug(`${ logTag } - unpublish skipped: ${ error.message }`)
    }

    await this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/assets/${ assetId }`),
      method: 'delete',
      logTag,
    })

    return { success: true, assetId }
  }

  // ---------------------------------------------------------------------------
  // Content Types (CMA)
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Content Types
   * @category Content Types
   * @description Lists all content types (content models) in the configured space and environment via the Content Management API. Pass optional query parameters as a map, e.g. {"limit":50,"order":"name"}.
   * @route GET /content_types
   * @paramDef {"type":"Object","label":"Query","name":"query","description":"Optional query parameters as a map, e.g. {\"limit\":50,\"order\":\"name\"}."}
   * @returns {Object}
   * @sampleResult {"sys":{"type":"Array"},"total":1,"skip":0,"limit":100,"items":[{"sys":{"id":"blogPost","type":"ContentType"},"name":"Blog Post","displayField":"title","fields":[{"id":"title","name":"Title","type":"Symbol"}]}]}
   */
  async listContentTypes(query) {
    const logTag = '[listContentTypes]'

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl('/content_types'),
      method: 'get',
      query: query || {},
      logTag,
    })
  }

  /**
   * @operationName Get Content Type
   * @category Content Types
   * @description Retrieves a single content type (content model) by ID via the Content Management API, including its field definitions, display field, and sys metadata.
   * @route GET /content_types/{id}
   * @paramDef {"type":"String","label":"Content Type ID","name":"contentTypeId","required":true,"dictionary":"getContentTypesDictionary","description":"The ID of the content type to retrieve."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"blogPost","type":"ContentType","version":2},"name":"Blog Post","displayField":"title","fields":[{"id":"title","name":"Title","type":"Symbol","required":true}]}
   */
  async getContentType(contentTypeId) {
    const logTag = '[getContentType]'

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/content_types/${ contentTypeId }`),
      method: 'get',
      logTag,
    })
  }

  /**
   * @operationName Create Content Type
   * @category Content Types
   * @description Creates or updates a content type (content model) with an explicit ID via the Content Management API (PUT /content_types/{id}). Provide the display name, the field definitions array, and optionally the field ID to use as the display field. Each field object follows Contentful's schema, e.g. {"id":"title","name":"Title","type":"Symbol","required":true}. The content type is created as a draft; use Activate Content Type to make it usable. Supplying the version updates an existing content type.
   * @route PUT /content_types/{id}
   * @paramDef {"type":"String","label":"Content Type ID","name":"contentTypeId","required":true,"description":"The ID for the content type (used in the URL, e.g. blogPost)."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Human-readable name of the content type, e.g. Blog Post."}
   * @paramDef {"type":"Array<Object>","label":"Fields","name":"fields","required":true,"description":"Array of field definitions, e.g. [{\"id\":\"title\",\"name\":\"Title\",\"type\":\"Symbol\"}]."}
   * @paramDef {"type":"String","label":"Display Field","name":"displayField","description":"Field ID to use as the display field (e.g. title)."}
   * @paramDef {"type":"Number","label":"Version","name":"version","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Current sys.version when updating an existing content type. Leave blank to create a new one."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"blogPost","type":"ContentType","version":1},"name":"Blog Post","displayField":"title","fields":[{"id":"title","name":"Title","type":"Symbol"}]}
   */
  async createContentType(contentTypeId, name, fields, displayField, version) {
    const logTag = '[createContentType]'
    const headers = version != null ? { 'X-Contentful-Version': `${ version }` } : undefined

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/content_types/${ contentTypeId }`),
      method: 'put',
      headers,
      body: clean({ name, fields, displayField }),
      logTag,
    })
  }

  /**
   * @operationName Activate Content Type
   * @category Content Types
   * @description Activates (publishes) a content type via the Content Management API so entries can be created against it. The current version is fetched automatically when the version parameter is left blank.
   * @route PUT /content_types/{id}/published
   * @paramDef {"type":"String","label":"Content Type ID","name":"contentTypeId","required":true,"dictionary":"getContentTypesDictionary","description":"The ID of the content type to activate."}
   * @paramDef {"type":"Number","label":"Version","name":"version","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The current sys.version of the content type. Leave blank to fetch it automatically."}
   * @returns {Object}
   * @sampleResult {"sys":{"id":"blogPost","type":"ContentType","version":2,"publishedVersion":1},"name":"Blog Post"}
   */
  async activateContentType(contentTypeId, version) {
    const logTag = '[activateContentType]'
    const currentVersion = version != null ? version : await this.#getCurrentVersion(`/content_types/${ contentTypeId }`, logTag)

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl(`/content_types/${ contentTypeId }/published`),
      method: 'put',
      headers: { 'X-Contentful-Version': `${ currentVersion }` },
      logTag,
    })
  }

  // ---------------------------------------------------------------------------
  // Locales (CMA)
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Locales
   * @category Locales
   * @description Lists all locales configured for the space and environment via the Content Management API, including each locale's code, name, whether it is the default, and fallback settings. Useful for discovering which locale codes to use when localizing fields.
   * @route GET /locales
   * @returns {Object}
   * @sampleResult {"sys":{"type":"Array"},"total":1,"skip":0,"limit":100,"items":[{"sys":{"id":"6Vtn4GcMSU2mI44mCe2GQq","type":"Locale"},"name":"English (United States)","code":"en-US","default":true}]}
   */
  async listLocales() {
    const logTag = '[listLocales]'

    return this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl('/locales'),
      method: 'get',
      logTag,
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getContentTypesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter content types by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (skip offset) for fetching the next page of content types."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Content Types Dictionary
   * @description Provides a searchable list of content types for selecting a content type ID in dependent parameters. The option value is the content type ID.
   * @route POST /get-content-types-dictionary
   * @paramDef {"type":"getContentTypesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing content types."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Blog Post","value":"blogPost","note":"blogPost"}],"cursor":null}
   */
  async getContentTypesDictionary(payload) {
    const logTag = '[getContentTypesDictionary]'
    const { search, cursor } = payload || {}
    const limit = 100
    const skip = cursor ? parseInt(cursor, 10) || 0 : 0

    const response = await this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl('/content_types'),
      method: 'get',
      query: { limit, skip, order: 'name' },
      logTag,
    })

    let items = response.items || []

    if (search) {
      const term = search.toLowerCase()

      items = items.filter(ct => (ct.name || '').toLowerCase().includes(term) || (ct.sys?.id || '').toLowerCase().includes(term))
    }

    const nextSkip = skip + limit
    const hasMore = (response.total || 0) > nextSkip

    return {
      items: items.map(ct => ({
        label: ct.name || ct.sys?.id,
        value: ct.sys?.id,
        note: ct.sys?.id,
      })),
      cursor: hasMore ? `${ nextSkip }` : null,
    }
  }

  /**
   * @typedef {Object} getEntriesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","dictionary":"getContentTypesDictionary","description":"Content type ID to filter entries by."}
   */

  /**
   * @typedef {Object} getEntriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional full-text search across entry fields."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (skip offset) for fetching the next page of entries."}
   * @paramDef {"type":"getEntriesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent filters, including the content type to list entries from."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Entries Dictionary
   * @description Provides a searchable list of entries for selecting an entry ID in dependent parameters. Filter by content type via the criteria; each option's label is taken from the content type's display field when available, falling back to the entry ID. The option value is the entry ID.
   * @route POST /get-entries-dictionary
   * @paramDef {"type":"getEntriesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and criteria (content type) for listing entries."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Hello","value":"6dbjWqNd9SqccegcqYq224","note":"blogPost"}],"cursor":null}
   */
  async getEntriesDictionary(payload) {
    const logTag = '[getEntriesDictionary]'
    const { search, cursor, criteria } = payload || {}
    const contentType = criteria?.contentType
    const limit = 100
    const skip = cursor ? parseInt(cursor, 10) || 0 : 0

    // Determine the display field for the content type to build meaningful labels.
    let displayField
    const contentTypeId = contentType

    if (contentType) {
      try {
        const ct = await this.#apiRequest({
          base: 'cma',
          url: this.#cmaUrl(`/content_types/${ contentType }`),
          method: 'get',
          logTag,
        })

        displayField = ct.displayField
      } catch (error) {
        logger.debug(`${ logTag } - could not load content type: ${ error.message }`)
      }
    }

    const response = await this.#apiRequest({
      base: 'cma',
      url: this.#cmaUrl('/entries'),
      method: 'get',
      query: clean({ content_type: contentType, query: search, limit, skip, order: '-sys.updatedAt' }),
      logTag,
    })

    const items = (response.items || []).map(entry => {
      const fields = entry.fields || {}
      const displayValue = displayField ? this.#firstLocaleValue(fields[displayField]) : undefined

      return {
        label: displayValue != null ? `${ displayValue }` : entry.sys?.id,
        value: entry.sys?.id,
        note: entry.sys?.contentType?.sys?.id || contentTypeId,
      }
    })

    const nextSkip = skip + limit
    const hasMore = (response.total || 0) > nextSkip

    return { items, cursor: hasMore ? `${ nextSkip }` : null }
  }

  /**
   * Returns the value of the first available locale for a localized field, or
   * undefined when the field is empty.
   */
  #firstLocaleValue(localizedField) {
    if (!localizedField || typeof localizedField !== 'object') {
      return undefined
    }

    const keys = Object.keys(localizedField)

    return keys.length ? localizedField[keys[0]] : undefined
  }
}

Flowrunner.ServerCode.addService(ContentfulService, [
  {
    name: 'spaceId',
    displayName: 'Space ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Contentful Space ID. Find it under Contentful → Settings → General settings → Space ID.',
  },
  {
    name: 'environmentId',
    displayName: 'Environment ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: 'master',
    hint: 'The environment name to operate on. Defaults to "master".',
  },
  {
    name: 'managementToken',
    displayName: 'Management Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Content Management API token (a personal access token starting with CFPAT-). Create it under Settings → API keys → Content management tokens. Required for all write/management operations.',
  },
  {
    name: 'deliveryToken',
    displayName: 'Delivery Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Content Delivery API token, used for the faster cached reads of published content. Find it under Settings → API keys → Content Delivery API - access token.',
  },
  {
    name: 'defaultLocale',
    displayName: 'Default Locale',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: 'en-US',
    hint: 'Default locale code used when wrapping/unwrapping simple field maps, e.g. en-US.',
  },
])
