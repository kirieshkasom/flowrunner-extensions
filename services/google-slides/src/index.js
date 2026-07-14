'use strict'

const SLIDES_API_BASE_URL = 'https://slides.googleapis.com/v1'
const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const DEFAULT_SCOPE_LIST = [
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const PRESENTATION_MIME_TYPE = 'application/vnd.google-apps.presentation'

const DICTIONARY_PAGE_SIZE = 50

const SLIDE_LAYOUTS = {
  'Blank': 'BLANK',
  'Title': 'TITLE',
  'Title And Body': 'TITLE_AND_BODY',
  'Title Only': 'TITLE_ONLY',
  'Section Header': 'SECTION_HEADER',
}

const IMAGE_REPLACE_METHODS = {
  'Fit Inside': 'CENTER_INSIDE',
  'Crop To Fill': 'CENTER_CROP',
}

const THUMBNAIL_SIZES = {
  'Small': 'SMALL',
  'Medium': 'MEDIUM',
  'Large': 'LARGE',
}

const EXPORT_FORMATS = {
  'PDF': { mimeType: 'application/pdf', extension: 'pdf' },
  'PowerPoint (PPTX)': {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: 'pptx',
  },
}

const TITLE_PLACEHOLDER_TYPES = ['TITLE', 'CENTERED_TITLE']

const DEFAULT_TEXT_BOX_X_PT = 50
const DEFAULT_TEXT_BOX_Y_PT = 50
const DEFAULT_TEXT_BOX_WIDTH_PT = 350
const DEFAULT_TEXT_BOX_HEIGHT_PT = 100

const logger = {
  info: (...args) => console.log('[Google Slides] info:', ...args),
  debug: (...args) => console.log('[Google Slides] debug:', ...args),
  error: (...args) => console.log('[Google Slides] error:', ...args),
  warn: (...args) => console.log('[Google Slides] warn:', ...args),
}

/**
 * @requireOAuth
 * @usesFileStorage
 * @integrationName Google Slides
 * @integrationIcon /icon.png
 **/
class GoogleSlidesService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Google Slides API error: ${ message }`)
    }
  }

  async #downloadBinary({ url, query, withAuth, logTag }) {
    try {
      logger.debug(`${ logTag } - downloading [GET::${ url }]`)

      const request = Flowrunner.Request.get(url)
        .query(cleanupObject(query || {}))
        .setEncoding(null)

      if (withAuth) {
        request.set(this.#getAccessTokenHeader())
      }

      const bytes = await request

      return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - download failed: ${ message }`)

      throw new Error(`Google Slides API error: ${ message }`)
    }
  }

  async #batchUpdate(presentationId, requests, logTag) {
    return this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ SLIDES_API_BASE_URL }/presentations/${ encodeURIComponent(this.#requirePresentationId(presentationId)) }:batchUpdate`,
      body: { requests },
    })
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #requirePresentationId(presentationId) {
    if (!presentationId) {
      throw new Error('"Presentation" is required')
    }

    return String(presentationId).trim()
  }

  #presentationUrl(presentationId) {
    return `https://docs.google.com/presentation/d/${ presentationId }/edit`
  }

  #extractSlideTitle(slide) {
    const pageElements = slide.pageElements || []

    for (const element of pageElements) {
      const shape = element.shape

      if (!shape || !TITLE_PLACEHOLDER_TYPES.includes(shape.placeholder?.type)) {
        continue
      }

      const textElements = shape.text?.textElements || []
      const title = textElements
        .map(textElement => textElement.textRun?.content || '')
        .join('')
        .trim()

      if (title) {
        return title
      }
    }

    return null
  }

  #buildSlideSummaries(slides) {
    return (slides || []).map((slide, index) => ({
      index,
      objectId: slide.objectId,
      title: this.#extractSlideTitle(slide),
    }))
  }

  // ============================================= OAUTH ================================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('access_type', 'offline')
    params.append('prompt', 'consent')

    const connectionURL = `${ OAUTH_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)
    params.append('access_type', 'offline')

    const codeExchangeResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'Google Slides Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(USER_INFO_URL)
        .set(this.#getAccessTokenHeader(codeExchangeResponse.access_token))

      if (userData.name || userData.email) {
        connectionIdentityName = userData.name
          ? `${ userData.name } (${ userData.email })`
          : userData.email
      }

      connectionIdentityImageURL = userData.picture || null
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ error.message }`)
    }

    return {
      token: codeExchangeResponse.access_token,
      expirationInSeconds: codeExchangeResponse.expires_in,
      refreshToken: codeExchangeResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
      userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   * @property {String} [refreshToken]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const { access_token, expires_in } = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        })

      return {
        token: access_token,
        expirationInSeconds: expires_in,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getPresentationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter presentations by name (Drive 'name contains' query)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Presentations Dictionary
   * @description Lists Google Slides presentations accessible to the connected user (via the Drive API), for selection in dependent parameters. Returns the presentation name as the label and the presentation ID as the value, sorted by most recently modified.
   * @route POST /get-presentations-dictionary
   * @paramDef {"type":"getPresentationsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Q3 Business Review","value":"1aBcDeFgHiJkLmNoPqRsTuVwXyZ","note":"Modified 2025-06-01T10:00:00.000Z"}],"cursor":"nextPageToken123"}
   */
  async getPresentationsDictionary(payload) {
    const { search, cursor } = payload || {}

    const queryParts = [`mimeType='${ PRESENTATION_MIME_TYPE }'`, 'trashed=false']

    if (search) {
      queryParts.push(`name contains '${ escapeDriveQueryValue(search) }'`)
    }

    const response = await this.#apiRequest({
      logTag: 'getPresentationsDictionary',
      url: `${ DRIVE_API_BASE_URL }/files`,
      query: {
        q: queryParts.join(' and '),
        orderBy: 'modifiedTime desc',
        pageSize: DICTIONARY_PAGE_SIZE,
        pageToken: cursor,
        fields: 'nextPageToken,files(id,name,modifiedTime)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      },
    })

    return {
      cursor: response.nextPageToken,
      items: (response.files || []).map(file => ({
        label: file.name,
        value: file.id,
        note: file.modifiedTime ? `Modified ${ file.modifiedTime }` : 'Presentation',
      })),
    }
  }

  /**
   * @typedef {Object} getSlidesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Presentation","name":"presentationId","description":"The presentation whose slides populate the list."}
   */

  /**
   * @typedef {Object} getSlidesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter slides by their title or object ID. Filtering is applied locally."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token (unused — all slides are returned in one page)."}
   * @paramDef {"type":"getSlidesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The presentation whose slides to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Slides Dictionary
   * @description Lists the slides of a specific presentation for selection in dependent parameters. Returns labels in the form "Slide {n} — {title}" (title extracted from the slide's title placeholder when present) and the slide's page object ID as the value.
   * @route POST /get-slides-dictionary
   * @paramDef {"type":"getSlidesDictionary__payload","label":"Payload","name":"payload","description":"Search text and the presentation criteria whose slides to list."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Slide 1 — Quarterly Overview","value":"p1_slideId","note":"Index 0"}]}
   */
  async getSlidesDictionary(payload) {
    const { search, criteria } = payload || {}
    const presentationId = criteria?.presentationId

    if (!presentationId) {
      return { items: [] }
    }

    const response = await this.#apiRequest({
      logTag: 'getSlidesDictionary',
      url: `${ SLIDES_API_BASE_URL }/presentations/${ encodeURIComponent(presentationId) }`,
      query: {
        fields: 'slides(objectId,pageElements(shape(placeholder(type),text(textElements(textRun(content))))))',
      },
    })

    const items = this.#buildSlideSummaries(response.slides).map(slide => ({
      label: slide.title ? `Slide ${ slide.index + 1 } — ${ slide.title }` : `Slide ${ slide.index + 1 }`,
      value: slide.objectId,
      note: `Index ${ slide.index }`,
    }))

    const filteredItems = search
      ? searchFilter(items, ['label', 'value'], search)
      : items

    return { items: filteredItems }
  }

  // ========================================== PRESENTATIONS ==========================================

  /**
   * @description Creates a new, blank Google Slides presentation with the given title in the connected user's Drive. The new presentation contains one default title slide. Returns the presentation ID, title, and a direct edit URL.
   *
   * @route POST /create-presentation
   * @operationName Create Presentation
   * @category Presentations
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the new presentation, shown as the file name in Google Drive."}
   *
   * @returns {Object}
   * @sampleResult {"presentationId":"1aBcDeFgHiJkLmNoPqRsTuVwXyZ","title":"Q3 Business Review","slideCount":1,"firstSlideObjectId":"p","url":"https://docs.google.com/presentation/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit"}
   */
  async createPresentation(title) {
    if (!title) {
      throw new Error('"Title" is required')
    }

    const presentation = await this.#apiRequest({
      logTag: 'createPresentation',
      method: 'post',
      url: `${ SLIDES_API_BASE_URL }/presentations`,
      body: { title },
    })

    return {
      presentationId: presentation.presentationId,
      title: presentation.title,
      slideCount: (presentation.slides || []).length,
      firstSlideObjectId: presentation.slides?.[0]?.objectId || null,
      url: this.#presentationUrl(presentation.presentationId),
    }
  }

  /**
   * @description Retrieves a Google Slides presentation and returns a convenient summary: title, revision ID, page size, slide count, and a slides list with each slide's index, page object ID, and title (extracted from the slide's title placeholder). Optionally includes the full raw presentation resource with all page elements.
   *
   * @route GET /get-presentation
   * @operationName Get Presentation
   * @category Presentations
   *
   * @paramDef {"type":"String","label":"Presentation","name":"presentationId","required":true,"dictionary":"getPresentationsDictionary","description":"The presentation to retrieve. Select from the list or provide the presentation ID directly (the long ID from the presentation URL)."}
   * @paramDef {"type":"Boolean","label":"Include Full Details","name":"includeFullDetails","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the response also contains the complete raw presentation resource (all slides, layouts, masters, and page elements) under the 'presentation' property. Default: disabled."}
   *
   * @returns {Object}
   * @sampleResult {"presentationId":"1aBcDeFgHiJkLmNoPqRsTuVwXyZ","title":"Q3 Business Review","revisionId":"revision123","slideCount":2,"pageSize":{"width":{"magnitude":9144000,"unit":"EMU"},"height":{"magnitude":5143500,"unit":"EMU"}},"slides":[{"index":0,"objectId":"p","title":"Quarterly Overview"},{"index":1,"objectId":"g2abc123","title":"Revenue Highlights"}],"url":"https://docs.google.com/presentation/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit"}
   */
  async getPresentation(presentationId, includeFullDetails) {
    const presentation = await this.#apiRequest({
      logTag: 'getPresentation',
      url: `${ SLIDES_API_BASE_URL }/presentations/${ encodeURIComponent(this.#requirePresentationId(presentationId)) }`,
    })

    const result = {
      presentationId: presentation.presentationId,
      title: presentation.title,
      revisionId: presentation.revisionId,
      slideCount: (presentation.slides || []).length,
      pageSize: presentation.pageSize,
      slides: this.#buildSlideSummaries(presentation.slides),
      url: this.#presentationUrl(presentation.presentationId),
    }

    if (includeFullDetails) {
      result.presentation = presentation
    }

    return result
  }

  /**
   * @description Creates a new presentation by copying an existing Google Slides template (via the Drive API) and replacing text placeholders across all slides. Placeholders follow the {{placeholder}} convention: pass a Replacements object whose keys are placeholder names (with or without the surrounding braces) and whose values are the replacement text. Returns the new presentation's ID, edit URL, and the number of occurrences replaced per placeholder.
   *
   * @route POST /create-from-template
   * @operationName Create From Template
   * @category Presentations
   *
   * @paramDef {"type":"String","label":"Template Presentation","name":"templatePresentationId","required":true,"dictionary":"getPresentationsDictionary","description":"The presentation to use as a template. Select from the list or provide the presentation ID directly. The template itself is not modified."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title (Drive file name) of the new presentation created from the template."}
   * @paramDef {"type":"Object","label":"Replacements","name":"replacements","description":"Placeholder-to-value map applied to all slides of the copy, e.g. {\"customerName\":\"Acme Corp\",\"{{date}}\":\"July 2026\"}. Keys may be written with or without the surrounding {{ }} braces; the template must contain the placeholders in {{placeholder}} form. Matching is case-sensitive."}
   *
   * @returns {Object}
   * @sampleResult {"presentationId":"1NewCopyIdAbCdEfGhIjKlMnOp","title":"Acme Corp Proposal","url":"https://docs.google.com/presentation/d/1NewCopyIdAbCdEfGhIjKlMnOp/edit","replacements":{"{{customerName}}":3,"{{date}}":1}}
   */
  async createFromTemplate(templatePresentationId, title, replacements) {
    if (!title) {
      throw new Error('"Title" is required')
    }

    const templateId = this.#requirePresentationId(templatePresentationId)

    const copy = await this.#apiRequest({
      logTag: 'createFromTemplate',
      method: 'post',
      url: `${ DRIVE_API_BASE_URL }/files/${ encodeURIComponent(templateId) }/copy`,
      query: { supportsAllDrives: true },
      body: { name: title },
    })

    const placeholders = Object.keys(replacements || {})
    const replacementResults = {}

    if (placeholders.length) {
      const requests = placeholders.map(key => ({
        replaceAllText: {
          containsText: {
            text: normalizePlaceholder(key),
            matchCase: true,
          },
          replaceText: replacements[key] === null || replacements[key] === undefined
            ? ''
            : String(replacements[key]),
        },
      }))

      const response = await this.#batchUpdate(copy.id, requests, 'createFromTemplate:replaceAllText')

      const replies = response.replies || []

      placeholders.forEach((key, index) => {
        replacementResults[normalizePlaceholder(key)] = replies[index]?.replaceAllText?.occurrencesChanged || 0
      })
    }

    return {
      presentationId: copy.id,
      title: copy.name || title,
      url: this.#presentationUrl(copy.id),
      replacements: replacementResults,
    }
  }

  /**
   * @description Exports a Google Slides presentation to PDF or PowerPoint (PPTX) via the Drive API, saves the exported file to FlowRunner file storage, and returns its hosted URL. Note: Drive export is limited to files of at most 10 MB of exported content.
   *
   * @route POST /export-presentation
   * @operationName Export Presentation
   * @category Presentations
   *
   * @paramDef {"type":"String","label":"Presentation","name":"presentationId","required":true,"dictionary":"getPresentationsDictionary","description":"The presentation to export. Select from the list or provide the presentation ID directly."}
   * @paramDef {"type":"String","label":"Format","name":"format","defaultValue":"PDF","uiComponent":{"type":"DROPDOWN","options":{"values":["PDF","PowerPoint (PPTX)"]}},"description":"The export format. 'PDF' produces a .pdf document; 'PowerPoint (PPTX)' produces an editable .pptx file. Default: 'PDF'."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional name (without extension) for the saved file in FlowRunner storage. The format extension is appended automatically. Defaults to 'presentation_{timestamp}'."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the exported file. Scope: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.com/exports/presentation_1750000000000.pdf","fileName":"presentation_1750000000000.pdf","format":"PDF","mimeType":"application/pdf","presentationId":"1aBcDeFgHiJkLmNoPqRsTuVwXyZ"}
   */
  async exportPresentation(presentationId, format, fileName, fileOptions) {
    const id = this.#requirePresentationId(presentationId)

    const formatLabel = format || 'PDF'
    const exportFormat = EXPORT_FORMATS[formatLabel]

    if (!exportFormat) {
      throw new Error(`Unsupported export format: "${ formatLabel }". Use "PDF" or "PowerPoint (PPTX)".`)
    }

    const buffer = await this.#downloadBinary({
      logTag: 'exportPresentation',
      url: `${ DRIVE_API_BASE_URL }/files/${ encodeURIComponent(id) }/export`,
      query: { mimeType: exportFormat.mimeType },
      withAuth: true,
    })

    const baseName = sanitizeFileName(fileName) || `presentation_${ Date.now() }`
    const fullFileName = `${ baseName }.${ exportFormat.extension }`

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: fullFileName,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      url,
      fileName: fullFileName,
      format: formatLabel,
      mimeType: exportFormat.mimeType,
      presentationId: id,
    }
  }

  /**
   * @description Permanently deletes a Google Slides presentation from Google Drive (via the Drive API), skipping the trash. This cannot be undone. The connected user must own the file or have permission to delete it.
   *
   * @route DELETE /delete-presentation
   * @operationName Delete Presentation
   * @category Presentations
   *
   * @paramDef {"type":"String","label":"Presentation","name":"presentationId","required":true,"dictionary":"getPresentationsDictionary","description":"The presentation to delete. Select from the list or provide the presentation ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Presentation deleted successfully","presentationId":"1aBcDeFgHiJkLmNoPqRsTuVwXyZ"}
   */
  async deletePresentation(presentationId) {
    const id = this.#requirePresentationId(presentationId)

    await this.#apiRequest({
      logTag: 'deletePresentation',
      method: 'delete',
      url: `${ DRIVE_API_BASE_URL }/files/${ encodeURIComponent(id) }`,
      query: { supportsAllDrives: true },
    })

    return {
      success: true,
      message: 'Presentation deleted successfully',
      presentationId: id,
    }
  }

  // ============================================= SLIDES ===============================================

  /**
   * @description Adds a new slide to a Google Slides presentation using one of the predefined layouts. Optionally inserts the slide at a specific zero-based position; by default the slide is appended at the end. Returns the object ID of the created slide for use in subsequent content operations.
   *
   * @route POST /add-slide
   * @operationName Add Slide
   * @category Slides
   *
   * @paramDef {"type":"String","label":"Presentation","name":"presentationId","required":true,"dictionary":"getPresentationsDictionary","description":"The presentation to add the slide to. Select from the list or provide the presentation ID directly."}
   * @paramDef {"type":"String","label":"Layout","name":"layout","defaultValue":"Blank","uiComponent":{"type":"DROPDOWN","options":{"values":["Blank","Title","Title And Body","Title Only","Section Header"]}},"description":"The predefined layout of the new slide. 'Blank' has no placeholders; 'Title' has centered title and subtitle; 'Title And Body' has a title and a body text area; 'Title Only' has only a title; 'Section Header' has a section title. Default: 'Blank'."}
   * @paramDef {"type":"Number","label":"Insertion Index","name":"insertionIndex","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional zero-based index at which to insert the slide (0 = first). When omitted, the slide is added at the end of the presentation."}
   *
   * @returns {Object}
   * @sampleResult {"presentationId":"1aBcDeFgHiJkLmNoPqRsTuVwXyZ","slideObjectId":"g2abc123","layout":"TITLE_AND_BODY"}
   */
  async addSlide(presentationId, layout, insertionIndex) {
    const id = this.#requirePresentationId(presentationId)
    const predefinedLayout = this.#resolveChoice(layout || 'Blank', SLIDE_LAYOUTS)

    const createSlide = {
      slideLayoutReference: { predefinedLayout },
    }

    if (insertionIndex !== undefined && insertionIndex !== null && insertionIndex !== '') {
      createSlide.insertionIndex = Number(insertionIndex)
    }

    const response = await this.#batchUpdate(id, [{ createSlide }], 'addSlide')

    return {
      presentationId: id,
      slideObjectId: response.replies?.[0]?.createSlide?.objectId || null,
      layout: predefinedLayout,
    }
  }

  /**
   * @description Deletes a slide (or any page element) from a Google Slides presentation by its object ID. Deleting a slide removes all of its content. A presentation must keep at least one slide.
   *
   * @route DELETE /delete-slide
   * @operationName Delete Slide
   * @category Slides
   *
   * @paramDef {"type":"String","label":"Presentation","name":"presentationId","required":true,"dictionary":"getPresentationsDictionary","description":"The presentation to delete the slide from. Select from the list or provide the presentation ID directly."}
   * @paramDef {"type":"String","label":"Slide","name":"pageObjectId","required":true,"dictionary":"getSlidesDictionary","dependsOn":["presentationId"],"description":"The slide to delete. Choose the presentation above to pick from its slides, or provide the slide's page object ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Slide deleted successfully","presentationId":"1aBcDeFgHiJkLmNoPqRsTuVwXyZ","pageObjectId":"g2abc123"}
   */
  async deleteSlide(presentationId, pageObjectId) {
    const id = this.#requirePresentationId(presentationId)

    if (!pageObjectId) {
      throw new Error('"Slide" is required')
    }

    await this.#batchUpdate(id, [{ deleteObject: { objectId: pageObjectId } }], 'deleteSlide')

    return {
      success: true,
      message: 'Slide deleted successfully',
      presentationId: id,
      pageObjectId,
    }
  }

  /**
   * @description Generates a thumbnail image of a single slide, downloads it, saves it as a PNG to FlowRunner file storage, and returns its hosted URL together with the image dimensions. Thumbnail generation counts as an expensive read request against the Slides API quota.
   *
   * @route POST /get-slide-thumbnail
   * @operationName Get Slide Thumbnail
   * @category Slides
   *
   * @paramDef {"type":"String","label":"Presentation","name":"presentationId","required":true,"dictionary":"getPresentationsDictionary","description":"The presentation containing the slide. Select from the list or provide the presentation ID directly."}
   * @paramDef {"type":"String","label":"Slide","name":"pageObjectId","required":true,"dictionary":"getSlidesDictionary","dependsOn":["presentationId"],"description":"The slide to render. Choose the presentation above to pick from its slides, or provide the slide's page object ID directly."}
   * @paramDef {"type":"String","label":"Size","name":"size","defaultValue":"Large","uiComponent":{"type":"DROPDOWN","options":{"values":["Small","Medium","Large"]}},"description":"The thumbnail size. 'Small' is 200px wide, 'Medium' is 800px wide, 'Large' is 1600px wide (widths are approximate and preserve the slide's aspect ratio). Default: 'Large'."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the saved thumbnail. Scope: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.com/thumbnails/slide_g2abc123_1750000000000.png","width":1600,"height":900,"presentationId":"1aBcDeFgHiJkLmNoPqRsTuVwXyZ","pageObjectId":"g2abc123"}
   */
  async getSlideThumbnail(presentationId, pageObjectId, size, fileOptions) {
    const id = this.#requirePresentationId(presentationId)

    if (!pageObjectId) {
      throw new Error('"Slide" is required')
    }

    const thumbnail = await this.#apiRequest({
      logTag: 'getSlideThumbnail',
      url: `${ SLIDES_API_BASE_URL }/presentations/${ encodeURIComponent(id) }/pages/${ encodeURIComponent(pageObjectId) }/thumbnail`,
      query: {
        'thumbnailProperties.mimeType': 'PNG',
        'thumbnailProperties.thumbnailSize': this.#resolveChoice(size || 'Large', THUMBNAIL_SIZES),
      },
    })

    if (!thumbnail.contentUrl) {
      throw new Error('Thumbnail generation did not return a content URL')
    }

    const buffer = await this.#downloadBinary({
      logTag: 'getSlideThumbnail',
      url: thumbnail.contentUrl,
    })

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: `slide_${ pageObjectId }_${ Date.now() }.png`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      url,
      width: thumbnail.width,
      height: thumbnail.height,
      presentationId: id,
      pageObjectId,
    }
  }

  // ============================================= CONTENT ==============================================

  /**
   * @description Inserts a new text box with the given text onto a slide. Position and size are specified in points (PT); one point is 1/72 inch, and a default 10-inch-wide slide is 720 PT wide by 405 PT tall. Defaults place a 350x100 PT box near the top-left corner. Returns the object ID of the created text box for further styling via Batch Update.
   *
   * @route POST /insert-text-box
   * @operationName Insert Text Box
   * @category Content
   *
   * @paramDef {"type":"String","label":"Presentation","name":"presentationId","required":true,"dictionary":"getPresentationsDictionary","description":"The presentation containing the target slide. Select from the list or provide the presentation ID directly."}
   * @paramDef {"type":"String","label":"Slide","name":"pageObjectId","required":true,"dictionary":"getSlidesDictionary","dependsOn":["presentationId"],"description":"The slide to place the text box on. Choose the presentation above to pick from its slides, or provide the slide's page object ID directly."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the text box. Line breaks are preserved."}
   * @paramDef {"type":"Number","label":"X Position (PT)","name":"x","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Horizontal position of the text box's top-left corner, in points from the slide's left edge. Default: 50."}
   * @paramDef {"type":"Number","label":"Y Position (PT)","name":"y","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Vertical position of the text box's top-left corner, in points from the slide's top edge. Default: 50."}
   * @paramDef {"type":"Number","label":"Width (PT)","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Width of the text box in points. Default: 350."}
   * @paramDef {"type":"Number","label":"Height (PT)","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Height of the text box in points. Default: 100."}
   *
   * @returns {Object}
   * @sampleResult {"presentationId":"1aBcDeFgHiJkLmNoPqRsTuVwXyZ","pageObjectId":"g2abc123","textBoxObjectId":"TextBox_1750000000000","text":"Hello from FlowRunner"}
   */
  async insertTextBox(presentationId, pageObjectId, text, x, y, width, height) {
    const id = this.#requirePresentationId(presentationId)

    if (!pageObjectId) {
      throw new Error('"Slide" is required')
    }

    if (!text) {
      throw new Error('"Text" is required')
    }

    const textBoxObjectId = `TextBox_${ Date.now() }_${ Math.floor(Math.random() * 10000) }`

    const requests = [
      {
        createShape: {
          objectId: textBoxObjectId,
          shapeType: 'TEXT_BOX',
          elementProperties: {
            pageObjectId,
            size: {
              width: { magnitude: toPositiveNumber(width, DEFAULT_TEXT_BOX_WIDTH_PT), unit: 'PT' },
              height: { magnitude: toPositiveNumber(height, DEFAULT_TEXT_BOX_HEIGHT_PT), unit: 'PT' },
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: toFiniteNumber(x, DEFAULT_TEXT_BOX_X_PT),
              translateY: toFiniteNumber(y, DEFAULT_TEXT_BOX_Y_PT),
              unit: 'PT',
            },
          },
        },
      },
      {
        insertText: {
          objectId: textBoxObjectId,
          insertionIndex: 0,
          text,
        },
      },
    ]

    await this.#batchUpdate(id, requests, 'insertTextBox')

    return {
      presentationId: id,
      pageObjectId,
      textBoxObjectId,
      text,
    }
  }

  /**
   * @description Finds and replaces all occurrences of a text string across every slide of a presentation (in shapes and tables). Commonly used to fill {{placeholder}} tokens. Returns the number of occurrences changed.
   *
   * @route POST /replace-all-text
   * @operationName Replace All Text
   * @category Content
   *
   * @paramDef {"type":"String","label":"Presentation","name":"presentationId","required":true,"dictionary":"getPresentationsDictionary","description":"The presentation to modify. Select from the list or provide the presentation ID directly."}
   * @paramDef {"type":"String","label":"Find Text","name":"findText","required":true,"description":"The text to search for across all slides, e.g. '{{customerName}}'."}
   * @paramDef {"type":"String","label":"Replace Text","name":"replaceText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The replacement text. Leave empty to remove all occurrences of the found text."}
   * @paramDef {"type":"Boolean","label":"Match Case","name":"matchCase","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the search is case-sensitive. Default: enabled."}
   *
   * @returns {Object}
   * @sampleResult {"presentationId":"1aBcDeFgHiJkLmNoPqRsTuVwXyZ","findText":"{{customerName}}","occurrencesChanged":3}
   */
  async replaceAllText(presentationId, findText, replaceText, matchCase) {
    const id = this.#requirePresentationId(presentationId)

    if (!findText) {
      throw new Error('"Find Text" is required')
    }

    const response = await this.#batchUpdate(id, [
      {
        replaceAllText: {
          containsText: {
            text: findText,
            matchCase: matchCase !== false,
          },
          replaceText: replaceText || '',
        },
      },
    ], 'replaceAllText')

    return {
      presentationId: id,
      findText,
      occurrencesChanged: response.replies?.[0]?.replaceAllText?.occurrencesChanged || 0,
    }
  }

  /**
   * @description Replaces all shapes containing the given text with an image fetched from a public URL, across every slide of the presentation. The image inherits the size and position of each replaced shape. The image URL must be publicly accessible, at most 50 MB, and in PNG, JPEG, or GIF format. Returns the number of shapes replaced.
   *
   * @route POST /replace-text-with-image
   * @operationName Replace Text With Image
   * @category Content
   *
   * @paramDef {"type":"String","label":"Presentation","name":"presentationId","required":true,"dictionary":"getPresentationsDictionary","description":"The presentation to modify. Select from the list or provide the presentation ID directly."}
   * @paramDef {"type":"String","label":"Contains Text","name":"containsText","required":true,"description":"Shapes containing this text are replaced with the image, e.g. '{{logo}}'."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":true,"description":"Publicly accessible URL of the image (PNG, JPEG, or GIF; max 50 MB, max 25 megapixels)."}
   * @paramDef {"type":"String","label":"Replace Method","name":"replaceMethod","defaultValue":"Fit Inside","uiComponent":{"type":"DROPDOWN","options":{"values":["Fit Inside","Crop To Fill"]}},"description":"How the image fits the replaced shape's bounds. 'Fit Inside' scales the image to fit within the shape while preserving aspect ratio; 'Crop To Fill' scales and crops the image to fill the shape completely. Default: 'Fit Inside'."}
   * @paramDef {"type":"Boolean","label":"Match Case","name":"matchCase","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the text search is case-sensitive. Default: enabled."}
   *
   * @returns {Object}
   * @sampleResult {"presentationId":"1aBcDeFgHiJkLmNoPqRsTuVwXyZ","containsText":"{{logo}}","occurrencesChanged":2}
   */
  async replaceTextWithImage(presentationId, containsText, imageUrl, replaceMethod, matchCase) {
    const id = this.#requirePresentationId(presentationId)

    if (!containsText) {
      throw new Error('"Contains Text" is required')
    }

    if (!imageUrl) {
      throw new Error('"Image URL" is required')
    }

    const response = await this.#batchUpdate(id, [
      {
        replaceAllShapesWithImage: {
          containsText: {
            text: containsText,
            matchCase: matchCase !== false,
          },
          imageUrl,
          imageReplaceMethod: this.#resolveChoice(replaceMethod || 'Fit Inside', IMAGE_REPLACE_METHODS),
        },
      },
    ], 'replaceTextWithImage')

    return {
      presentationId: id,
      containsText,
      occurrencesChanged: response.replies?.[0]?.replaceAllShapesWithImage?.occurrencesChanged || 0,
    }
  }

  // ============================================= ADVANCED =============================================

  /**
   * @description Applies a raw list of Google Slides batchUpdate requests to a presentation. Use this for advanced operations not covered by the dedicated actions (e.g. styling text, creating tables, duplicating slides, updating speaker notes). Each item must be a valid request object from the Slides API batchUpdate reference, e.g. {"updateTextStyle":{...}} or {"duplicateObject":{...}}. Requests are applied atomically: if any request fails, none are applied.
   *
   * @route POST /batch-update
   * @operationName Batch Update
   * @category Advanced
   *
   * @paramDef {"type":"String","label":"Presentation","name":"presentationId","required":true,"dictionary":"getPresentationsDictionary","description":"The presentation to modify. Select from the list or provide the presentation ID directly."}
   * @paramDef {"type":"Array<Object>","label":"Requests","name":"requests","required":true,"description":"List of Slides API request objects passed through unchanged, e.g. [{\"createSlide\":{\"slideLayoutReference\":{\"predefinedLayout\":\"BLANK\"}}},{\"replaceAllText\":{\"containsText\":{\"text\":\"{{name}}\"},\"replaceText\":\"Acme\"}}]. See the Slides API batchUpdate reference for all supported request types."}
   *
   * @returns {Object}
   * @sampleResult {"presentationId":"1aBcDeFgHiJkLmNoPqRsTuVwXyZ","replies":[{"createSlide":{"objectId":"g3def456"}},{}],"writeControl":{"requiredRevisionId":"revision124"}}
   */
  async batchUpdate(presentationId, requests) {
    if (!Array.isArray(requests) || !requests.length) {
      throw new Error('"Requests" must be a non-empty array of Slides API request objects')
    }

    return this.#batchUpdate(presentationId, requests, 'batchUpdate')
  }
}

Flowrunner.ServerCode.addService(GoogleSlidesService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client ID from the Google Cloud Console (used for authentication requests).',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client Secret from the Google Cloud Console (required for secure authentication).',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function searchFilter(list, props, searchString) {
  return list.filter(item =>
    props.some(prop => {
      const value = item[prop]

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    })
  )
}

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function normalizePlaceholder(key) {
  const trimmed = String(key).trim()

  return trimmed.startsWith('{{') && trimmed.endsWith('}}') ? trimmed : `{{${ trimmed }}}`
}

function sanitizeFileName(name) {
  if (!name) {
    return null
  }

  return String(name).trim().replace(/[/\\?%*:|"<>]/g, '_') || null
}

function toFiniteNumber(value, defaultValue) {
  const number = Number(value)

  return value !== undefined && value !== null && value !== '' && Number.isFinite(number)
    ? number
    : defaultValue
}

function toPositiveNumber(value, defaultValue) {
  const number = toFiniteNumber(value, defaultValue)

  return number > 0 ? number : defaultValue
}
