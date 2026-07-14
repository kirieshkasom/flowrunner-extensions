const logger = {
  info: (...args) => console.log('[Facebook] info:', ...args),
  debug: (...args) => console.log('[Facebook] debug:', ...args),
  error: (...args) => console.log('[Facebook] error:', ...args),
  warn: (...args) => console.log('[Facebook] warn:', ...args),
}

const DEFAULT_API_VERSION = 'v25.0'
const GRAPH_HOST = 'https://graph.facebook.com'
const DEFAULT_LIMIT = 25

// Remove undefined/null/'' entries so they are not sent to the Graph API.
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

// Normalize a downloaded file body to a Buffer. Flowrunner.Request auto-parses the
// response by Content-Type, so re-serialize anything that is not already a Buffer.
function toBuffer(body) {
  if (Buffer.isBuffer(body)) {
    return body
  }

  if (typeof body === 'string') {
    return Buffer.from(body)
  }

  return Buffer.from(JSON.stringify(body))
}

/**
 * @usesFileStorage
 * @integrationName Facebook
 * @integrationIcon /icon.svg
 */
class FacebookService {
  constructor(config) {
    this.accessToken = config.accessToken
    this.apiVersion = config.apiVersion || DEFAULT_API_VERSION
  }

  #baseUrl() {
    return `${ GRAPH_HOST }/${ this.apiVersion }`
  }

  // Page-scoped operations should use the Page's own access token (from List My Pages).
  // A per-call pageAccessToken always wins; otherwise fall back to the configured token.
  #tokenFor(pageAccessToken) {
    return pageAccessToken || this.accessToken
  }

  // Maps a friendly dropdown label to its Graph API value. Unmapped values pass through.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ url, method = 'get', body, query, token, logTag }) {
    const cleanedQuery = clean(query)

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.#tokenFor(token) }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const fbError = error.body?.error
      const message = fbError?.message || error.message

      logger.error(`${ logTag } - failed: ${ message } (trace: ${ fbError?.fbtrace_id || 'n/a' })`)

      const parts = [`Facebook API error: ${ message }`]

      if (fbError?.type) {
        parts.push(`type=${ fbError.type }`)
      }

      if (fbError?.code !== undefined) {
        parts.push(`code=${ fbError.code }`)
      }

      if (fbError?.fbtrace_id) {
        parts.push(`fbtrace_id=${ fbError.fbtrace_id }`)
      }

      throw new Error(parts.join(' | '))
    }
  }

  /**
   * @operationName List My Pages
   * @category Pages
   * @description Lists the Facebook Pages the authenticated user manages, via GET /me/accounts. Each entry includes the Page id, name, category, and — critically — the Page's own access_token, which you must use for page-scoped write operations (posting, photos, comments). Requires the pages_read_engagement permission. Copy a Page's access_token and pass it as the Page Access Token parameter on page operations.
   * @route GET /list-my-pages
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of Pages to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"1122334455","name":"Acme Store","category":"Retail Company","access_token":"EAAG...page","tasks":["MANAGE","CREATE_CONTENT"]}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async listMyPages(limit, after) {
    return await this.#apiRequest({
      logTag: '[listMyPages]',
      url: `${ this.#baseUrl() }/me/accounts`,
      method: 'get',
      query: {
        fields: 'id,name,category,access_token,tasks',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Get Page
   * @category Pages
   * @description Retrieves details for a single Facebook Page by id. Returns the requested fields (defaults to a common set: name, about, fan_count, category, link, website, verification_status). Pass a comma-separated Fields value to fetch additional fields supported by the Page node.
   * @route GET /get-page
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The Facebook Page id. Pick from your managed Pages or paste a Page id."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated list of Page fields to return. Defaults to name,about,fan_count,category,link,website,verification_status."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Optional Page access token (from List My Pages) to use instead of the configured token. Recommended for accurate Page-scoped fields."}
   * @returns {Object}
   * @sampleResult {"id":"1122334455","name":"Acme Store","about":"Quality goods since 1998","fan_count":10432,"category":"Retail Company","link":"https://www.facebook.com/AcmeStore","website":"https://acme.example.com","verification_status":"blue_verified"}
   */
  async getPage(pageId, fields, pageAccessToken) {
    return await this.#apiRequest({
      logTag: '[getPage]',
      url: `${ this.#baseUrl() }/${ pageId }`,
      method: 'get',
      token: pageAccessToken,
      query: {
        fields: fields || 'name,about,fan_count,category,link,website,verification_status',
      },
    })
  }

  /**
   * @operationName Create Page Post
   * @category Posts
   * @description Publishes a post to a Facebook Page's feed via POST /{pageId}/feed. Supports a text message and/or a link. Set Published to false to create an unpublished (draft) post, or provide a Scheduled Publish Time (unix seconds, at least 10 minutes and at most 6 months out) with Published false to schedule it. Requires a Page access token with pages_manage_posts; pass the Page's access_token from List My Pages.
   * @route POST /create-page-post
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The Page to post to. Pick from your managed Pages or paste a Page id."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the post. Required unless a Link is provided."}
   * @paramDef {"type":"String","label":"Link","name":"link","description":"Optional URL to attach to the post. Facebook renders a link preview."}
   * @paramDef {"type":"Boolean","label":"Published","name":"published","uiComponent":{"type":"TOGGLE"},"description":"Whether to publish immediately (default true). Set false for a draft, or false together with a Scheduled Publish Time to schedule."}
   * @paramDef {"type":"Number","label":"Scheduled Publish Time","name":"scheduledPublishTime","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds to auto-publish the post. Requires Published set to false. Must be 10 minutes to 6 months from now."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Page access token (from List My Pages) with pages_manage_posts. Overrides the configured token; recommended for Page posting."}
   * @returns {Object}
   * @sampleResult {"id":"1122334455_9988776655"}
   */
  async createPagePost(pageId, message, link, published, scheduledPublishTime, pageAccessToken) {
    return await this.#apiRequest({
      logTag: '[createPagePost]',
      url: `${ this.#baseUrl() }/${ pageId }/feed`,
      method: 'post',
      token: pageAccessToken,
      body: clean({
        message,
        link,
        published,
        scheduled_publish_time: scheduledPublishTime,
      }),
    })
  }

  /**
   * @operationName Get Post
   * @category Posts
   * @description Retrieves a single Page post by its id, including the message, creation time, permalink, and engagement summaries (like and comment counts, shares). Pass a comma-separated Fields value to customize the returned fields.
   * @route GET /get-post
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"description":"The post id, typically in the form {pageId}_{postId}."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated fields. Defaults to message,created_time,permalink_url,likes.summary(true),comments.summary(true),shares."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Optional Page access token (from List My Pages) to use instead of the configured token."}
   * @returns {Object}
   * @sampleResult {"id":"1122334455_9988776655","message":"Big summer sale!","created_time":"2026-06-01T12:00:00+0000","permalink_url":"https://www.facebook.com/1122334455/posts/9988776655","likes":{"summary":{"total_count":128}},"comments":{"summary":{"total_count":14}},"shares":{"count":7}}
   */
  async getPost(postId, fields, pageAccessToken) {
    return await this.#apiRequest({
      logTag: '[getPost]',
      url: `${ this.#baseUrl() }/${ postId }`,
      method: 'get',
      token: pageAccessToken,
      query: {
        fields: fields || 'message,created_time,permalink_url,likes.summary(true),comments.summary(true),shares',
      },
    })
  }

  /**
   * @operationName List Page Posts
   * @category Posts
   * @description Lists posts published on a Page's feed via GET /{pageId}/posts, newest first, with engagement summaries. Supports paging via limit and an after cursor. Use the Page's access token for full visibility of your own posts.
   * @route GET /list-page-posts
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The Page whose posts to list. Pick from your managed Pages or paste a Page id."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of posts to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated fields per post. Defaults to id,message,created_time,permalink_url,likes.summary(true),comments.summary(true),shares."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Optional Page access token (from List My Pages). Recommended so your unpublished/all posts are visible."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"1122334455_9988776655","message":"Big summer sale!","created_time":"2026-06-01T12:00:00+0000","permalink_url":"https://www.facebook.com/1122334455/posts/9988776655","likes":{"summary":{"total_count":128}},"comments":{"summary":{"total_count":14}},"shares":{"count":7}}],"paging":{"cursors":{"before":"MA","after":"MjQ"},"next":"https://graph.facebook.com/v25.0/1122334455/posts?after=MjQ"}}
   */
  async listPagePosts(pageId, limit, after, fields, pageAccessToken) {
    return await this.#apiRequest({
      logTag: '[listPagePosts]',
      url: `${ this.#baseUrl() }/${ pageId }/posts`,
      method: 'get',
      token: pageAccessToken,
      query: {
        fields: fields || 'id,message,created_time,permalink_url,likes.summary(true),comments.summary(true),shares',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Update Post
   * @category Posts
   * @description Updates the message text of an existing Page post via POST /{postId}. Only the message can be edited; other attributes (link, attachments) cannot be changed after publishing. Requires a Page access token with pages_manage_posts.
   * @route POST /update-post
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"description":"The post id to update, typically {pageId}_{postId}."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new text content for the post."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Page access token (from List My Pages) with pages_manage_posts. Overrides the configured token."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updatePost(postId, message, pageAccessToken) {
    return await this.#apiRequest({
      logTag: '[updatePost]',
      url: `${ this.#baseUrl() }/${ postId }`,
      method: 'post',
      token: pageAccessToken,
      body: clean({ message }),
    })
  }

  /**
   * @operationName Delete Post
   * @category Posts
   * @description Permanently deletes a Page post via DELETE /{postId}. This cannot be undone. Requires a Page access token with pages_manage_posts.
   * @route DELETE /delete-post
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"description":"The post id to delete, typically {pageId}_{postId}."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Page access token (from List My Pages) with pages_manage_posts. Overrides the configured token."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deletePost(postId, pageAccessToken) {
    return await this.#apiRequest({
      logTag: '[deletePost]',
      url: `${ this.#baseUrl() }/${ postId }`,
      method: 'delete',
      token: pageAccessToken,
    })
  }

  /**
   * @operationName Upload Photo
   * @category Photos
   * @description Uploads a photo to a Page via POST /{pageId}/photos, either from an external image URL or from a Flowrunner file (uploaded as multipart bytes). Optionally attach a caption message and control whether the photo is published to the Page timeline. Returns the photo id and, when published, the associated post_id. Requires a Page access token with pages_manage_posts. Provide either Image URL or a File — the File takes precedence.
   * @route POST /upload-photo
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The Page to upload the photo to. Pick from your managed Pages or paste a Page id."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","description":"Public URL of an image for Facebook to fetch. Used when no File is provided."}
   * @paramDef {"type":"String","label":"File","name":"fileUrl","uiComponent":{"type":"FILE_SELECTOR"},"description":"A Flowrunner file to upload as the photo's image bytes (multipart). Takes precedence over Image URL."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional caption for the photo."}
   * @paramDef {"type":"Boolean","label":"Published","name":"published","uiComponent":{"type":"TOGGLE"},"description":"Whether to publish the photo to the Page timeline (default true). Set false to upload an unpublished photo for later use."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Page access token (from List My Pages) with pages_manage_posts. Overrides the configured token."}
   * @returns {Object}
   * @sampleResult {"id":"5566778899","post_id":"1122334455_5566778899"}
   */
  async uploadPhoto(pageId, imageUrl, fileUrl, message, published, pageAccessToken) {
    const url = `${ this.#baseUrl() }/${ pageId }/photos`
    const token = this.#tokenFor(pageAccessToken)

    if (fileUrl) {
      try {
        logger.debug(`[uploadPhoto] multipart upload from file into page ${ pageId }`)

        const fileBytes = toBuffer(await Flowrunner.Request.get(fileUrl).setEncoding(null))
        const filename = decodeURIComponent(String(fileUrl).split('/').pop().split('?')[0]) || `photo_${ Date.now() }.jpg`

        const formData = new Flowrunner.Request.FormData()

        formData.append('source', fileBytes, { filename })

        if (message) {
          formData.append('message', message)
        }

        if (published !== undefined) {
          formData.append('published', String(published))
        }

        // No explicit Content-Type — the form supplies the multipart boundary.
        return await Flowrunner.Request.post(url)
          .set({ 'Authorization': `Bearer ${ token }` })
          .form(formData)
      } catch (error) {
        const fbError = error.body?.error
        const errMessage = fbError?.message || error.message

        logger.error(`[uploadPhoto] failed: ${ errMessage } (trace: ${ fbError?.fbtrace_id || 'n/a' })`)

        throw new Error(`Facebook API error: ${ errMessage }${ fbError?.fbtrace_id ? ` | fbtrace_id=${ fbError.fbtrace_id }` : '' }`)
      }
    }

    return await this.#apiRequest({
      logTag: '[uploadPhoto]',
      url,
      method: 'post',
      token: pageAccessToken,
      body: clean({
        url: imageUrl,
        message,
        published,
      }),
    })
  }

  /**
   * @operationName Get Comments
   * @category Comments
   * @description Lists comments on an object (a post, photo, or comment) via GET /{objectId}/comments. Returns each comment's id, message, author, creation time, and like count. Supports paging and ordering (chronological or ranked).
   * @route GET /get-comments
   * @paramDef {"type":"String","label":"Object ID","name":"objectId","required":true,"description":"The id of the post, photo, or comment to read comments from."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Chronological","Ranked","Reverse Chronological"]}},"defaultValue":"Chronological","description":"Comment ordering. Chronological is oldest-first; Ranked orders by relevance."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of comments to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Optional Page access token (from List My Pages) to use instead of the configured token."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"9988776655_1112223","message":"Love this!","created_time":"2026-06-01T12:05:00+0000","from":{"id":"7778889990","name":"Jane Doe"},"like_count":3}],"paging":{"cursors":{"before":"MA","after":"MQ"}}}
   */
  async getComments(objectId, order, limit, after, pageAccessToken) {
    return await this.#apiRequest({
      logTag: '[getComments]',
      url: `${ this.#baseUrl() }/${ objectId }/comments`,
      method: 'get',
      token: pageAccessToken,
      query: {
        fields: 'id,message,created_time,from,like_count',
        order: this.#resolveChoice(order, {
          'Chronological': 'chronological',
          'Ranked': 'ranked',
          'Reverse Chronological': 'reverse_chronological',
        }),
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Create Comment
   * @category Comments
   * @description Posts a comment on an object (a post, photo, or another comment) via POST /{objectId}/comments. Requires a Page access token with pages_manage_engagement / pages_manage_posts. Returns the new comment's id.
   * @route POST /create-comment
   * @paramDef {"type":"String","label":"Object ID","name":"objectId","required":true,"description":"The id of the post, photo, or comment to comment on."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text of the comment."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Page access token (from List My Pages) with comment-management permissions. Overrides the configured token."}
   * @returns {Object}
   * @sampleResult {"id":"9988776655_1112224"}
   */
  async createComment(objectId, message, pageAccessToken) {
    return await this.#apiRequest({
      logTag: '[createComment]',
      url: `${ this.#baseUrl() }/${ objectId }/comments`,
      method: 'post',
      token: pageAccessToken,
      body: clean({ message }),
    })
  }

  /**
   * @operationName Delete Comment
   * @category Comments
   * @description Permanently deletes a comment via DELETE /{commentId}. This cannot be undone. Requires a Page access token with comment-management permissions.
   * @route DELETE /delete-comment
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The id of the comment to delete."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Page access token (from List My Pages) with comment-management permissions. Overrides the configured token."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteComment(commentId, pageAccessToken) {
    return await this.#apiRequest({
      logTag: '[deleteComment]',
      url: `${ this.#baseUrl() }/${ commentId }`,
      method: 'delete',
      token: pageAccessToken,
    })
  }

  /**
   * @operationName Like Object
   * @category Comments
   * @description Adds a like from the Page to an object (a post, photo, or comment) via POST /{objectId}/likes. Requires a Page access token with engagement-management permissions.
   * @route POST /like-object
   * @paramDef {"type":"String","label":"Object ID","name":"objectId","required":true,"description":"The id of the post, photo, or comment to like."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Page access token (from List My Pages) with engagement-management permissions. Overrides the configured token."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async likeObject(objectId, pageAccessToken) {
    return await this.#apiRequest({
      logTag: '[likeObject]',
      url: `${ this.#baseUrl() }/${ objectId }/likes`,
      method: 'post',
      token: pageAccessToken,
    })
  }

  /**
   * @operationName Get Page Insights
   * @category Insights
   * @description Retrieves Page-level insights metrics via GET /{pageId}/insights. Provide one or more metric names (e.g. page_impressions, page_fans, page_post_engagements) and a period. Optionally bound the range with Since/Until unix timestamps. Requires a Page access token with read_insights / pages_read_engagement. See the Facebook Page Insights metrics reference for the full metric list.
   * @route GET /get-page-insights
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The Page to read insights for. Pick from your managed Pages or paste a Page id."}
   * @paramDef {"type":"Array<String>","label":"Metrics","name":"metrics","required":true,"description":"Insight metric names, e.g. page_impressions, page_fans, page_post_engagements. Sent as a comma-separated metric list."}
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Week","28 Days"]}},"defaultValue":"Day","description":"Aggregation period for each metric datapoint."}
   * @paramDef {"type":"Number","label":"Since","name":"since","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional unix timestamp (seconds) for the start of the range."}
   * @paramDef {"type":"Number","label":"Until","name":"until","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional unix timestamp (seconds) for the end of the range."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Page access token (from List My Pages) with read_insights. Overrides the configured token."}
   * @returns {Object}
   * @sampleResult {"data":[{"name":"page_impressions","period":"day","values":[{"value":1520,"end_time":"2026-06-02T07:00:00+0000"}],"title":"Daily Total Impressions","id":"1122334455/insights/page_impressions/day"}],"paging":{"previous":"https://graph.facebook.com/v25.0/1122334455/insights?since=1748736000","next":"https://graph.facebook.com/v25.0/1122334455/insights?since=1748908800"}}
   */
  async getPageInsights(pageId, metrics, period, since, until, pageAccessToken) {
    const metric = Array.isArray(metrics) ? metrics.join(',') : metrics

    return await this.#apiRequest({
      logTag: '[getPageInsights]',
      url: `${ this.#baseUrl() }/${ pageId }/insights`,
      method: 'get',
      token: pageAccessToken,
      query: {
        metric,
        period: this.#resolveChoice(period, {
          'Day': 'day',
          'Week': 'week',
          '28 Days': 'days_28',
        }),
        since,
        until,
      },
    })
  }

  /**
   * @operationName Get Post Insights
   * @category Insights
   * @description Retrieves post-level insights metrics via GET /{postId}/insights. Provide one or more post metric names (e.g. post_impressions, post_engaged_users, post_clicks). Requires a Page access token with read_insights.
   * @route GET /get-post-insights
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"description":"The post id to read insights for, typically {pageId}_{postId}."}
   * @paramDef {"type":"Array<String>","label":"Metrics","name":"metrics","required":true,"description":"Post insight metric names, e.g. post_impressions, post_engaged_users, post_clicks. Sent as a comma-separated metric list."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Page access token (from List My Pages) with read_insights. Overrides the configured token."}
   * @returns {Object}
   * @sampleResult {"data":[{"name":"post_impressions","period":"lifetime","values":[{"value":3120}],"title":"Post Total Impressions","id":"1122334455_9988776655/insights/post_impressions/lifetime"}]}
   */
  async getPostInsights(postId, metrics, pageAccessToken) {
    const metric = Array.isArray(metrics) ? metrics.join(',') : metrics

    return await this.#apiRequest({
      logTag: '[getPostInsights]',
      url: `${ this.#baseUrl() }/${ postId }/insights`,
      method: 'get',
      token: pageAccessToken,
      query: { metric },
    })
  }

  /**
   * @operationName Get Object
   * @category Miscellaneous
   * @description Generic escape-hatch fetch of any Graph API node by id via GET /{id}. Provide the node id and an optional comma-separated Fields list to shape the response. Use this for nodes not covered by a dedicated action (users, events, albums, etc.).
   * @route GET /get-object
   * @paramDef {"type":"String","label":"Object ID","name":"objectId","required":true,"description":"Any Graph API node id to fetch (a page, post, photo, user, album, etc.)."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Optional comma-separated list of fields to return. Leave empty for the node's default fields."}
   * @paramDef {"type":"String","label":"Page Access Token","name":"pageAccessToken","description":"Optional Page access token (from List My Pages) to use instead of the configured token."}
   * @returns {Object}
   * @sampleResult {"id":"1122334455","name":"Acme Store"}
   */
  async getObject(objectId, fields, pageAccessToken) {
    return await this.#apiRequest({
      logTag: '[getObject]',
      url: `${ this.#baseUrl() }/${ objectId }`,
      method: 'get',
      token: pageAccessToken,
      query: { fields },
    })
  }

  /**
   * @typedef {Object} getPagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter your managed Pages by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paging.cursors.after) to fetch the next page of managed Pages."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pages Dictionary
   * @description Lists the Facebook Pages the authenticated user manages (via GET /me/accounts) for selecting a Page id in dependent parameters. Optionally filters by name. The option value is the Page id.
   * @route POST /get-pages-dictionary
   * @paramDef {"type":"getPagesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing managed Pages."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Store","value":"1122334455","note":"Retail Company"}],"cursor":"MjQ"}
   */
  async getPagesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getPagesDictionary]',
      url: `${ this.#baseUrl() }/me/accounts`,
      method: 'get',
      query: {
        fields: 'id,name,category',
        limit: 100,
        after: cursor,
      },
    })

    const pages = response.data || []
    const term = (search || '').trim().toLowerCase()

    const filtered = term ? pages.filter(page => (page.name || '').toLowerCase().includes(term)) : pages

    return {
      items: filtered.map(page => ({
        label: page.name || page.id,
        value: page.id,
        note: page.category || undefined,
      })),
      cursor: response.paging?.cursors?.after,
    }
  }
}

Flowrunner.ServerCode.addService(FacebookService, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Page Access Token or User Access Token with the pages_manage_posts and pages_read_engagement scopes. Generate one from the Graph API Explorer or your Facebook app. Long-lived tokens are strongly recommended. For page-scoped operations, use List My Pages to obtain each Page\'s own access token.',
  },
  {
    name: 'apiVersion',
    displayName: 'API Version',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: DEFAULT_API_VERSION,
    hint: `Graph API version to target, e.g. ${ DEFAULT_API_VERSION }. Leave blank to use the default (${ DEFAULT_API_VERSION }).`,
  },
])
