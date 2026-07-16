const logger = {
  info: (...args) => console.log('[QuickChart] info:', ...args),
  debug: (...args) => console.log('[QuickChart] debug:', ...args),
  error: (...args) => console.log('[QuickChart] error:', ...args),
  warn: (...args) => console.log('[QuickChart] warn:', ...args),
}

const BASE_URL = 'https://quickchart.io'

const FORMAT_MAP = { PNG: 'png', SVG: 'svg', WebP: 'webp' }

/**
 * Returns only the entries of an object whose values are set (not undefined,
 * null, or empty string). Keeps request bodies and query strings clean.
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

/**
 * @integrationName QuickChart
 * @integrationIcon /icon.png
 */
class QuickChartService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  /**
   * Maps a friendly dropdown label to the API value. Falls back to the raw
   * value when the label is not present in the mapping.
   */
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * Single private request helper. All outbound HTTP goes through here.
   * Returns the response body directly (Flowrunner.Request does not wrap it).
   */
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Content-Type': 'application/json' })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.message || error.response?.body?.message || error.message

      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`QuickChart API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Create Chart
   * @category Charts
   * @description Renders a Chart.js configuration on QuickChart's servers and returns a short, hosted image URL you can embed or share. This is the flagship operation and the recommended path for anything beyond a trivial chart, because the config travels in the POST body (no URL length limit). The "chart" parameter is a full Chart.js config object with "type" (bar, line, pie, doughnut, radar, scatter, bubble, polarArea, radialGauge, etc.), "data" ({labels, datasets}), and optional "options". Supports width, height, output format (PNG/SVG/WebP), background color, device pixel ratio (1 or 2 for retina), and Chart.js version (2 or 4). Free-tier short URLs expire after ~3 days; paid API keys extend this and remove the watermark. Returns success:true with the hosted URL, or success:false with an error when the config is invalid.
   * @route POST /chart/create
   * @appearanceColor #FF6384 #FF9FB5
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"Object","label":"Chart Config","name":"chart","required":true,"description":"Chart.js configuration object, e.g. {\"type\":\"bar\",\"data\":{\"labels\":[\"Q1\",\"Q2\"],\"datasets\":[{\"label\":\"Sales\",\"data\":[50,80]}]}}. A JSON string is also accepted."}
   * @paramDef {"type":"Number","label":"Width","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Image width in pixels (default 500)."}
   * @paramDef {"type":"Number","label":"Height","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Image height in pixels (default 300)."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["PNG","SVG","WebP"]}},"description":"Output image format. Defaults to PNG."}
   * @paramDef {"type":"String","label":"Background Color","name":"backgroundColor","description":"Canvas background as a color name, hex, rgb, or hsl (e.g. white, #ffffff, transparent). Defaults to transparent."}
   * @paramDef {"type":"Number","label":"Device Pixel Ratio","name":"devicePixelRatio","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pixel density: 1 for normal, 2 for retina/high-DPI. Defaults to 2."}
   * @paramDef {"type":"String","label":"Chart.js Version","name":"version","uiComponent":{"type":"DROPDOWN","options":{"values":["2","4"]}},"description":"Chart.js major version to render with. Defaults to 2; use 4 for the latest features."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"url":"https://quickchart.io/chart/render/zf-a1b2c3d4-5e6f-7890-abcd-ef1234567890"}
   */
  async createChart(chart, width, height, format, backgroundColor, devicePixelRatio, version) {
    const logTag = '[createChart]'

    const body = clean({
      chart,
      width,
      height,
      format: this.#resolveChoice(format, FORMAT_MAP),
      backgroundColor,
      devicePixelRatio,
      version,
      key: this.apiKey,
    })

    const response = await this.#apiRequest({
      logTag,
      url: `${ BASE_URL }/chart/create`,
      method: 'post',
      body,
    })

    if (response && response.success === false) {
      const message = response.error || response.message || 'Invalid chart configuration'

      logger.error(`${ logTag } - QuickChart rejected the config: ${ message }`)

      throw new Error(`QuickChart API error: ${ message }`)
    }

    return response
  }

  /**
   * @operationName Get Chart Image URL
   * @category Charts
   * @description Builds a direct GET image URL for a Chart.js configuration WITHOUT making any network call, so it returns instantly. The chart renders on demand when the URL is loaded (in a browser, img tag, email, etc.). Use this for simple embeds. Because the entire config is URL-encoded into the "c" query parameter, very large or complex configs can exceed URL length limits — in that case use Create Chart, which POSTs the config and returns a short URL. Supports width, height, output format (PNG/SVG/WebP), and background color. An API key, if configured, is appended as the "key" query parameter.
   * @route GET /chart-url
   * @appearanceColor #FF6384 #FF9FB5
   *
   * @paramDef {"type":"Object","label":"Chart Config","name":"chart","required":true,"description":"Chart.js configuration object, e.g. {\"type\":\"line\",\"data\":{\"labels\":[\"A\",\"B\"],\"datasets\":[{\"data\":[1,2]}]}}. A JSON string is also accepted."}
   * @paramDef {"type":"Number","label":"Width","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Image width in pixels (default 500)."}
   * @paramDef {"type":"Number","label":"Height","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Image height in pixels (default 300)."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["PNG","SVG","WebP"]}},"description":"Output image format. Defaults to PNG."}
   * @paramDef {"type":"String","label":"Background Color","name":"backgroundColor","description":"Canvas background as a color name, hex, rgb, or hsl (e.g. white, #ffffff, transparent). Defaults to transparent."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://quickchart.io/chart?c=%7B%22type%22%3A%22bar%22%2C%22data%22%3A%7B%22labels%22%3A%5B%22Q1%22%5D%2C%22datasets%22%3A%5B%7B%22data%22%3A%5B50%5D%7D%5D%7D%7D&w=500&h=300"}
   */
  async getChartImageUrl(chart, width, height, format, backgroundColor) {
    const logTag = '[getChartImageUrl]'

    logger.debug(`${ logTag } - building direct chart URL`)

    const config = typeof chart === 'string' ? chart : JSON.stringify(chart)

    const params = [`c=${ encodeURIComponent(config) }`]

    if (width !== undefined && width !== null && width !== '') {
      params.push(`w=${ encodeURIComponent(width) }`)
    }

    if (height !== undefined && height !== null && height !== '') {
      params.push(`h=${ encodeURIComponent(height) }`)
    }

    const resolvedFormat = this.#resolveChoice(format, FORMAT_MAP)

    if (resolvedFormat) {
      params.push(`f=${ encodeURIComponent(resolvedFormat) }`)
    }

    if (backgroundColor !== undefined && backgroundColor !== null && backgroundColor !== '') {
      params.push(`bkg=${ encodeURIComponent(backgroundColor) }`)
    }

    if (this.apiKey) {
      params.push(`key=${ encodeURIComponent(this.apiKey) }`)
    }

    return { url: `${ BASE_URL }/chart?${ params.join('&') }` }
  }

  /**
   * @operationName Create QR Code
   * @category Codes
   * @description Builds a direct GET image URL for a QR code encoding any text or URL, without a network call so it returns instantly. The QR renders when the URL is loaded. Supports pixel size, output format (PNG/SVG), quiet-zone margin, foreground (dark) and background (light) colors, error-correction level (L/M/Q/H), and an optional caption. For very long payloads or advanced styling you can POST to QuickChart's /qr endpoint instead; this operation returns a stable, embeddable GET URL.
   * @route GET /qr-url
   * @appearanceColor #22A699 #5FD3C6
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text or URL to encode in the QR code."}
   * @paramDef {"type":"Number","label":"Size","name":"size","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Width and height of the square QR image in pixels (default 150)."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["PNG","SVG"]}},"description":"Output image format. Defaults to PNG."}
   * @paramDef {"type":"Number","label":"Margin","name":"margin","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Quiet-zone whitespace around the code, in modules (default 4)."}
   * @paramDef {"type":"String","label":"Dark Color","name":"dark","description":"Foreground (module) color as a hex code, e.g. 000000. Defaults to black."}
   * @paramDef {"type":"String","label":"Light Color","name":"light","description":"Background color as a hex code, e.g. ffffff. Defaults to white."}
   * @paramDef {"type":"String","label":"Error Correction Level","name":"ecLevel","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","Quartile","High"]}},"description":"Error-correction level; higher tolerates more damage but stores less. Defaults to Medium."}
   * @paramDef {"type":"String","label":"Caption","name":"caption","description":"Optional text caption rendered beneath the QR code."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://quickchart.io/qr?text=https%3A%2F%2Fexample.com&size=150&format=png"}
   */
  async createQrCode(text, size, format, margin, dark, light, ecLevel, caption) {
    const logTag = '[createQrCode]'

    logger.debug(`${ logTag } - building QR code URL`)

    const params = [`text=${ encodeURIComponent(text) }`]

    if (size !== undefined && size !== null && size !== '') {
      params.push(`size=${ encodeURIComponent(size) }`)
    }

    const resolvedFormat = this.#resolveChoice(format, { PNG: 'png', SVG: 'svg' })

    if (resolvedFormat) {
      params.push(`format=${ encodeURIComponent(resolvedFormat) }`)
    }

    if (margin !== undefined && margin !== null && margin !== '') {
      params.push(`margin=${ encodeURIComponent(margin) }`)
    }

    if (dark) {
      params.push(`dark=${ encodeURIComponent(dark) }`)
    }

    if (light) {
      params.push(`light=${ encodeURIComponent(light) }`)
    }

    const resolvedEc = this.#resolveChoice(ecLevel, { Low: 'L', Medium: 'M', Quartile: 'Q', High: 'H' })

    if (resolvedEc) {
      params.push(`ecLevel=${ encodeURIComponent(resolvedEc) }`)
    }

    if (caption) {
      params.push(`caption=${ encodeURIComponent(caption) }`)
    }

    return { url: `${ BASE_URL }/qr?${ params.join('&') }` }
  }

  /**
   * @operationName Create Barcode
   * @category Codes
   * @description Builds a direct GET image URL for a 1D or 2D barcode without a network call, returning instantly. The barcode renders when the URL is loaded. Supports many symbologies (Code 128, Code 39, EAN-13, EAN-8, UPC-A, UPC-E, ITF-14, Data Matrix, PDF417, and more), the data to encode, pixel width and height, and whether to render the human-readable text label. Note that requested width and height are approximate for some symbologies due to their fixed module specifications.
   * @route GET /barcode-url
   * @appearanceColor #22A699 #5FD3C6
   *
   * @paramDef {"type":"String","label":"Barcode Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Code 128","Code 39","EAN-13","EAN-8","UPC-A","UPC-E","ITF-14","Data Matrix","PDF417","QR Code"]}},"description":"Barcode symbology to generate. Defaults to Code 128."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"description":"The data to encode in the barcode."}
   * @paramDef {"type":"Number","label":"Width","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Approximate barcode width in pixels."}
   * @paramDef {"type":"Number","label":"Height","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Approximate barcode height in pixels."}
   * @paramDef {"type":"Boolean","label":"Include Text","name":"includeText","uiComponent":{"type":"CHECKBOX"},"description":"Whether to render the human-readable text label under the barcode. Defaults to true."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://quickchart.io/barcode?type=code128&text=ABC-123&width=300&height=100"}
   */
  async createBarcode(type, text, width, height, includeText) {
    const logTag = '[createBarcode]'

    logger.debug(`${ logTag } - building barcode URL`)

    const resolvedType = this.#resolveChoice(type, {
      'Code 128': 'code128',
      'Code 39': 'code39',
      'EAN-13': 'ean13',
      'EAN-8': 'ean8',
      'UPC-A': 'upca',
      'UPC-E': 'upce',
      'ITF-14': 'itf14',
      'Data Matrix': 'datamatrix',
      'PDF417': 'pdf417',
      'QR Code': 'qrcode',
    }) || 'code128'

    const params = [
      `type=${ encodeURIComponent(resolvedType) }`,
      `text=${ encodeURIComponent(text) }`,
    ]

    if (width !== undefined && width !== null && width !== '') {
      params.push(`width=${ encodeURIComponent(width) }`)
    }

    if (height !== undefined && height !== null && height !== '') {
      params.push(`height=${ encodeURIComponent(height) }`)
    }

    if (includeText !== undefined && includeText !== null && includeText !== '') {
      params.push(`includetext=${ includeText ? 'true' : 'false' }`)
    }

    return { url: `${ BASE_URL }/barcode?${ params.join('&') }` }
  }

  /**
   * @operationName Create Word Cloud
   * @category Charts
   * @description Builds a direct GET image URL for a word cloud generated from a block of text, without a network call so it returns instantly. The image renders when the URL is loaded, and word sizing reflects each word's frequency in the text. Supports output format (PNG/SVG), width and height, background color, font family, a scale mode (linear, square root, logarithmic) for sizing, maximum number of words, minimum word length, letter case, and optional stop-word removal. Useful for summarizing survey responses, reviews, or documents visually. For very long text that would exceed URL length limits, POST to QuickChart's /wordcloud endpoint directly.
   * @route GET /wordcloud-url
   * @appearanceColor #FF6384 #FF9FB5
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The source text to build the word cloud from."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["PNG","SVG"]}},"description":"Output image format. Defaults to PNG."}
   * @paramDef {"type":"Number","label":"Width","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Image width in pixels (default 600)."}
   * @paramDef {"type":"Number","label":"Height","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Image height in pixels (default 600)."}
   * @paramDef {"type":"String","label":"Background Color","name":"backgroundColor","description":"Background as a color name, hex, rgb, or hsl (e.g. white, #ffffff). Defaults to transparent."}
   * @paramDef {"type":"String","label":"Font Family","name":"fontFamily","description":"Font family for the words (e.g. serif, sans-serif). Defaults to serif."}
   * @paramDef {"type":"String","label":"Scale","name":"scale","uiComponent":{"type":"DROPDOWN","options":{"values":["Linear","Square Root","Logarithmic"]}},"description":"How word frequency maps to size. Defaults to Linear."}
   * @paramDef {"type":"Number","label":"Max Words","name":"maxNumWords","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of words to include (default 200)."}
   * @paramDef {"type":"Number","label":"Min Word Length","name":"minWordLength","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Ignore words shorter than this many characters (default 1)."}
   * @paramDef {"type":"String","label":"Case","name":"case","uiComponent":{"type":"DROPDOWN","options":{"values":["Lower","Upper","Original"]}},"description":"Case transform applied to words. Defaults to Lower."}
   * @paramDef {"type":"Boolean","label":"Remove Stop Words","name":"removeStopwords","uiComponent":{"type":"CHECKBOX"},"description":"Remove common stop words (the, and, of, ...). Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://quickchart.io/wordcloud?text=hello+world+data+chart&format=png&width=600&height=600"}
   */
  async createWordCloud(text, format, width, height, backgroundColor, fontFamily, scale, maxNumWords, minWordLength, wordCase, removeStopwords) {
    const logTag = '[createWordCloud]'

    logger.debug(`${ logTag } - building word cloud URL`)

    const params = [`text=${ encodeURIComponent(text) }`]

    const resolvedFormat = this.#resolveChoice(format, { PNG: 'png', SVG: 'svg' })

    if (resolvedFormat) {
      params.push(`format=${ encodeURIComponent(resolvedFormat) }`)
    }

    if (width !== undefined && width !== null && width !== '') {
      params.push(`width=${ encodeURIComponent(width) }`)
    }

    if (height !== undefined && height !== null && height !== '') {
      params.push(`height=${ encodeURIComponent(height) }`)
    }

    if (backgroundColor) {
      params.push(`backgroundColor=${ encodeURIComponent(backgroundColor) }`)
    }

    if (fontFamily) {
      params.push(`fontFamily=${ encodeURIComponent(fontFamily) }`)
    }

    const resolvedScale = this.#resolveChoice(scale, { 'Linear': 'linear', 'Square Root': 'sqrt', 'Logarithmic': 'log' })

    if (resolvedScale) {
      params.push(`scale=${ encodeURIComponent(resolvedScale) }`)
    }

    if (maxNumWords !== undefined && maxNumWords !== null && maxNumWords !== '') {
      params.push(`maxNumWords=${ encodeURIComponent(maxNumWords) }`)
    }

    if (minWordLength !== undefined && minWordLength !== null && minWordLength !== '') {
      params.push(`minWordLength=${ encodeURIComponent(minWordLength) }`)
    }

    const resolvedCase = this.#resolveChoice(wordCase, { Lower: 'lower', Upper: 'upper', Original: 'none' })

    if (resolvedCase) {
      params.push(`case=${ encodeURIComponent(resolvedCase) }`)
    }

    if (removeStopwords !== undefined && removeStopwords !== null && removeStopwords !== '') {
      params.push(`removeStopwords=${ removeStopwords ? 'true' : 'false' }`)
    }

    if (this.apiKey) {
      params.push(`key=${ encodeURIComponent(this.apiKey) }`)
    }

    return { url: `${ BASE_URL }/wordcloud?${ params.join('&') }` }
  }
}

Flowrunner.ServerCode.addService(QuickChartService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional QuickChart API key (from quickchart.io) for higher rate limits and no watermark. Leave blank to use the free tier.',
  },
])
