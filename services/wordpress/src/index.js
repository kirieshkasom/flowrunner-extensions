const logger = {
  info: (...args) => console.log('[WordPress Service] info:', ...args),
  debug: (...args) => console.log('[WordPress Service] debug:', ...args),
  error: (...args) => console.log('[WordPress Service] error:', ...args),
  warn: (...args) => console.log('[WordPress Service] warn:', ...args),
}

function clean(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const result = {}

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === '') {
      continue
    }

    result[key] = value
  }

  return result
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function extractFilenameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname
    const segments = pathname.split('/')
    const last = segments[segments.length - 1]

    return last && last.includes('.') ? decodeURIComponent(last) : 'upload.bin'
  } catch (error) {
    return 'upload.bin'
  }
}

/**
 * @integrationName WordPress
 * @integrationIcon /icon.png
 */
class WordPress {
  constructor({ siteUrl, username, appPassword }) {
    assert(siteUrl, 'Site URL must be configured for the WordPress service.')
    assert(username, 'Username must be configured for the WordPress service.')
    assert(appPassword, 'Application Password must be configured for the WordPress service.')

    const normalizedSiteUrl = String(siteUrl).trim().replace(/\/+$/, '')
    const normalizedAppPassword = String(appPassword).replace(/\s+/g, '')

    this.siteUrl = normalizedSiteUrl
    this.baseUrl = `${ normalizedSiteUrl }/wp-json/wp/v2`
    this.auth = Buffer.from(`${ username }:${ normalizedAppPassword }`).toString('base64')
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ url, method, body, form, query, headers, logTag }) {
    method = method || 'get'
    query = clean(query)

    const requestHeaders = {
      Authorization: `Basic ${ this.auth }`,
      Accept: 'application/json',
      ...(headers || {}),
    }

    if (!form && !requestHeaders['Content-Type'] && body !== undefined && body !== null) {
      requestHeaders['Content-Type'] = 'application/json'
    }

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(requestHeaders)
        .query(query)

      if (form) {
        request.form(form)
        request.set({ 'Content-Type': 'multipart/form-data' })

        return await request
      }

      if (body !== undefined && body !== null) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      const apiMessage = error?.body?.message || error?.message || 'Unknown WordPress API error.'
      const code = error?.body?.code ? ` (code: ${ error.body.code })` : ''
      const status = error?.status || error?.body?.status || error?.body?.data?.status
      const detail = `${ apiMessage }${ code }`

      // Prepend plain-English guidance for the common failures so a flow surfaces what to do,
      // not a raw WordPress error body. The original message/code stays on as detail.
      const authHint = 'Check the WordPress username and Application Password, or reconnect the account.'
      const hints = {
        401: authHint,
        403: authHint,
        404: 'The requested WordPress resource was not found - verify the ID.',
        429: 'WordPress is rate-limiting requests - wait a moment and retry.',
      }
      const hint = hints[status]

      logger.error(`${ logTag } - api request failed:`, apiMessage)
      throw new Error(hint ? `${ hint } (${ detail })` : `WordPress API request failed: ${ detail }`)
    }
  }

  /**
   * @operationName List Posts
   * @category Posts
   * @description Retrieves a paginated list of posts from the WordPress site with rich filtering by status, author, categories, tags, search query, and date ranges. Use this to power dashboards, sync content into other systems, or feed AI workflows with the latest published posts.
   * @route POST /list-posts
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Scheduled","Draft","Pending Review","Private","Trash","Any"]}},"description":"Filter posts by their publication status. Defaults to 'publish' if omitted."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search query that matches against post title and content."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of the result set to return. Starts at 1. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of posts to return per page (1-100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Date","ID","Include Order","Title","Slug","Last Modified","Author","Relevance"]}},"description":"Field used to sort the results. Defaults to 'date'."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction for the results. Defaults to 'desc'."}
   * @paramDef {"type":"Number","label":"Author","name":"authorId","dictionary":"getAuthorsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limit results to posts authored by the selected user."}
   * @paramDef {"type":"Number","label":"Category","name":"categoryId","dictionary":"getCategoriesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limit results to posts assigned to the selected category."}
   * @paramDef {"type":"Number","label":"Tag","name":"tagId","dictionary":"getTagsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limit results to posts assigned to the selected tag."}
   * @paramDef {"type":"String","label":"After","name":"after","description":"Return posts published after this ISO 8601 date (e.g. '2024-01-01T00:00:00')."}
   * @paramDef {"type":"String","label":"Before","name":"before","description":"Return posts published before this ISO 8601 date (e.g. '2024-12-31T23:59:59')."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":42,"date":"2024-08-01T10:30:00","slug":"hello-world","status":"publish","type":"post","link":"https://example.com/hello-world","title":{"rendered":"Hello World"},"content":{"rendered":"<p>Welcome to WordPress.</p>","protected":false},"excerpt":{"rendered":"<p>Welcome.</p>","protected":false},"author":1,"featured_media":0,"categories":[1],"tags":[]}]
   */
  async listPosts(status, search, page, perPage, orderBy, order, authorId, categoryId, tagId, after, before) {
    status = this.#resolveChoice(status, { Published: 'publish', Scheduled: 'future', Draft: 'draft', 'Pending Review': 'pending', Private: 'private', Trash: 'trash', Any: 'any' })
    orderBy = this.#resolveChoice(orderBy, { Date: 'date', ID: 'id', 'Include Order': 'include', Title: 'title', Slug: 'slug', 'Last Modified': 'modified', Author: 'author', Relevance: 'relevance' })
    order = this.#resolveChoice(order, { Ascending: 'asc', Descending: 'desc' })

    const query = {
      status,
      search,
      page,
      per_page: perPage,
      orderby: orderBy,
      order,
      author: authorId,
      categories: categoryId,
      tags: tagId,
      after,
      before,
    }

    return await this.#apiRequest({
      url: `${ this.baseUrl }/posts`,
      method: 'get',
      query,
      logTag: 'listPosts',
    })
  }

  /**
   * @operationName Get Post
   * @category Posts
   * @description Fetches a single post by its numeric ID, returning full title, content, excerpt, taxonomy assignments, featured media, and metadata. Useful for displaying full post details or feeding content into downstream automations.
   * @route POST /get-post
   *
   * @paramDef {"type":"Number","label":"Post ID","name":"postId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the post to retrieve."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"Password to access password-protected posts, if required."}
   *
   * @returns {Object}
   * @sampleResult {"id":42,"date":"2024-08-01T10:30:00","slug":"hello-world","status":"publish","type":"post","link":"https://example.com/hello-world","title":{"rendered":"Hello World"},"content":{"rendered":"<p>Welcome to WordPress.</p>","protected":false},"excerpt":{"rendered":"<p>Welcome.</p>","protected":false},"author":1,"featured_media":0,"categories":[1],"tags":[]}
   */
  async getPost(postId, password) {
    assert(postId, 'Post ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/posts/${ postId }`,
      method: 'get',
      query: { password },
      logTag: 'getPost',
    })
  }

  /**
   * @operationName Create Post
   * @category Posts
   * @description Creates a new blog post with the provided title, HTML content, status, and optional taxonomy or scheduling fields. Set status to 'draft' to keep it private or 'publish' to publish immediately. Categories and tags accept arrays of term IDs.
   * @route POST /create-post
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the post."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The HTML content body of the post."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Scheduled","Draft","Pending Review","Private"]}},"description":"Publication status for the new post. Defaults to 'draft' when omitted."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"URL-friendly identifier for the post. WordPress generates one from the title if omitted."}
   * @paramDef {"type":"String","label":"Excerpt","name":"excerpt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Short summary used by themes for previews."}
   * @paramDef {"type":"Number","label":"Author","name":"authorId","dictionary":"getAuthorsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"User ID for the post author."}
   * @paramDef {"type":"Number","label":"Featured Media","name":"featuredMediaId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Media item ID to use as the featured image."}
   * @paramDef {"type":"Array<Number>","label":"Categories","name":"categoryIds","description":"Array of category term IDs to assign to the post."}
   * @paramDef {"type":"Array<Number>","label":"Tags","name":"tagIds","description":"Array of tag term IDs to assign to the post."}
   * @paramDef {"type":"String","label":"Comment Status","name":"commentStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Whether comments are open or closed for the post."}
   * @paramDef {"type":"String","label":"Date","name":"date","description":"Publication date in ISO 8601 site-timezone format (e.g. '2024-12-15T09:00:00'). Use with status 'future' to schedule."}
   * @paramDef {"type":"Boolean","label":"Sticky","name":"sticky","uiComponent":{"type":"TOGGLE"},"description":"Pin this post to the top of the blog listing."}
   *
   * @returns {Object}
   * @sampleResult {"id":42,"date":"2024-08-01T10:30:00","slug":"hello-world","status":"publish","type":"post","link":"https://example.com/hello-world","title":{"rendered":"Hello World"},"content":{"rendered":"<p>Welcome to WordPress.</p>","protected":false},"author":1,"categories":[1],"tags":[]}
   */
  async createPost(title, content, status, slug, excerpt, authorId, featuredMediaId, categoryIds, tagIds, commentStatus, date, sticky) {
    assert(title, 'Title is required.')

    status = this.#resolveChoice(status, { Published: 'publish', Scheduled: 'future', Draft: 'draft', 'Pending Review': 'pending', Private: 'private' })
    commentStatus = this.#resolveChoice(commentStatus, { Open: 'open', Closed: 'closed' })

    const body = clean({
      title,
      content,
      status,
      slug,
      excerpt,
      author: authorId,
      featured_media: featuredMediaId,
      categories: categoryIds,
      tags: tagIds,
      comment_status: commentStatus,
      date,
      sticky,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/posts`,
      method: 'post',
      body,
      logTag: 'createPost',
    })
  }

  /**
   * @operationName Update Post
   * @category Posts
   * @description Updates fields of an existing post. Only the provided fields are changed; omitted fields are left untouched. Useful for changing status (e.g. publishing a draft), editing content, swapping featured media, or re-assigning categories.
   * @route POST /update-post
   *
   * @paramDef {"type":"Number","label":"Post ID","name":"postId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the post to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title for the post."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New HTML content body for the post."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Scheduled","Draft","Pending Review","Private"]}},"description":"New publication status for the post."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"New URL-friendly identifier."}
   * @paramDef {"type":"String","label":"Excerpt","name":"excerpt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New excerpt text used by themes for previews."}
   * @paramDef {"type":"Number","label":"Author","name":"authorId","dictionary":"getAuthorsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New author user ID."}
   * @paramDef {"type":"Number","label":"Featured Media","name":"featuredMediaId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New featured media item ID. Pass 0 to clear the existing featured image."}
   * @paramDef {"type":"Array<Number>","label":"Categories","name":"categoryIds","description":"Replacement array of category term IDs."}
   * @paramDef {"type":"Array<Number>","label":"Tags","name":"tagIds","description":"Replacement array of tag term IDs."}
   * @paramDef {"type":"String","label":"Comment Status","name":"commentStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Whether comments are open or closed for the post."}
   * @paramDef {"type":"String","label":"Date","name":"date","description":"New publication date in ISO 8601 site-timezone format."}
   * @paramDef {"type":"Boolean","label":"Sticky","name":"sticky","uiComponent":{"type":"TOGGLE"},"description":"Pin this post to the top of the blog listing."}
   *
   * @returns {Object}
   * @sampleResult {"id":42,"date":"2024-08-01T10:30:00","slug":"hello-world-updated","status":"publish","title":{"rendered":"Hello World Updated"},"content":{"rendered":"<p>Updated content.</p>","protected":false},"author":1,"categories":[1,2],"tags":[3]}
   */
  async updatePost(postId, title, content, status, slug, excerpt, authorId, featuredMediaId, categoryIds, tagIds, commentStatus, date, sticky) {
    assert(postId, 'Post ID is required.')

    status = this.#resolveChoice(status, { Published: 'publish', Scheduled: 'future', Draft: 'draft', 'Pending Review': 'pending', Private: 'private' })
    commentStatus = this.#resolveChoice(commentStatus, { Open: 'open', Closed: 'closed' })

    const body = clean({
      title,
      content,
      status,
      slug,
      excerpt,
      author: authorId,
      featured_media: featuredMediaId,
      categories: categoryIds,
      tags: tagIds,
      comment_status: commentStatus,
      date,
      sticky,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/posts/${ postId }`,
      method: 'post',
      body,
      logTag: 'updatePost',
    })
  }

  /**
   * @operationName Delete Post
   * @category Posts
   * @description Deletes a post. By default the post is moved to trash; pass force=true to permanently delete and bypass trash. Permanent deletion cannot be undone.
   * @route POST /delete-post
   *
   * @paramDef {"type":"Number","label":"Post ID","name":"postId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the post to delete."}
   * @paramDef {"type":"Boolean","label":"Force","name":"force","uiComponent":{"type":"TOGGLE"},"description":"Permanently delete the post instead of moving it to trash."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"previous":{"id":42,"slug":"hello-world","status":"trash","title":{"rendered":"Hello World"}}}
   */
  async deletePost(postId, force) {
    assert(postId, 'Post ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/posts/${ postId }`,
      method: 'delete',
      query: { force: force ? true : undefined },
      logTag: 'deletePost',
    })
  }

  /**
   * @operationName List Pages
   * @category Pages
   * @description Retrieves a paginated list of pages with filtering by status, parent, author, search query, and ordering. Pages are top-level content used for static content like About, Contact, or landing pages.
   * @route POST /list-pages
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Scheduled","Draft","Pending Review","Private","Trash","Any"]}},"description":"Filter pages by publication status. Defaults to 'publish' if omitted."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search query that matches against page title and content."}
   * @paramDef {"type":"Number","label":"Parent","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limit to direct children of the given parent page ID. Use 0 for top-level pages only."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of the result set to return. Starts at 1. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of pages to return per page (1-100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Date","ID","Include Order","Title","Slug","Last Modified","Menu Order"]}},"description":"Field used to sort the results. Defaults to 'date'."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction for the results. Defaults to 'desc'."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":2,"date":"2024-07-15T09:00:00","slug":"about","status":"publish","type":"page","link":"https://example.com/about","title":{"rendered":"About"},"content":{"rendered":"<p>About us.</p>","protected":false},"parent":0,"menu_order":0}]
   */
  async listPages(status, search, parentId, page, perPage, orderBy, order) {
    status = this.#resolveChoice(status, { Published: 'publish', Scheduled: 'future', Draft: 'draft', 'Pending Review': 'pending', Private: 'private', Trash: 'trash', Any: 'any' })
    orderBy = this.#resolveChoice(orderBy, { Date: 'date', ID: 'id', 'Include Order': 'include', Title: 'title', Slug: 'slug', 'Last Modified': 'modified', 'Menu Order': 'menu_order' })
    order = this.#resolveChoice(order, { Ascending: 'asc', Descending: 'desc' })

    const query = {
      status,
      search,
      parent: parentId,
      page,
      per_page: perPage,
      orderby: orderBy,
      order,
    }

    return await this.#apiRequest({
      url: `${ this.baseUrl }/pages`,
      method: 'get',
      query,
      logTag: 'listPages',
    })
  }

  /**
   * @operationName Get Page
   * @category Pages
   * @description Fetches a single page by its numeric ID, returning full title, content, parent, menu order, and metadata.
   * @route POST /get-page
   *
   * @paramDef {"type":"Number","label":"Page ID","name":"pageId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the page to retrieve."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"Password to access password-protected pages, if required."}
   *
   * @returns {Object}
   * @sampleResult {"id":2,"date":"2024-07-15T09:00:00","slug":"about","status":"publish","type":"page","link":"https://example.com/about","title":{"rendered":"About"},"content":{"rendered":"<p>About us.</p>","protected":false},"parent":0,"menu_order":0}
   */
  async getPage(pageId, password) {
    assert(pageId, 'Page ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/pages/${ pageId }`,
      method: 'get',
      query: { password },
      logTag: 'getPage',
    })
  }

  /**
   * @operationName Create Page
   * @category Pages
   * @description Creates a new page with the provided title and content. Pages can be nested under another page using the parent field, ordered with menuOrder, and rendered with a specific theme template via the template field.
   * @route POST /create-page
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the page."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The HTML content body of the page."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Scheduled","Draft","Pending Review","Private"]}},"description":"Publication status for the new page. Defaults to 'draft' when omitted."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"URL-friendly identifier. WordPress generates one from the title if omitted."}
   * @paramDef {"type":"Number","label":"Parent","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Parent page ID for nested pages. Use 0 or leave empty for a top-level page."}
   * @paramDef {"type":"Number","label":"Menu Order","name":"menuOrder","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Integer used to sort pages in menus and listings. Lower values appear first."}
   * @paramDef {"type":"String","label":"Template","name":"template","description":"Theme template file to render the page (e.g. 'templates/full-width.php')."}
   * @paramDef {"type":"Number","label":"Author","name":"authorId","dictionary":"getAuthorsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"User ID for the page author."}
   * @paramDef {"type":"Number","label":"Featured Media","name":"featuredMediaId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Media item ID to use as the featured image."}
   *
   * @returns {Object}
   * @sampleResult {"id":2,"date":"2024-07-15T09:00:00","slug":"about","status":"publish","type":"page","link":"https://example.com/about","title":{"rendered":"About"},"content":{"rendered":"<p>About us.</p>","protected":false},"parent":0,"menu_order":0}
   */
  async createPage(title, content, status, slug, parentId, menuOrder, template, authorId, featuredMediaId) {
    assert(title, 'Title is required.')

    status = this.#resolveChoice(status, { Published: 'publish', Scheduled: 'future', Draft: 'draft', 'Pending Review': 'pending', Private: 'private' })

    const body = clean({
      title,
      content,
      status,
      slug,
      parent: parentId,
      menu_order: menuOrder,
      template,
      author: authorId,
      featured_media: featuredMediaId,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/pages`,
      method: 'post',
      body,
      logTag: 'createPage',
    })
  }

  /**
   * @operationName Update Page
   * @category Pages
   * @description Updates fields of an existing page. Only the provided fields are changed; omitted fields are left untouched. Useful for editing static content, re-parenting, or changing publication status.
   * @route POST /update-page
   *
   * @paramDef {"type":"Number","label":"Page ID","name":"pageId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the page to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title for the page."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New HTML content body for the page."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Scheduled","Draft","Pending Review","Private"]}},"description":"New publication status."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"New URL-friendly identifier."}
   * @paramDef {"type":"Number","label":"Parent","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New parent page ID. Use 0 to make it a top-level page."}
   * @paramDef {"type":"Number","label":"Menu Order","name":"menuOrder","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Integer used to sort pages in menus and listings."}
   * @paramDef {"type":"String","label":"Template","name":"template","description":"Theme template file to render the page."}
   *
   * @returns {Object}
   * @sampleResult {"id":2,"date":"2024-07-15T09:00:00","slug":"about-updated","status":"publish","type":"page","title":{"rendered":"About Us"},"content":{"rendered":"<p>Updated about page.</p>","protected":false},"parent":0,"menu_order":1}
   */
  async updatePage(pageId, title, content, status, slug, parentId, menuOrder, template) {
    assert(pageId, 'Page ID is required.')

    status = this.#resolveChoice(status, { Published: 'publish', Scheduled: 'future', Draft: 'draft', 'Pending Review': 'pending', Private: 'private' })

    const body = clean({
      title,
      content,
      status,
      slug,
      parent: parentId,
      menu_order: menuOrder,
      template,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/pages/${ pageId }`,
      method: 'post',
      body,
      logTag: 'updatePage',
    })
  }

  /**
   * @operationName Delete Page
   * @category Pages
   * @description Deletes a page. By default the page is moved to trash; pass force=true to permanently delete and bypass trash. Permanent deletion cannot be undone.
   * @route POST /delete-page
   *
   * @paramDef {"type":"Number","label":"Page ID","name":"pageId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the page to delete."}
   * @paramDef {"type":"Boolean","label":"Force","name":"force","uiComponent":{"type":"TOGGLE"},"description":"Permanently delete the page instead of moving it to trash."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"previous":{"id":2,"slug":"about","status":"trash","title":{"rendered":"About"}}}
   */
  async deletePage(pageId, force) {
    assert(pageId, 'Page ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/pages/${ pageId }`,
      method: 'delete',
      query: { force: force ? true : undefined },
      logTag: 'deletePage',
    })
  }

  /**
   * @operationName List Categories
   * @category Categories
   * @description Retrieves a paginated list of post categories. Supports search, ordering, and filtering by parent for hierarchical category trees.
   * @route POST /list-categories
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search query matched against category names."}
   * @paramDef {"type":"Number","label":"Parent","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limit to direct children of the given parent category ID. Use 0 for top-level categories."}
   * @paramDef {"type":"Boolean","label":"Hide Empty","name":"hideEmpty","uiComponent":{"type":"TOGGLE"},"description":"Exclude categories that have no assigned posts."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of the result set. Starts at 1. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of categories to return per page (1-100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["ID","Name","Slug","Include Order","Post Count","Term Group","Description"]}},"description":"Field used to sort the results. Defaults to 'name'."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. Defaults to 'asc'."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"count":15,"description":"","link":"https://example.com/category/news","name":"News","slug":"news","taxonomy":"category","parent":0}]
   */
  async listCategories(search, parentId, hideEmpty, page, perPage, orderBy, order) {
    orderBy = this.#resolveChoice(orderBy, { ID: 'id', Name: 'name', Slug: 'slug', 'Include Order': 'include', 'Post Count': 'count', 'Term Group': 'term_group', Description: 'description' })
    order = this.#resolveChoice(order, { Ascending: 'asc', Descending: 'desc' })

    const query = {
      search,
      parent: parentId,
      hide_empty: hideEmpty,
      page,
      per_page: perPage,
      orderby: orderBy,
      order,
    }

    return await this.#apiRequest({
      url: `${ this.baseUrl }/categories`,
      method: 'get',
      query,
      logTag: 'listCategories',
    })
  }

  /**
   * @operationName Get Category
   * @category Categories
   * @description Fetches a single category by its numeric ID, including name, slug, description, and post count.
   * @route POST /get-category
   *
   * @paramDef {"type":"Number","label":"Category ID","name":"categoryId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the category."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"count":15,"description":"","link":"https://example.com/category/news","name":"News","slug":"news","taxonomy":"category","parent":0}
   */
  async getCategory(categoryId) {
    assert(categoryId, 'Category ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/categories/${ categoryId }`,
      method: 'get',
      logTag: 'getCategory',
    })
  }

  /**
   * @operationName Create Category
   * @category Categories
   * @description Creates a new post category. Use the parent field to nest the category under another for hierarchical trees.
   * @route POST /create-category
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name of the new category."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"URL-friendly identifier. WordPress generates one from the name if omitted."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text description for the category."}
   * @paramDef {"type":"Number","label":"Parent","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Parent category ID for nested categories. Use 0 or leave empty for a top-level category."}
   *
   * @returns {Object}
   * @sampleResult {"id":5,"count":0,"description":"","link":"https://example.com/category/announcements","name":"Announcements","slug":"announcements","taxonomy":"category","parent":0}
   */
  async createCategory(name, slug, description, parentId) {
    assert(name, 'Name is required.')

    const body = clean({
      name,
      slug,
      description,
      parent: parentId,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/categories`,
      method: 'post',
      body,
      logTag: 'createCategory',
    })
  }

  /**
   * @operationName Update Category
   * @category Categories
   * @description Updates fields of an existing category. Only provided fields are changed.
   * @route POST /update-category
   *
   * @paramDef {"type":"Number","label":"Category ID","name":"categoryId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the category to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New display name."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"New URL-friendly identifier."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"Number","label":"Parent","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New parent category ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":5,"count":0,"description":"Important updates.","link":"https://example.com/category/announcements","name":"Announcements","slug":"announcements","taxonomy":"category","parent":0}
   */
  async updateCategory(categoryId, name, slug, description, parentId) {
    assert(categoryId, 'Category ID is required.')

    const body = clean({
      name,
      slug,
      description,
      parent: parentId,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/categories/${ categoryId }`,
      method: 'post',
      body,
      logTag: 'updateCategory',
    })
  }

  /**
   * @operationName Delete Category
   * @category Categories
   * @description Permanently deletes a category. WordPress requires force=true for category deletion since categories do not support trashing. Posts assigned only to this category will be reassigned to the default category.
   * @route POST /delete-category
   *
   * @paramDef {"type":"Number","label":"Category ID","name":"categoryId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the category to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"previous":{"id":5,"name":"Announcements","slug":"announcements","taxonomy":"category"}}
   */
  async deleteCategory(categoryId) {
    assert(categoryId, 'Category ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/categories/${ categoryId }`,
      method: 'delete',
      query: { force: true },
      logTag: 'deleteCategory',
    })
  }

  /**
   * @operationName List Tags
   * @category Tags
   * @description Retrieves a paginated list of post tags with optional search, ordering, and the ability to exclude unused tags.
   * @route POST /list-tags
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search query matched against tag names."}
   * @paramDef {"type":"Boolean","label":"Hide Empty","name":"hideEmpty","uiComponent":{"type":"TOGGLE"},"description":"Exclude tags that have no assigned posts."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of the result set. Starts at 1. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tags to return per page (1-100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["ID","Name","Slug","Include Order","Post Count","Term Group","Description"]}},"description":"Field used to sort the results. Defaults to 'name'."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. Defaults to 'asc'."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":7,"count":3,"description":"","link":"https://example.com/tag/wordpress","name":"WordPress","slug":"wordpress","taxonomy":"post_tag"}]
   */
  async listTags(search, hideEmpty, page, perPage, orderBy, order) {
    orderBy = this.#resolveChoice(orderBy, { ID: 'id', Name: 'name', Slug: 'slug', 'Include Order': 'include', 'Post Count': 'count', 'Term Group': 'term_group', Description: 'description' })
    order = this.#resolveChoice(order, { Ascending: 'asc', Descending: 'desc' })

    const query = {
      search,
      hide_empty: hideEmpty,
      page,
      per_page: perPage,
      orderby: orderBy,
      order,
    }

    return await this.#apiRequest({
      url: `${ this.baseUrl }/tags`,
      method: 'get',
      query,
      logTag: 'listTags',
    })
  }

  /**
   * @operationName Get Tag
   * @category Tags
   * @description Fetches a single post tag by its numeric ID.
   * @route POST /get-tag
   *
   * @paramDef {"type":"Number","label":"Tag ID","name":"tagId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the tag."}
   *
   * @returns {Object}
   * @sampleResult {"id":7,"count":3,"description":"","link":"https://example.com/tag/wordpress","name":"WordPress","slug":"wordpress","taxonomy":"post_tag"}
   */
  async getTag(tagId) {
    assert(tagId, 'Tag ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/tags/${ tagId }`,
      method: 'get',
      logTag: 'getTag',
    })
  }

  /**
   * @operationName Create Tag
   * @category Tags
   * @description Creates a new post tag.
   * @route POST /create-tag
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name of the new tag."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"URL-friendly identifier. WordPress generates one from the name if omitted."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text description for the tag."}
   *
   * @returns {Object}
   * @sampleResult {"id":11,"count":0,"description":"","link":"https://example.com/tag/automation","name":"Automation","slug":"automation","taxonomy":"post_tag"}
   */
  async createTag(name, slug, description) {
    assert(name, 'Name is required.')

    const body = clean({
      name,
      slug,
      description,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/tags`,
      method: 'post',
      body,
      logTag: 'createTag',
    })
  }

  /**
   * @operationName Update Tag
   * @category Tags
   * @description Updates fields of an existing tag. Only provided fields are changed.
   * @route POST /update-tag
   *
   * @paramDef {"type":"Number","label":"Tag ID","name":"tagId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the tag to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New display name."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"New URL-friendly identifier."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   *
   * @returns {Object}
   * @sampleResult {"id":11,"count":0,"description":"Posts about automation.","link":"https://example.com/tag/automation","name":"Automation","slug":"automation","taxonomy":"post_tag"}
   */
  async updateTag(tagId, name, slug, description) {
    assert(tagId, 'Tag ID is required.')

    const body = clean({
      name,
      slug,
      description,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/tags/${ tagId }`,
      method: 'post',
      body,
      logTag: 'updateTag',
    })
  }

  /**
   * @operationName Delete Tag
   * @category Tags
   * @description Permanently deletes a tag. WordPress requires force=true for tag deletion since tags do not support trashing.
   * @route POST /delete-tag
   *
   * @paramDef {"type":"Number","label":"Tag ID","name":"tagId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the tag to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"previous":{"id":11,"name":"Automation","slug":"automation","taxonomy":"post_tag"}}
   */
  async deleteTag(tagId) {
    assert(tagId, 'Tag ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/tags/${ tagId }`,
      method: 'delete',
      query: { force: true },
      logTag: 'deleteTag',
    })
  }

  /**
   * @operationName List Users
   * @category Users
   * @description Retrieves a paginated list of users with filtering by role, slug, search query, or whether they have published posts. Use this to populate author selectors or sync site members.
   * @route POST /list-users
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search matched against user names and emails."}
   * @paramDef {"type":"Array<String>","label":"Roles","name":"roles","description":"Filter to users with any of these roles (e.g. ['administrator','editor','author'])."}
   * @paramDef {"type":"Boolean","label":"Has Published Posts","name":"hasPublishedPosts","uiComponent":{"type":"TOGGLE"},"description":"Limit to users who have at least one published post."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of the result set. Starts at 1. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of users to return per page (1-100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["ID","Name","Include Order","Slug","Email","URL","Registration Date"]}},"description":"Field used to sort the results. Defaults to 'name'."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. Defaults to 'asc'."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"name":"Admin","first_name":"Site","last_name":"Admin","email":"admin@example.com","roles":["administrator"],"registered_date":"2024-01-01T00:00:00+00:00","slug":"admin","url":"","description":"","link":"https://example.com/author/admin","avatar_urls":{"96":"https://secure.gravatar.com/avatar/abc?s=96"}}]
   */
  async listUsers(search, roles, hasPublishedPosts, page, perPage, orderBy, order) {
    orderBy = this.#resolveChoice(orderBy, { ID: 'id', Name: 'name', 'Include Order': 'include', Slug: 'slug', Email: 'email', URL: 'url', 'Registration Date': 'registered_date' })
    order = this.#resolveChoice(order, { Ascending: 'asc', Descending: 'desc' })

    const query = {
      search,
      roles: roles && roles.length ? roles.join(',') : undefined,
      has_published_posts: hasPublishedPosts,
      page,
      per_page: perPage,
      orderby: orderBy,
      order,
      context: 'edit',
    }

    return await this.#apiRequest({
      url: `${ this.baseUrl }/users`,
      method: 'get',
      query,
      logTag: 'listUsers',
    })
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Fetches a single user by numeric ID, returning name, slug, roles, capabilities, and avatar URLs.
   * @route POST /get-user
   *
   * @paramDef {"type":"Number","label":"User ID","name":"userId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the user."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"username":"admin","name":"Admin","first_name":"Site","last_name":"Admin","email":"admin@example.com","url":"","description":"","link":"https://example.com/author/admin","slug":"admin","roles":["administrator"]}
   */
  async getUser(userId) {
    assert(userId, 'User ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/users/${ userId }`,
      method: 'get',
      query: { context: 'edit' },
      logTag: 'getUser',
    })
  }

  /**
   * @operationName Get Current User
   * @category Users
   * @description Returns the user account associated with the configured Application Password credentials. Useful for verifying connectivity, identifying the acting user, or obtaining the connected user's roles and capabilities.
   * @route POST /get-current-user
   *
   * @returns {Object}
   * @sampleResult {"id":1,"username":"admin","name":"Admin","first_name":"Site","last_name":"Admin","email":"admin@example.com","link":"https://example.com/author/admin","slug":"admin","roles":["administrator"]}
   */
  async getCurrentUser() {
    return await this.#apiRequest({
      url: `${ this.baseUrl }/users/me`,
      method: 'get',
      query: { context: 'edit' },
      logTag: 'getCurrentUser',
    })
  }

  /**
   * @operationName Create User
   * @category Users
   * @description Creates a new WordPress user account with the supplied credentials and optional profile fields. Requires the connected user to have permission to create users.
   * @route POST /create-user
   *
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"Login name for the new user."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address for the new user."}
   * @paramDef {"type":"String","label":"Password","name":"password","required":true,"description":"Initial password for the new user."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Display name shown on the site."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Given name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Family name."}
   * @paramDef {"type":"Array<String>","label":"Roles","name":"roles","description":"Array of role slugs to assign (e.g. ['author'])."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"Personal website URL."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Short biography for the user profile."}
   *
   * @returns {Object}
   * @sampleResult {"id":12,"username":"jane","name":"Jane Doe","first_name":"Jane","last_name":"Doe","email":"jane@example.com","link":"https://example.com/author/jane","slug":"jane","roles":["author"]}
   */
  async createUser(username, email, password, name, firstName, lastName, roles, url, description) {
    assert(username, 'Username is required.')
    assert(email, 'Email is required.')
    assert(password, 'Password is required.')

    const body = clean({
      username,
      email,
      password,
      name,
      first_name: firstName,
      last_name: lastName,
      roles,
      url,
      description,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/users`,
      method: 'post',
      body,
      logTag: 'createUser',
    })
  }

  /**
   * @operationName Update User
   * @category Users
   * @description Updates fields on an existing user account. Only provided fields are changed; omitted fields are left untouched.
   * @route POST /update-user
   *
   * @paramDef {"type":"Number","label":"User ID","name":"userId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the user to update."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"New password for the user account."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New display name."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New given name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New family name."}
   * @paramDef {"type":"Array<String>","label":"Roles","name":"roles","description":"Replacement array of role slugs."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"New personal website URL."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New short biography."}
   *
   * @returns {Object}
   * @sampleResult {"id":12,"username":"jane","name":"Jane Doe Smith","first_name":"Jane","last_name":"Doe Smith","email":"jane@example.com","link":"https://example.com/author/jane","slug":"jane","roles":["editor"]}
   */
  async updateUser(userId, email, password, name, firstName, lastName, roles, url, description) {
    assert(userId, 'User ID is required.')

    const body = clean({
      email,
      password,
      name,
      first_name: firstName,
      last_name: lastName,
      roles,
      url,
      description,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/users/${ userId }`,
      method: 'post',
      body,
      logTag: 'updateUser',
    })
  }

  /**
   * @operationName Delete User
   * @category Users
   * @description Permanently deletes a user account. WordPress requires force=true for user deletion (no trash). The reassign parameter is required to transfer the deleted user's posts to another existing user.
   * @route POST /delete-user
   *
   * @paramDef {"type":"Number","label":"User ID","name":"userId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the user to delete."}
   * @paramDef {"type":"Number","label":"Reassign To","name":"reassignToUserId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"User ID that should inherit the deleted user's posts. Use the site administrator's ID if unsure."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"previous":{"id":12,"username":"jane","name":"Jane Doe","email":"jane@example.com","slug":"jane","roles":["author"]}}
   */
  async deleteUser(userId, reassignToUserId) {
    assert(userId, 'User ID is required.')
    assert(reassignToUserId, 'Reassign-To User ID is required when deleting a user.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/users/${ userId }`,
      method: 'delete',
      query: { force: true, reassign: reassignToUserId },
      logTag: 'deleteUser',
    })
  }

  /**
   * @operationName List Media
   * @category Media
   * @description Retrieves a paginated list of media library items with filtering by mime type, media type (image, video, audio, application, text), search query, and parent post.
   * @route POST /list-media
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search query matched against media titles and descriptions."}
   * @paramDef {"type":"String","label":"Media Type","name":"mediaType","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video","Audio","Application","Text"]}},"description":"Limit results to a specific media type."}
   * @paramDef {"type":"String","label":"Mime Type","name":"mimeType","description":"Filter by an exact MIME type (e.g. 'image/png')."}
   * @paramDef {"type":"Number","label":"Parent","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limit to media attached to a specific post or page ID."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of the result set. Starts at 1. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of media items to return per page (1-100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Date","ID","Include Order","Title","Slug","Last Modified"]}},"description":"Field used to sort the results. Defaults to 'date'."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. Defaults to 'desc'."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":99,"date":"2024-08-01T10:30:00","slug":"sample-image","type":"attachment","link":"https://example.com/sample-image","title":{"rendered":"Sample Image"},"author":1,"media_type":"image","mime_type":"image/png","source_url":"https://example.com/wp-content/uploads/2024/08/sample.png","alt_text":"A sample image"}]
   */
  async listMedia(search, mediaType, mimeType, parentId, page, perPage, orderBy, order) {
    mediaType = this.#resolveChoice(mediaType, { Image: 'image', Video: 'video', Audio: 'audio', Application: 'application', Text: 'text' })
    orderBy = this.#resolveChoice(orderBy, { Date: 'date', ID: 'id', 'Include Order': 'include', Title: 'title', Slug: 'slug', 'Last Modified': 'modified' })
    order = this.#resolveChoice(order, { Ascending: 'asc', Descending: 'desc' })

    const query = {
      search,
      media_type: mediaType,
      mime_type: mimeType,
      parent: parentId,
      page,
      per_page: perPage,
      orderby: orderBy,
      order,
    }

    return await this.#apiRequest({
      url: `${ this.baseUrl }/media`,
      method: 'get',
      query,
      logTag: 'listMedia',
    })
  }

  /**
   * @operationName Get Media
   * @category Media
   * @description Fetches a single media library item by numeric ID, including source URL, mime type, alt text, caption, and rendered metadata.
   * @route POST /get-media
   *
   * @paramDef {"type":"Number","label":"Media ID","name":"mediaId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the media item."}
   *
   * @returns {Object}
   * @sampleResult {"id":99,"date":"2024-08-01T10:30:00","slug":"sample-image","type":"attachment","link":"https://example.com/sample-image","title":{"rendered":"Sample Image"},"author":1,"media_type":"image","mime_type":"image/png","source_url":"https://example.com/wp-content/uploads/2024/08/sample.png","alt_text":"A sample image","caption":{"rendered":""},"description":{"rendered":""}}
   */
  async getMedia(mediaId) {
    assert(mediaId, 'Media ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/media/${ mediaId }`,
      method: 'get',
      logTag: 'getMedia',
    })
  }

  /**
   * @operationName Upload Media From URL
   * @category Media
   * @description Downloads a file from the supplied URL and uploads it to the WordPress media library. Optional title, alt text, and caption fields are saved alongside the asset. Returns the created attachment object including the public source URL.
   * @route POST /upload-media-from-url
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Source URL","name":"sourceUrl","required":true,"description":"Publicly accessible URL of the file to download and upload (e.g. an image, video, or document)."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Name to give the uploaded file. If omitted, the name is derived from the source URL."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Title of the new media item."}
   * @paramDef {"type":"String","label":"Alt Text","name":"altText","description":"Alternative text shown when the media cannot be displayed (used for accessibility and SEO)."}
   * @paramDef {"type":"String","label":"Caption","name":"caption","description":"Short caption displayed alongside the media."}
   * @paramDef {"type":"Number","label":"Attached To","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional post or page ID to attach the media to."}
   *
   * @returns {Object}
   * @sampleResult {"id":99,"date":"2024-08-01T10:30:00","slug":"sample","type":"attachment","link":"https://example.com/?attachment_id=99","title":{"rendered":"Sample"},"source_url":"https://example.com/wp-content/uploads/2024/08/sample.png","mime_type":"image/png","media_type":"image","alt_text":"A sample image"}
   */
  async uploadMediaFromUrl(sourceUrl, filename, title, altText, caption, parentId) {
    assert(sourceUrl, 'Source URL is required.')

    const resolvedFilename = filename || extractFilenameFromUrl(sourceUrl)

    logger.debug(`[uploadMediaFromUrl] Downloading source file from ${ sourceUrl }`)

    let downloadResponse

    try {
      downloadResponse = await Flowrunner.Request.get(sourceUrl).setEncoding(null).unwrapBody(false)
    } catch (error) {
      const message = error?.message || 'Unable to download source file.'

      logger.error(`[uploadMediaFromUrl] Failed to download source file: ${ message }`)
      throw new Error(`Failed to download source file from URL: ${ message }`)
    }

    const fileBuffer = downloadResponse.body
    const mimeType = downloadResponse.headers && (downloadResponse.headers['content-type'] || downloadResponse.headers['Content-Type'])

    const formData = new Flowrunner.Request.FormData()

    formData.append('file', fileBuffer, {
      filename: resolvedFilename,
      contentType: mimeType || 'application/octet-stream',
    })

    if (title) formData.append('title', title)
    if (altText) formData.append('alt_text', altText)
    if (caption) formData.append('caption', caption)
    if (parentId) formData.append('post', String(parentId))

    return await this.#apiRequest({
      url: `${ this.baseUrl }/media`,
      method: 'post',
      form: formData,
      headers: { 'Content-Disposition': `attachment; filename="${ resolvedFilename }"` },
      logTag: 'uploadMediaFromUrl',
    })
  }

  /**
   * @operationName Update Media
   * @category Media
   * @description Updates metadata fields of an existing media item such as title, alt text, caption, description, or post attachment.
   * @route POST /update-media
   *
   * @paramDef {"type":"Number","label":"Media ID","name":"mediaId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the media item to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title for the media item."}
   * @paramDef {"type":"String","label":"Alt Text","name":"altText","description":"New alternative text."}
   * @paramDef {"type":"String","label":"Caption","name":"caption","description":"New caption text."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New long-form description."}
   * @paramDef {"type":"Number","label":"Attached To","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Post or page ID to attach the media to. Use 0 to detach."}
   *
   * @returns {Object}
   * @sampleResult {"id":99,"slug":"sample-image","title":{"rendered":"Updated Title"},"alt_text":"Updated alt","caption":{"rendered":"<p>Updated caption</p>"},"description":{"rendered":""},"post":42}
   */
  async updateMedia(mediaId, title, altText, caption, description, parentId) {
    assert(mediaId, 'Media ID is required.')

    const body = clean({
      title,
      alt_text: altText,
      caption,
      description,
      post: parentId,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/media/${ mediaId }`,
      method: 'post',
      body,
      logTag: 'updateMedia',
    })
  }

  /**
   * @operationName Delete Media
   * @category Media
   * @description Permanently deletes a media library item. WordPress requires force=true for media deletion (no trash). The underlying file is removed from disk.
   * @route POST /delete-media
   *
   * @paramDef {"type":"Number","label":"Media ID","name":"mediaId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the media item to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"previous":{"id":99,"slug":"sample-image","title":{"rendered":"Sample"},"source_url":"https://example.com/wp-content/uploads/2024/08/sample.png","mime_type":"image/png"}}
   */
  async deleteMedia(mediaId) {
    assert(mediaId, 'Media ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/media/${ mediaId }`,
      method: 'delete',
      query: { force: true },
      logTag: 'deleteMedia',
    })
  }

  /**
   * @operationName List Comments
   * @category Comments
   * @description Retrieves a paginated list of comments with filtering by post, author, parent, status, and search query.
   * @route POST /list-comments
   *
   * @paramDef {"type":"Number","label":"Post","name":"postId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limit comments to a specific post or page ID."}
   * @paramDef {"type":"Number","label":"Parent","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limit to direct replies of the given parent comment ID. Use 0 for top-level comments."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Approved","Pending","Spam","Trash"]}},"description":"Filter comments by moderation status. Defaults to 'approve'."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search query matched against comment content."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of the result set. Starts at 1. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of comments to return per page (1-100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Date","Date (GMT)","ID","Include Order","Post","Parent","Type"]}},"description":"Field used to sort the results. Defaults to 'date_gmt'."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. Defaults to 'desc'."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":31,"post":42,"parent":0,"author":0,"author_name":"Visitor","author_url":"","date":"2024-08-02T12:00:00","content":{"rendered":"<p>Great post!</p>"},"link":"https://example.com/hello-world#comment-31","status":"approved","type":"comment"}]
   */
  async listComments(postId, parentId, status, search, page, perPage, orderBy, order) {
    status = this.#resolveChoice(status, { Approved: 'approve', Pending: 'hold', Spam: 'spam', Trash: 'trash' })
    orderBy = this.#resolveChoice(orderBy, { Date: 'date', 'Date (GMT)': 'date_gmt', ID: 'id', 'Include Order': 'include', Post: 'post', Parent: 'parent', Type: 'type' })
    order = this.#resolveChoice(order, { Ascending: 'asc', Descending: 'desc' })

    const query = {
      post: postId,
      parent: parentId,
      status,
      search,
      page,
      per_page: perPage,
      orderby: orderBy,
      order,
    }

    return await this.#apiRequest({
      url: `${ this.baseUrl }/comments`,
      method: 'get',
      query,
      logTag: 'listComments',
    })
  }

  /**
   * @operationName Get Comment
   * @category Comments
   * @description Fetches a single comment by numeric ID, including author details, content, and moderation status.
   * @route POST /get-comment
   *
   * @paramDef {"type":"Number","label":"Comment ID","name":"commentId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the comment to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":31,"post":42,"parent":0,"author":0,"author_name":"Visitor","author_email":"visitor@example.com","date":"2024-08-02T12:00:00","content":{"rendered":"<p>Great post!</p>"},"link":"https://example.com/hello-world#comment-31","status":"approved","type":"comment"}
   */
  async getComment(commentId) {
    assert(commentId, 'Comment ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/comments/${ commentId }`,
      method: 'get',
      logTag: 'getComment',
    })
  }

  /**
   * @operationName Create Comment
   * @category Comments
   * @description Creates a new comment on a post. Provide either an authenticated author user ID or guest author details (name and email). Use parent to nest the comment as a reply.
   * @route POST /create-comment
   *
   * @paramDef {"type":"Number","label":"Post ID","name":"postId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the post the comment belongs to."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Comment body text. May contain HTML."}
   * @paramDef {"type":"Number","label":"Author User ID","name":"authorId","dictionary":"getAuthorsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"User ID of an existing site user to attribute the comment to."}
   * @paramDef {"type":"String","label":"Author Name","name":"authorName","description":"Display name to use for guest comments when no Author User ID is provided."}
   * @paramDef {"type":"String","label":"Author Email","name":"authorEmail","description":"Email address to use for guest comments when no Author User ID is provided."}
   * @paramDef {"type":"String","label":"Author URL","name":"authorUrl","description":"Optional website URL for the comment author."}
   * @paramDef {"type":"Number","label":"Parent","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Parent comment ID to reply to. Use 0 or leave empty for a top-level comment."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Approved","Pending","Spam"]}},"description":"Initial moderation status. Requires moderation permission."}
   *
   * @returns {Object}
   * @sampleResult {"id":31,"post":42,"parent":0,"author":1,"author_name":"Admin","author_url":"","date":"2024-08-02T12:00:00","content":{"rendered":"<p>Thanks for visiting.</p>"},"link":"https://example.com/hello-world#comment-31","status":"approved","type":"comment"}
   */
  async createComment(postId, content, authorId, authorName, authorEmail, authorUrl, parentId, status) {
    assert(postId, 'Post ID is required.')
    assert(content, 'Content is required.')

    status = this.#resolveChoice(status, { Approved: 'approve', Pending: 'hold', Spam: 'spam' })

    const body = clean({
      post: postId,
      content,
      author: authorId,
      author_name: authorName,
      author_email: authorEmail,
      author_url: authorUrl,
      parent: parentId,
      status,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/comments`,
      method: 'post',
      body,
      logTag: 'createComment',
    })
  }

  /**
   * @operationName Update Comment
   * @category Comments
   * @description Updates fields of an existing comment such as content, moderation status, or author metadata.
   * @route POST /update-comment
   *
   * @paramDef {"type":"Number","label":"Comment ID","name":"commentId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the comment to update."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New comment body text."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Approved","Pending","Spam","Trash"]}},"description":"New moderation status."}
   * @paramDef {"type":"String","label":"Author Name","name":"authorName","description":"New display name for the comment author."}
   * @paramDef {"type":"String","label":"Author Email","name":"authorEmail","description":"New email address for the comment author."}
   * @paramDef {"type":"String","label":"Author URL","name":"authorUrl","description":"New website URL for the comment author."}
   *
   * @returns {Object}
   * @sampleResult {"id":31,"post":42,"parent":0,"author":1,"author_name":"Admin","date":"2024-08-02T12:00:00","content":{"rendered":"<p>Updated comment.</p>"},"link":"https://example.com/hello-world#comment-31","status":"approved","type":"comment"}
   */
  async updateComment(commentId, content, status, authorName, authorEmail, authorUrl) {
    assert(commentId, 'Comment ID is required.')

    status = this.#resolveChoice(status, { Approved: 'approve', Pending: 'hold', Spam: 'spam', Trash: 'trash' })

    const body = clean({
      content,
      status,
      author_name: authorName,
      author_email: authorEmail,
      author_url: authorUrl,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/comments/${ commentId }`,
      method: 'post',
      body,
      logTag: 'updateComment',
    })
  }

  /**
   * @operationName Delete Comment
   * @category Comments
   * @description Deletes a comment. By default the comment is moved to trash; pass force=true to permanently delete and bypass trash.
   * @route POST /delete-comment
   *
   * @paramDef {"type":"Number","label":"Comment ID","name":"commentId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the comment to delete."}
   * @paramDef {"type":"Boolean","label":"Force","name":"force","uiComponent":{"type":"TOGGLE"},"description":"Permanently delete the comment instead of moving it to trash."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"previous":{"id":31,"post":42,"author_name":"Admin","content":{"rendered":"<p>Updated comment.</p>"},"status":"trash"}}
   */
  async deleteComment(commentId, force) {
    assert(commentId, 'Comment ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/comments/${ commentId }`,
      method: 'delete',
      query: { force: force ? true : undefined },
      logTag: 'deleteComment',
    })
  }

  /**
   * @operationName Search Site
   * @category Search
   * @description Performs a sitewide search across configured content types (posts, pages, terms) and returns lightweight result objects with id, title, url, type and subtype. Use this to power site-search experiences or AI grounding over WordPress content.
   * @route POST /search-site
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search keywords."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Post","Term","Post Format"]}},"description":"Limit the result set to a specific search type. Defaults to 'post'."}
   * @paramDef {"type":"String","label":"Subtype","name":"subtype","description":"Comma-separated subtype slugs (e.g. 'post,page' or 'category,post_tag'). Use 'any' for all subtypes."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of the result set. Starts at 1. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to return per page (1-100). Defaults to 10."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":42,"title":"Hello World","url":"https://example.com/hello-world","type":"post","subtype":"post"},{"id":2,"title":"About","url":"https://example.com/about","type":"post","subtype":"page"}]
   */
  async searchSite(query, type, subtype, page, perPage) {
    assert(query, 'Query is required.')

    type = this.#resolveChoice(type, { Post: 'post', Term: 'term', 'Post Format': 'post-format' })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/search`,
      method: 'get',
      query: {
        search: query,
        type,
        subtype,
        page,
        per_page: perPage,
      },
      logTag: 'searchSite',
    })
  }

  /**
   * @operationName Get Settings
   * @category Settings
   * @description Returns site-wide WordPress settings such as title, description, URL, timezone, language, default category, and posts-per-page values. Requires manage_options capability on the connected user.
   * @route POST /get-settings
   *
   * @returns {Object}
   * @sampleResult {"title":"My WordPress Site","description":"Just another WordPress site","url":"https://example.com","email":"admin@example.com","timezone":"America/New_York","date_format":"F j, Y","time_format":"g:i a","start_of_week":1,"language":"en_US","use_smilies":true,"default_category":1,"default_post_format":"0","posts_per_page":10,"default_ping_status":"open","default_comment_status":"open"}
   */
  async getSettings() {
    return await this.#apiRequest({
      url: `${ this.baseUrl }/settings`,
      method: 'get',
      logTag: 'getSettings',
    })
  }

  /**
   * @operationName Update Settings
   * @category Settings
   * @description Updates site-wide WordPress settings. Only provided fields are changed. Requires manage_options capability on the connected user.
   * @route POST /update-settings
   *
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Site title shown in the browser bar and themes."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Site tagline."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Administration email address."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","description":"Site timezone string (e.g. 'America/New_York' or 'UTC+2')."}
   * @paramDef {"type":"String","label":"Date Format","name":"dateFormat","description":"PHP date format string used by themes."}
   * @paramDef {"type":"String","label":"Time Format","name":"timeFormat","description":"PHP time format string used by themes."}
   * @paramDef {"type":"Number","label":"Start of Week","name":"startOfWeek","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Day of week to start with (0 for Sunday through 6 for Saturday)."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"WordPress locale (e.g. 'en_US')."}
   * @paramDef {"type":"Number","label":"Default Category","name":"defaultCategory","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the default category for new posts."}
   * @paramDef {"type":"Number","label":"Posts Per Page","name":"postsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of posts shown on archive pages."}
   * @paramDef {"type":"String","label":"Default Comment Status","name":"defaultCommentStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Whether new posts allow comments by default."}
   * @paramDef {"type":"String","label":"Default Ping Status","name":"defaultPingStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Whether new posts allow pingbacks/trackbacks by default."}
   *
   * @returns {Object}
   * @sampleResult {"title":"My WordPress Site","description":"Updated tagline","url":"https://example.com","email":"admin@example.com","timezone":"America/New_York","posts_per_page":10}
   */
  async updateSettings(title, description, email, timezone, dateFormat, timeFormat, startOfWeek, language, defaultCategory, postsPerPage, defaultCommentStatus, defaultPingStatus) {
    defaultCommentStatus = this.#resolveChoice(defaultCommentStatus, { Open: 'open', Closed: 'closed' })
    defaultPingStatus = this.#resolveChoice(defaultPingStatus, { Open: 'open', Closed: 'closed' })

    const body = clean({
      title,
      description,
      email,
      timezone,
      date_format: dateFormat,
      time_format: timeFormat,
      start_of_week: startOfWeek,
      language,
      default_category: defaultCategory,
      posts_per_page: postsPerPage,
      default_comment_status: defaultCommentStatus,
      default_ping_status: defaultPingStatus,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/settings`,
      method: 'post',
      body,
      logTag: 'updateSettings',
    })
  }

  /**
   * @operationName List Taxonomies
   * @category Taxonomies
   * @description Returns all registered taxonomies on the site (e.g. category, post_tag, plus any custom taxonomies). Useful for discovering available term endpoints when working with custom post types.
   * @route POST /list-taxonomies
   *
   * @paramDef {"type":"String","label":"Type","name":"type","description":"Limit results to taxonomies that apply to a specific post type slug (e.g. 'post', 'page')."}
   *
   * @returns {Object}
   * @sampleResult {"category":{"name":"Categories","slug":"category","hierarchical":true,"rest_base":"categories","types":["post"]},"post_tag":{"name":"Tags","slug":"post_tag","hierarchical":false,"rest_base":"tags","types":["post"]}}
   */
  async listTaxonomies(type) {
    return await this.#apiRequest({
      url: `${ this.baseUrl }/taxonomies`,
      method: 'get',
      query: { type },
      logTag: 'listTaxonomies',
    })
  }

  /**
   * @operationName List Post Types
   * @category Taxonomies
   * @description Returns all registered post types on the site (e.g. post, page, attachment, plus any custom post types). Useful for discovering custom post type slugs and their REST base endpoints.
   * @route POST /list-post-types
   *
   * @returns {Object}
   * @sampleResult {"post":{"name":"Posts","slug":"post","hierarchical":false,"rest_base":"posts","supports":{"title":true,"editor":true,"author":true}},"page":{"name":"Pages","slug":"page","hierarchical":true,"rest_base":"pages","supports":{"title":true,"editor":true,"page-attributes":true}}}
   */
  async listPostTypes() {
    return await this.#apiRequest({
      url: `${ this.baseUrl }/types`,
      method: 'get',
      logTag: 'listPostTypes',
    })
  }

  /**
   * @operationName Get Post Meta
   * @category Custom Fields
   * @description Reads the custom fields (meta) stored on a single post or page and returns them as a key/value map. Only meta keys registered on the site with show_in_rest are exposed by the WordPress REST API; keys registered without it never appear here, so an empty result usually means no keys are REST-visible.
   * @route POST /get-post-meta
   *
   * @paramDef {"type":"String","label":"Content Type","name":"postType","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"post","label":"Post"},{"value":"page","label":"Page"}]}},"description":"Whether the ID refers to a post or a page. Defaults to post."}
   * @paramDef {"type":"Number","label":"Post ID","name":"postId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the post or page whose meta to read."}
   *
   * @returns {Object}
   * @sampleResult {"subtitle":"A short subtitle","featured":"yes","reading_time":5}
   */
  async getPostMeta(postType, postId) {
    assert(postId, 'Post ID is required.')

    const restBase = postType === 'page' ? 'pages' : 'posts'

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/${ restBase }/${ postId }`,
      method: 'get',
      query: { context: 'edit' },
      logTag: 'getPostMeta',
    })

    return response?.meta || {}
  }

  /**
   * @operationName Update Post Meta
   * @category Custom Fields
   * @description Sets one or more custom fields (meta) on a post or page. Pass a map of meta key to value; the given keys are overwritten and all other meta is left untouched. A key is only saved if it was registered on the site with show_in_rest - WordPress silently ignores unregistered keys, so a returned value that is missing your key means the key is not REST-registered. Returns the post's meta after the update.
   * @route POST /update-post-meta
   *
   * @paramDef {"type":"String","label":"Content Type","name":"postType","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"post","label":"Post"},{"value":"page","label":"Page"}]}},"description":"Whether the ID refers to a post or a page. Defaults to post."}
   * @paramDef {"type":"Number","label":"Post ID","name":"postId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the post or page to update."}
   * @paramDef {"type":"Object","label":"Meta Fields","name":"meta","required":true,"description":"Map of meta key to value to set, for example {\"subtitle\":\"A short subtitle\",\"featured\":\"yes\"}. Each key must be registered on the site with show_in_rest or WordPress ignores it."}
   *
   * @returns {Object}
   * @sampleResult {"subtitle":"A short subtitle","featured":"yes","reading_time":5}
   */
  async updatePostMeta(postType, postId, meta) {
    assert(postId, 'Post ID is required.')
    assert(meta && typeof meta === 'object' && !Array.isArray(meta), 'Meta must be an object of key/value pairs.')
    assert(Object.keys(meta).length > 0, 'Provide at least one meta key to update.')

    const restBase = postType === 'page' ? 'pages' : 'posts'

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/${ restBase }/${ postId }`,
      method: 'post',
      body: { meta },
      logTag: 'updatePostMeta',
    })

    return response?.meta || {}
  }

  /**
   * @operationName List Custom Posts
   * @category Custom Post Types
   * @description Lists items of any registered post type by its REST base (e.g. a 'portfolio' or 'product' custom post type), with filtering by status, search, ordering, and pagination. Use List Post Types to discover the available REST bases.
   * @route POST /list-custom-posts
   *
   * @paramDef {"type":"String","label":"Post Type","name":"restBase","required":true,"dictionary":"getPostTypesDictionary","description":"REST base of the post type to list (e.g. 'posts', 'pages', or a custom type's REST base)."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"publish","label":"Published"},{"value":"future","label":"Scheduled"},{"value":"draft","label":"Draft"},{"value":"pending","label":"Pending Review"},{"value":"private","label":"Private"},{"value":"trash","label":"Trash"},{"value":"any","label":"Any"}]}},"description":"Filter items by publication status. Defaults to 'publish' if omitted."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search query matched against item title and content."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of the result set. Starts at 1. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items to return per page (1-100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"date","label":"Date"},{"value":"id","label":"ID"},{"value":"include","label":"Include Order"},{"value":"title","label":"Title"},{"value":"slug","label":"Slug"},{"value":"modified","label":"Last Modified"},{"value":"menu_order","label":"Menu Order"}]}},"description":"Field used to sort the results. Defaults to 'date'."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"asc","label":"Ascending"},{"value":"desc","label":"Descending"}]}},"description":"Sort direction. Defaults to 'desc'."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":128,"date":"2024-08-05T09:00:00","slug":"my-item","status":"publish","type":"portfolio","link":"https://example.com/portfolio/my-item","title":{"rendered":"My Item"},"content":{"rendered":"<p>Item body.</p>","protected":false},"excerpt":{"rendered":"<p>Item body.</p>","protected":false},"author":1,"featured_media":0,"meta":{}}]
   */
  async listCustomPosts(restBase, status, search, page, perPage, orderBy, order) {
    assert(restBase, 'Post Type (REST base) is required.')

    const query = {
      status,
      search,
      page,
      per_page: perPage,
      orderby: orderBy,
      order,
    }

    return await this.#apiRequest({
      url: `${ this.baseUrl }/${ restBase }`,
      method: 'get',
      query,
      logTag: 'listCustomPosts',
    })
  }

  /**
   * @operationName Get Custom Post
   * @category Custom Post Types
   * @description Fetches a single item of any registered post type by its REST base and numeric ID, including its content, status, and meta fields. Use List Post Types to discover the available REST bases.
   * @route POST /get-custom-post
   *
   * @paramDef {"type":"String","label":"Post Type","name":"restBase","required":true,"dictionary":"getPostTypesDictionary","description":"REST base of the post type (e.g. 'posts', 'pages', or a custom type's REST base)."}
   * @paramDef {"type":"Number","label":"Post ID","name":"postId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the item to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":128,"date":"2024-08-05T09:00:00","slug":"my-item","status":"publish","type":"portfolio","link":"https://example.com/portfolio/my-item","title":{"rendered":"My Item"},"content":{"rendered":"<p>Item body.</p>","protected":false},"excerpt":{"rendered":"<p>Item body.</p>","protected":false},"author":1,"featured_media":0,"meta":{}}
   */
  async getCustomPost(restBase, postId) {
    assert(restBase, 'Post Type (REST base) is required.')
    assert(postId, 'Post ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/${ restBase }/${ postId }`,
      method: 'get',
      logTag: 'getCustomPost',
    })
  }

  /**
   * @operationName Create Custom Post
   * @category Custom Post Types
   * @description Creates an item of any registered post type by its REST base (e.g. a 'portfolio' or 'product' custom post type). Provide the title, content, status, and any custom fields via meta. Use List Post Types to discover the available REST bases.
   * @route POST /create-custom-post
   *
   * @paramDef {"type":"String","label":"Post Type","name":"restBase","required":true,"dictionary":"getPostTypesDictionary","description":"REST base of the post type to create in (e.g. 'posts', 'pages', or a custom type's REST base)."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the new item."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The HTML content body of the item."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"publish","label":"Published"},{"value":"future","label":"Scheduled"},{"value":"draft","label":"Draft"},{"value":"pending","label":"Pending Review"},{"value":"private","label":"Private"}]}},"description":"Publication status for the new item. Defaults to 'draft' when omitted."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"URL-friendly identifier. WordPress generates one from the title if omitted."}
   * @paramDef {"type":"String","label":"Excerpt","name":"excerpt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Short summary used by themes for previews."}
   * @paramDef {"type":"Object","label":"Meta Fields","name":"meta","description":"Optional map of custom-field key to value. Each key must be registered on the site with show_in_rest or WordPress ignores it."}
   *
   * @returns {Object}
   * @sampleResult {"id":128,"date":"2024-08-05T09:00:00","slug":"my-item","status":"draft","type":"portfolio","link":"https://example.com/?portfolio=my-item","title":{"rendered":"My Item"},"content":{"rendered":"<p>Item body.</p>","protected":false},"author":1,"featured_media":0,"meta":{}}
   */
  async createCustomPost(restBase, title, content, status, slug, excerpt, meta) {
    assert(restBase, 'Post Type (REST base) is required.')
    assert(title, 'Title is required.')

    const body = clean({
      title,
      content,
      status,
      slug,
      excerpt,
      meta,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/${ restBase }`,
      method: 'post',
      body,
      logTag: 'createCustomPost',
    })
  }

  /**
   * @operationName Update Custom Post
   * @category Custom Post Types
   * @description Updates an item of any registered post type by its REST base and numeric ID. Only the provided fields are changed; omitted fields are left untouched. Use List Post Types to discover the available REST bases.
   * @route POST /update-custom-post
   *
   * @paramDef {"type":"String","label":"Post Type","name":"restBase","required":true,"dictionary":"getPostTypesDictionary","description":"REST base of the post type (e.g. 'posts', 'pages', or a custom type's REST base)."}
   * @paramDef {"type":"Number","label":"Post ID","name":"postId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the item to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title for the item."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New HTML content body for the item."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"publish","label":"Published"},{"value":"future","label":"Scheduled"},{"value":"draft","label":"Draft"},{"value":"pending","label":"Pending Review"},{"value":"private","label":"Private"}]}},"description":"New publication status for the item."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"New URL-friendly identifier."}
   * @paramDef {"type":"String","label":"Excerpt","name":"excerpt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New excerpt text used by themes for previews."}
   * @paramDef {"type":"Object","label":"Meta Fields","name":"meta","description":"Optional map of custom-field key to value to overwrite. Each key must be registered on the site with show_in_rest or WordPress ignores it."}
   *
   * @returns {Object}
   * @sampleResult {"id":128,"date":"2024-08-05T09:00:00","slug":"my-item-updated","status":"publish","type":"portfolio","link":"https://example.com/portfolio/my-item-updated","title":{"rendered":"My Item Updated"},"content":{"rendered":"<p>Updated body.</p>","protected":false},"author":1,"featured_media":0,"meta":{}}
   */
  async updateCustomPost(restBase, postId, title, content, status, slug, excerpt, meta) {
    assert(restBase, 'Post Type (REST base) is required.')
    assert(postId, 'Post ID is required.')

    const body = clean({
      title,
      content,
      status,
      slug,
      excerpt,
      meta,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/${ restBase }/${ postId }`,
      method: 'post',
      body,
      logTag: 'updateCustomPost',
    })
  }

  /**
   * @operationName Delete Custom Post
   * @category Custom Post Types
   * @description Deletes an item of any registered post type by its REST base and numeric ID. By default the item is moved to trash; pass force=true to permanently delete and bypass trash. Some post types do not support trash and require force=true.
   * @route POST /delete-custom-post
   *
   * @paramDef {"type":"String","label":"Post Type","name":"restBase","required":true,"dictionary":"getPostTypesDictionary","description":"REST base of the post type (e.g. 'posts', 'pages', or a custom type's REST base)."}
   * @paramDef {"type":"Number","label":"Post ID","name":"postId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the item to delete."}
   * @paramDef {"type":"Boolean","label":"Force","name":"force","uiComponent":{"type":"TOGGLE"},"description":"Permanently delete the item instead of moving it to trash."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"previous":{"id":128,"slug":"my-item","status":"trash","type":"portfolio","title":{"rendered":"My Item"}}}
   */
  async deleteCustomPost(restBase, postId, force) {
    assert(restBase, 'Post Type (REST base) is required.')
    assert(postId, 'Post ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/${ restBase }/${ postId }`,
      method: 'delete',
      query: { force: force ? true : undefined },
      logTag: 'deleteCustomPost',
    })
  }

  /**
   * @operationName List Taxonomy Terms
   * @category Custom Taxonomies
   * @description Lists terms of any registered taxonomy by its REST base (e.g. a 'genre' or 'brand' custom taxonomy), with search, ordering, and filtering by parent for hierarchical taxonomies. Use List Taxonomies to discover the available REST bases.
   * @route POST /list-taxonomy-terms
   *
   * @paramDef {"type":"String","label":"Taxonomy","name":"taxonomy","required":true,"dictionary":"getTaxonomiesDictionary","description":"REST base of the taxonomy to list terms from (e.g. 'categories', 'tags', or a custom taxonomy's REST base)."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search query matched against term names."}
   * @paramDef {"type":"Number","label":"Parent","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limit to direct children of the given parent term ID. Only applies to hierarchical taxonomies. Use 0 for top-level terms."}
   * @paramDef {"type":"Boolean","label":"Hide Empty","name":"hideEmpty","uiComponent":{"type":"TOGGLE"},"description":"Exclude terms that have no assigned content."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of the result set. Starts at 1. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of terms to return per page (1-100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"id","label":"ID"},{"value":"name","label":"Name"},{"value":"slug","label":"Slug"},{"value":"include","label":"Include Order"},{"value":"count","label":"Content Count"},{"value":"term_group","label":"Term Group"},{"value":"description","label":"Description"}]}},"description":"Field used to sort the results. Defaults to 'name'."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"asc","label":"Ascending"},{"value":"desc","label":"Descending"}]}},"description":"Sort direction. Defaults to 'asc'."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":45,"count":8,"description":"","link":"https://example.com/genre/sci-fi","name":"Sci-Fi","slug":"sci-fi","taxonomy":"genre","parent":0}]
   */
  async listTaxonomyTerms(taxonomy, search, parentId, hideEmpty, page, perPage, orderBy, order) {
    assert(taxonomy, 'Taxonomy (REST base) is required.')

    const query = {
      search,
      parent: parentId,
      hide_empty: hideEmpty,
      page,
      per_page: perPage,
      orderby: orderBy,
      order,
    }

    return await this.#apiRequest({
      url: `${ this.baseUrl }/${ taxonomy }`,
      method: 'get',
      query,
      logTag: 'listTaxonomyTerms',
    })
  }

  /**
   * @operationName Create Taxonomy Term
   * @category Custom Taxonomies
   * @description Creates a term in any registered taxonomy by its REST base (e.g. a 'genre' or 'brand' custom taxonomy). The parent field only applies to hierarchical taxonomies. Use List Taxonomies to discover the available REST bases.
   * @route POST /create-taxonomy-term
   *
   * @paramDef {"type":"String","label":"Taxonomy","name":"taxonomy","required":true,"dictionary":"getTaxonomiesDictionary","description":"REST base of the taxonomy to create the term in (e.g. 'categories', 'tags', or a custom taxonomy's REST base)."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name of the new term."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"URL-friendly identifier. WordPress generates one from the name if omitted."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text description for the term."}
   * @paramDef {"type":"Number","label":"Parent","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Parent term ID for nested terms. Only applies to hierarchical taxonomies; leave empty otherwise."}
   * @paramDef {"type":"Object","label":"Meta Fields","name":"meta","description":"Optional map of custom-field key to value. Each key must be registered on the site with show_in_rest or WordPress ignores it."}
   *
   * @returns {Object}
   * @sampleResult {"id":45,"count":0,"description":"","link":"https://example.com/genre/sci-fi","name":"Sci-Fi","slug":"sci-fi","taxonomy":"genre","parent":0}
   */
  async createTaxonomyTerm(taxonomy, name, slug, description, parentId, meta) {
    assert(taxonomy, 'Taxonomy (REST base) is required.')
    assert(name, 'Name is required.')

    const body = clean({
      name,
      slug,
      description,
      parent: parentId,
      meta,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/${ taxonomy }`,
      method: 'post',
      body,
      logTag: 'createTaxonomyTerm',
    })
  }

  /**
   * @operationName Update Taxonomy Term
   * @category Custom Taxonomies
   * @description Updates a term in any registered taxonomy by its REST base and numeric term ID. Only the provided fields are changed. Use List Taxonomies to discover the available REST bases.
   * @route POST /update-taxonomy-term
   *
   * @paramDef {"type":"String","label":"Taxonomy","name":"taxonomy","required":true,"dictionary":"getTaxonomiesDictionary","description":"REST base of the taxonomy (e.g. 'categories', 'tags', or a custom taxonomy's REST base)."}
   * @paramDef {"type":"Number","label":"Term ID","name":"termId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the term to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New display name."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"New URL-friendly identifier."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"Number","label":"Parent","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New parent term ID. Only applies to hierarchical taxonomies."}
   * @paramDef {"type":"Object","label":"Meta Fields","name":"meta","description":"Optional map of custom-field key to value to overwrite. Each key must be registered on the site with show_in_rest or WordPress ignores it."}
   *
   * @returns {Object}
   * @sampleResult {"id":45,"count":8,"description":"Science fiction titles.","link":"https://example.com/genre/sci-fi","name":"Sci-Fi","slug":"sci-fi","taxonomy":"genre","parent":0}
   */
  async updateTaxonomyTerm(taxonomy, termId, name, slug, description, parentId, meta) {
    assert(taxonomy, 'Taxonomy (REST base) is required.')
    assert(termId, 'Term ID is required.')

    const body = clean({
      name,
      slug,
      description,
      parent: parentId,
      meta,
    })

    return await this.#apiRequest({
      url: `${ this.baseUrl }/${ taxonomy }/${ termId }`,
      method: 'post',
      body,
      logTag: 'updateTaxonomyTerm',
    })
  }

  /**
   * @operationName Delete Taxonomy Term
   * @category Custom Taxonomies
   * @description Permanently deletes a term from any registered taxonomy by its REST base and numeric term ID. WordPress requires force=true for term deletion since terms do not support trashing, so this always deletes permanently. Content assigned only to this term loses the assignment.
   * @route POST /delete-taxonomy-term
   *
   * @paramDef {"type":"String","label":"Taxonomy","name":"taxonomy","required":true,"dictionary":"getTaxonomiesDictionary","description":"REST base of the taxonomy (e.g. 'categories', 'tags', or a custom taxonomy's REST base)."}
   * @paramDef {"type":"Number","label":"Term ID","name":"termId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unique numeric identifier of the term to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"previous":{"id":45,"name":"Sci-Fi","slug":"sci-fi","taxonomy":"genre"}}
   */
  async deleteTaxonomyTerm(taxonomy, termId) {
    assert(taxonomy, 'Taxonomy (REST base) is required.')
    assert(termId, 'Term ID is required.')

    return await this.#apiRequest({
      url: `${ this.baseUrl }/${ taxonomy }/${ termId }`,
      method: 'delete',
      query: { force: true },
      logTag: 'deleteTaxonomyTerm',
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Categories Dictionary
   * @description Provides a searchable list of WordPress post categories for dynamic parameter selection in dropdowns.
   * @route POST /get-categories-dictionary
   * @paramDef {"type":"getCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering categories."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"News","value":"1","note":"Slug: news"}],"cursor":"2"}
   */
  async getCategoriesDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? Number(cursor) : 1

    const items = await this.#apiRequest({
      url: `${ this.baseUrl }/categories`,
      method: 'get',
      query: {
        search,
        page,
        per_page: 100,
        orderby: 'name',
        order: 'asc',
      },
      logTag: 'getCategoriesDictionary',
    })

    return {
      items: (items || []).map(category => ({
        label: category.name,
        value: String(category.id),
        note: `Slug: ${ category.slug }`,
      })),
      cursor: (items || []).length === 100 ? String(page + 1) : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Provides a searchable list of WordPress post tags for dynamic parameter selection in dropdowns.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering tags."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"WordPress","value":"7","note":"Slug: wordpress"}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? Number(cursor) : 1

    const items = await this.#apiRequest({
      url: `${ this.baseUrl }/tags`,
      method: 'get',
      query: {
        search,
        page,
        per_page: 100,
        orderby: 'name',
        order: 'asc',
      },
      logTag: 'getTagsDictionary',
    })

    return {
      items: (items || []).map(tag => ({
        label: tag.name,
        value: String(tag.id),
        note: `Slug: ${ tag.slug }`,
      })),
      cursor: (items || []).length === 100 ? String(page + 1) : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Authors Dictionary
   * @description Provides a searchable list of WordPress users for dynamic author selection in dropdowns.
   * @route POST /get-authors-dictionary
   * @paramDef {"type":"getAuthorsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering users."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Admin","value":"1","note":"Slug: admin"}],"cursor":null}
   */
  async getAuthorsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? Number(cursor) : 1

    const items = await this.#apiRequest({
      url: `${ this.baseUrl }/users`,
      method: 'get',
      query: {
        search,
        page,
        per_page: 100,
        orderby: 'name',
        order: 'asc',
        context: 'edit',
      },
      logTag: 'getAuthorsDictionary',
    })

    return {
      items: (items || []).map(user => ({
        label: user.name || user.username || `User ${ user.id }`,
        value: String(user.id),
        note: user.slug ? `Slug: ${ user.slug }` : `ID: ${ user.id }`,
      })),
      cursor: (items || []).length === 100 ? String(page + 1) : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Post Types Dictionary
   * @description Provides a searchable list of registered post types (by REST base) for dynamic parameter selection in dropdowns.
   * @route POST /get-post-types-dictionary
   * @paramDef {"type":"getPostTypesDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string for filtering post types by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Posts","value":"posts","note":"Slug: post"}],"cursor":null}
   */
  async getPostTypesDictionary(payload) {
    const { search } = payload || {}

    const types = await this.#apiRequest({
      url: `${ this.baseUrl }/types`,
      method: 'get',
      logTag: 'getPostTypesDictionary',
    })

    const term = search ? String(search).toLowerCase() : null

    const items = Object.values(types || {})
      .filter(type => type && type.rest_base)
      .filter(type => !term || String(type.name || '').toLowerCase().includes(term) || String(type.slug || '').toLowerCase().includes(term))
      .map(type => ({
        label: type.name || type.slug,
        value: type.rest_base,
        note: `Slug: ${ type.slug }`,
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Taxonomies Dictionary
   * @description Provides a searchable list of registered taxonomies (by REST base) for dynamic parameter selection in dropdowns.
   * @route POST /get-taxonomies-dictionary
   * @paramDef {"type":"getTaxonomiesDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string for filtering taxonomies by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Categories","value":"categories","note":"Slug: category"}],"cursor":null}
   */
  async getTaxonomiesDictionary(payload) {
    const { search } = payload || {}

    const taxonomies = await this.#apiRequest({
      url: `${ this.baseUrl }/taxonomies`,
      method: 'get',
      logTag: 'getTaxonomiesDictionary',
    })

    const term = search ? String(search).toLowerCase() : null

    const items = Object.values(taxonomies || {})
      .filter(taxonomy => taxonomy && taxonomy.rest_base)
      .filter(taxonomy => !term || String(taxonomy.name || '').toLowerCase().includes(term) || String(taxonomy.slug || '').toLowerCase().includes(term))
      .map(taxonomy => ({
        label: taxonomy.name || taxonomy.slug,
        value: taxonomy.rest_base,
        note: `Slug: ${ taxonomy.slug }`,
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    logger.debug(`handleTriggerPollingForEvent.${ invocation.eventName }`)

    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On New Published Post
   * @category Triggers
   * @description Triggers when a new post is published on the WordPress site. Optionally filter by category to react only to posts in a specific topic. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-published-post
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Category","name":"categoryId","dictionary":"getCategoriesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limit triggers to posts assigned to the selected category. Leave empty to trigger on all categories."}
   *
   * @returns {Object}
   * @sampleResult {"id":42,"date":"2024-08-01T10:30:00","slug":"hello-world","status":"publish","type":"post","link":"https://example.com/hello-world","title":{"rendered":"Hello World"},"content":{"rendered":"<p>Welcome to WordPress.</p>","protected":false},"excerpt":{"rendered":"<p>Welcome.</p>","protected":false},"author":1,"categories":[1],"tags":[]}
   */
  async onNewPublishedPost(invocation) {
    const { categoryId } = invocation.triggerData || {}
    const lastSeenId = invocation.state?.lastSeenId

    const perPage = 100

    const fetchPage = page => this.#apiRequest({
      url: `${ this.baseUrl }/posts`,
      method: 'get',
      query: {
        status: 'publish',
        per_page: perPage,
        page,
        orderby: 'id',
        order: 'desc',
        categories: categoryId || undefined,
      },
      logTag: 'onNewPublishedPost',
    })

    // Sorting by id descending means page 1 always leads with the highest post id on the site.
    const firstPage = await fetchPage(1)
    const newestId = firstPage && firstPage.length ? firstPage[0].id : 0

    // Learning mode: surface the single newest post as a sample event.
    if (invocation.learningMode) {
      const sample = firstPage && firstPage.length ? firstPage[0] : null

      return {
        events: sample ? [sample] : [],
        state: { lastSeenId: sample ? sample.id : 0 },
      }
    }

    // First real cycle: seed the watermark to the newest id and emit nothing (no backlog replay).
    if (lastSeenId == null) {
      return {
        events: [],
        state: { lastSeenId: newestId },
      }
    }

    // Walk pages newest-first, collecting every post above the watermark. Stop as soon as a page
    // holds an already-seen id (fewer fresh than fetched) or is a short/last page - so bulk
    // (>1 page/interval) and back-dated/imported posts are never dropped, however many pages they span.
    const collected = []
    let pagePosts = firstPage

    for (let page = 1; pagePosts && pagePosts.length; page++) {
      const fresh = pagePosts.filter(post => post.id > lastSeenId)

      collected.push(...fresh)

      if (fresh.length < pagePosts.length || pagePosts.length < perPage) {
        break
      }

      pagePosts = await fetchPage(page + 1)
    }

    // Emit ascending (oldest new post first) and advance the watermark to the highest id seen.
    collected.sort((a, b) => a.id - b.id)

    return {
      events: collected,
      state: { lastSeenId: Math.max(lastSeenId, newestId) },
    }
  }

  /**
   * @operationName On New Comment
   * @category Triggers
   * @description Triggers when a new comment is posted on the WordPress site. Optionally filter by a specific post or by moderation status (approved comments by default). Polling interval can be customized (minimum 30 seconds). New comments are tracked by ID: a comment left pending in moderation and approved only after a newer comment was already approved keeps its lower ID and may not trigger.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-comment
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Post","name":"postId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limit triggers to comments on the given post or page ID. Leave empty to trigger on comments across the whole site."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"approve","label":"Approved"},{"value":"hold","label":"Pending"},{"value":"spam","label":"Spam"},{"value":"trash","label":"Trash"}]}},"description":"Limit triggers to comments in this moderation status. Defaults to approved comments."}
   *
   * @returns {Object}
   * @sampleResult {"id":31,"post":42,"parent":0,"author":0,"author_name":"Visitor","author_url":"","date":"2024-08-02T12:00:00","content":{"rendered":"<p>Great post!</p>"},"link":"https://example.com/hello-world#comment-31","status":"approved","type":"comment"}
   */
  async onNewComment(invocation) {
    const { postId, status } = invocation.triggerData || {}
    const lastSeenId = invocation.state?.lastSeenId

    const perPage = 100

    const fetchPage = page => this.#apiRequest({
      url: `${ this.baseUrl }/comments`,
      method: 'get',
      query: {
        post: postId || undefined,
        status: status || undefined,
        per_page: perPage,
        page,
        orderby: 'id',
        order: 'desc',
      },
      logTag: 'onNewComment',
    })

    // Sorting by id descending means page 1 always leads with the highest comment id on the site.
    const firstPage = await fetchPage(1)
    const newestId = firstPage && firstPage.length ? firstPage[0].id : 0

    // Learning mode: surface the single newest comment as a sample event.
    if (invocation.learningMode) {
      const sample = firstPage && firstPage.length ? firstPage[0] : null

      return {
        events: sample ? [sample] : [],
        state: { lastSeenId: sample ? sample.id : 0 },
      }
    }

    // First real cycle: seed the watermark to the newest id and emit nothing (no backlog replay).
    if (lastSeenId == null) {
      return {
        events: [],
        state: { lastSeenId: newestId },
      }
    }

    // Walk pages newest-first, collecting every comment above the watermark. Stop as soon as a page
    // holds an already-seen id (fewer fresh than fetched) or is a short/last page - so a burst of
    // comments (>1 page/interval) is never dropped, however many pages it spans.
    const collected = []
    let pageComments = firstPage

    for (let page = 1; pageComments && pageComments.length; page++) {
      const fresh = pageComments.filter(comment => comment.id > lastSeenId)

      collected.push(...fresh)

      if (fresh.length < pageComments.length || pageComments.length < perPage) {
        break
      }

      pageComments = await fetchPage(page + 1)
    }

    // Emit ascending (oldest new comment first) and advance the watermark to the highest id seen.
    collected.sort((a, b) => a.id - b.id)

    return {
      events: collected,
      state: { lastSeenId: Math.max(lastSeenId, newestId) },
    }
  }
}

/**
 * @typedef {Object} getCategoriesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter categories by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getTagsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tags by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getAuthorsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter users by name or email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getPostTypesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter post types by name."}
 */

/**
 * @typedef {Object} getTaxonomiesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter taxonomies by name."}
 */

Flowrunner.ServerCode.addService(WordPress, [
  {
    displayName: 'Site URL',
    name: 'siteUrl',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    defaultValue: 'https://example.com',
    hint: 'Your WordPress site URL including protocol. Example: https://yoursite.com. Find it in WordPress Admin > Settings > General > Site Address (URL).',
  },
  {
    displayName: 'Username',
    name: 'username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    defaultValue: 'admin',
    hint: 'WordPress login (username or email) of the user whose Application Password will be used. The user must have permission for the operations you intend to perform.',
  },
  {
    displayName: 'Application Password',
    name: 'appPassword',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    defaultValue: 'xxxx xxxx xxxx xxxx xxxx xxxx',
    hint: 'Application Password generated in WordPress Admin > Users > Profile > Application Passwords. Spaces in the displayed value are ignored.',
  },
])
