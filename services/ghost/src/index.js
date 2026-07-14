const crypto = require('crypto')

const logger = {
  info: (...args) => console.log('[Ghost] info:', ...args),
  debug: (...args) => console.log('[Ghost] debug:', ...args),
  error: (...args) => console.log('[Ghost] error:', ...args),
  warn: (...args) => console.log('[Ghost] warn:', ...args),
}

// Ghost API version negotiated via the Accept-Version header.
const GHOST_API_VERSION = 'v5.0'

// Admin API JWTs are short-lived (Ghost caps exp at 5 minutes). We mint a fresh
// token slightly ahead of expiry to avoid clock-skew rejections at the edge.
const JWT_TTL_SECONDS = 300
const JWT_RENEW_MARGIN_MS = 30 * 1000

const STATUS_LABEL_TO_VALUE = {
  Draft: 'draft',
  Published: 'published',
  Scheduled: 'scheduled',
}

const ORDER_LABEL_TO_VALUE = {
  'Newest First': 'published_at desc',
  'Oldest First': 'published_at asc',
  'Recently Updated': 'updated_at desc',
  'Title A-Z': 'title asc',
}

/**
 * Removes undefined, null, and empty-string values so optional params are omitted
 * from request bodies and query strings rather than sent as blanks.
 */
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

/** base64url encoding without the '=' padding, per the JWT spec. */
function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

/**
 * @usesFileStorage
 * @integrationName Ghost
 * @integrationIcon /icon.svg
 */
class GhostService {
  constructor(config) {
    // Site URL, e.g. https://blog.example.com — trailing slash stripped so we can
    // safely concatenate the API path segments.
    this.apiUrl = (config.apiUrl || '').replace(/\/+$/, '')
    // Admin API key in 'id:secret' form (secret is hex) — used to mint Admin API JWTs.
    this.adminApiKey = config.adminApiKey
    // Content API key — a plain hex string passed as the ?key= query param.
    this.contentApiKey = config.contentApiKey

    this.adminBaseUrl = `${ this.apiUrl }/ghost/api/admin`
    this.contentBaseUrl = `${ this.apiUrl }/ghost/api/content`

    // Cached Admin JWT + its absolute expiry (ms epoch).
    this._jwt = null
    this._jwtExpiresAt = 0
  }

  // ---------------------------------------------------------------------------
  //  AUTH
  // ---------------------------------------------------------------------------

  /**
   * Mints (and briefly caches) an Admin API JWT from the 'id:secret' admin key.
   * HS256 over the standard header/payload, signing with the hex-decoded secret.
   */
  #getAdminToken() {
    if (this._jwt && Date.now() < this._jwtExpiresAt - JWT_RENEW_MARGIN_MS) {
      return this._jwt
    }

    if (!this.adminApiKey || !this.adminApiKey.includes(':')) {
      throw new Error('Ghost API error: Admin API Key is required for this operation and must be in the "id:secret" format.')
    }

    const [id, secret] = this.adminApiKey.split(':')

    if (!id || !secret) {
      throw new Error('Ghost API error: Admin API Key is malformed — expected "id:secret".')
    }

    const now = Math.floor(Date.now() / 1000)
    const header = { alg: 'HS256', typ: 'JWT', kid: id }
    const payload = { iat: now, exp: now + JWT_TTL_SECONDS, aud: '/admin/' }

    const encodedHeader = base64url(JSON.stringify(header))
    const encodedPayload = base64url(JSON.stringify(payload))
    const signingInput = `${ encodedHeader }.${ encodedPayload }`

    const signature = crypto
      .createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(signingInput)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

    this._jwt = `${ signingInput }.${ signature }`
    this._jwtExpiresAt = (now + JWT_TTL_SECONDS) * 1000

    return this._jwt
  }

  // ---------------------------------------------------------------------------
  //  REQUEST HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Single entry point for Admin API calls. Injects a fresh JWT and version header,
   * and normalizes Ghost's errors[].message / errors[].context error envelope.
   */
  async #adminRequest({ path, method = 'get', body, query, logTag }) {
    if (!this.apiUrl) {
      throw new Error('Ghost API error: Site URL is not configured.')
    }

    const url = `${ this.adminBaseUrl }${ path }`
    const cleanedQuery = clean(query)

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Ghost ${ this.#getAdminToken() }`,
          'Accept-Version': GHOST_API_VERSION,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      throw this.#toError(error, logTag)
    }
  }

  /**
   * Single entry point for Content API (published, read-only) calls. Auth is the
   * plain content key on the query string; no JWT.
   */
  async #contentRequest({ path, query, logTag }) {
    if (!this.apiUrl) {
      throw new Error('Ghost API error: Site URL is not configured.')
    }

    if (!this.contentApiKey) {
      throw new Error('Ghost API error: Content API Key is required to read published content.')
    }

    const url = `${ this.contentBaseUrl }${ path }`
    const cleanedQuery = clean({ ...query, key: this.contentApiKey })

    try {
      logger.debug(`${ logTag } - [GET::${ url }]`)

      return await Flowrunner.Request.get(url)
        .set({ 'Accept-Version': GHOST_API_VERSION })
        .query(cleanedQuery)
    } catch (error) {
      throw this.#toError(error, logTag)
    }
  }

  /** Normalizes a thrown request error into a single Error with Ghost's message + context. */
  #toError(error, logTag) {
    const ghostError = error.body?.errors?.[0]
    const parts = []

    if (ghostError?.message) {
      parts.push(ghostError.message)
    }

    if (ghostError?.context) {
      parts.push(ghostError.context)
    }

    const message = parts.length
      ? parts.join(' — ')
      : (error.body?.message || (typeof error.message === 'string' ? error.message : JSON.stringify(error.message)))

    logger.error(`${ logTag } - failed: ${ message }`)

    return new Error(`Ghost API error: ${ message }`)
  }

  /** Maps a friendly dropdown label to its API value, passing through unknown values. */
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /** Splits a comma-separated string (or passes an array through) into a trimmed name array. */
  #parseList(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const raw = Array.isArray(value) ? value : String(value).split(',')
    const list = raw.map(item => String(item).trim()).filter(Boolean)

    return list.length ? list : undefined
  }

  /** Converts a list of tag/author name strings into Ghost's [{name}] / [{email}] reference shape. */
  #toReferences(names, key) {
    const list = this.#parseList(names)

    return list ? list.map(name => ({ [key]: name })) : undefined
  }

  // ===========================================================================
  //  POSTS (Admin API)
  // ===========================================================================

  /**
   * @operationName Create Post
   * @category Posts
   * @description Creates a new post on the Ghost site via the Admin API. Provide HTML content (recommended) or Lexical JSON. Set the status to Draft, Published, or Scheduled — when scheduling, also supply a future Published At timestamp. Tags and authors are matched by name/email and created if they do not exist. Returns the created post including its id, slug, and url.
   * @route POST /posts
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The post title."}
   * @paramDef {"type":"String","label":"HTML Content","name":"html","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Post body as HTML. Sent using Ghost's source=html conversion. Leave empty if providing Lexical instead."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Published","Scheduled"]}},"description":"Publication state of the post. Defaults to Draft. Scheduled requires a future Published At."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tag names to attach. Existing tags are reused; unknown names are created."}
   * @paramDef {"type":"Array<String>","label":"Authors","name":"authors","description":"Author email addresses. Each must correspond to an existing staff user on the site."}
   * @paramDef {"type":"String","label":"Feature Image URL","name":"featureImage","description":"URL of the post's feature image."}
   * @paramDef {"type":"String","label":"Excerpt","name":"excerpt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Custom excerpt / summary shown in listings and meta tags."}
   * @paramDef {"type":"String","label":"Lexical Content","name":"lexical","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Post body as Ghost Lexical JSON. Use instead of HTML Content for full editor fidelity."}
   * @paramDef {"type":"String","label":"Published At","name":"publishedAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Publish timestamp (ISO 8601). Required and must be in the future when status is Scheduled."}
   * @returns {Object}
   * @sampleResult {"posts":[{"id":"64b2f...","uuid":"a1b2...","title":"Hello World","slug":"hello-world","html":"<p>Hi</p>","status":"draft","url":"https://blog.example.com/hello-world/","created_at":"2026-07-14T10:00:00.000Z","updated_at":"2026-07-14T10:00:00.000Z"}]}
   */
  async createPost(title, html, status, tags, authors, featureImage, excerpt, lexical, publishedAt) {
    const logTag = '[createPost]'

    const post = clean({
      title,
      html,
      lexical,
      status: this.#resolveChoice(status, STATUS_LABEL_TO_VALUE) || 'draft',
      tags: this.#toReferences(tags, 'name'),
      authors: this.#toReferences(authors, 'email'),
      feature_image: featureImage,
      excerpt,
      published_at: publishedAt,
    })

    return this.#adminRequest({
      logTag,
      path: '/posts/',
      method: 'post',
      query: html ? { source: 'html' } : undefined,
      body: { posts: [post] },
    })
  }

  /**
   * @operationName Get Post
   * @category Posts
   * @description Retrieves a single post by its id via the Admin API, including drafts and scheduled posts. Optionally include related tags and authors. Returns the full post record.
   * @route GET /posts/get
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"dictionary":"getPostsDictionary","description":"The id of the post to retrieve."}
   * @paramDef {"type":"Boolean","label":"Include Tags & Authors","name":"includeRelations","uiComponent":{"type":"TOGGLE"},"description":"When on, embeds the post's tags and authors in the response."}
   * @returns {Object}
   * @sampleResult {"posts":[{"id":"64b2f...","title":"Hello World","slug":"hello-world","status":"published","url":"https://blog.example.com/hello-world/","updated_at":"2026-07-14T10:00:00.000Z"}]}
   */
  async getPost(postId, includeRelations) {
    const logTag = '[getPost]'

    return this.#adminRequest({
      logTag,
      path: `/posts/${ encodeURIComponent(postId) }/`,
      method: 'get',
      query: { include: includeRelations ? 'tags,authors' : undefined },
    })
  }

  /**
   * @operationName Get Post by Slug
   * @category Posts
   * @description Retrieves a single post by its slug via the Admin API, including drafts and scheduled posts. Optionally include related tags and authors.
   * @route GET /posts/slug
   * @paramDef {"type":"String","label":"Slug","name":"slug","required":true,"description":"The post's URL slug, e.g. hello-world."}
   * @paramDef {"type":"Boolean","label":"Include Tags & Authors","name":"includeRelations","uiComponent":{"type":"TOGGLE"},"description":"When on, embeds the post's tags and authors in the response."}
   * @returns {Object}
   * @sampleResult {"posts":[{"id":"64b2f...","title":"Hello World","slug":"hello-world","status":"published","url":"https://blog.example.com/hello-world/"}]}
   */
  async getPostBySlug(slug, includeRelations) {
    const logTag = '[getPostBySlug]'

    return this.#adminRequest({
      logTag,
      path: `/posts/slug/${ encodeURIComponent(slug) }/`,
      method: 'get',
      query: { include: includeRelations ? 'tags,authors' : undefined },
    })
  }

  /**
   * @operationName List Posts
   * @category Posts
   * @description Lists posts via the Admin API with optional NQL filtering, ordering, and pagination. Includes drafts, scheduled, and published posts. Use the Filter field for NQL expressions such as "status:published+tag:news". Returns posts plus pagination metadata.
   * @route GET /posts
   * @paramDef {"type":"String","label":"Filter (NQL)","name":"filter","description":"Ghost NQL filter expression, e.g. status:published+tag:news. Leave empty for all posts."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Newest First","Oldest First","Recently Updated","Title A-Z"]}},"description":"Sort order for results. Defaults to Newest First."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of posts per page (default 15, max 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number to retrieve."}
   * @paramDef {"type":"Boolean","label":"Include Tags & Authors","name":"includeRelations","uiComponent":{"type":"TOGGLE"},"description":"When on, embeds each post's tags and authors."}
   * @returns {Object}
   * @sampleResult {"posts":[{"id":"64b2f...","title":"Hello World","slug":"hello-world","status":"published","url":"https://blog.example.com/hello-world/"}],"meta":{"pagination":{"page":1,"limit":15,"pages":1,"total":1}}}
   */
  async listPosts(filter, order, limit, page, includeRelations) {
    const logTag = '[listPosts]'

    return this.#adminRequest({
      logTag,
      path: '/posts/',
      method: 'get',
      query: {
        filter,
        order: this.#resolveChoice(order, ORDER_LABEL_TO_VALUE),
        limit,
        page,
        include: includeRelations ? 'tags,authors' : undefined,
      },
    })
  }

  /**
   * @operationName Update Post
   * @category Posts
   * @description Updates an existing post via the Admin API. Ghost requires the post's current updated_at for collision detection; if you leave it blank, this action fetches the latest value first. Only the fields you provide are changed. To send new HTML body content, provide HTML Content. Returns the updated post.
   * @route PUT /posts
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"dictionary":"getPostsDictionary","description":"The id of the post to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title. Leave empty to keep the current title."}
   * @paramDef {"type":"String","label":"HTML Content","name":"html","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New post body as HTML, sent using source=html. Leave empty to keep current content."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Published","Scheduled"]}},"description":"New publication state. Leave empty to keep the current status."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Replacement tag names. Leave empty to keep the current tags."}
   * @paramDef {"type":"String","label":"Feature Image URL","name":"featureImage","description":"New feature image URL. Leave empty to keep the current image."}
   * @paramDef {"type":"String","label":"Excerpt","name":"excerpt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New custom excerpt. Leave empty to keep the current excerpt."}
   * @paramDef {"type":"String","label":"Updated At","name":"updatedAt","description":"The post's current updated_at (ISO 8601) for collision detection. Leave empty to fetch it automatically."}
   * @returns {Object}
   * @sampleResult {"posts":[{"id":"64b2f...","title":"Updated Title","slug":"hello-world","status":"published","updated_at":"2026-07-14T11:00:00.000Z"}]}
   */
  async updatePost(postId, title, html, status, tags, featureImage, excerpt, updatedAt) {
    const logTag = '[updatePost]'

    let currentUpdatedAt = updatedAt

    if (!currentUpdatedAt) {
      const current = await this.getPost(postId)
      currentUpdatedAt = current?.posts?.[0]?.updated_at

      if (!currentUpdatedAt) {
        throw new Error('Ghost API error: Could not determine the post\'s current updated_at for collision detection.')
      }
    }

    const post = clean({
      updated_at: currentUpdatedAt,
      title,
      html,
      status: this.#resolveChoice(status, STATUS_LABEL_TO_VALUE),
      tags: this.#toReferences(tags, 'name'),
      feature_image: featureImage,
      excerpt,
    })

    return this.#adminRequest({
      logTag,
      path: `/posts/${ encodeURIComponent(postId) }/`,
      method: 'put',
      query: html ? { source: 'html' } : undefined,
      body: { posts: [post] },
    })
  }

  /**
   * @operationName Publish Post
   * @category Posts
   * @description Publishes an existing draft or scheduled post immediately by setting its status to published via the Admin API. Handles the required updated_at collision check automatically. Returns the published post including its live url.
   * @route PUT /posts/publish
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"dictionary":"getPostsDictionary","description":"The id of the post to publish."}
   * @returns {Object}
   * @sampleResult {"posts":[{"id":"64b2f...","title":"Hello World","slug":"hello-world","status":"published","url":"https://blog.example.com/hello-world/","published_at":"2026-07-14T11:05:00.000Z"}]}
   */
  async publishPost(postId) {
    const logTag = '[publishPost]'

    const current = await this.getPost(postId)
    const updatedAt = current?.posts?.[0]?.updated_at

    if (!updatedAt) {
      throw new Error('Ghost API error: Post not found or missing updated_at.')
    }

    return this.#adminRequest({
      logTag,
      path: `/posts/${ encodeURIComponent(postId) }/`,
      method: 'put',
      body: { posts: [{ status: 'published', updated_at: updatedAt }] },
    })
  }

  /**
   * @operationName Delete Post
   * @category Posts
   * @description Permanently deletes a post by its id via the Admin API. This cannot be undone. Returns a confirmation object.
   * @route DELETE /posts
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"dictionary":"getPostsDictionary","description":"The id of the post to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"64b2f..."}
   */
  async deletePost(postId) {
    const logTag = '[deletePost]'

    await this.#adminRequest({
      logTag,
      path: `/posts/${ encodeURIComponent(postId) }/`,
      method: 'delete',
    })

    return { deleted: true, id: postId }
  }

  // ===========================================================================
  //  PAGES (Admin API)
  // ===========================================================================

  /**
   * @operationName Create Page
   * @category Pages
   * @description Creates a new static page on the Ghost site via the Admin API. Provide HTML content (recommended) or Lexical JSON, and set the status to Draft, Published, or Scheduled. Pages behave like posts but are excluded from the main feed. Returns the created page.
   * @route POST /pages
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The page title."}
   * @paramDef {"type":"String","label":"HTML Content","name":"html","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Page body as HTML. Sent using Ghost's source=html conversion. Leave empty if providing Lexical instead."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Published","Scheduled"]}},"description":"Publication state of the page. Defaults to Draft."}
   * @paramDef {"type":"String","label":"Feature Image URL","name":"featureImage","description":"URL of the page's feature image."}
   * @paramDef {"type":"String","label":"Excerpt","name":"excerpt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Custom excerpt / meta description for the page."}
   * @paramDef {"type":"String","label":"Lexical Content","name":"lexical","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Page body as Ghost Lexical JSON. Use instead of HTML Content for full editor fidelity."}
   * @returns {Object}
   * @sampleResult {"pages":[{"id":"64c9a...","title":"About","slug":"about","status":"draft","url":"https://blog.example.com/about/","updated_at":"2026-07-14T10:00:00.000Z"}]}
   */
  async createPage(title, html, status, featureImage, excerpt, lexical) {
    const logTag = '[createPage]'

    const page = clean({
      title,
      html,
      lexical,
      status: this.#resolveChoice(status, STATUS_LABEL_TO_VALUE) || 'draft',
      feature_image: featureImage,
      excerpt,
    })

    return this.#adminRequest({
      logTag,
      path: '/pages/',
      method: 'post',
      query: html ? { source: 'html' } : undefined,
      body: { pages: [page] },
    })
  }

  /**
   * @operationName Get Page
   * @category Pages
   * @description Retrieves a single static page by its id via the Admin API, including drafts. Returns the full page record.
   * @route GET /pages/get
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"description":"The id of the page to retrieve."}
   * @returns {Object}
   * @sampleResult {"pages":[{"id":"64c9a...","title":"About","slug":"about","status":"published","url":"https://blog.example.com/about/"}]}
   */
  async getPage(pageId) {
    const logTag = '[getPage]'

    return this.#adminRequest({
      logTag,
      path: `/pages/${ encodeURIComponent(pageId) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName List Pages
   * @category Pages
   * @description Lists static pages via the Admin API with optional NQL filtering and pagination. Includes drafts, scheduled, and published pages. Returns pages plus pagination metadata.
   * @route GET /pages
   * @paramDef {"type":"String","label":"Filter (NQL)","name":"filter","description":"Ghost NQL filter expression, e.g. status:published. Leave empty for all pages."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of pages per response (default 15, max 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"pages":[{"id":"64c9a...","title":"About","slug":"about","status":"published","url":"https://blog.example.com/about/"}],"meta":{"pagination":{"page":1,"limit":15,"pages":1,"total":1}}}
   */
  async listPages(filter, limit, page) {
    const logTag = '[listPages]'

    return this.#adminRequest({
      logTag,
      path: '/pages/',
      method: 'get',
      query: { filter, limit, page },
    })
  }

  /**
   * @operationName Update Page
   * @category Pages
   * @description Updates an existing static page via the Admin API. Ghost requires the page's current updated_at for collision detection; if left blank it is fetched automatically. Only provided fields are changed. Returns the updated page.
   * @route PUT /pages
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"description":"The id of the page to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title. Leave empty to keep the current title."}
   * @paramDef {"type":"String","label":"HTML Content","name":"html","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New page body as HTML, sent using source=html. Leave empty to keep current content."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Published","Scheduled"]}},"description":"New publication state. Leave empty to keep the current status."}
   * @paramDef {"type":"String","label":"Updated At","name":"updatedAt","description":"The page's current updated_at (ISO 8601) for collision detection. Leave empty to fetch it automatically."}
   * @returns {Object}
   * @sampleResult {"pages":[{"id":"64c9a...","title":"About Us","slug":"about","status":"published","updated_at":"2026-07-14T11:00:00.000Z"}]}
   */
  async updatePage(pageId, title, html, status, updatedAt) {
    const logTag = '[updatePage]'

    let currentUpdatedAt = updatedAt

    if (!currentUpdatedAt) {
      const current = await this.getPage(pageId)
      currentUpdatedAt = current?.pages?.[0]?.updated_at

      if (!currentUpdatedAt) {
        throw new Error('Ghost API error: Could not determine the page\'s current updated_at for collision detection.')
      }
    }

    const page = clean({
      updated_at: currentUpdatedAt,
      title,
      html,
      status: this.#resolveChoice(status, STATUS_LABEL_TO_VALUE),
    })

    return this.#adminRequest({
      logTag,
      path: `/pages/${ encodeURIComponent(pageId) }/`,
      method: 'put',
      query: html ? { source: 'html' } : undefined,
      body: { pages: [page] },
    })
  }

  /**
   * @operationName Delete Page
   * @category Pages
   * @description Permanently deletes a static page by its id via the Admin API. This cannot be undone. Returns a confirmation object.
   * @route DELETE /pages
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"description":"The id of the page to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"64c9a..."}
   */
  async deletePage(pageId) {
    const logTag = '[deletePage]'

    await this.#adminRequest({
      logTag,
      path: `/pages/${ encodeURIComponent(pageId) }/`,
      method: 'delete',
    })

    return { deleted: true, id: pageId }
  }

  // ===========================================================================
  //  CONTENT API (published reads)
  // ===========================================================================

  /**
   * @operationName Get Published Posts
   * @category Published Content
   * @description Lists published posts via the read-only Content API. Requires the Content API Key. Supports NQL filtering, ordering, pagination, and including tags/authors. Only public, published content is returned. Returns posts plus pagination metadata.
   * @route GET /content/posts
   * @paramDef {"type":"String","label":"Filter (NQL)","name":"filter","description":"Ghost NQL filter expression, e.g. tag:news+featured:true. Leave empty for all published posts."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of posts per response (default 15, max 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number to retrieve."}
   * @paramDef {"type":"Boolean","label":"Include Tags & Authors","name":"includeRelations","uiComponent":{"type":"TOGGLE"},"description":"When on, embeds each post's tags and authors."}
   * @returns {Object}
   * @sampleResult {"posts":[{"id":"64b2f...","title":"Hello World","slug":"hello-world","url":"https://blog.example.com/hello-world/","published_at":"2026-07-14T10:00:00.000Z","excerpt":"Hi"}],"meta":{"pagination":{"page":1,"limit":15,"pages":1,"total":1}}}
   */
  async getPublishedPosts(filter, limit, page, includeRelations) {
    const logTag = '[getPublishedPosts]'

    return this.#contentRequest({
      logTag,
      path: '/posts/',
      query: {
        filter,
        limit,
        page,
        include: includeRelations ? 'tags,authors' : undefined,
      },
    })
  }

  /**
   * @operationName Get Published Post
   * @category Published Content
   * @description Retrieves a single published post by its id via the read-only Content API. Requires the Content API Key. Optionally include tags and authors. Only returns the post if it is publicly published.
   * @route GET /content/posts/get
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"description":"The id of the published post to retrieve."}
   * @paramDef {"type":"Boolean","label":"Include Tags & Authors","name":"includeRelations","uiComponent":{"type":"TOGGLE"},"description":"When on, embeds the post's tags and authors."}
   * @returns {Object}
   * @sampleResult {"posts":[{"id":"64b2f...","title":"Hello World","slug":"hello-world","url":"https://blog.example.com/hello-world/","html":"<p>Hi</p>"}]}
   */
  async getPublishedPost(postId, includeRelations) {
    const logTag = '[getPublishedPost]'

    return this.#contentRequest({
      logTag,
      path: `/posts/${ encodeURIComponent(postId) }/`,
      query: { include: includeRelations ? 'tags,authors' : undefined },
    })
  }

  /**
   * @operationName Get Published Post by Slug
   * @category Published Content
   * @description Retrieves a single published post by its slug via the read-only Content API. Requires the Content API Key. Optionally include tags and authors.
   * @route GET /content/posts/slug
   * @paramDef {"type":"String","label":"Slug","name":"slug","required":true,"description":"The post's URL slug, e.g. hello-world."}
   * @paramDef {"type":"Boolean","label":"Include Tags & Authors","name":"includeRelations","uiComponent":{"type":"TOGGLE"},"description":"When on, embeds the post's tags and authors."}
   * @returns {Object}
   * @sampleResult {"posts":[{"id":"64b2f...","title":"Hello World","slug":"hello-world","url":"https://blog.example.com/hello-world/"}]}
   */
  async getPublishedPostBySlug(slug, includeRelations) {
    const logTag = '[getPublishedPostBySlug]'

    return this.#contentRequest({
      logTag,
      path: `/posts/slug/${ encodeURIComponent(slug) }/`,
      query: { include: includeRelations ? 'tags,authors' : undefined },
    })
  }

  // ===========================================================================
  //  TAGS (Admin API)
  // ===========================================================================

  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists tags via the Admin API with optional NQL filtering and pagination. Returns internal and public tags plus pagination metadata.
   * @route GET /tags
   * @paramDef {"type":"String","label":"Filter (NQL)","name":"filter","description":"Ghost NQL filter expression, e.g. visibility:public. Leave empty for all tags."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tags per response (default 15, max 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"tags":[{"id":"64d1a...","name":"News","slug":"news","description":"Company news","visibility":"public"}],"meta":{"pagination":{"page":1,"limit":15,"pages":1,"total":1}}}
   */
  async listTags(filter, limit, page) {
    const logTag = '[listTags]'

    return this.#adminRequest({
      logTag,
      path: '/tags/',
      method: 'get',
      query: { filter, limit, page },
    })
  }

  /**
   * @operationName Create Tag
   * @category Tags
   * @description Creates a new tag via the Admin API. Only the name is required; slug and description are optional. Returns the created tag.
   * @route POST /tags
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The tag name, e.g. News."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"URL slug for the tag. Auto-generated from the name if omitted."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description shown on the tag's archive page."}
   * @returns {Object}
   * @sampleResult {"tags":[{"id":"64d1a...","name":"News","slug":"news","description":"Company news","visibility":"public"}]}
   */
  async createTag(name, slug, description) {
    const logTag = '[createTag]'

    return this.#adminRequest({
      logTag,
      path: '/tags/',
      method: 'post',
      body: { tags: [clean({ name, slug, description })] },
    })
  }

  /**
   * @operationName Get Tag
   * @category Tags
   * @description Retrieves a single tag by its id via the Admin API. Returns the full tag record.
   * @route GET /tags/get
   * @paramDef {"type":"String","label":"Tag ID","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The id of the tag to retrieve."}
   * @returns {Object}
   * @sampleResult {"tags":[{"id":"64d1a...","name":"News","slug":"news","description":"Company news","visibility":"public"}]}
   */
  async getTag(tagId) {
    const logTag = '[getTag]'

    return this.#adminRequest({
      logTag,
      path: `/tags/${ encodeURIComponent(tagId) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Tag
   * @category Tags
   * @description Updates an existing tag by its id via the Admin API. Only provided fields are changed. Returns the updated tag.
   * @route PUT /tags
   * @paramDef {"type":"String","label":"Tag ID","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The id of the tag to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name. Leave empty to keep the current name."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"New URL slug. Leave empty to keep the current slug."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description. Leave empty to keep the current description."}
   * @returns {Object}
   * @sampleResult {"tags":[{"id":"64d1a...","name":"Breaking News","slug":"news","description":"Company news","visibility":"public"}]}
   */
  async updateTag(tagId, name, slug, description) {
    const logTag = '[updateTag]'

    return this.#adminRequest({
      logTag,
      path: `/tags/${ encodeURIComponent(tagId) }/`,
      method: 'put',
      body: { tags: [clean({ name, slug, description })] },
    })
  }

  /**
   * @operationName Delete Tag
   * @category Tags
   * @description Permanently deletes a tag by its id via the Admin API. Posts keep their content but lose this tag. Returns a confirmation object.
   * @route DELETE /tags
   * @paramDef {"type":"String","label":"Tag ID","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The id of the tag to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"64d1a..."}
   */
  async deleteTag(tagId) {
    const logTag = '[deleteTag]'

    await this.#adminRequest({
      logTag,
      path: `/tags/${ encodeURIComponent(tagId) }/`,
      method: 'delete',
    })

    return { deleted: true, id: tagId }
  }

  // ===========================================================================
  //  MEMBERS (Admin API)
  // ===========================================================================

  /**
   * @operationName List Members
   * @category Members
   * @description Lists members (subscribers) via the Admin API with optional NQL filtering and pagination. Returns members plus pagination metadata.
   * @route GET /members
   * @paramDef {"type":"String","label":"Filter (NQL)","name":"filter","description":"Ghost NQL filter expression, e.g. status:paid or label:vip. Leave empty for all members."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of members per response (default 15, max 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"members":[{"id":"64e5c...","email":"jane@example.com","name":"Jane Doe","status":"free","labels":[{"name":"VIP","slug":"vip"}]}],"meta":{"pagination":{"page":1,"limit":15,"pages":1,"total":1}}}
   */
  async listMembers(filter, limit, page) {
    const logTag = '[listMembers]'

    return this.#adminRequest({
      logTag,
      path: '/members/',
      method: 'get',
      query: { filter, limit, page },
    })
  }

  /**
   * @operationName Create Member
   * @category Members
   * @description Creates a new member (subscriber) via the Admin API. Only the email is required. Labels are matched by name and created if they do not exist. Returns the created member.
   * @route POST /members
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The member's email address (must be unique)."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The member's display name."}
   * @paramDef {"type":"Array<String>","label":"Labels","name":"labels","description":"Label names to attach to the member. Unknown labels are created."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Private staff note about the member."}
   * @returns {Object}
   * @sampleResult {"members":[{"id":"64e5c...","email":"jane@example.com","name":"Jane Doe","status":"free","labels":[{"name":"VIP","slug":"vip"}]}]}
   */
  async createMember(email, name, labels, note) {
    const logTag = '[createMember]'

    const member = clean({
      email,
      name,
      note,
      labels: this.#toReferences(labels, 'name'),
    })

    return this.#adminRequest({
      logTag,
      path: '/members/',
      method: 'post',
      body: { members: [member] },
    })
  }

  /**
   * @operationName Get Member
   * @category Members
   * @description Retrieves a single member by its id via the Admin API. Returns the full member record including subscription and label data.
   * @route GET /members/get
   * @paramDef {"type":"String","label":"Member ID","name":"memberId","required":true,"description":"The id of the member to retrieve."}
   * @returns {Object}
   * @sampleResult {"members":[{"id":"64e5c...","email":"jane@example.com","name":"Jane Doe","status":"free"}]}
   */
  async getMember(memberId) {
    const logTag = '[getMember]'

    return this.#adminRequest({
      logTag,
      path: `/members/${ encodeURIComponent(memberId) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Member
   * @category Members
   * @description Updates an existing member by its id via the Admin API. Only provided fields are changed. Providing Labels replaces the member's existing labels. Returns the updated member.
   * @route PUT /members
   * @paramDef {"type":"String","label":"Member ID","name":"memberId","required":true,"description":"The id of the member to update."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address. Leave empty to keep the current email."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New display name. Leave empty to keep the current name."}
   * @paramDef {"type":"Array<String>","label":"Labels","name":"labels","description":"Replacement label names. Leave empty to keep the current labels."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New private staff note. Leave empty to keep the current note."}
   * @returns {Object}
   * @sampleResult {"members":[{"id":"64e5c...","email":"jane@example.com","name":"Jane Smith","status":"free"}]}
   */
  async updateMember(memberId, email, name, labels, note) {
    const logTag = '[updateMember]'

    const member = clean({
      email,
      name,
      note,
      labels: this.#toReferences(labels, 'name'),
    })

    return this.#adminRequest({
      logTag,
      path: `/members/${ encodeURIComponent(memberId) }/`,
      method: 'put',
      body: { members: [member] },
    })
  }

  /**
   * @operationName Delete Member
   * @category Members
   * @description Permanently deletes a member by its id via the Admin API. This cannot be undone. Returns a confirmation object.
   * @route DELETE /members
   * @paramDef {"type":"String","label":"Member ID","name":"memberId","required":true,"description":"The id of the member to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"64e5c..."}
   */
  async deleteMember(memberId) {
    const logTag = '[deleteMember]'

    await this.#adminRequest({
      logTag,
      path: `/members/${ encodeURIComponent(memberId) }/`,
      method: 'delete',
    })

    return { deleted: true, id: memberId }
  }

  // ===========================================================================
  //  TIERS & NEWSLETTERS (Admin API)
  // ===========================================================================

  /**
   * @operationName List Tiers
   * @category Tiers & Newsletters
   * @description Lists membership tiers via the Admin API. Includes free and paid tiers with their pricing and benefits. Returns tiers plus pagination metadata.
   * @route GET /tiers
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tiers per response (default 15, max 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"tiers":[{"id":"64f0a...","name":"Gold","slug":"gold","active":true,"type":"paid","monthly_price":500,"currency":"usd"}],"meta":{"pagination":{"page":1,"limit":15,"pages":1,"total":1}}}
   */
  async listTiers(limit, page) {
    const logTag = '[listTiers]'

    return this.#adminRequest({
      logTag,
      path: '/tiers/',
      method: 'get',
      query: { limit, page, include: 'monthly_price,yearly_price,benefits' },
    })
  }

  /**
   * @operationName List Newsletters
   * @category Tiers & Newsletters
   * @description Lists newsletters via the Admin API. Returns each newsletter's name, status, and delivery settings plus pagination metadata.
   * @route GET /newsletters
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of newsletters per response (default 15, max 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"newsletters":[{"id":"64f8a...","name":"Weekly Digest","slug":"weekly-digest","status":"active","subscribe_on_signup":true}],"meta":{"pagination":{"page":1,"limit":15,"pages":1,"total":1}}}
   */
  async listNewsletters(limit, page) {
    const logTag = '[listNewsletters]'

    return this.#adminRequest({
      logTag,
      path: '/newsletters/',
      method: 'get',
      query: { limit, page },
    })
  }

  // ===========================================================================
  //  IMAGES (Admin API)
  // ===========================================================================

  /**
   * @operationName Upload Image
   * @category Images
   * @description Uploads an image to the Ghost site's storage via the Admin API and returns its hosted URL, which can be used as a post or page feature image. Provide a publicly accessible image URL (for example a FlowRunner file URL); the image is downloaded and re-uploaded to Ghost. Supports JPEG, PNG, GIF, WEBP, and SVG.
   * @route POST /images/upload
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"Publicly accessible URL of the image to upload (e.g. a FlowRunner file URL)."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional file name for the uploaded image, e.g. banner.png. Defaults to a generated name."}
   * @returns {Object}
   * @sampleResult {"images":[{"url":"https://blog.example.com/content/images/2026/07/banner.png","ref":null}]}
   */
  async uploadImage(imageUrl, fileName) {
    const logTag = '[uploadImage]'

    if (!this.apiUrl) {
      throw new Error('Ghost API error: Site URL is not configured.')
    }

    // Download the source image as raw bytes.
    const bytes = await Flowrunner.Request.get(imageUrl).setEncoding(null)
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

    const name = fileName || `image_${ Date.now() }`
    const contentType = this.#guessContentType(name)

    const formData = new Flowrunner.Request.FormData()
    formData.append('file', buffer, { filename: name, contentType })
    formData.append('purpose', 'image')

    try {
      logger.debug(`${ logTag } - uploading image (${ buffer.length } bytes) as ${ name }`)

      return await Flowrunner.Request.post(`${ this.adminBaseUrl }/images/upload/`)
        .set({
          'Authorization': `Ghost ${ this.#getAdminToken() }`,
          'Accept-Version': GHOST_API_VERSION,
        })
        .form(formData)
    } catch (error) {
      throw this.#toError(error, logTag)
    }
  }

  /** Best-effort content type from a file name extension for the multipart upload part. */
  #guessContentType(name) {
    const ext = String(name).toLowerCase().split('.').pop()
    const map = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    }

    return map[ext] || 'application/octet-stream'
  }

  // ===========================================================================
  //  DICTIONARIES
  // ===========================================================================

  /**
   * @typedef {Object} getPostsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter posts by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"1-based page number for the next batch of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Posts Dictionary
   * @description Provides a searchable list of posts (all statuses) for selecting a post id in post operations. The option value is the post id.
   * @route POST /get-posts-dictionary
   * @paramDef {"type":"getPostsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing posts."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Hello World","value":"64b2f...","note":"published"}],"cursor":"2"}
   */
  async getPostsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getPostsDictionary]'
    const page = Number(cursor) > 0 ? Number(cursor) : 1

    const response = await this.#adminRequest({
      logTag,
      path: '/posts/',
      method: 'get',
      query: {
        limit: 50,
        page,
        order: 'updated_at desc',
        filter: search ? `title:~'${ String(search).replace(/'/g, '') }'` : undefined,
      },
    })

    const posts = response.posts || []
    const pagination = response.meta?.pagination || {}
    const nextCursor = pagination.next ? String(pagination.next) : undefined

    return {
      items: posts.map(post => ({
        label: post.title || post.slug || post.id,
        value: post.id,
        note: post.status,
      })),
      cursor: nextCursor,
    }
  }

  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tags by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"1-based page number for the next batch of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Provides a searchable list of tags for selecting a tag id in tag operations. The option value is the tag id.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing tags."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"News","value":"64d1a...","note":"news"}],"cursor":"2"}
   */
  async getTagsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getTagsDictionary]'
    const page = Number(cursor) > 0 ? Number(cursor) : 1

    const response = await this.#adminRequest({
      logTag,
      path: '/tags/',
      method: 'get',
      query: {
        limit: 50,
        page,
        filter: search ? `name:~'${ String(search).replace(/'/g, '') }'` : undefined,
      },
    })

    const tags = response.tags || []
    const pagination = response.meta?.pagination || {}
    const nextCursor = pagination.next ? String(pagination.next) : undefined

    return {
      items: tags.map(tag => ({
        label: tag.name || tag.slug || tag.id,
        value: tag.id,
        note: tag.slug,
      })),
      cursor: nextCursor,
    }
  }

  /**
   * @typedef {Object} getAuthorsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter staff users by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"1-based page number for the next batch of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Authors Dictionary
   * @description Provides a searchable list of staff users (authors) for selecting an author when creating posts. The option value is the user's email, which is what post authors are matched on.
   * @route POST /get-authors-dictionary
   * @paramDef {"type":"getAuthorsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing staff users."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"jane@example.com","note":"Editor"}],"cursor":"2"}
   */
  async getAuthorsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getAuthorsDictionary]'
    const page = Number(cursor) > 0 ? Number(cursor) : 1

    const response = await this.#adminRequest({
      logTag,
      path: '/users/',
      method: 'get',
      query: {
        limit: 50,
        page,
        include: 'roles',
        filter: search ? `name:~'${ String(search).replace(/'/g, '') }'` : undefined,
      },
    })

    const users = response.users || []
    const pagination = response.meta?.pagination || {}
    const nextCursor = pagination.next ? String(pagination.next) : undefined

    return {
      items: users
        .filter(user => user.email)
        .map(user => ({
          label: user.name || user.email,
          value: user.email,
          note: user.roles?.[0]?.name || user.slug,
        })),
      cursor: nextCursor,
    }
  }
}

Flowrunner.ServerCode.addService(GhostService, [
  {
    name: 'apiUrl',
    displayName: 'Site URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Ghost site URL, e.g. https://blog.example.com (any trailing slash is stripped automatically).',
  },
  {
    name: 'adminApiKey',
    displayName: 'Admin API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Required for all write operations. In Ghost Admin go to Settings → Integrations → your custom integration → Admin API Key. Format is "id:secret".',
  },
  {
    name: 'contentApiKey',
    displayName: 'Content API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional. Used only for the "Get Published..." read operations. Found on the same custom integration as the Content API Key.',
  },
])
