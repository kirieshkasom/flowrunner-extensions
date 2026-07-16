const logger = {
  info: (...args) => console.log('[Strapi] info:', ...args),
  debug: (...args) => console.log('[Strapi] debug:', ...args),
  error: (...args) => console.log('[Strapi] error:', ...args),
  warn: (...args) => console.log('[Strapi] warn:', ...args),
}

// Strapi v5 status values, mapped from friendly dropdown labels.
const STATUS_MAP = {
  Published: 'published',
  Draft: 'draft',
}

/**
 * @integrationName Strapi
 * @integrationIcon /icon.png
 * @usesFileStorage
 */
class StrapiService {
  constructor(config) {
    // Strip a trailing slash so we can safely append /api and paths.
    this.baseUrl = (config.baseUrl || '').trim().replace(/\/+$/, '')
    this.apiToken = config.apiToken
    this.apiBase = `${ this.baseUrl }/api`
  }

  // ---------------------------------------------------------------------------
  //  Private helpers
  // ---------------------------------------------------------------------------

  // Single request helper — all external calls route through here.
  async #apiRequest({ url, method = 'get', body, query, isForm, form, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ Authorization: `Bearer ${ this.apiToken }` })
        .query(query || {})

      if (isForm) {
        // Multipart: do NOT set Content-Type — the boundary is supplied by the form.
        return await request.form(form)
      }

      request = request.set({ 'Content-Type': 'application/json' })

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const body = error.body || {}
      const apiError = body.error || {}
      const detail = apiError.message || error.message || 'Unknown error'
      const name = apiError.name ? `${ apiError.name }: ` : ''
      const details = apiError.details && Object.keys(apiError.details).length
        ? ` (${ JSON.stringify(apiError.details) })`
        : ''

      logger.error(`${ logTag } - failed: ${ name }${ detail }${ details }`)
      throw new Error(`Strapi API error: ${ name }${ detail }${ details }`)
    }
  }

  // Maps a friendly dropdown label to the underlying API value; passes through unknowns.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Normalizes a user-supplied collection into its plural API id segment.
  #resolveCollection(collection) {
    if (!collection || typeof collection !== 'string') {
      throw new Error('Strapi API error: A collection (plural API ID, e.g. "articles") is required.')
    }

    return encodeURIComponent(collection.trim().replace(/^\/+|\/+$/g, ''))
  }

  // Recursively flattens a nested filters object into Strapi's bracket syntax.
  // { title: { $contains: 'x' } }  ->  { 'filters[title][$contains]': 'x' }
  // Arrays (e.g. $in) become indexed keys: filters[id][$in][0]=1.
  #flattenBrackets(value, prefix, out) {
    if (value === undefined || value === null) {
      return out
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => this.#flattenBrackets(item, `${ prefix }[${ index }]`, out))

      return out
    }

    if (typeof value === 'object') {
      for (const key of Object.keys(value)) {
        this.#flattenBrackets(value[key], `${ prefix }[${ key }]`, out)
      }

      return out
    }

    out[prefix] = value

    return out
  }

  // Builds the full Strapi query object from the shared list/read parameters.
  #buildQuery({ populate, filters, sort, page, pageSize, fields, locale, status } = {}) {
    const query = {}

    // populate: '*' or a comma-separated list of relations/media fields.
    if (populate) {
      if (populate === '*') {
        query.populate = '*'
      } else {
        String(populate)
          .split(',')
          .map(part => part.trim())
          .filter(Boolean)
          .forEach((relation, index) => {
            query[`populate[${ index }]`] = relation
          })
      }
    }

    // filters: nested object flattened to filters[field][$op]=value.
    if (filters && typeof filters === 'object') {
      this.#flattenBrackets(filters, 'filters', query)
    }

    // sort: comma-separated "field:asc" clauses -> sort[0]=field:asc.
    if (sort) {
      String(sort)
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .forEach((clause, index) => {
          query[`sort[${ index }]`] = clause
        })
    }

    // fields: comma-separated field selection -> fields[0]=title.
    if (fields) {
      String(fields)
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .forEach((field, index) => {
          query[`fields[${ index }]`] = field
        })
    }

    if (page !== undefined && page !== null && page !== '') {
      query['pagination[page]'] = page
    }

    if (pageSize !== undefined && pageSize !== null && pageSize !== '') {
      query['pagination[pageSize]'] = pageSize
    }

    if (locale) {
      query.locale = locale
    }

    const resolvedStatus = this.#resolveChoice(status, STATUS_MAP)

    if (resolvedStatus) {
      query.status = resolvedStatus
    }

    return query
  }

  #toBuffer(bytes) {
    return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  }

  // ---------------------------------------------------------------------------
  //  Entries — generic CRUD over any collection type
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Entries
   * @category Entries
   * @description Lists entries from any Strapi collection type. Provide the plural API ID of the collection (e.g. "articles", "products"). Supports Strapi v5 querying: populate relations/media, filter with the document operator syntax, sort, select fields, paginate, request a locale, and choose published or draft entries. Returns the entries in "data" plus a "meta.pagination" block (page, pageSize, pageCount, total). In Strapi v5 each entry is flat — its fields sit directly on the object alongside "id" and the string "documentId".
   * @route GET /list-entries
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"description":"The plural API ID of the collection type, e.g. articles, products, categories. This is the segment used in the REST URL (/api/{collection})."}
   * @paramDef {"type":"String","label":"Populate","name":"populate","description":"Relations, components, and media fields to include. Use * for everything, or a comma-separated list of field names (e.g. author,cover,category)."}
   * @paramDef {"type":"Object","label":"Filters","name":"filters","description":"Filter conditions as a nested object flattened to Strapi bracket syntax. Example: {\"title\":{\"$contains\":\"hello\"},\"rating\":{\"$gte\":4}}. Operators include $eq, $ne, $lt, $lte, $gt, $gte, $contains, $in, $notIn, $null, $startsWith."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","description":"Comma-separated sort clauses in field:direction form, e.g. createdAt:desc,title:asc."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated list of fields to return, e.g. title,slug,publishedAt. Omit to return all fields."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of entries per page (Strapi default 25, max 100)."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Locale code to fetch, e.g. en, fr, es. Only relevant when internationalization (i18n) is enabled on the content type."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Draft"]}},"description":"Which version to return for Draft & Publish content types. Published returns live entries; Draft returns draft versions. Defaults to Published."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":6,"documentId":"znrlzntu9ei5onjvwfaalu2v","title":"Hello World","slug":"hello-world","createdAt":"2024-02-27T10:19:04.953Z","updatedAt":"2024-03-05T15:52:05.591Z","publishedAt":"2024-03-05T15:52:05.600Z","locale":"en"}],"meta":{"pagination":{"page":1,"pageSize":25,"pageCount":1,"total":1}}}
   */
  async listEntries(collection, populate, filters, sort, fields, page, pageSize, locale, status) {
    const pluralApiId = this.#resolveCollection(collection)

    return await this.#apiRequest({
      logTag: '[listEntries]',
      url: `${ this.apiBase }/${ pluralApiId }`,
      method: 'get',
      query: this.#buildQuery({ populate, filters, sort, page, pageSize, fields, locale, status }),
    })
  }

  /**
   * @operationName Get Entry
   * @category Entries
   * @description Retrieves a single entry from a collection type by its Strapi v5 documentId (a string identifier, not the numeric id used in Strapi v4). Optionally populate relations, components, and media, and choose the published or draft version. Returns the entry under "data" with its fields flattened to the top level alongside "id" and "documentId".
   * @route GET /get-entry
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"description":"The plural API ID of the collection type, e.g. articles, products."}
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The Strapi v5 documentId of the entry (a string, e.g. znrlzntu9ei5onjvwfaalu2v). This replaces the numeric id used in Strapi v4 URLs."}
   * @paramDef {"type":"String","label":"Populate","name":"populate","description":"Relations, components, and media to include. Use * for everything, or a comma-separated list of field names."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Locale code to fetch, e.g. en, fr. Only relevant when i18n is enabled."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Draft"]}},"description":"Which version to return for Draft & Publish content types. Defaults to Published."}
   * @returns {Object}
   * @sampleResult {"data":{"id":6,"documentId":"znrlzntu9ei5onjvwfaalu2v","title":"Hello World","slug":"hello-world","createdAt":"2024-02-27T10:19:04.953Z","updatedAt":"2024-03-05T15:52:05.591Z","publishedAt":"2024-03-05T15:52:05.600Z","locale":"en"},"meta":{}}
   */
  async getEntry(collection, documentId, populate, locale, status) {
    const pluralApiId = this.#resolveCollection(collection)

    if (!documentId) {
      throw new Error('Strapi API error: A documentId is required.')
    }

    return await this.#apiRequest({
      logTag: '[getEntry]',
      url: `${ this.apiBase }/${ pluralApiId }/${ encodeURIComponent(documentId) }`,
      method: 'get',
      query: this.#buildQuery({ populate, locale, status }),
    })
  }

  /**
   * @operationName Create Entry
   * @category Entries
   * @description Creates a new entry in a collection type. Provide the entry fields as an object; they are automatically wrapped in the required {"data": {...}} envelope Strapi expects. For content types with Draft & Publish enabled, a new entry is created as a draft unless the target status is published. Returns the created entry under "data" with its "documentId".
   * @route POST /create-entry
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"description":"The plural API ID of the collection type, e.g. articles, products."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"The entry fields to set, as a flat object, e.g. {\"title\":\"Hello\",\"slug\":\"hello\",\"author\":\"abc123documentId\"}. Relation fields accept the related entry's documentId (or an array of them). Do not wrap in a data key — that is added automatically."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Locale to create the entry in, e.g. en, fr. Only relevant when i18n is enabled."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Draft"]}},"description":"For Draft & Publish content types, whether to create the entry published or as a draft. Defaults to Draft."}
   * @returns {Object}
   * @sampleResult {"data":{"id":7,"documentId":"k9r3fj2h8s1a0bcd4ef5gh6i","title":"Hello","slug":"hello","createdAt":"2024-03-05T15:52:05.591Z","updatedAt":"2024-03-05T15:52:05.591Z","publishedAt":null,"locale":"en"},"meta":{}}
   */
  async createEntry(collection, data, locale, status) {
    const pluralApiId = this.#resolveCollection(collection)

    if (!data || typeof data !== 'object') {
      throw new Error('Strapi API error: A data object with the entry fields is required.')
    }

    return await this.#apiRequest({
      logTag: '[createEntry]',
      url: `${ this.apiBase }/${ pluralApiId }`,
      method: 'post',
      query: this.#buildQuery({ locale, status }),
      body: { data },
    })
  }

  /**
   * @operationName Update Entry
   * @category Entries
   * @description Updates an existing entry, identified by its Strapi v5 documentId. Provide only the fields you want to change as an object; they are wrapped in the {"data": {...}} envelope automatically. To publish a draft you can set the target status to Published, or set the publishedAt field, depending on the content type's Draft & Publish configuration. Returns the updated entry under "data".
   * @route PUT /update-entry
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"description":"The plural API ID of the collection type, e.g. articles, products."}
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The Strapi v5 documentId (string) of the entry to update."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"The fields to update, as a flat object, e.g. {\"title\":\"Updated title\"}. Only include the fields you want to change. Do not wrap in a data key — that is added automatically."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Locale of the entry version to update, e.g. en, fr. Only relevant when i18n is enabled."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Draft"]}},"description":"For Draft & Publish content types, the target status of the update. Published updates and publishes; Draft updates the draft version."}
   * @returns {Object}
   * @sampleResult {"data":{"id":6,"documentId":"znrlzntu9ei5onjvwfaalu2v","title":"Updated title","slug":"hello-world","createdAt":"2024-02-27T10:19:04.953Z","updatedAt":"2024-03-06T09:10:00.000Z","publishedAt":"2024-03-06T09:10:00.000Z","locale":"en"},"meta":{}}
   */
  async updateEntry(collection, documentId, data, locale, status) {
    const pluralApiId = this.#resolveCollection(collection)

    if (!documentId) {
      throw new Error('Strapi API error: A documentId is required.')
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Strapi API error: A data object with the fields to update is required.')
    }

    return await this.#apiRequest({
      logTag: '[updateEntry]',
      url: `${ this.apiBase }/${ pluralApiId }/${ encodeURIComponent(documentId) }`,
      method: 'put',
      query: this.#buildQuery({ locale, status }),
      body: { data },
    })
  }

  /**
   * @operationName Delete Entry
   * @category Entries
   * @description Permanently deletes an entry from a collection type by its Strapi v5 documentId. For internationalized content, deleting without a locale removes all localizations of the document; pass a locale to delete only that localization. Returns an empty data payload on success (HTTP 204 with no body in newer Strapi versions).
   * @route DELETE /delete-entry
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"description":"The plural API ID of the collection type, e.g. articles, products."}
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The Strapi v5 documentId (string) of the entry to delete."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Locale to delete, e.g. en, fr. Omit to delete all localizations of the document. Only relevant when i18n is enabled."}
   * @returns {Object}
   * @sampleResult {"data":null,"meta":{}}
   */
  async deleteEntry(collection, documentId, locale) {
    const pluralApiId = this.#resolveCollection(collection)

    if (!documentId) {
      throw new Error('Strapi API error: A documentId is required.')
    }

    const response = await this.#apiRequest({
      logTag: '[deleteEntry]',
      url: `${ this.apiBase }/${ pluralApiId }/${ encodeURIComponent(documentId) }`,
      method: 'delete',
      query: this.#buildQuery({ locale }),
    })

    // Strapi returns 204 No Content on delete in v5; normalize to a consistent shape.
    return response || { data: null, meta: {} }
  }

  // ---------------------------------------------------------------------------
  //  Media — Upload plugin
  // ---------------------------------------------------------------------------

  /**
   * @operationName Upload File
   * @category Media
   * @description Uploads a file to the Strapi Media Library from a Flowrunner file. Optionally attach the uploaded file to a specific entry field by supplying the target model UID (ref), the numeric entry id (refId), and the field name — for example to set a restaurant's cover image. Returns an array with the uploaded media file object, including its numeric id, url, mime type, size, and generated image formats.
   * @route POST /upload-file
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The Flowrunner file to upload. Its bytes are streamed to Strapi's upload endpoint."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Name to give the file in the Media Library (e.g. cover.jpg). Defaults to the source file name."}
   * @paramDef {"type":"String","label":"Ref (Model UID)","name":"ref","description":"Optional. The content type UID to attach the file to, e.g. api::restaurant.restaurant. Required together with Ref ID and Field to link the upload to an entry."}
   * @paramDef {"type":"String","label":"Ref ID","name":"refId","description":"Optional. The numeric id of the entry to attach the file to. Note: the upload plugin uses the numeric id here, not the documentId."}
   * @paramDef {"type":"String","label":"Field","name":"field","description":"Optional. The name of the media field on the target entry to set, e.g. cover or images."}
   * @returns {Array}
   * @sampleResult [{"id":1,"documentId":"a1b2c3d4e5f6g7h8i9j0","name":"cover.jpg","alternativeText":null,"caption":null,"width":1920,"height":1080,"formats":{"thumbnail":{"url":"/uploads/thumbnail_cover.jpg"}},"hash":"cover_abc123","ext":".jpg","mime":"image/jpeg","size":204.8,"url":"/uploads/cover.jpg","provider":"local","createdAt":"2024-03-05T15:52:05.591Z","updatedAt":"2024-03-05T15:52:05.591Z"}]
   */
  async uploadFile(fileUrl, fileName, ref, refId, field) {
    if (!fileUrl) {
      throw new Error('Strapi API error: A file to upload is required.')
    }

    const resolvedName = fileName || decodeURIComponent(String(fileUrl).split('/').pop().split('?')[0])
    const fileBytes = this.#toBuffer(await Flowrunner.Request.get(fileUrl).setEncoding(null))

    const formData = new Flowrunner.Request.FormData()
    formData.append('files', fileBytes, { filename: resolvedName })

    // Optional linking of the upload to an entry field.
    if (ref) {
      formData.append('ref', ref)
    }

    if (refId !== undefined && refId !== null && refId !== '') {
      formData.append('refId', String(refId))
    }

    if (field) {
      formData.append('field', field)
    }

    return await this.#apiRequest({
      logTag: '[uploadFile]',
      url: `${ this.apiBase }/upload`,
      method: 'post',
      isForm: true,
      form: formData,
    })
  }

  /**
   * @operationName List Media Files
   * @category Media
   * @description Lists files in the Strapi Media Library. Optionally filter by name, mime type, or other file fields using the same nested filter syntax as entries, and sort the results. Returns a flat array of media file objects (id, name, url, mime, size, formats). Folders are an admin-only feature and are not returned by the Content API.
   * @route GET /list-media-files
   * @paramDef {"type":"Object","label":"Filters","name":"filters","description":"Optional filter conditions as a nested object, e.g. {\"mime\":{\"$contains\":\"image\"}} or {\"name\":{\"$contains\":\"logo\"}}. Uses Strapi document operators ($eq, $contains, $in, etc.)."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","description":"Comma-separated sort clauses in field:direction form, e.g. createdAt:desc,name:asc."}
   * @returns {Array}
   * @sampleResult [{"id":1,"name":"cover.jpg","alternativeText":null,"caption":null,"width":1920,"height":1080,"formats":{"thumbnail":{"url":"/uploads/thumbnail_cover.jpg"}},"hash":"cover_abc123","ext":".jpg","mime":"image/jpeg","size":204.8,"url":"/uploads/cover.jpg","provider":"local","createdAt":"2024-03-05T15:52:05.591Z","updatedAt":"2024-03-05T15:52:05.591Z"}]
   */
  async listMediaFiles(filters, sort) {
    const query = {}

    if (filters && typeof filters === 'object') {
      this.#flattenBrackets(filters, 'filters', query)
    }

    if (sort) {
      String(sort)
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .forEach((clause, index) => {
          query[`sort[${ index }]`] = clause
        })
    }

    return await this.#apiRequest({
      logTag: '[listMediaFiles]',
      url: `${ this.apiBase }/upload/files`,
      method: 'get',
      query,
    })
  }

  /**
   * @operationName Get Media File
   * @category Media
   * @description Retrieves the metadata for a single Media Library file by its numeric id. Returns the file object with its name, url, mime type, size, dimensions, and generated image formats.
   * @route GET /get-media-file
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The numeric id of the media file (from Upload File or List Media Files). The upload plugin identifies media by numeric id, not by documentId."}
   * @returns {Object}
   * @sampleResult {"id":1,"name":"cover.jpg","alternativeText":null,"caption":null,"width":1920,"height":1080,"formats":{"thumbnail":{"url":"/uploads/thumbnail_cover.jpg"}},"hash":"cover_abc123","ext":".jpg","mime":"image/jpeg","size":204.8,"url":"/uploads/cover.jpg","provider":"local","createdAt":"2024-03-05T15:52:05.591Z","updatedAt":"2024-03-05T15:52:05.591Z"}
   */
  async getMediaFile(fileId) {
    if (!fileId) {
      throw new Error('Strapi API error: A media file id is required.')
    }

    return await this.#apiRequest({
      logTag: '[getMediaFile]',
      url: `${ this.apiBase }/upload/files/${ encodeURIComponent(fileId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete Media File
   * @category Media
   * @description Permanently deletes a file from the Strapi Media Library by its numeric id. Returns the deleted file's metadata on success.
   * @route DELETE /delete-media-file
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The numeric id of the media file to delete (from Upload File or List Media Files)."}
   * @returns {Object}
   * @sampleResult {"id":1,"name":"cover.jpg","hash":"cover_abc123","ext":".jpg","mime":"image/jpeg","size":204.8,"url":"/uploads/cover.jpg","provider":"local","createdAt":"2024-03-05T15:52:05.591Z","updatedAt":"2024-03-05T15:52:05.591Z"}
   */
  async deleteMediaFile(fileId) {
    if (!fileId) {
      throw new Error('Strapi API error: A media file id is required.')
    }

    return await this.#apiRequest({
      logTag: '[deleteMediaFile]',
      url: `${ this.apiBase }/upload/files/${ encodeURIComponent(fileId) }`,
      method: 'delete',
    })
  }
}

Flowrunner.ServerCode.addService(StrapiService, [
  {
    name: 'baseUrl',
    displayName: 'Base URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Strapi instance URL, e.g. https://your-strapi.example.com (no trailing slash). The REST API is reached at {baseUrl}/api.',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Strapi API token. Create one in the Strapi admin panel under Settings → API Tokens. Grant it the token type / permissions your operations need (e.g. Full access, or a custom scope).',
  },
])
