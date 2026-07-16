const logger = {
  info: (...args) => console.log('[One Simple API] info:', ...args),
  debug: (...args) => console.log('[One Simple API] debug:', ...args),
  error: (...args) => console.log('[One Simple API] error:', ...args),
  warn: (...args) => console.log('[One Simple API] warn:', ...args),
}

const API_BASE_URL = 'https://onesimpleapi.com/api'

const OUTPUT_MAPPING = { JSON: 'json', Inline: 'inline' }

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
 * @integrationName One Simple API
 * @integrationIcon /icon.png
 */
class OneSimpleApiService {
  constructor(config) {
    this.token = config.token
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ path, query, logTag }) {
    const url = `${ API_BASE_URL }${ path }`

    try {
      const cleanedQuery = clean({ ...query, token: this.token })

      logger.debug(`${ logTag } - API request: [GET::${ url }]`)

      const response = await Flowrunner.Request.get(url).query(cleanedQuery)

      if (response && response.success === false) {
        throw new Error(`One Simple API error: ${ response.message || response.error || 'Unknown error' }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('One Simple API error:')) {
        throw error
      }

      const status = error.status || error.statusCode
      const message = error.body?.message || error.body?.error ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - Request failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`One Simple API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Take Screenshot
   * @category Website
   * @description Captures a screenshot of a public web page and returns it. Control the viewport width and height, choose whether to capture the entire scrollable page (full page) or just the visible viewport, and select the output format (JSON returns a hosted image URL, Inline returns the raw image). Useful for archiving, previews, and monitoring visual changes.
   * @route GET /screenshot
   * @appearanceColor #1B2A5B #34497F
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Public URL of the web page to capture (must include http:// or https://)."}
   * @paramDef {"type":"String","label":"Output","name":"output","uiComponent":{"type":"DROPDOWN","options":{"values":["JSON","Inline"]}},"description":"Response format. JSON returns a hosted image URL; Inline returns the raw image data. Defaults to JSON."}
   * @paramDef {"type":"Number","label":"Width","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Viewport width in pixels (e.g. 1920). Optional."}
   * @paramDef {"type":"Number","label":"Height","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Viewport height in pixels (e.g. 1080). Optional."}
   * @paramDef {"type":"Boolean","label":"Full Page","name":"fullPage","uiComponent":{"type":"CHECKBOX"},"description":"Capture the entire scrollable page instead of just the visible viewport. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"result":{"url":"https://example.com","image":"https://cdn.onesimpleapi.com/screenshots/abc123.png"}}
   */
  async takeScreenshot(url, output, width, height, fullPage) {
    const logTag = '[takeScreenshot]'

    return await this.#apiRequest({
      logTag,
      path: '/screenshot',
      query: {
        url,
        output: this.#resolveChoice(output, OUTPUT_MAPPING) || 'json',
        width,
        height,
        full_page: fullPage === true ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Generate PDF From URL
   * @category Website
   * @description Renders a public web page and returns it as a PDF document. Choose the output format (JSON returns a hosted PDF URL, Inline returns the raw PDF). Useful for generating printable snapshots, invoices, or reports from live pages.
   * @route GET /pdf
   * @appearanceColor #1B2A5B #34497F
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Public URL of the web page to render as a PDF (must include http:// or https://)."}
   * @paramDef {"type":"String","label":"Output","name":"output","uiComponent":{"type":"DROPDOWN","options":{"values":["JSON","Inline"]}},"description":"Response format. JSON returns a hosted PDF URL; Inline returns the raw PDF data. Defaults to JSON."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"result":{"url":"https://example.com","pdf":"https://cdn.onesimpleapi.com/pdf/abc123.pdf"}}
   */
  async generatePdfFromUrl(url, output) {
    const logTag = '[generatePdfFromUrl]'

    return await this.#apiRequest({
      logTag,
      path: '/pdf',
      query: {
        url,
        output: this.#resolveChoice(output, OUTPUT_MAPPING) || 'json',
      },
    })
  }

  /**
   * @operationName Generate QR Code
   * @category Utility
   * @description Generates a QR code image encoding the provided value (a URL, text, phone number, etc.). Control the image size in pixels and choose the output format (JSON returns a hosted image URL, Inline returns the raw image).
   * @route GET /qr_code
   * @appearanceColor #1B2A5B #34497F
   *
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The data to encode in the QR code (URL, text, phone number, etc.)."}
   * @paramDef {"type":"Number","label":"Size","name":"size","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output image size in pixels (square). Optional; defaults to the provider default."}
   * @paramDef {"type":"String","label":"Output","name":"output","uiComponent":{"type":"DROPDOWN","options":{"values":["JSON","Inline"]}},"description":"Response format. JSON returns a hosted image URL; Inline returns the raw image data. Defaults to JSON."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"result":{"value":"https://example.com","image":"https://cdn.onesimpleapi.com/qr/abc123.png"}}
   */
  async generateQrCode(value, size, output) {
    const logTag = '[generateQrCode]'

    return await this.#apiRequest({
      logTag,
      path: '/qr_code',
      query: {
        value,
        size,
        output: this.#resolveChoice(output, OUTPUT_MAPPING) || 'json',
      },
    })
  }

  /**
   * @operationName Convert Currency
   * @category Information
   * @description Converts a numeric amount from one currency to another using live exchange rates. Returns the converted amount and the exchange rate applied. Use Get Currency List to discover valid currency codes.
   * @route GET /exchange_rate
   * @appearanceColor #1B2A5B #34497F
   *
   * @paramDef {"type":"String","label":"From Currency","name":"from","required":true,"description":"Source ISO 4217 currency code, e.g. USD."}
   * @paramDef {"type":"String","label":"To Currency","name":"to","required":true,"description":"Target ISO 4217 currency code, e.g. EUR."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount in the source currency to convert. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"result":{"from":"USD","to":"EUR","amount":100,"rate":0.92,"converted":92}}
   */
  async convertCurrency(from, to, amount) {
    const logTag = '[convertCurrency]'

    return await this.#apiRequest({
      logTag,
      path: '/exchange_rate',
      query: {
        from,
        to,
        amount: amount !== undefined && amount !== null ? amount : 1,
      },
    })
  }

  /**
   * @operationName Get Currency List
   * @category Information
   * @description Returns the list of currencies supported by the exchange rate service, including their ISO 4217 codes and names. Use these codes with Convert Currency.
   * @route GET /currencies
   * @appearanceColor #1B2A5B #34497F
   *
   * @returns {Object}
   * @sampleResult {"success":true,"result":{"currencies":[{"code":"USD","name":"United States Dollar"},{"code":"EUR","name":"Euro"}]}}
   */
  async getCurrencyList() {
    const logTag = '[getCurrencyList]'

    return await this.#apiRequest({
      logTag,
      path: '/currencies',
      query: {},
    })
  }

  /**
   * @operationName Validate Email
   * @category Utility
   * @description Validates an email address, checking its syntax, domain, and mailbox deliverability signals. Returns validity indicators such as whether the address is well formed, the domain has valid MX records, and whether it is a disposable or free provider.
   * @route GET /email_validation
   * @appearanceColor #1B2A5B #34497F
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address to validate."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"result":{"email":"user@example.com","valid":true,"format_valid":true,"mx_found":true,"disposable":false,"free":false}}
   */
  async validateEmail(email) {
    const logTag = '[validateEmail]'

    return await this.#apiRequest({
      logTag,
      path: '/email_validation',
      query: { email },
    })
  }

  /**
   * @operationName Check Domain Expiry
   * @category Website
   * @description Checks a website's domain registration expiry and SSL certificate expiry dates from its URL. Returns the domain expiry date, the SSL certificate expiry date, and related registration details. Useful for monitoring renewals and avoiding downtime.
   * @route GET /expiry
   * @appearanceColor #1B2A5B #34497F
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Website URL or domain to check (e.g. https://example.com or example.com)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"result":{"url":"https://example.com","domain":"example.com","domain_expiry":"2027-08-13","ssl_expiry":"2026-11-01"}}
   */
  async checkDomainExpiry(url) {
    const logTag = '[checkDomainExpiry]'

    return await this.#apiRequest({
      logTag,
      path: '/expiry',
      query: { url },
    })
  }

  /**
   * @operationName Expand URL
   * @category Utility
   * @description Expands a shortened URL (e.g. bit.ly, t.co) to its final destination by following redirects. Returns the resolved long URL.
   * @route GET /url_expand
   * @appearanceColor #1B2A5B #34497F
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The shortened URL to expand (must include http:// or https://)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"result":{"short_url":"https://bit.ly/abc","expanded_url":"https://example.com/long/destination/page"}}
   */
  async expandUrl(url) {
    const logTag = '[expandUrl]'

    return await this.#apiRequest({
      logTag,
      path: '/url_expand',
      query: { url },
    })
  }

  /**
   * @operationName Shorten URL
   * @category Utility
   * @description Shortens a long URL into a compact short link. Returns the generated short URL. Note: this endpoint may not be available on all One Simple API plans.
   * @route GET /url_shorten
   * @appearanceColor #1B2A5B #34497F
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The long URL to shorten (must include http:// or https://)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"result":{"long_url":"https://example.com/long/destination/page","short_url":"https://osa.link/abc"}}
   */
  async shortenUrl(url) {
    const logTag = '[shortenUrl]'

    return await this.#apiRequest({
      logTag,
      path: '/url_shorten',
      query: { url },
    })
  }

  /**
   * @operationName Get Image Info
   * @category Information
   * @description Retrieves metadata about an image from its URL, such as dimensions (width and height), format/MIME type, and file size. Useful for validating and inspecting remote images before processing them.
   * @route GET /image_info
   * @appearanceColor #1B2A5B #34497F
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Public URL of the image to inspect (must include http:// or https://)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"result":{"url":"https://example.com/photo.jpg","width":1920,"height":1080,"mime":"image/jpeg","size":248310}}
   */
  async getImageInfo(url) {
    const logTag = '[getImageInfo]'

    return await this.#apiRequest({
      logTag,
      path: '/image_info',
      query: { url },
    })
  }

  /**
   * @operationName Get Video Info
   * @category Information
   * @description Retrieves metadata about a video from its URL, such as title, duration, dimensions, and thumbnails. Note: this endpoint may not be available on all One Simple API plans.
   * @route GET /video_info
   * @appearanceColor #1B2A5B #34497F
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Public URL of the video to inspect (must include http:// or https://)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"result":{"url":"https://example.com/clip.mp4","title":"Clip","duration":42.5,"width":1280,"height":720}}
   */
  async getVideoInfo(url) {
    const logTag = '[getVideoInfo]'

    return await this.#apiRequest({
      logTag,
      path: '/video_info',
      query: { url },
    })
  }

  /**
   * @operationName Check Website Status
   * @category Website
   * @description Checks whether a website is currently up or down and reports the HTTP response time. Returns the status (up/down), HTTP status code, and response time in milliseconds. Useful for uptime monitoring.
   * @route GET /website_status
   * @appearanceColor #1B2A5B #34497F
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Website URL to check (must include http:// or https://)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"result":{"url":"https://example.com","status":"up","status_code":200,"response_time":184}}
   */
  async checkWebsiteStatus(url) {
    const logTag = '[checkWebsiteStatus]'

    return await this.#apiRequest({
      logTag,
      path: '/website_status',
      query: { url },
    })
  }
}

Flowrunner.ServerCode.addService(OneSimpleApiService, [
  {
    name: 'token',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your One Simple API token, sent as the token query parameter. Get it from One Simple API → Dashboard → your API token.',
  },
])
