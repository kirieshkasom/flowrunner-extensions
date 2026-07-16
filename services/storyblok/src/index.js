const logger = {
  info: (...args) => console.log('[Storyblok] info:', ...args),
  debug: (...args) => console.log('[Storyblok] debug:', ...args),
  error: (...args) => console.log('[Storyblok] error:', ...args),
  warn: (...args) => console.log('[Storyblok] warn:', ...args),
}

// Content Delivery API hosts by region. Base path: {host}/v2/cdn
const DELIVERY_HOSTS = {
  EU: 'https://api.storyblok.com',
  US: 'https://api-us.storyblok.com',
  AP: 'https://api-ap.storyblok.com',
  CA: 'https://api-ca.storyblok.com',
  CN: 'https://app.storyblokchina.cn',
}

// Management API hosts by region. Base path: {host}/v1/spaces/{spaceId}
// EU uses the dedicated mapi host; other regions reuse their regional host.
const MANAGEMENT_HOSTS = {
  EU: 'https://mapi.storyblok.com',
  US: 'https://api-us.storyblok.com',
  AP: 'https://api-ap.storyblok.com',
  CA: 'https://api-ca.storyblok.com',
  CN: 'https://app.storyblokchina.cn',
}

const VERSION_MAP = { Draft: 'draft', Published: 'published' }

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

/**
 * @integrationName Storyblok
 * @integrationIcon /icon.svg
 */
class StoryblokService {
  constructor(config) {
    this.contentDeliveryToken = config.contentDeliveryToken
    this.managementToken = config.managementToken
    this.spaceId = config.spaceId
    this.region = config.region || 'EU'
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #deliveryBase() {
    const host = DELIVERY_HOSTS[this.region] || DELIVERY_HOSTS.EU

    return `${ host }/v2/cdn`
  }

  #managementBase() {
    if (!this.spaceId) {
      throw new Error('Storyblok API error: Space ID is required for Management API operations. Set it in the service configuration.')
    }

    const host = MANAGEMENT_HOSTS[this.region] || MANAGEMENT_HOSTS.EU

    return `${ host }/v1/spaces/${ this.spaceId }`
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, headers, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Content-Type': 'application/json', ...(headers || {}) })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const errorBody = error.body
      let message

      if (errorBody && typeof errorBody === 'object') {
        message = errorBody.error || errorBody.message || JSON.stringify(errorBody)
      } else if (typeof errorBody === 'string' && errorBody) {
        message = errorBody
      } else {
        message = error.message
      }

      logger.error(`${ logTag } - failed (${ status || 'no status' }): ${ message }`)

      throw new Error(`Storyblok API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  #deliveryQuery(extra) {
    if (!this.contentDeliveryToken) {
      throw new Error('Storyblok API error: Content Delivery token is required for read operations. Set it in the service configuration.')
    }

    return { token: this.contentDeliveryToken, ...(extra || {}) }
  }

  #managementHeaders() {
    if (!this.managementToken) {
      throw new Error('Storyblok API error: Management token is required for write operations. Set it in the service configuration.')
    }

    // Storyblok Management API expects the bare personal access token, no "Bearer" prefix.
    return { 'Authorization': this.managementToken }
  }

  /**
   * @operationName Get Stories
   * @category Content Delivery
   * @description Retrieves a paginated list of stories (content entries) from a space using the Content Delivery API. Supports filtering by slug prefix, draft vs published version, sorting, and advanced field filtering. Requires a Content Delivery token. The draft version requires a preview token.
   * @route GET /get-stories
   * @paramDef {"type":"String","label":"Version","name":"version","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Published"]}},"description":"Content version to return. Draft requires a preview token. Defaults to Published."}
   * @paramDef {"type":"String","label":"Starts With","name":"startsWith","description":"Filter stories whose full slug begins with this prefix, e.g. blog/ or en/products."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of stories per page (max 100, default 25)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","description":"Sort expression, e.g. created_at:desc, published_at:asc, or content.price:asc:float."}
   * @paramDef {"type":"Object","label":"Filter Query","name":"filterQuery","description":"Advanced filter object mapped to filter_query[field][operation]=value, e.g. {\"component\":{\"in\":\"page\"}} or {\"category\":{\"in\":\"news\"}}."}
   * @returns {Object}
   * @sampleResult {"stories":[{"id":12345,"uuid":"c1a2...","name":"Home","slug":"home","full_slug":"home","content":{"component":"page","body":[]},"published_at":"2024-01-10T12:00:00.000Z"}],"cv":1704888000,"rels":[],"links":[]}
   */
  async getStories(version, startsWith, perPage, page, sortBy, filterQuery) {
    const logTag = '[getStories]'
    const query = this.#deliveryQuery({
      version: this.#resolveChoice(version, VERSION_MAP) || 'published',
      starts_with: startsWith,
      per_page: perPage,
      page,
      sort_by: sortBy,
    })

    if (filterQuery && typeof filterQuery === 'object') {
      for (const field of Object.keys(filterQuery)) {
        const operations = filterQuery[field]

        if (operations && typeof operations === 'object') {
          for (const op of Object.keys(operations)) {
            query[`filter_query[${ field }][${ op }]`] = operations[op]
          }
        }
      }
    }

    return await this.#apiRequest({
      logTag,
      url: `${ this.#deliveryBase() }/stories`,
      method: 'get',
      query,
    })
  }

  /**
   * @operationName Get Story
   * @category Content Delivery
   * @description Retrieves a single story by its full slug or numeric ID using the Content Delivery API. Returns the story object including its resolved content. Requires a Content Delivery token; the draft version requires a preview token.
   * @route GET /get-story
   * @paramDef {"type":"String","label":"Slug or ID","name":"slugOrId","required":true,"description":"Full slug (e.g. blog/my-post) or numeric story ID."}
   * @paramDef {"type":"String","label":"Version","name":"version","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Published"]}},"description":"Content version to return. Draft requires a preview token. Defaults to Published."}
   * @returns {Object}
   * @sampleResult {"story":{"id":12345,"uuid":"c1a2...","name":"Home","slug":"home","full_slug":"home","content":{"component":"page","body":[]},"published_at":"2024-01-10T12:00:00.000Z"},"cv":1704888000,"rels":[],"links":[]}
   */
  async getStory(slugOrId, version) {
    const logTag = '[getStory]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#deliveryBase() }/stories/${ encodeURIComponent(slugOrId) }`,
      method: 'get',
      query: this.#deliveryQuery({
        version: this.#resolveChoice(version, VERSION_MAP) || 'published',
      }),
    })
  }

  /**
   * @operationName Get Datasource Entries
   * @category Content Delivery
   * @description Retrieves entries (key/value pairs) from a datasource using the Content Delivery API. Useful for shared configuration values, translation strings, and select options. Requires a Content Delivery token.
   * @route GET /get-datasource-entries
   * @paramDef {"type":"String","label":"Datasource","name":"datasource","description":"Slug of the datasource to read entries from. Leave empty to return entries across all datasources."}
   * @paramDef {"type":"String","label":"Dimension","name":"dimension","description":"Optional datasource dimension (e.g. a language code) to return dimension-specific values."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of entries per page (max 1000, default 25)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @returns {Object}
   * @sampleResult {"datasource_entries":[{"id":1,"name":"Red","value":"#ff0000","dimension_value":null}]}
   */
  async getDatasourceEntries(datasource, dimension, perPage, page) {
    const logTag = '[getDatasourceEntries]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#deliveryBase() }/datasource_entries`,
      method: 'get',
      query: this.#deliveryQuery({
        datasource,
        dimension,
        per_page: perPage,
        page,
      }),
    })
  }

  /**
   * @operationName Get Links
   * @category Content Delivery
   * @description Retrieves the link tree of a space using the Content Delivery API. Returns a lightweight map of all stories with their slugs, parent relationships, and folder flags — ideal for building navigation menus. Requires a Content Delivery token.
   * @route GET /get-links
   * @paramDef {"type":"String","label":"Version","name":"version","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Published"]}},"description":"Content version to return. Draft requires a preview token. Defaults to Published."}
   * @paramDef {"type":"String","label":"Starts With","name":"startsWith","description":"Filter links whose full slug begins with this prefix, e.g. blog/."}
   * @returns {Object}
   * @sampleResult {"links":{"c1a2...":{"id":12345,"uuid":"c1a2...","slug":"home","name":"Home","is_folder":false,"parent_id":0,"published":true}}}
   */
  async getLinks(version, startsWith) {
    const logTag = '[getLinks]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#deliveryBase() }/links`,
      method: 'get',
      query: this.#deliveryQuery({
        version: this.#resolveChoice(version, VERSION_MAP) || 'published',
        starts_with: startsWith,
      }),
    })
  }

  /**
   * @operationName Get Tags
   * @category Content Delivery
   * @description Retrieves all tags used across stories in a space using the Content Delivery API, each with a count of how many stories use it. Requires a Content Delivery token.
   * @route GET /get-tags
   * @paramDef {"type":"String","label":"Starts With","name":"startsWith","description":"Only include tags used by stories whose full slug begins with this prefix, e.g. blog/."}
   * @returns {Object}
   * @sampleResult {"tags":[{"name":"featured","taggings_count":4},{"name":"news","taggings_count":12}]}
   */
  async getTags(startsWith) {
    const logTag = '[getTags]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#deliveryBase() }/tags`,
      method: 'get',
      query: this.#deliveryQuery({ starts_with: startsWith }),
    })
  }

  /**
   * @operationName Create Story
   * @category Content Management
   * @description Creates a new story (content entry) in the configured space using the Management API. Provide a display name, a full slug, and a content object whose component matches a content type defined in the space. Requires a Management token and a Space ID. Optionally publishes the story on creation.
   * @route POST /create-story
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name of the story shown in the Storyblok editor."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","required":true,"description":"URL slug for the story, e.g. my-first-post. Combined with any parent folder to form the full slug."}
   * @paramDef {"type":"Object","label":"Content","name":"content","required":true,"description":"Content object for the story. Must include a component key matching a content type, e.g. {\"component\":\"page\",\"title\":\"Hello\"}."}
   * @paramDef {"type":"Number","label":"Parent ID","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional numeric ID of the parent folder story to nest this story under."}
   * @paramDef {"type":"Boolean","label":"Publish","name":"publish","uiComponent":{"type":"CHECKBOX"},"description":"Publish the story immediately after creation. Defaults to false (saved as draft)."}
   * @returns {Object}
   * @sampleResult {"story":{"id":12346,"name":"My First Post","slug":"my-first-post","full_slug":"my-first-post","content":{"component":"page","title":"Hello"},"published":false}}
   */
  async createStory(name, slug, content, parentId, publish) {
    const logTag = '[createStory]'
    const story = clean({ name, slug, content, parent_id: parentId })

    return await this.#apiRequest({
      logTag,
      url: `${ this.#managementBase() }/stories`,
      method: 'post',
      headers: this.#managementHeaders(),
      query: publish ? { publish: 1 } : undefined,
      body: { story },
    })
  }

  /**
   * @operationName Update Story
   * @category Content Management
   * @description Updates an existing story in the configured space using the Management API. Only the fields you provide are changed. Requires a Management token and a Space ID. Optionally publishes the story after updating.
   * @route PUT /update-story
   * @paramDef {"type":"Number","label":"Story ID","name":"storyId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the story to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New display name for the story. Leave empty to keep the current name."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"New URL slug for the story. Leave empty to keep the current slug."}
   * @paramDef {"type":"Object","label":"Content","name":"content","description":"New content object for the story, e.g. {\"component\":\"page\",\"title\":\"Updated\"}. Leave empty to keep the current content."}
   * @paramDef {"type":"Boolean","label":"Publish","name":"publish","uiComponent":{"type":"CHECKBOX"},"description":"Publish the story after updating. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"story":{"id":12346,"name":"Updated Post","slug":"my-first-post","full_slug":"my-first-post","content":{"component":"page","title":"Updated"},"published":true}}
   */
  async updateStory(storyId, name, slug, content, publish) {
    const logTag = '[updateStory]'
    const story = clean({ name, slug, content })

    return await this.#apiRequest({
      logTag,
      url: `${ this.#managementBase() }/stories/${ storyId }`,
      method: 'put',
      headers: this.#managementHeaders(),
      query: publish ? { publish: 1 } : undefined,
      body: { story },
    })
  }

  /**
   * @operationName Delete Story
   * @category Content Management
   * @description Permanently deletes a story from the configured space using the Management API. This cannot be undone. Requires a Management token and a Space ID.
   * @route DELETE /delete-story
   * @paramDef {"type":"Number","label":"Story ID","name":"storyId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the story to delete."}
   * @returns {Object}
   * @sampleResult {"story":{"id":12346,"name":"My First Post","slug":"my-first-post"}}
   */
  async deleteStory(storyId) {
    const logTag = '[deleteStory]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#managementBase() }/stories/${ storyId }`,
      method: 'delete',
      headers: this.#managementHeaders(),
    })
  }

  /**
   * @operationName Publish Story
   * @category Content Management
   * @description Publishes a story in the configured space using the Management API, making its current draft content live. Requires a Management token and a Space ID.
   * @route POST /publish-story
   * @paramDef {"type":"Number","label":"Story ID","name":"storyId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the story to publish."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional language code to publish a specific translation (field-level translations). Leave empty to publish the default language."}
   * @returns {Object}
   * @sampleResult {"story":{"id":12346,"name":"My First Post","slug":"my-first-post","published":true}}
   */
  async publishStory(storyId, language) {
    const logTag = '[publishStory]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#managementBase() }/stories/${ storyId }/publish`,
      method: 'get',
      headers: this.#managementHeaders(),
      query: clean({ lang: language }),
    })
  }

  /**
   * @operationName List Stories
   * @category Content Management
   * @description Lists stories in the configured space using the Management API, including drafts and unpublished content. Supports pagination and filtering by slug prefix. Requires a Management token and a Space ID. Use this (rather than Get Stories) when you need editorial metadata such as unpublished changes.
   * @route GET /list-stories
   * @paramDef {"type":"String","label":"Starts With","name":"startsWith","description":"Filter stories whose full slug begins with this prefix, e.g. blog/."}
   * @paramDef {"type":"String","label":"Text Search","name":"search","description":"Free-text search term matched against story names and slugs."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of stories per page (max 100, default 25)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @returns {Object}
   * @sampleResult {"stories":[{"id":12345,"name":"Home","slug":"home","full_slug":"home","published":true,"unpublished_changes":false}]}
   */
  async listStories(startsWith, search, perPage, page) {
    const logTag = '[listStories]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#managementBase() }/stories`,
      method: 'get',
      headers: this.#managementHeaders(),
      query: clean({
        starts_with: startsWith,
        search,
        per_page: perPage,
        page,
      }),
    })
  }

  /**
   * @operationName Get Space
   * @category Content Management
   * @description Retrieves details about the configured space using the Management API, including its name, plan, domain, default language, and environment settings. Requires a Management token and a Space ID.
   * @route GET /get-space
   * @returns {Object}
   * @sampleResult {"space":{"id":100001,"name":"My Space","domain":"https://my-space.storyblok.com","plan":"starter","default_root":"page","languages":[]}}
   */
  async getSpace() {
    const logTag = '[getSpace]'

    return await this.#apiRequest({
      logTag,
      url: this.#managementBase(),
      method: 'get',
      headers: this.#managementHeaders(),
    })
  }

  /**
   * @operationName List Assets
   * @category Content Management
   * @description Lists assets (images, documents, and other uploaded files) in the configured space using the Management API. Supports pagination and filtering by containing folder. Requires a Management token and a Space ID.
   * @route GET /list-assets
   * @paramDef {"type":"Number","label":"Folder ID","name":"folderId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional numeric ID of an asset folder to list assets from. Leave empty to list assets across the space."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search term matched against asset filenames."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of assets per page (max 100, default 25)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @returns {Object}
   * @sampleResult {"assets":[{"id":9001,"filename":"https://a.storyblok.com/f/100001/photo.jpg","content_type":"image/jpeg","content_length":204800}]}
   */
  async listAssets(folderId, search, perPage, page) {
    const logTag = '[listAssets]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#managementBase() }/assets`,
      method: 'get',
      headers: this.#managementHeaders(),
      query: clean({
        in_folder: folderId,
        search,
        per_page: perPage,
        page,
      }),
    })
  }
}

Flowrunner.ServerCode.addService(StoryblokService, [
  {
    name: 'contentDeliveryToken',
    displayName: 'Content Delivery Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Storyblok → Space → Settings → Access Tokens → a public or preview token (Delivery/read API).',
  },
  {
    name: 'managementToken',
    displayName: 'Management Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Storyblok → My Account → Personal access tokens (Management/write API).',
  },
  {
    name: 'spaceId',
    displayName: 'Space ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Your Space ID — required for Management API operations.',
  },
  {
    name: 'region',
    displayName: 'Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    required: false,
    shared: false,
    defaultValue: 'EU',
    options: ['EU', 'US', 'AP', 'CA', 'CN'],
    hint: 'Data residency region of your Storyblok space. Defaults to EU.',
  },
])
