const logger = {
  info: (...args) => console.log('[npm Registry] info:', ...args),
  debug: (...args) => console.log('[npm Registry] debug:', ...args),
  error: (...args) => console.log('[npm Registry] error:', ...args),
  warn: (...args) => console.log('[npm Registry] warn:', ...args),
}

// Package metadata, dist-tags and search live on the registry host.
const REGISTRY_BASE_URL = 'https://registry.npmjs.org'
// Search and download-count endpoints live on the api host.
const API_BASE_URL = 'https://api.npmjs.org'

// Friendly download-period labels mapped to the tokens the API expects.
const PERIOD_MAP = {
  'Last Day': 'last-day',
  'Last Week': 'last-week',
  'Last Month': 'last-month',
  'Last Year': 'last-year',
}

/**
 * Encodes a package name for use in a registry URL path. Scoped names
 * (@scope/name) must have their slash percent-encoded (@scope%2Fname),
 * while unscoped names are passed through unchanged.
 *
 * @param {String} packageName
 * @returns {String}
 */
function encodePackageName(packageName) {
  if (typeof packageName !== 'string') {
    return packageName
  }

  const trimmed = packageName.trim()

  return trimmed.startsWith('@') ? trimmed.replace('/', '%2F') : encodeURIComponent(trimmed)
}

/**
 * @integrationName npm Registry
 * @integrationIcon /icon.png
 */
class NpmRegistryService {
  constructor(config) {
    this.authToken = config.authToken
  }

  // Maps a friendly dropdown label to its API value, passing through
  // anything already in API form (e.g. a custom date range or version).
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const headers = { 'Content-Type': 'application/json' }

      // Public reads need no auth; a token is only required for private packages.
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${ this.authToken }`
      }

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(headers)
        .query(query || {})

      const response = body !== undefined ? await request.send(body) : await request

      // The registry answers some 404s with a 200-style body of { error: "Not found" }.
      if (response && typeof response === 'object' && response.error) {
        throw new Error(`npm Registry API error: ${ response.error }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('npm Registry API error:')) {
        throw error
      }

      const status = error.status || error.statusCode
      const message = error.body?.error || error.body?.message || error.message
      const suffix = status ? ` (status ${ status })` : ''

      logger.error(`${ logTag } - failed: ${ message }${ suffix }`)

      throw new Error(`npm Registry API error: ${ message }${ suffix }`)
    }
  }

  /**
   * @operationName Get Package
   * @category Packages
   * @description Retrieves the full metadata document (packument) for a package, including every published version, dist-tags (such as latest and next), maintainers, description, keywords, license, and repository links. Accepts both unscoped names (e.g. express) and scoped names (e.g. @angular/core) — scoped names are URL-encoded automatically. Public packages need no authentication; a token is only required to read private packages.
   * @route GET /package
   * @appearanceColor #CB3837 #E85C5B
   *
   * @paramDef {"type":"String","label":"Package Name","name":"packageName","required":true,"description":"The npm package name, e.g. express or @angular/core."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"express","name":"express","description":"Fast, unopinionated, minimalist web framework","dist-tags":{"latest":"4.19.2"},"versions":{"4.19.2":{"name":"express","version":"4.19.2"}},"license":"MIT","maintainers":[{"name":"wesleytodd"}],"keywords":["express","framework","web"]}
   */
  async getPackage(packageName) {
    return await this.#apiRequest({
      logTag: '[getPackage]',
      url: `${ REGISTRY_BASE_URL }/${ encodePackageName(packageName) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Package Version
   * @category Packages
   * @description Retrieves the metadata for a single package version. The version may be an exact version number (e.g. 4.19.2) or a dist-tag such as latest or next. Returns the manifest for that version including its dependencies, dist information (tarball URL, shasum, integrity), engines, and scripts. Scoped package names are URL-encoded automatically.
   * @route GET /package-version
   * @appearanceColor #CB3837 #E85C5B
   *
   * @paramDef {"type":"String","label":"Package Name","name":"packageName","required":true,"description":"The npm package name, e.g. express or @angular/core."}
   * @paramDef {"type":"String","label":"Version","name":"version","required":true,"description":"An exact version (e.g. 4.19.2) or a dist-tag (e.g. latest, next)."}
   *
   * @returns {Object}
   * @sampleResult {"name":"express","version":"4.19.2","description":"Fast, unopinionated, minimalist web framework","license":"MIT","dependencies":{"body-parser":"1.20.2"},"dist":{"shasum":"e25437827a3aa7f2a827bc8171bbbb664a356465","tarball":"https://registry.npmjs.org/express/-/express-4.19.2.tgz","integrity":"sha512-..."}}
   */
  async getPackageVersion(packageName, version) {
    return await this.#apiRequest({
      logTag: '[getPackageVersion]',
      url: `${ REGISTRY_BASE_URL }/${ encodePackageName(packageName) }/${ encodeURIComponent(version) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Package Dist-Tags
   * @category Packages
   * @description Retrieves the distribution tags for a package as a map of tag name to version (e.g. {"latest":"4.19.2","next":"5.0.0-beta.3"}). Dist-tags are human-friendly aliases that point to specific versions and are what users install when they do not specify an exact version. Scoped package names are URL-encoded automatically.
   * @route GET /dist-tags
   * @appearanceColor #CB3837 #E85C5B
   *
   * @paramDef {"type":"String","label":"Package Name","name":"packageName","required":true,"description":"The npm package name, e.g. express or @angular/core."}
   *
   * @returns {Object}
   * @sampleResult {"latest":"4.19.2","next":"5.0.0-beta.3"}
   */
  async getPackageDistTags(packageName) {
    return await this.#apiRequest({
      logTag: '[getPackageDistTags]',
      url: `${ REGISTRY_BASE_URL }/-/package/${ encodePackageName(packageName) }/dist-tags`,
      method: 'get',
    })
  }

  /**
   * @operationName Search Packages
   * @category Search
   * @description Performs a full-text search of the npm registry and returns an array of matching packages under objects[], each with the package summary (name, version, description, keywords, author, links) plus quality, popularity, and maintenance scores. Supports pagination via size (max 250) and from, and optional scoring weights (quality, popularity, maintenance) between 0 and 1 to bias the ranking. The text field also accepts qualifiers such as author:, maintainer:, scope:, and keywords:.
   * @route GET /search
   * @appearanceColor #CB3837 #E85C5B
   *
   * @paramDef {"type":"String","label":"Search Text","name":"text","required":true,"description":"Full-text query. Supports qualifiers like author:sindresorhus, scope:babel, keywords:cli."}
   * @paramDef {"type":"Number","label":"Size","name":"size","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to return (1-250). Defaults to 20."}
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Result offset for pagination. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Quality Weight","name":"quality","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional ranking weight for code quality, 0 to 1."}
   * @paramDef {"type":"Number","label":"Popularity Weight","name":"popularity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional ranking weight for popularity, 0 to 1."}
   * @paramDef {"type":"Number","label":"Maintenance Weight","name":"maintenance","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional ranking weight for maintenance, 0 to 1."}
   *
   * @returns {Object}
   * @sampleResult {"objects":[{"package":{"name":"express","version":"4.19.2","description":"Fast, unopinionated, minimalist web framework","keywords":["express","framework"],"links":{"npm":"https://www.npmjs.com/package/express"}},"score":{"final":0.95,"detail":{"quality":0.99,"popularity":0.9,"maintenance":0.97}},"searchScore":100000}],"total":1234,"time":"Mon Jul 14 2026 00:00:00 GMT+0000"}
   */
  async searchPackages(text, size, from, quality, popularity, maintenance) {
    return await this.#apiRequest({
      logTag: '[searchPackages]',
      url: `${ REGISTRY_BASE_URL }/-/v1/search`,
      method: 'get',
      query: {
        text,
        size,
        from,
        quality,
        popularity,
        maintenance,
      },
    })
  }

  /**
   * @operationName Get Download Count
   * @category Downloads
   * @description Returns the total number of downloads for a package over a period. The period may be a friendly preset (Last Day, Last Week, Last Month, Last Year) or a custom date range in YYYY-MM-DD:YYYY-MM-DD form. Returns the aggregate count together with the resolved start and end dates. Omit the package name to get total downloads across the entire registry for the period.
   * @route GET /download-count
   * @appearanceColor #CB3837 #E85C5B
   *
   * @paramDef {"type":"String","label":"Period","name":"period","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Last Day","Last Week","Last Month","Last Year"]}},"defaultValue":"Last Week","description":"A preset period, or type a custom range as YYYY-MM-DD:YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Package Name","name":"packageName","description":"The npm package name, e.g. express. Leave empty for total registry-wide downloads."}
   *
   * @returns {Object}
   * @sampleResult {"downloads":32100000,"start":"2026-07-07","end":"2026-07-13","package":"express"}
   */
  async getDownloadCount(period, packageName) {
    const resolvedPeriod = this.#resolveChoice(period, PERIOD_MAP)
    const suffix = packageName ? `/${ encodePackageName(packageName) }` : ''

    return await this.#apiRequest({
      logTag: '[getDownloadCount]',
      url: `${ API_BASE_URL }/downloads/point/${ encodeURIComponent(resolvedPeriod) }${ suffix }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Download Range
   * @category Downloads
   * @description Returns a per-day breakdown of downloads for a package over a period. The period may be a friendly preset (Last Day, Last Week, Last Month, Last Year) or a custom date range in YYYY-MM-DD:YYYY-MM-DD form. Returns an array of { day, downloads } entries plus the resolved start and end dates — useful for charting download trends. Omit the package name to get registry-wide daily totals.
   * @route GET /download-range
   * @appearanceColor #CB3837 #E85C5B
   *
   * @paramDef {"type":"String","label":"Period","name":"period","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Last Day","Last Week","Last Month","Last Year"]}},"defaultValue":"Last Month","description":"A preset period, or type a custom range as YYYY-MM-DD:YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Package Name","name":"packageName","description":"The npm package name, e.g. express. Leave empty for total registry-wide downloads."}
   *
   * @returns {Object}
   * @sampleResult {"start":"2026-06-14","end":"2026-07-13","package":"express","downloads":[{"day":"2026-06-14","downloads":980000},{"day":"2026-06-15","downloads":1020000}]}
   */
  async getDownloadRange(period, packageName) {
    const resolvedPeriod = this.#resolveChoice(period, PERIOD_MAP)
    const suffix = packageName ? `/${ encodePackageName(packageName) }` : ''

    return await this.#apiRequest({
      logTag: '[getDownloadRange]',
      url: `${ API_BASE_URL }/downloads/range/${ encodeURIComponent(resolvedPeriod) }${ suffix }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Registry Info
   * @category Registry
   * @description Retrieves the top-level information document from the npm registry root. Useful as a connection and health check, and to read general registry metadata such as the database name and document counts. Requires no authentication.
   * @route GET /registry-info
   * @appearanceColor #CB3837 #E85C5B
   *
   * @returns {Object}
   * @sampleResult {"db_name":"registry","doc_count":3200000,"doc_del_count":120000,"update_seq":987654321,"disk_size":123456789012,"compact_running":false}
   */
  async getRegistryInfo() {
    return await this.#apiRequest({
      logTag: '[getRegistryInfo]',
      url: `${ REGISTRY_BASE_URL }/`,
      method: 'get',
    })
  }
}

Flowrunner.ServerCode.addService(NpmRegistryService, [
  {
    name: 'authToken',
    displayName: 'Auth Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional npm token (npmjs.com → Access Tokens). Only needed for private packages; public reads need no auth.',
  },
])
