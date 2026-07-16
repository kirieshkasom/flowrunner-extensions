const logger = {
  info: (...args) => console.log('[Medium] info:', ...args),
  debug: (...args) => console.log('[Medium] debug:', ...args),
  error: (...args) => console.log('[Medium] error:', ...args),
  warn: (...args) => console.log('[Medium] warn:', ...args),
}

const API_BASE_URL = 'https://api.medium.com/v1'

// Friendly dropdown label -> Medium license API value.
const LICENSE_MAP = {
  'All Rights Reserved': 'all-rights-reserved',
  'CC 4.0 BY': 'cc-40-by',
  'CC 4.0 BY-SA': 'cc-40-by-sa',
  'CC 4.0 BY-ND': 'cc-40-by-nd',
  'CC 4.0 BY-NC': 'cc-40-by-nc',
  'CC 4.0 BY-NC-ND': 'cc-40-by-nc-nd',
  'CC 4.0 BY-NC-SA': 'cc-40-by-nc-sa',
  'CC 4.0 Zero': 'cc-40-zero',
  'Public Domain': 'public-domain',
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

/**
 * @integrationName Medium
 * @integrationIcon /icon.svg
 */
class MediumService {
  constructor(config) {
    this.integrationToken = config.integrationToken
  }

  #authHeader() {
    return {
      'Authorization': `Bearer ${ this.integrationToken }`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper for JSON endpoints; unwraps Medium's { data } envelope.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(this.#authHeader())
        .query(clean(query) || {})

      const response = body !== undefined ? await request.send(body) : await request

      return response && response.data !== undefined ? response.data : response
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #handleError(error, logTag) {
    const errors = error.body?.errors
    const message = Array.isArray(errors) && errors.length
      ? errors.map(e => e.message).filter(Boolean).join('; ')
      : (error.body?.message || error.message || 'Unknown error')
    const status = error.status || error.statusCode

    logger.error(`${ logTag } - failed: ${ message }`)

    throw new Error(`Medium API error${ status ? ` (${ status })` : '' }: ${ message }`)
  }

  /**
   * @operationName Get Current User
   * @category User
   * @description Returns details about the user associated with the integration token: their id, username, name, and profile URL. Use the returned id as the Author ID for Create Post, and as the User ID for List User's Publications. Also serves as a connection check to confirm the token is valid.
   * @route GET /me
   * @appearanceColor #000000 #292929
   *
   * @returns {Object}
   * @sampleResult {"id":"5303d74c64f66366f00cb9b2a94f3251bf5","username":"majelbstoat","name":"Jamie Talbot","url":"https://medium.com/@majelbstoat","imageUrl":"https://images.medium.com/0*fkfQiTzT7TlUGGyI.png"}
   */
  async getCurrentUser() {
    return await this.#apiRequest({
      logTag: '[getCurrentUser]',
      url: `${ API_BASE_URL }/me`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Post
   * @category Posts
   * @description IMPORTANT: The Medium API is deprecated and frozen — Medium no longer issues new integration tokens, and content publishing to Medium via API is effectively legacy. This operation only works for accounts that already hold a valid integration token. Creates a post on the authenticated user's Medium profile. The Author ID is the "id" returned by Get Current User. Content must be HTML or Markdown (set Content Format accordingly). Up to 3 tags (max 25 chars each) are allowed; extra tags are ignored by Medium. Set Publish Status to draft, public, or unlisted. Once published as public, a post cannot be reverted to draft via the API.
   * @route POST /users/{authorId}/posts
   * @appearanceColor #000000 #292929
   *
   * @paramDef {"type":"String","label":"Author ID","name":"authorId","required":true,"description":"The user id to publish under, taken from the id field of Get Current User."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Post title (used in the URL and SEO title tag). Not the same as the H1 in the content. Max 100 characters."}
   * @paramDef {"type":"String","label":"Content Format","name":"contentFormat","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["HTML","Markdown"]}},"description":"The format of the Content field. Choose HTML or Markdown."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The body of the post, in the selected Content Format. In HTML the first h1/h2 is treated as the display title."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Up to 3 tags to classify the post. Tags longer than 25 characters or beyond the first 3 are ignored by Medium."}
   * @paramDef {"type":"String","label":"Canonical URL","name":"canonicalUrl","description":"The original home of this content if it was first published elsewhere (helps avoid duplicate-content penalties)."}
   * @paramDef {"type":"String","label":"Publish Status","name":"publishStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Draft","Unlisted"]}},"defaultValue":"Public","description":"Visibility of the post. Defaults to Public."}
   * @paramDef {"type":"String","label":"License","name":"license","uiComponent":{"type":"DROPDOWN","options":{"values":["All Rights Reserved","CC 4.0 BY","CC 4.0 BY-SA","CC 4.0 BY-ND","CC 4.0 BY-NC","CC 4.0 BY-NC-ND","CC 4.0 BY-NC-SA","CC 4.0 Zero","Public Domain"]}},"defaultValue":"All Rights Reserved","description":"Content license for the post. Defaults to All Rights Reserved."}
   * @paramDef {"type":"Boolean","label":"Notify Followers","name":"notifyFollowers","uiComponent":{"type":"TOGGLE"},"description":"Whether to notify the author's followers that the user has published this post."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e6f36a","title":"Liverpool FC","authorId":"5303d74c64f66366f00cb9b2a94f3251bf5","tags":["football","soccer"],"url":"https://medium.com/@majelbstoat/liverpool-fc-e6f36a","canonicalUrl":"","publishStatus":"public","publishedAt":1442286338435,"license":"all-rights-reserved","licenseUrl":"https://medium.com/policy/9db0094a1e0f"}
   */
  async createPost(authorId, title, contentFormat, content, tags, canonicalUrl, publishStatus, license, notifyFollowers) {
    const body = this.#buildPostBody(title, contentFormat, content, tags, canonicalUrl, publishStatus, license, notifyFollowers)

    return await this.#apiRequest({
      logTag: '[createPost]',
      url: `${ API_BASE_URL }/users/${ authorId }/posts`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Create Post Under Publication
   * @category Posts
   * @description Creates a post under a Medium publication instead of a user's personal profile. The Medium API is deprecated (no new tokens issued); this only works for accounts with an existing integration token. The user must be a contributor to the publication: editors can publish with any status (public/unlisted appear immediately), while writers can only create drafts pending editor approval. Use List User's Publications to find a Publication ID.
   * @route POST /publications/{publicationId}/posts
   * @appearanceColor #000000 #292929
   *
   * @paramDef {"type":"String","label":"Publication ID","name":"publicationId","required":true,"dictionary":"getPublicationsDictionary","description":"The publication to publish under. Search and select, or paste an id from List User's Publications."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Post title (used in the URL and SEO title tag). Max 100 characters."}
   * @paramDef {"type":"String","label":"Content Format","name":"contentFormat","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["HTML","Markdown"]}},"description":"The format of the Content field. Choose HTML or Markdown."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The body of the post, in the selected Content Format."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Up to 3 tags to classify the post. Tags longer than 25 characters or beyond the first 3 are ignored by Medium."}
   * @paramDef {"type":"String","label":"Canonical URL","name":"canonicalUrl","description":"The original home of this content if it was first published elsewhere."}
   * @paramDef {"type":"String","label":"Publish Status","name":"publishStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Draft","Unlisted"]}},"defaultValue":"Public","description":"Visibility of the post. Writers may only use Draft. Defaults to Public."}
   * @paramDef {"type":"String","label":"License","name":"license","uiComponent":{"type":"DROPDOWN","options":{"values":["All Rights Reserved","CC 4.0 BY","CC 4.0 BY-SA","CC 4.0 BY-ND","CC 4.0 BY-NC","CC 4.0 BY-NC-ND","CC 4.0 BY-NC-SA","CC 4.0 Zero","Public Domain"]}},"defaultValue":"All Rights Reserved","description":"Content license for the post. Defaults to All Rights Reserved."}
   * @paramDef {"type":"Boolean","label":"Notify Followers","name":"notifyFollowers","uiComponent":{"type":"TOGGLE"},"description":"Whether to notify the author's followers that the user has published this post."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e6f36a","title":"Liverpool FC","authorId":"5303d74c64f66366f00cb9b2a94f3251bf5","tags":["football","soccer"],"url":"https://medium.com/@majelbstoat/liverpool-fc-e6f36a","canonicalUrl":"","publishStatus":"public","license":"all-rights-reserved","licenseUrl":"https://medium.com/policy/9db0094a1e0f","publicationId":"b969ac62a46b"}
   */
  async createPostUnderPublication(publicationId, title, contentFormat, content, tags, canonicalUrl, publishStatus, license, notifyFollowers) {
    const body = this.#buildPostBody(title, contentFormat, content, tags, canonicalUrl, publishStatus, license, notifyFollowers)

    return await this.#apiRequest({
      logTag: '[createPostUnderPublication]',
      url: `${ API_BASE_URL }/publications/${ publicationId }/posts`,
      method: 'post',
      body,
    })
  }

  #buildPostBody(title, contentFormat, content, tags, canonicalUrl, publishStatus, license, notifyFollowers) {
    return clean({
      title,
      contentFormat: this.#resolveChoice(contentFormat, { HTML: 'html', Markdown: 'markdown' }),
      content,
      tags: Array.isArray(tags) && tags.length ? tags : undefined,
      canonicalUrl,
      publishStatus: this.#resolveChoice(publishStatus, { Public: 'public', Draft: 'draft', Unlisted: 'unlisted' }),
      license: this.#resolveChoice(license, LICENSE_MAP),
      notifyFollowers: typeof notifyFollowers === 'boolean' ? notifyFollowers : undefined,
    })
  }

  /**
   * @operationName List User's Publications
   * @category Publications
   * @description Lists the publications the given user is related to as an editor or writer. Provide the user id from Get Current User. Each entry includes the publication id, name, description, and URL; use a publication id with Create Post Under Publication or List Publication Contributors.
   * @route GET /users/{userId}/publications
   * @appearanceColor #000000 #292929
   *
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The user whose publications to list, taken from the id field of Get Current User. Users can only list their own publications."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"b969ac62a46b","name":"About Medium","description":"What is this thing and how does it work?","url":"https://medium.com/about","imageUrl":"https://cdn-images-1.medium.com/fit/c/200/200/0*ae1jbP_od0W6EulE.png"}]
   */
  async listUserPublications(userId) {
    return await this.#apiRequest({
      logTag: '[listUserPublications]',
      url: `${ API_BASE_URL }/users/${ userId }/publications`,
      method: 'get',
    })
  }

  /**
   * @operationName List Publication Contributors
   * @category Publications
   * @description Lists the contributors of a publication along with their role (editor or writer). Provide a publication id (from List User's Publications). Only useful for publications the authenticated user has access to.
   * @route GET /publications/{publicationId}/contributors
   * @appearanceColor #000000 #292929
   *
   * @paramDef {"type":"String","label":"Publication ID","name":"publicationId","required":true,"dictionary":"getPublicationsDictionary","description":"The publication whose contributors to list. Search and select, or paste an id from List User's Publications."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"publicationId":"b45573563f5a","userId":"13a06af8f81849c64880","role":"editor"},{"publicationId":"b45573563f5a","userId":"1c9c63b15b874d3e498d","role":"writer"}]
   */
  async listPublicationContributors(publicationId) {
    return await this.#apiRequest({
      logTag: '[listPublicationContributors]',
      url: `${ API_BASE_URL }/publications/${ publicationId }/contributors`,
      method: 'get',
    })
  }

  /**
   * @operationName Upload Image
   * @category Images
   * @description Uploads an image to Medium from a publicly accessible image URL and returns a Medium-hosted URL you can reference from post HTML. Most integrations do not need this: Medium automatically imports images referenced by src attributes in post content. Supported types: JPEG, PNG, GIF (including animated), and TIFF. Note: the Medium API is deprecated and requires an existing integration token.
   * @route POST /images
   * @appearanceColor #000000 #292929
   *
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":true,"description":"Public URL of the image to fetch and upload to Medium (JPEG, PNG, GIF, or TIFF)."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Optional filename to send with the upload, e.g. image.png. Defaults to a name derived from the URL."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://cdn-images-1.medium.com/0*fkfQiTzT7TlUGGyI.png","md5":"fkfQiTzT7TlUGGyI"}
   */
  async uploadImage(imageUrl, filename) {
    const logTag = '[uploadImage]'

    let bytes

    try {
      logger.debug(`${ logTag } - fetching image bytes from ${ imageUrl }`)
      bytes = await Flowrunner.Request.get(imageUrl).setEncoding(null)
    } catch (error) {
      logger.error(`${ logTag } - failed to fetch image: ${ error.message }`)
      throw new Error(`Medium API error: could not fetch image from URL (${ error.message })`)
    }

    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const name = filename || this.#filenameFromUrl(imageUrl)

    try {
      logger.debug(`${ logTag } - [POST::${ API_BASE_URL }/images] ${ name }`)

      const formData = new Flowrunner.Request.FormData()
      formData.append('image', buffer, name)

      const response = await Flowrunner.Request.post(`${ API_BASE_URL }/images`)
        .set({
          'Authorization': `Bearer ${ this.integrationToken }`,
          'Accept': 'application/json',
        })
        .form(formData)

      return response && response.data !== undefined ? response.data : response
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #filenameFromUrl(url) {
    try {
      const path = String(url).split('?')[0]
      const base = path.substring(path.lastIndexOf('/') + 1)

      return base || 'image'
    } catch {
      return 'image'
    }
  }

  /**
   * @typedef {Object} getPublicationsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"The user id (from Get Current User) whose publications to list. Required because Medium has no global publication search."}
   */

  /**
   * @typedef {Object} getPublicationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter publications by name or description."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Medium returns all publications in one call, so this is unused but kept for API compatibility."}
   * @paramDef {"type":"getPublicationsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependency inputs. Requires a User ID from Get Current User to list that user's publications."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Publications Dictionary
   * @description Provides a selectable list of publications for a user. Medium has no global publication search, so this requires a User ID (the id from Get Current User) supplied via criteria; without it, no options are returned. The option value is the publication id used by Create Post Under Publication and List Publication Contributors.
   * @route POST /get-publications-dictionary
   * @paramDef {"type":"getPublicationsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and criteria (User ID) used to list the user's publications."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"About Medium","value":"b969ac62a46b","note":"What is this thing and how does it work?"}],"cursor":null}
   */
  async getPublicationsDictionary(payload) {
    const logTag = '[getPublicationsDictionary]'
    const { search, criteria } = payload || {}
    const userId = criteria?.userId

    if (!userId) {
      return { items: [], cursor: null }
    }

    const publications = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ userId }/publications`,
      method: 'get',
    })

    const list = Array.isArray(publications) ? publications : []
    const term = (search || '').toLowerCase()

    const filtered = term
      ? list.filter(p => `${ p.name || '' } ${ p.description || '' }`.toLowerCase().includes(term))
      : list

    return {
      items: filtered.map(p => ({
        label: p.name || p.id,
        value: p.id,
        note: p.description || undefined,
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(MediumService, [
  {
    name: 'integrationToken',
    displayName: 'Integration Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Medium → Settings → Security and apps → Integration tokens. NOTE: Medium no longer issues new integration tokens for most accounts — this works only if you already have one.',
  },
])
