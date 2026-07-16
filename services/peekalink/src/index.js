const logger = {
  info: (...args) => console.log('[Peekalink] info:', ...args),
  debug: (...args) => console.log('[Peekalink] debug:', ...args),
  error: (...args) => console.log('[Peekalink] error:', ...args),
  warn: (...args) => console.log('[Peekalink] warn:', ...args),
}

const API_BASE_URL = 'https://api.peekalink.io'

/**
 * @integrationName Peekalink
 * @integrationIcon /icon.svg
 */
class PeekalinkService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'post', body, logTag }) {
    try {
      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url).set({
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      })

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.message || error.message

      logger.error(`${ logTag } - Request failed (${ status || 'unknown' }): ${ message }`)

      if (status === 401) {
        throw new Error('Peekalink API error: invalid or missing API key (401).')
      }

      if (status === 429) {
        throw new Error('Peekalink API error: rate limit exceeded (429). Wait and retry, or upgrade your plan for a higher hourly quota.')
      }

      throw new Error(`Peekalink API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Preview Link
   * @category Link Preview
   * @description Generates a rich preview for a single URL. Returns core metadata (title, description, url, domain, type, size, contentType, redirected, updatedAt) plus a main image and favicon when available. For recognized services (YouTube, Twitter/X, Reddit, Amazon, and more) a type-specific details object is included with platform data such as video, author, or product information. Use Check Availability first if you want to confirm a link is previewable before spending a request.
   * @route POST /preview
   * @appearanceColor #000000 #4A4A4A
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Link","name":"link","required":true,"description":"The full URL to generate a preview for, including the scheme (e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ)."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"ok":true,"url":"https://www.youtube.com/watch?v=abc123","domain":"youtube.com","type":"youtube","status":200,"updatedAt":"2026-07-13T10:00:00.000Z","size":123456,"redirected":false,"title":"Sample Video Title","description":"A short description of the linked page.","name":"YouTube","trackersDetected":false,"contentType":"text/html","mimeType":"text/html","image":{"url":"https://cdn.peekalink.io/image.jpg","width":1280,"height":720},"favicon":{"url":"https://cdn.peekalink.io/favicon.png","width":32,"height":32},"details":{"type":"youtube","youtube":{"id":"abc123","duration":213,"channelName":"Example Channel"}}}
   */
  async previewLink(link) {
    const logTag = '[previewLink]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/`,
      method: 'post',
      body: { link },
    })
  }

  /**
   * @operationName Check Availability
   * @category Link Preview
   * @description Checks whether Peekalink can generate a preview for a URL without generating the full preview. Returns a single boolean, isAvailable. Useful as an inexpensive pre-check before calling Preview Link, for validating user-submitted links, or for filtering a batch of URLs down to those that will resolve.
   * @route POST /is-available
   * @appearanceColor #000000 #4A4A4A
   *
   * @paramDef {"type":"String","label":"Link","name":"link","required":true,"description":"The full URL to check for preview availability, including the scheme (e.g. https://example.com)."}
   *
   * @returns {Object}
   * @sampleResult {"isAvailable":true}
   */
  async checkAvailability(link) {
    const logTag = '[checkAvailability]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/is-available`,
      method: 'post',
      body: { link },
    })
  }
}

Flowrunner.ServerCode.addService(PeekalinkService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Peekalink API key (sent as the X-API-Key header). Find it in your Peekalink account under the API key section.',
  },
])
