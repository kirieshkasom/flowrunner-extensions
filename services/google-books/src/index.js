const logger = {
  info: (...args) => console.log('[Google Books] info:', ...args),
  debug: (...args) => console.log('[Google Books] debug:', ...args),
  error: (...args) => console.log('[Google Books] error:', ...args),
  warn: (...args) => console.log('[Google Books] warn:', ...args),
}

const API_BASE_URL = 'https://www.googleapis.com/books/v1'

const DEFAULT_MAX_RESULTS = 10

const ORDER_BY_MAP = {
  Relevance: 'relevance',
  Newest: 'newest',
}

const PRINT_TYPE_MAP = {
  All: 'all',
  Books: 'books',
  Magazines: 'magazines',
}

const FILTER_MAP = {
  Partial: 'partial',
  Full: 'full',
  'Free eBooks': 'free-ebooks',
  'Paid eBooks': 'paid-ebooks',
  eBooks: 'ebooks',
}

const PROJECTION_MAP = {
  Full: 'full',
  Lite: 'lite',
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
 * @integrationName Google Books
 * @integrationIcon /icon.png
 */
class GoogleBooksService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ url, method = 'get', query, logTag }) {
    try {
      const finalQuery = clean({ ...(query || {}) })

      if (this.apiKey) {
        finalQuery.key = this.apiKey
      }

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Content-Type': 'application/json' })
        .query(finalQuery)

      return await request
    } catch (error) {
      const apiError = error.body?.error
      const message = apiError?.message || error.body?.message || error.message
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - Request failed (status ${ status }): ${ message }`)

      throw new Error(`Google Books API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Search Volumes
   * @category Volumes
   * @description Searches Google Books for volumes (books and magazines) matching a text query. The query supports Google's special search qualifiers: "intitle:" limits to the title, "inauthor:" to the author, "inpublisher:" to the publisher, "subject:" to the category/subject, and "isbn:" to a specific ISBN (e.g. "isbn:9780134685991"). Qualifiers can be combined with keywords, for example "flowers inauthor:keyes intitle:garden". Supports pagination (up to 40 results per page), sorting, print-type and content filtering, language restriction, and lite/full projection.
   * @route GET /search-volumes
   * @paramDef {"type":"String","label":"Query","name":"q","required":true,"description":"Search text. Supports qualifiers intitle:, inauthor:, inpublisher:, subject:, and isbn: (e.g. \"isbn:9780134685991\" or \"gardening inauthor:keyes\")."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based index of the first result to return, used for pagination. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-40). Defaults to 10."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Relevance","Newest"]}},"description":"Sort order for results. Defaults to Relevance."}
   * @paramDef {"type":"String","label":"Print Type","name":"printType","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Books","Magazines"]}},"description":"Restrict results by print type. Defaults to All."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["Partial","Full","Free eBooks","Paid eBooks","eBooks"]}},"description":"Filter by content availability: Partial (partial preview), Full (full view), Free eBooks, Paid eBooks, or all eBooks."}
   * @paramDef {"type":"String","label":"Language Restrict","name":"langRestrict","description":"Restrict results to a two-letter ISO-639-1 language code, e.g. \"en\" or \"fr\"."}
   * @paramDef {"type":"String","label":"Projection","name":"projection","uiComponent":{"type":"DROPDOWN","options":{"values":["Full","Lite"]}},"description":"Amount of volume information returned: Full (all metadata) or Lite (subset)."}
   * @returns {Object}
   * @sampleResult {"kind":"books#volumes","totalItems":1234,"items":[{"kind":"books#volume","id":"zyTCAlFPjgYC","volumeInfo":{"title":"The Google Story","authors":["David A. Vise"],"publisher":"Random House","publishedDate":"2005-11-15","industryIdentifiers":[{"type":"ISBN_13","identifier":"9780553804577"}],"pageCount":207,"language":"en"},"saleInfo":{"country":"US","saleability":"NOT_FOR_SALE"}}]}
   */
  async searchVolumes(q, startIndex, maxResults, orderBy, printType, filter, langRestrict, projection) {
    const logTag = '[searchVolumes]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/volumes`,
      method: 'get',
      query: {
        q,
        startIndex,
        maxResults: maxResults || DEFAULT_MAX_RESULTS,
        orderBy: this.#resolveChoice(orderBy, ORDER_BY_MAP),
        printType: this.#resolveChoice(printType, PRINT_TYPE_MAP),
        filter: this.#resolveChoice(filter, FILTER_MAP),
        langRestrict,
        projection: this.#resolveChoice(projection, PROJECTION_MAP),
      },
    })
  }

  /**
   * @operationName Get Volume
   * @category Volumes
   * @description Retrieves complete metadata for a single volume by its Google Books volume ID (as returned in the "id" field of Search Volumes). Returns volume info (title, authors, publisher, description, categories, page count, images), sale info, and access info.
   * @route GET /get-volume
   * @paramDef {"type":"String","label":"Volume ID","name":"volumeId","required":true,"description":"The Google Books volume ID, e.g. \"zyTCAlFPjgYC\" (from the \"id\" field of a search result)."}
   * @returns {Object}
   * @sampleResult {"kind":"books#volume","id":"zyTCAlFPjgYC","volumeInfo":{"title":"The Google Story","authors":["David A. Vise","Mark Malseed"],"publisher":"Random House","publishedDate":"2005-11-15","description":"...","pageCount":207,"categories":["Business & Economics"],"averageRating":3.5,"language":"en","imageLinks":{"thumbnail":"http://books.google.com/books/content?id=zyTCAlFPjgYC"}},"saleInfo":{"country":"US","saleability":"NOT_FOR_SALE","isEbook":false},"accessInfo":{"country":"US","viewability":"PARTIAL"}}
   */
  async getVolume(volumeId) {
    const logTag = '[getVolume]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/volumes/${ encodeURIComponent(volumeId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Public Bookshelves
   * @category Bookshelves
   * @description Lists the public bookshelves for a given Google user ID. Only bookshelves the user has made public are returned. Use a returned bookshelf's "id" as the Shelf ID for Get Public Bookshelf and List Bookshelf Volumes.
   * @route GET /list-public-bookshelves
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The numeric Google user ID whose public bookshelves should be listed."}
   * @returns {Object}
   * @sampleResult {"kind":"books#bookshelves","items":[{"kind":"books#bookshelf","id":1001,"title":"Favorites","access":"PUBLIC","volumeCount":12,"updated":"2015-01-02T18:26:00.000Z"}]}
   */
  async listPublicBookshelves(userId) {
    const logTag = '[listPublicBookshelves]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }/bookshelves`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Public Bookshelf
   * @category Bookshelves
   * @description Retrieves metadata for a single public bookshelf belonging to a Google user, identified by user ID and shelf ID. Returns the bookshelf's title, access level, volume count, and timestamps.
   * @route GET /get-public-bookshelf
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The numeric Google user ID that owns the bookshelf."}
   * @paramDef {"type":"String","label":"Shelf ID","name":"shelf","required":true,"description":"The bookshelf ID (from List Public Bookshelves). Standard shelves include 0 (Favorites), 3 (Reviewed), 8 (Reading now), etc."}
   * @returns {Object}
   * @sampleResult {"kind":"books#bookshelf","id":1001,"title":"Favorites","access":"PUBLIC","volumeCount":12,"created":"2014-01-01T00:00:00.000Z","updated":"2015-01-02T18:26:00.000Z"}
   */
  async getPublicBookshelf(userId, shelf) {
    const logTag = '[getPublicBookshelf]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }/bookshelves/${ encodeURIComponent(shelf) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Bookshelf Volumes
   * @category Bookshelves
   * @description Lists the volumes contained in a specific public bookshelf, identified by user ID and shelf ID. Supports pagination via start index and max results. Each item is a full volume resource, the same shape returned by Get Volume.
   * @route GET /list-bookshelf-volumes
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The numeric Google user ID that owns the bookshelf."}
   * @paramDef {"type":"String","label":"Shelf ID","name":"shelf","required":true,"description":"The bookshelf ID (from List Public Bookshelves) whose volumes should be listed."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based index of the first volume to return, used for pagination. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of volumes to return. Defaults to 10."}
   * @returns {Object}
   * @sampleResult {"kind":"books#volumes","totalItems":12,"items":[{"kind":"books#volume","id":"zyTCAlFPjgYC","volumeInfo":{"title":"The Google Story","authors":["David A. Vise"],"publishedDate":"2005-11-15"}}]}
   */
  async listBookshelfVolumes(userId, shelf, startIndex, maxResults) {
    const logTag = '[listBookshelfVolumes]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }/bookshelves/${ encodeURIComponent(shelf) }/volumes`,
      method: 'get',
      query: {
        startIndex,
        maxResults,
      },
    })
  }
}

Flowrunner.ServerCode.addService(GoogleBooksService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional Google Cloud API key (with the Books API enabled) for higher quotas — public search works without it. Create one at https://console.cloud.google.com/apis/credentials',
  },
])
