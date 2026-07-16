const logger = {
  info: (...args) => console.log('[Bannerbear] info:', ...args),
  debug: (...args) => console.log('[Bannerbear] debug:', ...args),
  error: (...args) => console.log('[Bannerbear] error:', ...args),
  warn: (...args) => console.log('[Bannerbear] warn:', ...args),
}

const API_BASE_URL = 'https://api.bannerbear.com/v2'

// Async renders (images, videos, collections, gifs) start as "pending" and
// finish as "completed". When waitForCompletion is requested we poll the
// resource endpoint on a respectful interval up to this bounded window.
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 30000

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * @integrationName Bannerbear
 * @integrationIcon /icon.png
 */
class BannerbearService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.message || error.message || 'Unknown error'

      logger.error(`${ logTag } - failed (${ status || 'no status' }): ${ message }`)

      throw new Error(`Bannerbear API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  // Poll a render resource until status is completed/failed or the window elapses.
  async #pollUntilComplete({ resourcePath, uid, logTag }) {
    const deadline = Date.now() + POLL_TIMEOUT_MS

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const resource = await this.#apiRequest({
        logTag,
        url: `${ API_BASE_URL }/${ resourcePath }/${ uid }`,
        method: 'get',
      })

      const status = resource && resource.status

      if (status === 'completed' || status === 'failed' || Date.now() >= deadline) {
        return resource
      }

      await sleep(POLL_INTERVAL_MS)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @operationName Create Image
   * @category Images
   * @description Renders an image from a Bannerbear template by supplying a list of modifications (text, images, colors) for named layers. By default Bannerbear renders asynchronously and returns a pending object with a uid and status "pending"; call Get Image to poll for completion or provide a webhook_url to be notified. Set Wait For Completion to true to poll here (up to ~30 seconds) and return the finished object with a populated image_url. Optionally output a transparent PNG, render a PDF (costs extra quota), and attach metadata.
   * @route POST /images
   * @appearanceColor #EF4E4E #F97070
   * @executionTimeoutInSeconds 45
   *
   * @paramDef {"type":"String","label":"Template","name":"template","required":true,"dictionary":"getTemplatesDictionary","description":"UID of the Bannerbear template to render. Search and select a template, or paste a UID. Use Get Template to reveal the modification layer names."}
   * @paramDef {"type":"Array<Object>","label":"Modifications","name":"modifications","required":true,"description":"List of layer modifications. Each item targets a layer by name, e.g. {\"name\":\"title\",\"text\":\"Hello\"} for text or {\"name\":\"photo\",\"image_url\":\"https://...\"} for images. Supported keys per item: name, text, image_url, color (hex), background (hex), font_family, text_align_h, text_align_v, effect, hide."}
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","description":"Optional URL that Bannerbear POSTs the completed image object to when rendering finishes."}
   * @paramDef {"type":"Boolean","label":"Transparent","name":"transparent","uiComponent":{"type":"CHECKBOX"},"description":"When true, render a PNG with a transparent background. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Render PDF","name":"renderPdf","uiComponent":{"type":"CHECKBOX"},"description":"When true, also produce a PDF of the image. Costs 3x quota. Defaults to false."}
   * @paramDef {"type":"String","label":"Metadata","name":"metadata","description":"Optional custom string stored alongside the image and echoed back on the object."}
   * @paramDef {"type":"Boolean","label":"Wait For Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"description":"When true, poll Bannerbear (up to ~30 seconds) until the image finishes rendering and return the completed object with image_url. When false, return immediately with the pending object and its uid. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"uid":"lY1keE0Zmw83jVQ7pd","status":"completed","self":"https://api.bannerbear.com/v2/images/lY1keE0Zmw83jVQ7pd","image_url":"https://cdn.bannerbear.com/lY1keE0Zmw83jVQ7pd.png","template":"jJWBKNELpQPvbX5R93Gk","created_at":"2026-07-14T12:00:00.000Z"}
   */
  async createImage(template, modifications, webhookUrl, transparent, renderPdf, metadata, waitForCompletion) {
    const logTag = '[createImage]'

    const created = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/images`,
      method: 'post',
      body: clean({
        template,
        modifications: modifications || [],
        webhook_url: webhookUrl,
        transparent: transparent === true ? true : undefined,
        render_pdf: renderPdf === true ? true : undefined,
        metadata,
      }),
    })

    if (waitForCompletion === true && created && created.uid && created.status !== 'completed') {
      return await this.#pollUntilComplete({ logTag, resourcePath: 'images', uid: created.uid })
    }

    return created
  }

  /**
   * @operationName Get Image
   * @category Images
   * @description Retrieves a single rendered image by its uid, including its current status ("pending", "completed", or "failed") and, once completed, the image_url (and pdf_url when a PDF was requested). Use this to poll for completion after Create Image when not waiting inline.
   * @route GET /images/{uid}
   * @appearanceColor #EF4E4E #F97070
   *
   * @paramDef {"type":"String","label":"Image UID","name":"uid","required":true,"description":"The uid of the image returned by Create Image."}
   *
   * @returns {Object}
   * @sampleResult {"uid":"lY1keE0Zmw83jVQ7pd","status":"completed","image_url":"https://cdn.bannerbear.com/lY1keE0Zmw83jVQ7pd.png","template":"jJWBKNELpQPvbX5R93Gk","created_at":"2026-07-14T12:00:00.000Z"}
   */
  async getImage(uid) {
    const logTag = '[getImage]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/images/${ uid }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Images
   * @category Images
   * @description Lists images previously rendered in the current project, most recent first, in pages of 25 (up to 100 per page). Supports pagination via page and limit.
   * @route GET /images
   * @appearanceColor #EF4E4E #F97070
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of images per page (max 100). Defaults to 25."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"uid":"lY1keE0Zmw83jVQ7pd","status":"completed","image_url":"https://cdn.bannerbear.com/lY1keE0Zmw83jVQ7pd.png","template":"jJWBKNELpQPvbX5R93Gk","created_at":"2026-07-14T12:00:00.000Z"}]
   */
  async listImages(page, limit) {
    const logTag = '[listImages]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/images`,
      method: 'get',
      query: { page, limit },
    })
  }

  /**
   * @operationName List Templates
   * @category Templates
   * @description Lists templates available in the current project, in pages of 25 (up to 100 per page). Optionally filter by partial name or tag. Each template exposes its uid and available modification layer names for use with Create Image.
   * @route GET /templates
   * @appearanceColor #EF4E4E #F97070
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional partial name to filter templates by."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Optional tag to filter templates by."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of templates per page (max 100). Defaults to 25."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"uid":"jJWBKNELpQPvbX5R93Gk","name":"Social Post","width":1200,"height":630,"available_modifications":[{"name":"title","text":null},{"name":"photo","image_url":null}]}]
   */
  async listTemplates(name, tag, page, limit) {
    const logTag = '[listTemplates]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/templates`,
      method: 'get',
      query: { name, tag, page, limit },
    })
  }

  /**
   * @operationName Get Template
   * @category Templates
   * @description Retrieves a single template by its uid, including its dimensions and the available_modifications array that lists every editable layer name. Use these layer names to build the modifications for Create Image.
   * @route GET /templates/{uid}
   * @appearanceColor #EF4E4E #F97070
   *
   * @paramDef {"type":"String","label":"Template UID","name":"uid","required":true,"dictionary":"getTemplatesDictionary","description":"UID of the template to retrieve. Search and select a template, or paste a UID."}
   *
   * @returns {Object}
   * @sampleResult {"uid":"jJWBKNELpQPvbX5R93Gk","name":"Social Post","width":1200,"height":630,"available_modifications":[{"name":"title","text":null,"color":null},{"name":"photo","image_url":null}]}
   */
  async getTemplate(uid) {
    const logTag = '[getTemplate]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/templates/${ uid }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Video
   * @category Videos
   * @description Renders a video from a Bannerbear video template. Depending on the template's build pack, supply an input media URL (a source video/audio/image) and/or per-frame modifications. Rendering is asynchronous: the response is a pending object with a uid; poll Get Video for the video_url and percent_rendered, or supply a webhook_url. Optionally apply a zoom pan effect and trim the source clip.
   * @route POST /videos
   * @appearanceColor #EF4E4E #F97070
   * @executionTimeoutInSeconds 45
   *
   * @paramDef {"type":"String","label":"Video Template","name":"videoTemplate","required":true,"description":"UID of the Bannerbear video template to render."}
   * @paramDef {"type":"String","label":"Input Media URL","name":"inputMediaUrl","description":"URL of the source video, audio, or image. Required for Overlay and Transcribe build packs; optional for Multi Overlay."}
   * @paramDef {"type":"Array<Object>","label":"Modifications","name":"modifications","description":"List of layer modifications applied to the base video frame, same structure as image modifications (name plus text/image_url/color/etc.)."}
   * @paramDef {"type":"Array<Object>","label":"Frames","name":"frames","description":"For Multi Overlay templates, an array of frames where each frame is itself an array of modification objects."}
   * @paramDef {"type":"String","label":"Zoom","name":"zoom","uiComponent":{"type":"DROPDOWN","options":{"values":["Center","Top","Right","Bottom","Left"]}},"description":"Optional pan/zoom direction applied over the clip."}
   * @paramDef {"type":"String","label":"Trim Start Time","name":"trimStartTime","description":"Optional start time to trim the source clip, in HH:MM:SS format."}
   * @paramDef {"type":"String","label":"Trim End Time","name":"trimEndTime","description":"Optional end time to trim the source clip, in HH:MM:SS format."}
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","description":"Optional URL that Bannerbear POSTs the completed video object to when rendering finishes."}
   * @paramDef {"type":"String","label":"Metadata","name":"metadata","description":"Optional custom string stored alongside the video and echoed back on the object."}
   *
   * @returns {Object}
   * @sampleResult {"uid":"A89wELKp6vJxg","status":"pending","self":"https://api.bannerbear.com/v2/videos/A89wELKp6vJxg","video_template":"9k2wELMp6vJxgYbP","percent_rendered":0,"video_url":null,"created_at":"2026-07-14T12:00:00.000Z"}
   */
  async createVideo(videoTemplate, inputMediaUrl, modifications, frames, zoom, trimStartTime, trimEndTime, webhookUrl, metadata) {
    const logTag = '[createVideo]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/videos`,
      method: 'post',
      body: clean({
        video_template: videoTemplate,
        input_media_url: inputMediaUrl,
        modifications,
        frames,
        zoom: this.#resolveChoice(zoom, {
          Center: 'center',
          Top: 'top',
          Right: 'right',
          Bottom: 'bottom',
          Left: 'left',
        }),
        trim_start_time: trimStartTime,
        trim_end_time: trimEndTime,
        webhook_url: webhookUrl,
        metadata,
      }),
    })
  }

  /**
   * @operationName Get Video
   * @category Videos
   * @description Retrieves a single video by its uid, including its status, percent_rendered progress, and, once completed, the video_url (and transcription when applicable). Use this to poll for completion after Create Video.
   * @route GET /videos/{uid}
   * @appearanceColor #EF4E4E #F97070
   *
   * @paramDef {"type":"String","label":"Video UID","name":"uid","required":true,"description":"The uid of the video returned by Create Video."}
   *
   * @returns {Object}
   * @sampleResult {"uid":"A89wELKp6vJxg","status":"completed","percent_rendered":100,"video_url":"https://cdn.bannerbear.com/A89wELKp6vJxg.mp4","video_template":"9k2wELMp6vJxgYbP","created_at":"2026-07-14T12:00:00.000Z"}
   */
  async getVideo(uid) {
    const logTag = '[getVideo]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/videos/${ uid }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Collection
   * @category Collections
   * @description Renders a set of images in one call from a Bannerbear template set, applying the same modifications across every template in the set. Rendering is asynchronous: the response is a pending object with a uid; poll Get Collection for the per-template image_urls, or supply a webhook_url. Optionally output transparent PNGs and attach metadata.
   * @route POST /collections
   * @appearanceColor #EF4E4E #F97070
   * @executionTimeoutInSeconds 45
   *
   * @paramDef {"type":"String","label":"Template Set","name":"templateSet","required":true,"description":"UID of the Bannerbear template set to render."}
   * @paramDef {"type":"Array<Object>","label":"Modifications","name":"modifications","required":true,"description":"List of layer modifications applied across all templates in the set, same structure as image modifications (name plus text/image_url/color/etc.)."}
   * @paramDef {"type":"Boolean","label":"Transparent","name":"transparent","uiComponent":{"type":"CHECKBOX"},"description":"When true, render transparent PNGs. Defaults to false."}
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","description":"Optional URL that Bannerbear POSTs the completed collection object to when rendering finishes."}
   * @paramDef {"type":"String","label":"Metadata","name":"metadata","description":"Optional custom string stored alongside the collection and echoed back on the object."}
   *
   * @returns {Object}
   * @sampleResult {"uid":"Wy3Bae0PdkrbEQ8Vlz","status":"pending","self":"https://api.bannerbear.com/v2/collections/Wy3Bae0PdkrbEQ8Vlz","template_set":"7pMLxke0PdkrbEQVlz","image_urls":{},"created_at":"2026-07-14T12:00:00.000Z"}
   */
  async createCollection(templateSet, modifications, transparent, webhookUrl, metadata) {
    const logTag = '[createCollection]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/collections`,
      method: 'post',
      body: clean({
        template_set: templateSet,
        modifications: modifications || [],
        transparent: transparent === true ? true : undefined,
        webhook_url: webhookUrl,
        metadata,
      }),
    })
  }

  /**
   * @operationName Get Collection
   * @category Collections
   * @description Retrieves a single collection by its uid, including its status and, once completed, the image_urls object mapping each template in the set to its rendered image URL. Use this to poll for completion after Create Collection.
   * @route GET /collections/{uid}
   * @appearanceColor #EF4E4E #F97070
   *
   * @paramDef {"type":"String","label":"Collection UID","name":"uid","required":true,"description":"The uid of the collection returned by Create Collection."}
   *
   * @returns {Object}
   * @sampleResult {"uid":"Wy3Bae0PdkrbEQ8Vlz","status":"completed","template_set":"7pMLxke0PdkrbEQVlz","image_urls":{"jJWBKNELpQPvbX5R93Gk":"https://cdn.bannerbear.com/jJWBKNELpQPvbX5R93Gk.png"},"created_at":"2026-07-14T12:00:00.000Z"}
   */
  async getCollection(uid) {
    const logTag = '[getCollection]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/collections/${ uid }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Screenshot
   * @category Screenshots
   * @description Captures a screenshot of a public website URL. Rendering is asynchronous: the response is a pending object with a uid; poll Get Image is not used here — provide a webhook_url to be notified when the screenshot completes and returns its image_url. Optionally set viewport width/height and a mobile user agent.
   * @route POST /screenshots
   * @appearanceColor #EF4E4E #F97070
   * @executionTimeoutInSeconds 45
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Public website URL to capture."}
   * @paramDef {"type":"Number","label":"Width","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional viewport width in pixels."}
   * @paramDef {"type":"Number","label":"Height","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional viewport height in pixels."}
   * @paramDef {"type":"Boolean","label":"Mobile","name":"mobile","uiComponent":{"type":"CHECKBOX"},"description":"When true, use a mobile user agent. Defaults to false."}
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","description":"Optional URL that Bannerbear POSTs the completed screenshot object to when it finishes."}
   * @paramDef {"type":"String","label":"Metadata","name":"metadata","description":"Optional custom string stored alongside the screenshot and echoed back on the object."}
   *
   * @returns {Object}
   * @sampleResult {"uid":"kV3Bae0PdkrbEQ8Vlz","status":"pending","self":"https://api.bannerbear.com/v2/screenshots/kV3Bae0PdkrbEQ8Vlz","url":"https://example.com","screenshot_image_url":null,"created_at":"2026-07-14T12:00:00.000Z"}
   */
  async createScreenshot(url, width, height, mobile, webhookUrl, metadata) {
    const logTag = '[createScreenshot]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/screenshots`,
      method: 'post',
      body: clean({
        url,
        width,
        height,
        mobile: mobile === true ? true : undefined,
        webhook_url: webhookUrl,
        metadata,
      }),
    })
  }

  /**
   * @operationName Create Animated GIF
   * @category Animated GIFs
   * @description Renders an animated GIF from a Bannerbear template by supplying up to 30 frames, where each frame is an array of layer modifications. Rendering is asynchronous: the response is a pending object with a uid; poll or supply a webhook_url to be notified when the GIF completes and returns its image_url. Optionally set the frame rate, per-frame durations, and looping.
   * @route POST /animated_gifs
   * @appearanceColor #EF4E4E #F97070
   * @executionTimeoutInSeconds 45
   *
   * @paramDef {"type":"String","label":"Template","name":"template","required":true,"dictionary":"getTemplatesDictionary","description":"UID of the Bannerbear template to animate. Search and select a template, or paste a UID."}
   * @paramDef {"type":"Array<Object>","label":"Frames","name":"frames","required":true,"description":"Array of frames (max 30). Each frame is itself an array of modification objects, same structure as image modifications (name plus text/image_url/color/etc.)."}
   * @paramDef {"type":"Number","label":"FPS","name":"fps","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional frame rate for the GIF."}
   * @paramDef {"type":"Array<Number>","label":"Frame Durations","name":"frameDurations","description":"Optional array of per-frame durations. Overrides FPS when provided."}
   * @paramDef {"type":"Boolean","label":"Loop","name":"loop","uiComponent":{"type":"CHECKBOX"},"description":"When true, the GIF loops continuously. Defaults to false."}
   * @paramDef {"type":"String","label":"Input Media URL","name":"inputMediaUrl","description":"Optional source video URL to build the GIF from."}
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","description":"Optional URL that Bannerbear POSTs the completed GIF object to when it finishes."}
   * @paramDef {"type":"String","label":"Metadata","name":"metadata","description":"Optional custom string stored alongside the GIF and echoed back on the object."}
   *
   * @returns {Object}
   * @sampleResult {"uid":"gZ3Bae0PdkrbEQ8Vlz","status":"pending","self":"https://api.bannerbear.com/v2/animated_gifs/gZ3Bae0PdkrbEQ8Vlz","template":"jJWBKNELpQPvbX5R93Gk","image_url":null,"created_at":"2026-07-14T12:00:00.000Z"}
   */
  async createAnimatedGif(template, frames, fps, frameDurations, loop, inputMediaUrl, webhookUrl, metadata) {
    const logTag = '[createAnimatedGif]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/animated_gifs`,
      method: 'post',
      body: clean({
        template,
        frames: frames || [],
        fps,
        frame_durations: frameDurations,
        loop: loop === true ? true : undefined,
        input_media_url: inputMediaUrl,
        webhook_url: webhookUrl,
        metadata,
      }),
    })
  }

  /**
   * @operationName Get Account
   * @category Account
   * @description Retrieves the current project's account details, including quota usage, API calls consumed, plan, and paid status. Useful as a connection check to verify the API key is valid.
   * @route GET /account
   * @appearanceColor #EF4E4E #F97070
   *
   * @returns {Object}
   * @sampleResult {"created_at":"2026-01-01T00:00:00.000Z","paid":true,"uid":"pQvbX5R93GkjJWBKNEL","quota":30000,"usage":1420,"api_usage":1420,"project_name":"My Project"}
   */
  async getAccount() {
    const logTag = '[getAccount]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/account`,
      method: 'get',
    })
  }

  /**
   * @typedef {Object} getTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional partial template name to filter by."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number as a string) for fetching the next page of templates."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Templates Dictionary
   * @description Provides a searchable list of templates in the current project for selecting the Template parameter in Create Image, Get Template, and Create Animated GIF. The option value is the template uid; the label is the template name. Note that Get Template reveals the modification layer names for a selected template.
   * @route POST /get-templates-dictionary
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string and pagination cursor used to filter templates."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Social Post","value":"jJWBKNELpQPvbX5R93Gk","note":"1200x630"}],"cursor":"2"}
   */
  async getTemplatesDictionary(payload) {
    const logTag = '[getTemplatesDictionary]'
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) || 1 : 1
    const limit = 100

    const templates = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/templates`,
      method: 'get',
      query: {
        name: search,
        page,
        limit,
      },
    })

    const list = Array.isArray(templates) ? templates : []

    return {
      items: list.map(template => {
        const dimensions = template.width && template.height
          ? `${ template.width }x${ template.height }`
          : undefined

        return {
          label: template.name || template.uid,
          value: template.uid,
          note: dimensions,
        }
      }),
      cursor: list.length === limit ? String(page + 1) : undefined,
    }
  }
}

Flowrunner.ServerCode.addService(BannerbearService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Bannerbear Project API Key (sent as Authorization: Bearer). Find it in Bannerbear → your Project → Settings → API Key.',
  },
])
