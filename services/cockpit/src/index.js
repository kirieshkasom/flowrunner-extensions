const logger = {
  info: (...args) => console.log('[Cockpit] info:', ...args),
  debug: (...args) => console.log('[Cockpit] debug:', ...args),
  error: (...args) => console.log('[Cockpit] error:', ...args),
  warn: (...args) => console.log('[Cockpit] warn:', ...args),
}

function clean(obj) {
  if (!obj) {
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

// Cockpit expects filter/sort/fields as URL-encoded JSON strings on the query.
// Accepts an already-stringified JSON string or an object/array to serialize.
function toJsonParam(value) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch (error) {
    logger.warn(`Could not serialize query param: ${ error.message }`)

    return undefined
  }
}

/**
 * @integrationName Cockpit
 * @integrationIcon /icon.svg
 */
class CockpitService {
  constructor(config) {
    this.url = (config.url || '').replace(/\/+$/, '')
    this.apiKey = config.apiKey
    this.baseUrl = `${ this.url }/api`
  }

  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const body = error.body

      let message

      if (body && typeof body === 'object') {
        message = body.error || body.message || JSON.stringify(body)
      } else if (typeof body === 'string' && body) {
        message = body
      } else {
        message = error.message
      }

      logger.error(`${ logTag } - failed (${ status || 'no status' }): ${ message }`)

      throw new Error(`Cockpit API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Get Content Items
   * @category Content Items
   * @description Lists entries from a Cockpit content model (collection). Returns an array of items. Supports MongoDB-style filtering, sorting, field projection, pagination, linked-content population, and localization. The model is the collection name defined in Cockpit (e.g. "posts", "pages").
   * @route GET /content-items
   * @appearanceColor #0B1019 #2C3E50
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Name of the content model (collection) to read, e.g. posts or pages."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"MongoDB-style query object, e.g. {\"published\":true} or {\"title\":{\"$regex\":\"news\"}}. Sent as a JSON filter parameter."}
   * @paramDef {"type":"Object","label":"Sort","name":"sort","description":"Sort object where 1 is ascending and -1 descending, e.g. {\"_created\":-1}."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","description":"Field projection, e.g. {\"title\":1,\"content\":1} to include or {\"content\":0} to exclude."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of items to return."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items to skip, for pagination."}
   * @paramDef {"type":"Number","label":"Populate","name":"populate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Depth to which linked content items are populated (0 = none)."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Locale code to return localized field values, e.g. en or de."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"65a1b2c3d4e5f6a7b8c9d0e1","title":"Hello World","content":"Lorem ipsum","_state":1,"_created":1705000000,"_modified":1705000000}]
   */
  async getContentItems(model, filter, sort, fields, limit, skip, populate, locale) {
    const logTag = '[getContentItems]'

    return await this.#apiRequest({
      logTag,
      path: `/content/items/${ encodeURIComponent(model) }`,
      method: 'get',
      query: {
        filter: toJsonParam(filter),
        sort: toJsonParam(sort),
        fields: toJsonParam(fields),
        limit,
        skip,
        populate,
        locale,
      },
    })
  }

  /**
   * @operationName Get Content Item
   * @category Content Items
   * @description Retrieves a single entry from a content model. Provide an item ID to fetch by ID, or a MongoDB-style filter to fetch the first matching item. Supports field projection, population, and localization.
   * @route GET /content-item
   * @appearanceColor #0B1019 #2C3E50
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Name of the content model (collection), e.g. posts."}
   * @paramDef {"type":"String","label":"Item ID","name":"id","description":"ID of the item to fetch. If provided, the filter is ignored."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"MongoDB-style query to select the first matching item, e.g. {\"slug\":\"hello-world\"}. Used only when no Item ID is given."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","description":"Field projection, e.g. {\"title\":1,\"content\":1}."}
   * @paramDef {"type":"Number","label":"Populate","name":"populate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Depth to which linked content items are populated (0 = none)."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Locale code to return localized field values, e.g. en."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"65a1b2c3d4e5f6a7b8c9d0e1","title":"Hello World","content":"Lorem ipsum","_state":1,"_created":1705000000,"_modified":1705000000}
   */
  async getContentItem(model, id, filter, fields, populate, locale) {
    const logTag = '[getContentItem]'
    const encodedModel = encodeURIComponent(model)
    const path = id
      ? `/content/item/${ encodedModel }/${ encodeURIComponent(id) }`
      : `/content/item/${ encodedModel }`

    return await this.#apiRequest({
      logTag,
      path,
      method: 'get',
      query: {
        filter: id ? undefined : toJsonParam(filter),
        fields: toJsonParam(fields),
        populate,
        locale,
      },
    })
  }

  /**
   * @operationName Get Singleton
   * @category Singletons
   * @description Retrieves the content of a Cockpit singleton by name. A singleton is a single, non-repeating content entry (e.g. site settings, homepage). Returns the singleton's field values.
   * @route GET /singleton
   * @appearanceColor #0B1019 #2C3E50
   *
   * @paramDef {"type":"String","label":"Singleton Name","name":"name","required":true,"description":"Name of the singleton to fetch, e.g. settings or homepage."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Locale code to return localized field values, e.g. en."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"65a1b2c3d4e5f6a7b8c9d0e2","siteTitle":"My Site","tagline":"Welcome","_modified":1705000000}
   */
  async getSingleton(name, locale) {
    const logTag = '[getSingleton]'

    return await this.#apiRequest({
      logTag,
      path: `/content/item/${ encodeURIComponent(name) }`,
      method: 'get',
      query: { locale },
    })
  }

  /**
   * @operationName Save Content Item
   * @category Content Items
   * @description Creates or updates an entry in a content model. Omit the Item ID to create a new item; provide the Item ID to update the existing item with that ID. The Data object holds the model's field values. Returns the saved item including its _id.
   * @route POST /save-content-item
   * @appearanceColor #0B1019 #2C3E50
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Name of the content model (collection) to write to, e.g. posts."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Field values for the item, e.g. {\"title\":\"Hello\",\"content\":\"Lorem ipsum\",\"published\":true}."}
   * @paramDef {"type":"String","label":"Item ID","name":"id","description":"ID of the item to update. Leave empty to create a new item."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"65a1b2c3d4e5f6a7b8c9d0e1","title":"Hello","content":"Lorem ipsum","published":true,"_created":1705000000,"_modified":1705000000}
   */
  async saveContentItem(model, data, id) {
    const logTag = '[saveContentItem]'
    const payload = { ...(data || {}) }

    // Cockpit v2 distinguishes create vs update by the presence of _id inside data.
    if (id) {
      payload._id = id
    }

    return await this.#apiRequest({
      logTag,
      path: `/content/item/${ encodeURIComponent(model) }`,
      method: 'post',
      body: { data: payload },
    })
  }

  /**
   * @operationName Update Content Item
   * @category Content Items
   * @description Updates an existing entry in a content model by ID. The Data object holds the field values to set. This is a convenience over Save Content Item for updates; the item ID is required.
   * @route POST /update-content-item
   * @appearanceColor #0B1019 #2C3E50
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Name of the content model (collection), e.g. posts."}
   * @paramDef {"type":"String","label":"Item ID","name":"id","required":true,"description":"ID of the item to update."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Field values to update, e.g. {\"title\":\"Updated title\"}."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"65a1b2c3d4e5f6a7b8c9d0e1","title":"Updated title","content":"Lorem ipsum","_modified":1705000100}
   */
  async updateContentItem(model, id, data) {
    const logTag = '[updateContentItem]'

    return await this.#apiRequest({
      logTag,
      path: `/content/item/${ encodeURIComponent(model) }`,
      method: 'post',
      body: { data: { ...(data || {}), _id: id } },
    })
  }

  /**
   * @operationName Delete Content Item
   * @category Content Items
   * @description Deletes an entry from a content model by ID. This is permanent and cannot be undone.
   * @route DELETE /delete-content-item
   * @appearanceColor #0B1019 #2C3E50
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Name of the content model (collection), e.g. posts."}
   * @paramDef {"type":"String","label":"Item ID","name":"id","required":true,"description":"ID of the item to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteContentItem(model, id) {
    const logTag = '[deleteContentItem]'

    return await this.#apiRequest({
      logTag,
      path: `/content/item/${ encodeURIComponent(model) }/${ encodeURIComponent(id) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Get Content Tree
   * @category Content Items
   * @description Retrieves entries of a tree-structured content model as a nested tree, where child items are attached to their parents. Supports field projection, population, and localization.
   * @route GET /content-tree
   * @appearanceColor #0B1019 #2C3E50
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Name of the tree-structured content model, e.g. navigation."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","description":"Field projection, e.g. {\"title\":1}."}
   * @paramDef {"type":"Number","label":"Populate","name":"populate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Depth to which linked content items are populated (0 = none)."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Locale code to return localized field values, e.g. en."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"65a1b2c3d4e5f6a7b8c9d0e1","title":"Root","children":[{"_id":"65a1b2c3d4e5f6a7b8c9d0e2","title":"Child"}]}]
   */
  async getContentTree(model, fields, populate, locale) {
    const logTag = '[getContentTree]'

    return await this.#apiRequest({
      logTag,
      path: `/content/tree/${ encodeURIComponent(model) }`,
      method: 'get',
      query: {
        fields: toJsonParam(fields),
        populate,
        locale,
      },
    })
  }

  /**
   * @operationName Count Content Items
   * @category Content Items
   * @description Returns the number of items in a content model that match an optional MongoDB-style filter. Fetches matching items and counts them, so use a filter to narrow large collections.
   * @route GET /count-content-items
   * @appearanceColor #0B1019 #2C3E50
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Name of the content model (collection), e.g. posts."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"MongoDB-style query object to count matching items, e.g. {\"published\":true}. Omit to count all items."}
   *
   * @returns {Object}
   * @sampleResult {"model":"posts","count":42}
   */
  async countContentItems(model, filter) {
    const logTag = '[countContentItems]'

    const items = await this.#apiRequest({
      logTag,
      path: `/content/items/${ encodeURIComponent(model) }`,
      method: 'get',
      query: {
        filter: toJsonParam(filter),
        fields: JSON.stringify({ _id: 1 }),
      },
    })

    const count = Array.isArray(items) ? items.length : 0

    return { model, count }
  }

  /**
   * @operationName List Assets
   * @category Assets
   * @description Lists assets (uploaded files) from the Cockpit asset manager. Supports MongoDB-style filtering, sorting, and pagination. Returns asset metadata including id, path, title, mime type, and size.
   * @route GET /list-assets
   * @appearanceColor #0B1019 #2C3E50
   *
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"MongoDB-style query object, e.g. {\"mime\":{\"$regex\":\"image\"}}."}
   * @paramDef {"type":"Object","label":"Sort","name":"sort","description":"Sort object, e.g. {\"_created\":-1}."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of assets to return."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of assets to skip, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"assets":[{"_id":"65a1b2c3d4e5f6a7b8c9d0e3","path":"/2024/01/photo.jpg","title":"photo.jpg","mime":"image/jpeg","size":204800}],"total":1}
   */
  async listAssets(filter, sort, limit, skip) {
    const logTag = '[listAssets]'

    return await this.#apiRequest({
      logTag,
      path: '/assets',
      method: 'get',
      query: {
        filter: toJsonParam(filter),
        sort: toJsonParam(sort),
        limit,
        skip,
      },
    })
  }

  /**
   * @operationName Get Asset
   * @category Assets
   * @description Retrieves metadata for a single asset by ID, including its path, title, mime type, size, and dimensions.
   * @route GET /get-asset
   * @appearanceColor #0B1019 #2C3E50
   *
   * @paramDef {"type":"String","label":"Asset ID","name":"id","required":true,"description":"ID of the asset to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"65a1b2c3d4e5f6a7b8c9d0e3","path":"/2024/01/photo.jpg","title":"photo.jpg","mime":"image/jpeg","size":204800,"width":1200,"height":800}
   */
  async getAsset(id) {
    const logTag = '[getAsset]'

    return await this.#apiRequest({
      logTag,
      path: `/assets/${ encodeURIComponent(id) }`,
      method: 'get',
    })
  }
}

Flowrunner.ServerCode.addService(CockpitService, [
  {
    name: 'url',
    displayName: 'Cockpit URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Cockpit CMS URL, e.g. https://cms.example.com (strip any trailing slash). The API base /api is appended automatically.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Create an API key in Cockpit under Settings -> API. Sent as the api-key request header.',
  },
])
