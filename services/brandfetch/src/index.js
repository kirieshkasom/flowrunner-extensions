const logger = {
  info: (...args) => console.log('[Brandfetch] info:', ...args),
  debug: (...args) => console.log('[Brandfetch] debug:', ...args),
  error: (...args) => console.log('[Brandfetch] error:', ...args),
  warn: (...args) => console.log('[Brandfetch] warn:', ...args),
}

const API_BASE_URL = 'https://api.brandfetch.io/v2'

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
 * @integrationName Brandfetch
 * @integrationIcon /icon.png
 */
class BrandfetchService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.message || error.message

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`Brandfetch API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * Picks the first logo of a preferred type, falling back through the type
   * priority list, and returns the best format URL (prefers non-SVG raster for
   * portability, then SVG). Returns undefined when nothing usable exists.
   */
  #primaryLogoUrl(logos) {
    if (!Array.isArray(logos) || logos.length === 0) {
      return undefined
    }

    const typePriority = ['logo', 'symbol', 'icon', 'other']

    const pickFormat = formats => {
      if (!Array.isArray(formats) || formats.length === 0) {
        return undefined
      }

      const raster = formats.find(f => f.format && f.format !== 'svg')

      return (raster || formats[0]).src
    }

    for (const type of typePriority) {
      const match = logos.find(l => l.type === type)

      if (match) {
        const src = pickFormat(match.formats)

        if (src) {
          return src
        }
      }
    }

    return pickFormat(logos[0].formats)
  }

  /**
   * Returns the accent color hex if present, otherwise the first available color.
   */
  #primaryColor(colors) {
    if (!Array.isArray(colors) || colors.length === 0) {
      return undefined
    }

    const accent = colors.find(c => c.type === 'accent')

    return (accent || colors[0]).hex
  }

  /**
   * @operationName Get Brand
   * @category Brand
   * @description Retrieves the full brand profile for a company by its domain (e.g. "nike.com") or Brandfetch brand ID. Returns the complete Brandfetch record - name, domain, short and long descriptions, all logos (logo/symbol/icon/other) with their formats and download URLs, the color palette (accent/dark/light/brand with hex values), fonts, social and website links, images, industries, and company firmographics (employees, founded year, kind, location, financial identifiers). For convenience, also surfaces a flattened "primaryLogoUrl" and "primaryColor" so flows can grab the main brand assets without traversing the raw arrays. Accepts stock tickers, ISINs, and crypto symbols as identifiers too. Returns 404 if the brand is not found.
   * @route GET /brands
   * @appearanceColor #6E56CF #9E86FF
   *
   * @paramDef {"type":"String","label":"Domain or Brand ID","name":"domainOrId","required":true,"description":"The brand domain (e.g. \"nike.com\", \"stripe.com\") or a Brandfetch brand ID (e.g. \"id_0dwKPKT\"). Stock tickers, ISINs, and crypto symbols are also accepted."}
   * @paramDef {"type":"Boolean","label":"Allow NSFW","name":"allowNsfw","uiComponent":{"type":"CHECKBOX"},"description":"When true, returns brands regardless of NSFW status. When left off, some flagged brands may be filtered. Defaults to off."}
   *
   * @returns {Object}
   * @sampleResult {"primaryLogoUrl":"https://asset.brandfetch.io/nike.com/logo.svg","primaryColor":"#FF6B35","id":"id_0dwKPKT","name":"Nike","domain":"nike.com","claimed":true,"description":"Athletic footwear and apparel company","logos":[{"type":"logo","theme":"dark","formats":[{"src":"https://asset.brandfetch.io/nike.com/logo.svg","format":"svg","width":1200,"height":400,"size":3500}]}],"colors":[{"hex":"#FF6B35","type":"accent","brightness":120.3}],"fonts":[{"name":"Helvetica","type":"title","origin":"system"}],"links":[{"name":"twitter","url":"https://twitter.com/nike"}],"company":{"employees":10001,"foundedYear":1964,"kind":"PUBLIC_COMPANY","location":{"city":"Beaverton","countryCode":"US"}}}
   */
  async getBrand(domainOrId, allowNsfw) {
    const logTag = '[getBrand]'

    const brand = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/brands/${ encodeURIComponent(domainOrId) }`,
      method: 'get',
      query: {
        allowNsfw: allowNsfw === true ? true : undefined,
      },
    })

    return {
      primaryLogoUrl: this.#primaryLogoUrl(brand && brand.logos),
      primaryColor: this.#primaryColor(brand && brand.colors),
      ...brand,
    }
  }

  /**
   * @operationName Search Brands
   * @category Brand
   * @description Searches Brandfetch for brands matching a name or partial domain (e.g. "nike", "stripe"). Returns a list of matching brands, each with its Brandfetch brand ID, display name, primary domain, an icon URL, and a "claimed" flag indicating whether the brand owner has claimed the profile. Use a result's domain or brand ID with Get Brand to retrieve the full brand record. Returns an empty list when there are no matches.
   * @route GET /search
   * @appearanceColor #6E56CF #9E86FF
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The brand name or partial domain to search for (e.g. \"nike\", \"stripe\", \"airbnb\")."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"brandId":"id_0dwKPKT","name":"Nike","domain":"nike.com","icon":"https://asset.brandfetch.io/nike.com/icon.png","claimed":true}]
   */
  async searchBrands(query) {
    const logTag = '[searchBrands]'

    const results = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/search/${ encodeURIComponent(query) }`,
      method: 'get',
    })

    return Array.isArray(results) ? results : []
  }
}

Flowrunner.ServerCode.addService(BrandfetchService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Brandfetch Brand API key, sent as the Authorization: Bearer header. Get it from https://developers.brandfetch.com - register, then create an API key for the Brand API.',
  },
])
