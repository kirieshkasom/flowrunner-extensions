const logger = {
  info: (...args) => console.log('[YOURLS] info:', ...args),
  debug: (...args) => console.log('[YOURLS] debug:', ...args),
  error: (...args) => console.log('[YOURLS] error:', ...args),
  warn: (...args) => console.log('[YOURLS] warn:', ...args),
}

const FILTER_MAP = {
  Top: 'top',
  Bottom: 'bottom',
  Random: 'rand',
  Last: 'last',
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
 * @integrationName YOURLS
 * @integrationIcon /icon.svg
 */
class YOURLSService {
  constructor(config) {
    this.baseUrl = (config.url || '').trim().replace(/\/+$/, '')
    this.signature = config.signature
  }

  #endpoint() {
    return `${ this.baseUrl }/yourls-api.php`
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // All YOURLS operations hit the single yourls-api.php endpoint, authenticated with the
  // passwordless `signature` token, and select the operation via the `action` parameter.
  async #apiRequest({ action, params, logTag }) {
    const query = clean({
      ...params,
      action,
      signature: this.signature,
      format: 'json',
    })

    try {
      logger.debug(`${ logTag } - [GET::${ this.#endpoint() }] action=${ action }`)

      const response = await Flowrunner.Request.get(this.#endpoint()).query(query)

      // YOURLS answers with { status: 'success' | 'fail', code, message, statusCode, ... }.
      if (response && response.status === 'fail') {
        throw new Error(response.message || `YOURLS request failed (action=${ action })`)
      }

      return response
    } catch (error) {
      // A YOURLS install may reflect the error envelope inside the thrown error body.
      const body = error.body
      const message = (body && body.message) ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`YOURLS API error: ${ message }`)
    }
  }

  /**
   * @operationName Shorten URL
   * @category Links
   * @description Shortens a long URL on your YOURLS instance (action=shorturl). Optionally set a custom keyword (the short slug) and a title. If the long URL was already shortened, YOURLS returns the existing short URL instead of creating a duplicate; this operation surfaces that existing short link and the duplicate notice rather than failing. Returns the short URL, the resolved title, and the stored link details.
   * @route POST /shorten
   * @paramDef {"type":"String","label":"Long URL","name":"url","required":true,"description":"The destination URL to shorten, including the protocol (e.g. https://example.com/page)."}
   * @paramDef {"type":"String","label":"Custom Keyword","name":"keyword","description":"Optional custom short slug (the part after the domain). Leave empty to let YOURLS auto-generate one."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional title for the link. Leave empty to have YOURLS fetch the page title automatically."}
   * @returns {Object}
   * @sampleResult {"url":{"keyword":"abc","url":"https://example.com/page","title":"Example Page","date":"2026-07-14 10:00:00","ip":"203.0.113.7"},"status":"success","message":"https://example.com/page added to database","title":"Example Page","shorturl":"https://sho.rt/abc","statusCode":200}
   */
  async shortenUrl(url, keyword, title) {
    const logTag = '[shortenUrl]'
    const query = clean({
      ...{ url, keyword, title },
      action: 'shorturl',
      signature: this.signature,
      format: 'json',
    })

    try {
      logger.debug(`${ logTag } - [GET::${ this.#endpoint() }] action=shorturl`)

      const response = await Flowrunner.Request.get(this.#endpoint()).query(query)

      // A known-duplicate (code error:url) still returns the existing shorturl. Surface it
      // instead of hard-failing so callers can reuse the existing short link.
      if (response && response.status === 'fail') {
        if (response.code === 'error:url' && response.shorturl) {
          logger.info(`${ logTag } - URL already shortened, returning existing short link.`)

          return response
        }

        throw new Error(response.message || 'YOURLS shorturl request failed')
      }

      return response
    } catch (error) {
      const body = error.body
      const message = (body && body.message) ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`YOURLS API error: ${ message }`)
    }
  }

  /**
   * @operationName Expand Short URL
   * @category Links
   * @description Expands a YOURLS short URL back to its original long URL (action=expand). Accepts either the full short URL or just the keyword (short slug). Returns the original long URL along with the keyword and short URL.
   * @route GET /expand
   * @paramDef {"type":"String","label":"Short URL or Keyword","name":"shorturl","required":true,"description":"The short URL (e.g. https://sho.rt/abc) or just its keyword (e.g. abc) to expand."}
   * @returns {Object}
   * @sampleResult {"keyword":"abc","shorturl":"https://sho.rt/abc","longurl":"https://example.com/page","message":"success","statusCode":200}
   */
  async expandUrl(shorturl) {
    const logTag = '[expandUrl]'

    return await this.#apiRequest({
      logTag,
      action: 'expand',
      params: { shorturl },
    })
  }

  /**
   * @operationName Get URL Stats
   * @category Statistics
   * @description Retrieves click statistics for a single YOURLS short URL (action=url-stats). Accepts the short URL or its keyword. Returns a link object containing the total click count, creation timestamp, title, destination URL, and creator IP.
   * @route GET /url-stats
   * @paramDef {"type":"String","label":"Short URL or Keyword","name":"shorturl","required":true,"description":"The short URL (e.g. https://sho.rt/abc) or just its keyword (e.g. abc) to look up stats for."}
   * @returns {Object}
   * @sampleResult {"statusCode":200,"message":"success","link":{"shorturl":"https://sho.rt/abc","url":"https://example.com/page","title":"Example Page","timestamp":"2026-07-14 10:00:00","ip":"203.0.113.7","clicks":"42"}}
   */
  async getUrlStats(shorturl) {
    const logTag = '[getUrlStats]'

    return await this.#apiRequest({
      logTag,
      action: 'url-stats',
      params: { shorturl },
    })
  }

  /**
   * @operationName Get Stats
   * @category Statistics
   * @description Retrieves a ranked list of links from your YOURLS instance (action=stats). Filter by the most clicked (Top), least clicked (Bottom), a random selection (Random), or the most recently created (Last), and limit how many links are returned. Also returns overall totals for links and clicks.
   * @route GET /stats
   * @paramDef {"type":"String","label":"Filter","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["Top","Bottom","Random","Last"]}},"description":"How to rank the returned links: Top (most clicks), Bottom (fewest clicks), Random, or Last (most recently created). Defaults to Top."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of links to return. Defaults to 10."}
   * @returns {Object}
   * @sampleResult {"stats":{"total_links":"128","total_clicks":"4096"},"links":{"link_1":{"shorturl":"https://sho.rt/abc","url":"https://example.com/page","title":"Example Page","timestamp":"2026-07-14 10:00:00","ip":"203.0.113.7","clicks":"42"}},"statusCode":200,"message":"success"}
   */
  async getStats(filter, limit) {
    const logTag = '[getStats]'

    return await this.#apiRequest({
      logTag,
      action: 'stats',
      params: {
        filter: this.#resolveChoice(filter, FILTER_MAP) || 'top',
        limit: limit === undefined || limit === null ? 10 : limit,
      },
    })
  }

  /**
   * @operationName Get Database Stats
   * @category Statistics
   * @description Retrieves global statistics for your entire YOURLS instance (action=db-stats): the total number of shortened links and the total number of clicks across all links.
   * @route GET /db-stats
   * @returns {Object}
   * @sampleResult {"db-stats":{"total_links":"128","total_clicks":"4096"},"statusCode":200,"message":"success"}
   */
  async getDbStats() {
    const logTag = '[getDbStats]'

    return await this.#apiRequest({
      logTag,
      action: 'db-stats',
      params: {},
    })
  }
}

Flowrunner.ServerCode.addService(YOURLSService, [
  {
    name: 'url',
    displayName: 'Install URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your YOURLS install URL, e.g. https://sho.rt (strip any trailing slash). The API endpoint yourls-api.php is appended automatically.',
  },
  {
    name: 'signature',
    displayName: 'Signature Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your YOURLS signature token for passwordless API access. Find it in YOURLS admin under Tools > Secure passwordless API.',
  },
])
