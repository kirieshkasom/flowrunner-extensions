const logger = {
  info: (...args) => console.log('[Raindrop.io] info:', ...args),
  debug: (...args) => console.log('[Raindrop.io] debug:', ...args),
  error: (...args) => console.log('[Raindrop.io] error:', ...args),
  warn: (...args) => console.log('[Raindrop.io] warn:', ...args),
}

const API_BASE_URL = 'https://api.raindrop.io/rest/v1'

const DICTIONARY_PER_PAGE = 50

const VIEW_MAP = {
  'List': 'list',
  'Simple': 'simple',
  'Grid': 'grid',
  'Masonry': 'masonry',
}

const SORT_MAP = {
  'Newest first': '-created',
  'Oldest first': 'created',
  'Relevancy': 'score',
  'Manual order': '-sort',
  'Title A-Z': 'title',
  'Title Z-A': '-title',
  'Domain A-Z': 'domain',
  'Domain Z-A': '-domain',
}

/**
 * Removes undefined, null, and empty-string values from a flat object so they
 * are not sent to the Raindrop API.
 */
function clean(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const result = {}

  for (const key of Object.keys(obj)) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * Splits a comma-separated tag string (or passes through an array) into a
 * trimmed array of tags. Returns undefined when there is nothing to send.
 */
function toTagArray(tags) {
  if (tags === undefined || tags === null || tags === '') {
    return undefined
  }

  const list = Array.isArray(tags) ? tags : String(tags).split(',')
  const cleaned = list.map(tag => String(tag).trim()).filter(Boolean)

  return cleaned.length ? cleaned : undefined
}

/**
 * @integrationName Raindrop.io
 * @integrationIcon /icon.png
 */
class RaindropService {
  constructor(config) {
    this.accessToken = config.accessToken
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      const response = body !== undefined ? await request.send(body) : await request

      // Raindrop wraps responses in { result: boolean, ... }. A false result
      // is a logical failure even when the HTTP status is 200.
      if (response && response.result === false) {
        throw new Error(`Raindrop.io API error: ${ response.errorMessage || response.error || 'Request was not successful' }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('Raindrop.io API error:')) {
        throw error
      }

      const status = error.status || error.statusCode
      const apiMessage = error.body?.errorMessage || error.body?.error || error.message
      const message = status ? `${ apiMessage } (status ${ status })` : apiMessage

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`Raindrop.io API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /* ----------------------------------------------------------------------- */
  /* Collections                                                             */
  /* ----------------------------------------------------------------------- */

  /**
   * @operationName Get Collections
   * @category Collections
   * @description Retrieves all root (top-level) collections for the authenticated Raindrop.io account. Returns each collection's id, title, bookmark count, view style, visibility, and metadata. Use Get Child Collections to retrieve nested collections.
   * @route GET /collections
   *
   * @returns {Object}
   * @sampleResult {"result":true,"items":[{"_id":8492393,"title":"Reading List","count":42,"public":false,"view":"list","sort":0,"created":"2023-01-04T12:00:00Z"}]}
   */
  async getCollections() {
    return await this.#apiRequest({
      logTag: '[getCollections]',
      url: `${ API_BASE_URL }/collections`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Child Collections
   * @category Collections
   * @description Retrieves all nested (child) collections for the authenticated account, i.e. every collection that has a parent. Combine with Get Collections to reconstruct the full collection tree.
   * @route GET /collections/childrens
   *
   * @returns {Object}
   * @sampleResult {"result":true,"items":[{"_id":8492400,"title":"Design","count":12,"parent":{"$id":8492393},"public":false,"view":"grid"}]}
   */
  async getChildCollections() {
    return await this.#apiRequest({
      logTag: '[getChildCollections]',
      url: `${ API_BASE_URL }/collections/childrens`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Collection
   * @category Collections
   * @description Retrieves a single collection by its id, including title, bookmark count, view style, visibility, cover, and parent reference.
   * @route GET /collection
   *
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCollectionsDictionary","description":"The id of the collection to retrieve. Search and select a collection, or enter an id directly."}
   *
   * @returns {Object}
   * @sampleResult {"result":true,"item":{"_id":8492393,"title":"Reading List","count":42,"public":false,"view":"list"}}
   */
  async getCollection(collectionId) {
    return await this.#apiRequest({
      logTag: '[getCollection]',
      url: `${ API_BASE_URL }/collection/${ collectionId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Collection
   * @category Collections
   * @description Creates a new collection. Provide a title and optionally the view style, public visibility, and a parent collection to nest it under. Returns the newly created collection.
   * @route POST /collection
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Name of the new collection."}
   * @paramDef {"type":"String","label":"View","name":"view","uiComponent":{"type":"DROPDOWN","options":{"values":["List","Simple","Grid","Masonry"]}},"defaultValue":"List","description":"Display style for bookmarks in this collection. Defaults to List."}
   * @paramDef {"type":"Boolean","label":"Public","name":"isPublic","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the collection is accessible to anyone without authentication. Defaults to false."}
   * @paramDef {"type":"Number","label":"Parent Collection ID","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCollectionsDictionary","description":"Optional parent collection id to nest this collection under. Leave empty to create a root collection."}
   *
   * @returns {Object}
   * @sampleResult {"result":true,"item":{"_id":8492500,"title":"Recipes","view":"list","public":false}}
   */
  async createCollection(title, view, isPublic, parentId) {
    const body = clean({
      title,
      view: this.#resolveChoice(view, VIEW_MAP),
      public: isPublic,
    })

    if (parentId !== undefined && parentId !== null && parentId !== '') {
      body.parent = { $id: parentId }
    }

    return await this.#apiRequest({
      logTag: '[createCollection]',
      url: `${ API_BASE_URL }/collection`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Collection
   * @category Collections
   * @description Updates an existing collection. Any of title, view style, public visibility, or parent collection can be changed; omitted fields are left unchanged. Returns the updated collection.
   * @route PUT /collection
   *
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCollectionsDictionary","description":"The id of the collection to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New collection title. Leave empty to keep the current title."}
   * @paramDef {"type":"String","label":"View","name":"view","uiComponent":{"type":"DROPDOWN","options":{"values":["List","Simple","Grid","Masonry"]}},"description":"New display style. Leave empty to keep the current view."}
   * @paramDef {"type":"Boolean","label":"Public","name":"isPublic","uiComponent":{"type":"TOGGLE"},"description":"Set public visibility. Leave unset to keep the current value."}
   * @paramDef {"type":"Number","label":"Parent Collection ID","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCollectionsDictionary","description":"Move this collection under a new parent collection. Leave empty to keep the current parent."}
   *
   * @returns {Object}
   * @sampleResult {"result":true,"item":{"_id":8492393,"title":"Reading List (updated)","view":"grid","public":true}}
   */
  async updateCollection(collectionId, title, view, isPublic, parentId) {
    const body = clean({
      title,
      view: this.#resolveChoice(view, VIEW_MAP),
      public: isPublic,
    })

    if (parentId !== undefined && parentId !== null && parentId !== '') {
      body.parent = { $id: parentId }
    }

    return await this.#apiRequest({
      logTag: '[updateCollection]',
      url: `${ API_BASE_URL }/collection/${ collectionId }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete Collection
   * @category Collections
   * @description Deletes a collection by id. The bookmarks it contains are moved to Unsorted rather than deleted, and any descendant collections are removed as well.
   * @route DELETE /collection
   *
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCollectionsDictionary","description":"The id of the collection to delete."}
   *
   * @returns {Object}
   * @sampleResult {"result":true}
   */
  async deleteCollection(collectionId) {
    return await this.#apiRequest({
      logTag: '[deleteCollection]',
      url: `${ API_BASE_URL }/collection/${ collectionId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Empty Trash
   * @category Collections
   * @description Permanently empties the Trash collection, deleting all bookmarks it contains. This action cannot be undone.
   * @route DELETE /collection/trash
   *
   * @returns {Object}
   * @sampleResult {"result":true}
   */
  async emptyTrash() {
    return await this.#apiRequest({
      logTag: '[emptyTrash]',
      url: `${ API_BASE_URL }/collection/-99`,
      method: 'delete',
    })
  }

  /* ----------------------------------------------------------------------- */
  /* Raindrops (bookmarks)                                                   */
  /* ----------------------------------------------------------------------- */

  /**
   * @operationName Get Raindrops
   * @category Raindrops
   * @description Lists bookmarks (raindrops) in a collection with search, sorting, and pagination. Use collection id 0 for all bookmarks, -1 for Unsorted, or -99 for Trash. The search term supports Raindrop's search operators (e.g. tag, site, type). Returns a page of raindrops plus the total count.
   * @route GET /raindrops
   *
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCollectionsDictionary","description":"Collection to list. Use 0 for all bookmarks, -1 for Unsorted, or -99 for Trash."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional full-text search query. Supports Raindrop operators such as #tag, site:example.com, and type:article."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Newest first","Oldest first","Relevancy","Manual order","Title A-Z","Title Z-A","Domain A-Z","Domain Z-A"]}},"defaultValue":"Newest first","description":"Order of returned bookmarks. Defaults to Newest first."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of bookmarks per page (max 50). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"result":true,"items":[{"_id":123456,"title":"Example","link":"https://example.com","excerpt":"An example page","tags":["reference"],"collection":{"$id":8492393}}],"count":42}
   */
  async getRaindrops(collectionId, search, sort, page, perPage) {
    return await this.#apiRequest({
      logTag: '[getRaindrops]',
      url: `${ API_BASE_URL }/raindrops/${ collectionId }`,
      method: 'get',
      query: {
        search,
        sort: this.#resolveChoice(sort, SORT_MAP),
        page,
        perpage: perPage,
      },
    })
  }

  /**
   * @operationName Get Raindrop
   * @category Raindrops
   * @description Retrieves a single bookmark (raindrop) by its id, including link, title, excerpt, note, tags, cover, type, and its parent collection.
   * @route GET /raindrop
   *
   * @paramDef {"type":"Number","label":"Raindrop ID","name":"raindropId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the bookmark to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"result":true,"item":{"_id":123456,"title":"Example","link":"https://example.com","excerpt":"An example page","tags":["reference"],"type":"link","collection":{"$id":8492393}}}
   */
  async getRaindrop(raindropId) {
    return await this.#apiRequest({
      logTag: '[getRaindrop]',
      url: `${ API_BASE_URL }/raindrop/${ raindropId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Raindrop
   * @category Raindrops
   * @description Creates a new bookmark (raindrop) from a link. Optionally set a title, excerpt, tags, and target collection. When Parse Metadata is enabled, Raindrop fetches the page in the background to fill in the title, excerpt, and cover automatically.
   * @route POST /raindrop
   *
   * @paramDef {"type":"String","label":"Link","name":"link","required":true,"description":"URL to bookmark."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Bookmark title. Leave empty to let Raindrop parse it from the page."}
   * @paramDef {"type":"String","label":"Excerpt","name":"excerpt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Short description or excerpt for the bookmark."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to attach to the bookmark. Accepts a list of tags or a comma-separated string."}
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCollectionsDictionary","description":"Collection to add the bookmark to. Use -1 for Unsorted. Defaults to Unsorted when empty."}
   * @paramDef {"type":"Boolean","label":"Parse Metadata","name":"pleaseParse","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"When enabled, Raindrop parses the link in the background to auto-fill cover, description, and other metadata. Defaults to true."}
   *
   * @returns {Object}
   * @sampleResult {"result":true,"item":{"_id":123457,"title":"Example","link":"https://example.com","tags":["reference"],"collection":{"$id":-1}}}
   */
  async createRaindrop(link, title, excerpt, tags, collectionId, pleaseParse) {
    const body = clean({
      link,
      title,
      excerpt,
      tags: toTagArray(tags),
    })

    if (collectionId !== undefined && collectionId !== null && collectionId !== '') {
      body.collection = { $id: collectionId }
    }

    if (pleaseParse !== false) {
      body.pleaseParse = {}
    }

    return await this.#apiRequest({
      logTag: '[createRaindrop]',
      url: `${ API_BASE_URL }/raindrop`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Raindrop
   * @category Raindrops
   * @description Updates an existing bookmark (raindrop). Any of link, title, excerpt, tags, collection, or important flag can be changed; omitted fields are left unchanged. Returns the updated raindrop.
   * @route PUT /raindrop
   *
   * @paramDef {"type":"Number","label":"Raindrop ID","name":"raindropId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the bookmark to update."}
   * @paramDef {"type":"String","label":"Link","name":"link","description":"New URL for the bookmark. Leave empty to keep the current link."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title. Leave empty to keep the current title."}
   * @paramDef {"type":"String","label":"Excerpt","name":"excerpt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New excerpt or description. Leave empty to keep the current excerpt."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Replacement set of tags. Accepts a list or a comma-separated string. Leave empty to keep the current tags."}
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCollectionsDictionary","description":"Move the bookmark to this collection. Leave empty to keep the current collection."}
   * @paramDef {"type":"Boolean","label":"Important","name":"important","uiComponent":{"type":"TOGGLE"},"description":"Mark or unmark the bookmark as a favorite. Leave unset to keep the current value."}
   *
   * @returns {Object}
   * @sampleResult {"result":true,"item":{"_id":123456,"title":"Updated title","link":"https://example.com","tags":["reference","updated"],"important":true}}
   */
  async updateRaindrop(raindropId, link, title, excerpt, tags, collectionId, important) {
    const body = clean({
      link,
      title,
      excerpt,
      tags: toTagArray(tags),
      important,
    })

    if (collectionId !== undefined && collectionId !== null && collectionId !== '') {
      body.collection = { $id: collectionId }
    }

    return await this.#apiRequest({
      logTag: '[updateRaindrop]',
      url: `${ API_BASE_URL }/raindrop/${ raindropId }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete Raindrop
   * @category Raindrops
   * @description Deletes a bookmark (raindrop) by id. The bookmark is moved to Trash; deleting a bookmark that is already in Trash removes it permanently.
   * @route DELETE /raindrop
   *
   * @paramDef {"type":"Number","label":"Raindrop ID","name":"raindropId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the bookmark to delete."}
   *
   * @returns {Object}
   * @sampleResult {"result":true}
   */
  async deleteRaindrop(raindropId) {
    return await this.#apiRequest({
      logTag: '[deleteRaindrop]',
      url: `${ API_BASE_URL }/raindrop/${ raindropId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Create Many Raindrops
   * @category Raindrops
   * @description Creates multiple bookmarks (raindrops) in a single request, up to 100 at once. Each item must be an object with at least a link; it may also include title, excerpt, tags, and a collection reference in the form {"collection":{"$id":123}}.
   * @route POST /raindrops
   *
   * @paramDef {"type":"Array<Object>","label":"Items","name":"items","required":true,"description":"Array of raindrop objects to create (max 100). Each object requires a 'link' and may include title, excerpt, tags, and collection:{\"$id\":id}."}
   *
   * @returns {Object}
   * @sampleResult {"result":true,"items":[{"_id":123458,"link":"https://a.com"},{"_id":123459,"link":"https://b.com"}]}
   */
  async createManyRaindrops(items) {
    return await this.#apiRequest({
      logTag: '[createManyRaindrops]',
      url: `${ API_BASE_URL }/raindrops`,
      method: 'post',
      body: { items: items || [] },
    })
  }

  /**
   * @operationName Update Many Raindrops
   * @category Raindrops
   * @description Applies a bulk update to bookmarks within a collection. Optionally restrict to specific raindrop ids; otherwise all bookmarks in the collection are affected. Can add tags, toggle the important (favorite) flag, or move bookmarks to another collection.
   * @route PUT /raindrops
   *
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCollectionsDictionary","description":"Collection whose bookmarks will be updated. Use 0 for all bookmarks."}
   * @paramDef {"type":"Array<Number>","label":"Raindrop IDs","name":"ids","description":"Optional list of specific bookmark ids to update. Leave empty to update every bookmark in the collection."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to apply to the matched bookmarks. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"Boolean","label":"Important","name":"important","uiComponent":{"type":"TOGGLE"},"description":"Mark or unmark the matched bookmarks as favorites. Leave unset to leave unchanged."}
   * @paramDef {"type":"Number","label":"Move To Collection ID","name":"moveToCollectionId","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCollectionsDictionary","description":"Move the matched bookmarks into this collection. Leave empty to keep them in place."}
   *
   * @returns {Object}
   * @sampleResult {"result":true,"modified":12}
   */
  async updateManyRaindrops(collectionId, ids, tags, important, moveToCollectionId) {
    const body = clean({
      ids: Array.isArray(ids) && ids.length ? ids : undefined,
      tags: toTagArray(tags),
      important,
    })

    if (moveToCollectionId !== undefined && moveToCollectionId !== null && moveToCollectionId !== '') {
      body.collection = { $id: moveToCollectionId }
    }

    return await this.#apiRequest({
      logTag: '[updateManyRaindrops]',
      url: `${ API_BASE_URL }/raindrops/${ collectionId }`,
      method: 'put',
      body,
    })
  }

  /* ----------------------------------------------------------------------- */
  /* Tags                                                                    */
  /* ----------------------------------------------------------------------- */

  /**
   * @operationName Get Tags
   * @category Tags
   * @description Retrieves all tags, with usage counts, either across the whole account or scoped to a single collection. Provide a collection id to scope the results, or 0 for all bookmarks.
   * @route GET /tags
   *
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCollectionsDictionary","description":"Collection to scope tags to. Use 0 or leave empty for tags across all bookmarks."}
   *
   * @returns {Object}
   * @sampleResult {"result":true,"items":[{"_id":"reference","count":24},{"_id":"design","count":11}]}
   */
  async getTags(collectionId) {
    const path = (collectionId !== undefined && collectionId !== null && collectionId !== '')
      ? `/tags/${ collectionId }`
      : '/tags'

    return await this.#apiRequest({
      logTag: '[getTags]',
      url: `${ API_BASE_URL }${ path }`,
      method: 'get',
    })
  }

  /**
   * @operationName Rename Tag
   * @category Tags
   * @description Renames a tag, merging it into the new name across the account or within a single collection. All bookmarks using the old tag are updated to the new tag.
   * @route PUT /tags/rename
   *
   * @paramDef {"type":"String","label":"Current Tag","name":"currentTag","required":true,"description":"Existing tag name to rename."}
   * @paramDef {"type":"String","label":"New Tag","name":"newTag","required":true,"description":"New tag name. If it already exists, the tags are merged."}
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCollectionsDictionary","description":"Restrict the rename to a single collection. Leave empty to rename across all collections."}
   *
   * @returns {Object}
   * @sampleResult {"result":true}
   */
  async renameTag(currentTag, newTag, collectionId) {
    const path = (collectionId !== undefined && collectionId !== null && collectionId !== '')
      ? `/tags/${ collectionId }`
      : '/tags'

    return await this.#apiRequest({
      logTag: '[renameTag]',
      url: `${ API_BASE_URL }${ path }`,
      method: 'put',
      body: {
        tags: [currentTag],
        replace: newTag,
      },
    })
  }

  /**
   * @operationName Remove Tags
   * @category Tags
   * @description Removes one or more tags from all bookmarks, either across the account or within a single collection. The bookmarks themselves are not deleted; only the tags are stripped.
   * @route DELETE /tags
   *
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","required":true,"description":"Tags to remove. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"Number","label":"Collection ID","name":"collectionId","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCollectionsDictionary","description":"Restrict tag removal to a single collection. Leave empty to remove across all collections."}
   *
   * @returns {Object}
   * @sampleResult {"result":true}
   */
  async removeTags(tags, collectionId) {
    const path = (collectionId !== undefined && collectionId !== null && collectionId !== '')
      ? `/tags/${ collectionId }`
      : '/tags'

    return await this.#apiRequest({
      logTag: '[removeTags]',
      url: `${ API_BASE_URL }${ path }`,
      method: 'delete',
      body: {
        tags: toTagArray(tags) || [],
      },
    })
  }

  /* ----------------------------------------------------------------------- */
  /* Highlights                                                              */
  /* ----------------------------------------------------------------------- */

  /**
   * @operationName Get All Highlights
   * @category Highlights
   * @description Retrieves all text highlights the user has saved across every bookmark, with pagination. Each highlight includes the highlighted text, optional note, color, and the raindrop it belongs to.
   * @route GET /highlights
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of highlights per page (max 50). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"result":true,"items":[{"_id":"6a1b","text":"An important sentence","note":"Follow up","color":"yellow","raindropRef":123456}]}
   */
  async getAllHighlights(page, perPage) {
    return await this.#apiRequest({
      logTag: '[getAllHighlights]',
      url: `${ API_BASE_URL }/highlights`,
      method: 'get',
      query: {
        page,
        perpage: perPage,
      },
    })
  }

  /**
   * @operationName Get Highlights Of Raindrop
   * @category Highlights
   * @description Retrieves all text highlights saved on a single bookmark (raindrop), including each highlight's text, note, and color.
   * @route GET /highlights/raindrop
   *
   * @paramDef {"type":"Number","label":"Raindrop ID","name":"raindropId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The id of the bookmark whose highlights should be returned."}
   *
   * @returns {Object}
   * @sampleResult {"result":true,"item":{"_id":123456,"highlights":[{"_id":"6a1b","text":"An important sentence","color":"yellow"}]}}
   */
  async getHighlightsOfRaindrop(raindropId) {
    return await this.#apiRequest({
      logTag: '[getHighlightsOfRaindrop]',
      url: `${ API_BASE_URL }/highlights/${ raindropId }`,
      method: 'get',
    })
  }

  /* ----------------------------------------------------------------------- */
  /* User                                                                    */
  /* ----------------------------------------------------------------------- */

  /**
   * @operationName Get User
   * @category User
   * @description Retrieves the authenticated user's profile, including id, email, full name, plan, and registration date. Useful as a connection check to confirm the access token is valid.
   * @route GET /user
   *
   * @returns {Object}
   * @sampleResult {"result":true,"user":{"_id":32,"email":"user@example.com","fullName":"Jane Doe","pro":true,"registered":"2020-01-01T00:00:00Z"}}
   */
  async getUser() {
    return await this.#apiRequest({
      logTag: '[getUser]',
      url: `${ API_BASE_URL }/user`,
      method: 'get',
    })
  }

  /* ----------------------------------------------------------------------- */
  /* Dictionaries                                                            */
  /* ----------------------------------------------------------------------- */

  /**
   * @typedef {Object} getCollectionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter collections by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Raindrop returns all collections in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Collections Dictionary
   * @description Provides a searchable list of the account's collections (root and nested) for selecting a collection id in other operations. The option value is the numeric collection id.
   * @route POST /get-collections-dictionary
   * @paramDef {"type":"getCollectionsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text used to filter collections by title."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Reading List","value":"8492393","note":"42 bookmarks"}],"cursor":null}
   */
  async getCollectionsDictionary(payload) {
    const { search } = payload || {}
    const term = (search || '').trim().toLowerCase()

    const [roots, children] = await Promise.all([
      this.#apiRequest({
        logTag: '[getCollectionsDictionary]',
        url: `${ API_BASE_URL }/collections`,
        method: 'get',
      }),
      this.#apiRequest({
        logTag: '[getCollectionsDictionary]',
        url: `${ API_BASE_URL }/collections/childrens`,
        method: 'get',
      }),
    ])

    const collections = [...(roots?.items || []), ...(children?.items || [])]

    const items = collections
      .filter(collection => !term || String(collection.title || '').toLowerCase().includes(term))
      .slice(0, DICTIONARY_PER_PAGE)
      .map(collection => ({
        label: collection.title || `Collection ${ collection._id }`,
        value: String(collection._id),
        note: `${ collection.count || 0 } bookmarks`,
      }))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(RaindropService, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Raindrop.io test or OAuth token. Go to Raindrop.io → Settings → Integrations → create an app → copy the Test Token (or use an OAuth access token). Sent as: Authorization: Bearer {accessToken}.',
  },
])
