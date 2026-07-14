const logger = {
  info: (...args) => console.log('[Marketstack] info:', ...args),
  debug: (...args) => console.log('[Marketstack] debug:', ...args),
  error: (...args) => console.log('[Marketstack] error:', ...args),
  warn: (...args) => console.log('[Marketstack] warn:', ...args),
}

const API_BASE_URL = 'https://api.marketstack.com/v2'

const INTERVAL_MAP = {
  '1 Minute': '1min',
  '5 Minutes': '5min',
  '10 Minutes': '10min',
  '15 Minutes': '15min',
  '30 Minutes': '30min',
  '1 Hour': '1hour',
  '3 Hours': '3hour',
  '6 Hours': '6hour',
  '12 Hours': '12hour',
  '24 Hours': '24hour',
}

const SORT_MAP = {
  Descending: 'DESC',
  Ascending: 'ASC',
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
 * @integrationName Marketstack
 * @integrationIcon /icon.png
 */
class MarketstackService {
  constructor(config) {
    this.accessKey = config.accessKey
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
      const cleanedQuery = clean({ ...(query || {}), access_key: this.accessKey })

      logger.debug(`${ logTag } - API request: [GET::${ url }]`)

      return await Flowrunner.Request.get(url)
        .set({ 'Content-Type': 'application/json' })
        .query(cleanedQuery)
    } catch (error) {
      const apiError = error.body?.error
      const message = apiError?.message || error.body?.message || error.message
      const code = apiError?.code

      logger.error(`${ logTag } - Request failed (${ error.status || '' }): ${ message }`)

      throw new Error(`Marketstack API error${ code ? ` [${ code }]` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Get End-of-Day Data
   * @category End-of-Day
   * @description Retrieves historical end-of-day (EOD) stock prices for one or more symbols. Each data point includes open, high, low, close, volume, adjusted values, split factor, and dividend. Supports date range filtering, sorting, and pagination. Returns a pagination block alongside the data array.
   * @route GET /eod
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"String","label":"Symbols","name":"symbols","required":true,"description":"Comma-separated stock ticker symbols, e.g. AAPL,MSFT. Up to 100 symbols per request depending on your plan."}
   * @paramDef {"type":"String","label":"Date From","name":"dateFrom","uiComponent":{"type":"DATE_PICKER"},"description":"Start date (inclusive) in YYYY-MM-DD format. Optional."}
   * @paramDef {"type":"String","label":"Date To","name":"dateTo","uiComponent":{"type":"DATE_PICKER"},"description":"End date (inclusive) in YYYY-MM-DD format. Optional."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Descending","Ascending"]}},"description":"Sort order by date. Defaults to Descending (newest first)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of results to skip). Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"limit":100,"offset":0,"count":1,"total":1},"data":[{"open":129.8,"high":133.04,"low":129.47,"close":132.995,"volume":106686703,"adj_close":132.995,"symbol":"AAPL","exchange":"XNAS","date":"2025-07-11T00:00:00+0000"}]}
   */
  async getEndOfDay(symbols, dateFrom, dateTo, sort, limit, offset) {
    return await this.#apiRequest({
      logTag: '[getEndOfDay]',
      path: '/eod',
      query: {
        symbols,
        date_from: dateFrom,
        date_to: dateTo,
        sort: this.#resolveChoice(sort, SORT_MAP),
        limit,
        offset,
      },
    })
  }

  /**
   * @operationName Get Latest End-of-Day Data
   * @category End-of-Day
   * @description Retrieves the most recent available end-of-day (EOD) stock prices for one or more symbols. Returns a single latest record per symbol with open, high, low, close, volume, and adjusted values.
   * @route GET /eod/latest
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"String","label":"Symbols","name":"symbols","required":true,"description":"Comma-separated stock ticker symbols, e.g. AAPL,MSFT."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"limit":100,"offset":0,"count":1,"total":1},"data":[{"open":129.8,"high":133.04,"low":129.47,"close":132.995,"volume":106686703,"adj_close":132.995,"symbol":"AAPL","exchange":"XNAS","date":"2025-07-11T00:00:00+0000"}]}
   */
  async getLatestEndOfDay(symbols) {
    return await this.#apiRequest({
      logTag: '[getLatestEndOfDay]',
      path: '/eod/latest',
      query: { symbols },
    })
  }

  /**
   * @operationName Get End-of-Day for Date
   * @category End-of-Day
   * @description Retrieves end-of-day (EOD) stock prices for one or more symbols on a specific date. Useful for pulling a single trading day's open/high/low/close and volume.
   * @route GET /eod-for-date
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"String","label":"Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Trading date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Symbols","name":"symbols","required":true,"description":"Comma-separated stock ticker symbols, e.g. AAPL,MSFT."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"limit":100,"offset":0,"count":1,"total":1},"data":[{"open":129.8,"high":133.04,"low":129.47,"close":132.995,"volume":106686703,"adj_close":132.995,"symbol":"AAPL","exchange":"XNAS","date":"2025-07-11T00:00:00+0000"}]}
   */
  async getEndOfDayForDate(date, symbols) {
    return await this.#apiRequest({
      logTag: '[getEndOfDayForDate]',
      path: `/eod/${ encodeURIComponent(date) }`,
      query: { symbols },
    })
  }

  /**
   * @operationName Get Intraday Data
   * @category Intraday
   * @description Retrieves intraday stock prices for one or more symbols at a selected time interval (from 1 minute up to 24 hours). Each data point includes open, high, low, close, last price, and volume. Supports date range filtering. Intraday coverage depends on your subscription plan.
   * @route GET /intraday
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"String","label":"Symbols","name":"symbols","required":true,"description":"Comma-separated stock ticker symbols, e.g. AAPL,MSFT."}
   * @paramDef {"type":"String","label":"Interval","name":"interval","uiComponent":{"type":"DROPDOWN","options":{"values":["1 Minute","5 Minutes","10 Minutes","15 Minutes","30 Minutes","1 Hour","3 Hours","6 Hours","12 Hours","24 Hours"]}},"description":"Time interval between data points. Defaults to 1 Hour."}
   * @paramDef {"type":"String","label":"Date From","name":"dateFrom","uiComponent":{"type":"DATE_PICKER"},"description":"Start date/time (inclusive) in YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS format. Optional."}
   * @paramDef {"type":"String","label":"Date To","name":"dateTo","uiComponent":{"type":"DATE_PICKER"},"description":"End date/time (inclusive) in YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS format. Optional."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"limit":100,"offset":0,"count":1,"total":1},"data":[{"open":132.5,"high":133.04,"low":132.4,"last":132.99,"close":132.99,"volume":1250000,"symbol":"AAPL","exchange":"IEX","date":"2025-07-11T20:00:00+0000"}]}
   */
  async getIntraday(symbols, interval, dateFrom, dateTo) {
    return await this.#apiRequest({
      logTag: '[getIntraday]',
      path: '/intraday',
      query: {
        symbols,
        interval: this.#resolveChoice(interval, INTERVAL_MAP),
        date_from: dateFrom,
        date_to: dateTo,
      },
    })
  }

  /**
   * @operationName Get Latest Intraday Data
   * @category Intraday
   * @description Retrieves the most recent intraday stock prices for one or more symbols. Returns the latest available intraday record per symbol with open, high, low, close, last price, and volume.
   * @route GET /intraday/latest
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"String","label":"Symbols","name":"symbols","required":true,"description":"Comma-separated stock ticker symbols, e.g. AAPL,MSFT."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"limit":100,"offset":0,"count":1,"total":1},"data":[{"open":132.5,"high":133.04,"low":132.4,"last":132.99,"close":132.99,"volume":1250000,"symbol":"AAPL","exchange":"IEX","date":"2025-07-11T20:00:00+0000"}]}
   */
  async getLatestIntraday(symbols) {
    return await this.#apiRequest({
      logTag: '[getLatestIntraday]',
      path: '/intraday/latest',
      query: { symbols },
    })
  }

  /**
   * @operationName Get Stock Splits
   * @category Splits & Dividends
   * @description Retrieves historical stock split events for one or more symbols. Each record includes the split date and the split factor. Supports date range filtering and pagination.
   * @route GET /splits
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"String","label":"Symbols","name":"symbols","required":true,"description":"Comma-separated stock ticker symbols, e.g. AAPL,MSFT."}
   * @paramDef {"type":"String","label":"Date From","name":"dateFrom","uiComponent":{"type":"DATE_PICKER"},"description":"Start date (inclusive) in YYYY-MM-DD format. Optional."}
   * @paramDef {"type":"String","label":"Date To","name":"dateTo","uiComponent":{"type":"DATE_PICKER"},"description":"End date (inclusive) in YYYY-MM-DD format. Optional."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Descending","Ascending"]}},"description":"Sort order by date. Defaults to Descending (newest first)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of results to skip). Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"limit":100,"offset":0,"count":1,"total":1},"data":[{"date":"2020-08-31","split_factor":4,"symbol":"AAPL"}]}
   */
  async getSplits(symbols, dateFrom, dateTo, sort, limit, offset) {
    return await this.#apiRequest({
      logTag: '[getSplits]',
      path: '/splits',
      query: {
        symbols,
        date_from: dateFrom,
        date_to: dateTo,
        sort: this.#resolveChoice(sort, SORT_MAP),
        limit,
        offset,
      },
    })
  }

  /**
   * @operationName Get Dividends
   * @category Splits & Dividends
   * @description Retrieves historical dividend distributions for one or more symbols. Each record includes the dividend date and the dividend amount. Supports date range filtering and pagination.
   * @route GET /dividends
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"String","label":"Symbols","name":"symbols","required":true,"description":"Comma-separated stock ticker symbols, e.g. AAPL,MSFT."}
   * @paramDef {"type":"String","label":"Date From","name":"dateFrom","uiComponent":{"type":"DATE_PICKER"},"description":"Start date (inclusive) in YYYY-MM-DD format. Optional."}
   * @paramDef {"type":"String","label":"Date To","name":"dateTo","uiComponent":{"type":"DATE_PICKER"},"description":"End date (inclusive) in YYYY-MM-DD format. Optional."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Descending","Ascending"]}},"description":"Sort order by date. Defaults to Descending (newest first)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of results to skip). Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"limit":100,"offset":0,"count":1,"total":1},"data":[{"date":"2025-05-12","dividend":0.26,"symbol":"AAPL"}]}
   */
  async getDividends(symbols, dateFrom, dateTo, sort, limit, offset) {
    return await this.#apiRequest({
      logTag: '[getDividends]',
      path: '/dividends',
      query: {
        symbols,
        date_from: dateFrom,
        date_to: dateTo,
        sort: this.#resolveChoice(sort, SORT_MAP),
        limit,
        offset,
      },
    })
  }

  /**
   * @operationName List Tickers
   * @category Tickers
   * @description Searches and lists available stock tickers. Filter by free-text search (name or symbol) and/or a specific exchange MIC code. Each result includes the ticker symbol, company name, and its stock exchange. Supports pagination.
   * @route GET /tickers
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search by company name or ticker symbol. Optional."}
   * @paramDef {"type":"String","label":"Exchange (MIC)","name":"exchange","description":"Filter by exchange MIC code, e.g. XNAS for NASDAQ. Optional."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of results to skip). Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"limit":100,"offset":0,"count":1,"total":1},"data":[{"name":"Apple Inc","symbol":"AAPL","stock_exchange":{"name":"NASDAQ Stock Exchange","acronym":"NASDAQ","mic":"XNAS","country":"USA","country_code":"US","city":"New York"}}]}
   */
  async listTickers(search, exchange, limit, offset) {
    return await this.#apiRequest({
      logTag: '[listTickers]',
      path: '/tickers',
      query: {
        search,
        exchange,
        limit,
        offset,
      },
    })
  }

  /**
   * @operationName Get Ticker
   * @category Tickers
   * @description Retrieves detailed information about a single stock ticker by its symbol, including the company name and the stock exchange it trades on.
   * @route GET /ticker
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"String","label":"Symbol","name":"symbol","required":true,"description":"A single stock ticker symbol, e.g. AAPL."}
   *
   * @returns {Object}
   * @sampleResult {"name":"Apple Inc","symbol":"AAPL","stock_exchange":{"name":"NASDAQ Stock Exchange","acronym":"NASDAQ","mic":"XNAS","country":"USA","country_code":"US","city":"New York"}}
   */
  async getTicker(symbol) {
    return await this.#apiRequest({
      logTag: '[getTicker]',
      path: `/tickers/${ encodeURIComponent(symbol) }`,
    })
  }

  /**
   * @operationName Get Ticker End-of-Day
   * @category Tickers
   * @description Retrieves end-of-day (EOD) price history for a single ticker symbol. Supports date range filtering, sorting, and pagination. Returns ticker metadata together with an EOD data array.
   * @route GET /ticker-eod
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"String","label":"Symbol","name":"symbol","required":true,"description":"A single stock ticker symbol, e.g. AAPL."}
   * @paramDef {"type":"String","label":"Date From","name":"dateFrom","uiComponent":{"type":"DATE_PICKER"},"description":"Start date (inclusive) in YYYY-MM-DD format. Optional."}
   * @paramDef {"type":"String","label":"Date To","name":"dateTo","uiComponent":{"type":"DATE_PICKER"},"description":"End date (inclusive) in YYYY-MM-DD format. Optional."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Descending","Ascending"]}},"description":"Sort order by date. Defaults to Descending (newest first)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of results to skip). Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"limit":100,"offset":0,"count":1,"total":1},"data":{"name":"Apple Inc","symbol":"AAPL","eod":[{"open":129.8,"high":133.04,"low":129.47,"close":132.995,"volume":106686703,"date":"2025-07-11T00:00:00+0000"}]}}
   */
  async getTickerEndOfDay(symbol, dateFrom, dateTo, sort, limit, offset) {
    return await this.#apiRequest({
      logTag: '[getTickerEndOfDay]',
      path: `/tickers/${ encodeURIComponent(symbol) }/eod`,
      query: {
        date_from: dateFrom,
        date_to: dateTo,
        sort: this.#resolveChoice(sort, SORT_MAP),
        limit,
        offset,
      },
    })
  }

  /**
   * @operationName List Exchanges
   * @category Exchanges
   * @description Lists supported stock exchanges. Optionally filter by a free-text search on exchange name, MIC, or country. Each result includes the exchange name, acronym, MIC code, and country. Supports pagination.
   * @route GET /exchanges
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search by exchange name, MIC, or country. Optional."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of results to skip). Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"limit":100,"offset":0,"count":1,"total":1},"data":[{"name":"NASDAQ Stock Exchange","acronym":"NASDAQ","mic":"XNAS","country":"USA","country_code":"US","city":"New York","website":"www.nasdaq.com"}]}
   */
  async listExchanges(search, limit, offset) {
    return await this.#apiRequest({
      logTag: '[listExchanges]',
      path: '/exchanges',
      query: {
        search,
        limit,
        offset,
      },
    })
  }

  /**
   * @operationName Get Exchange
   * @category Exchanges
   * @description Retrieves detailed information about a single stock exchange identified by its MIC code, including its name, acronym, country, and website.
   * @route GET /exchange
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"String","label":"MIC","name":"mic","required":true,"description":"Market Identifier Code (MIC) of the exchange, e.g. XNAS for NASDAQ."}
   *
   * @returns {Object}
   * @sampleResult {"name":"NASDAQ Stock Exchange","acronym":"NASDAQ","mic":"XNAS","country":"USA","country_code":"US","city":"New York","website":"www.nasdaq.com"}
   */
  async getExchange(mic) {
    return await this.#apiRequest({
      logTag: '[getExchange]',
      path: `/exchanges/${ encodeURIComponent(mic) }`,
    })
  }

  /**
   * @operationName Get Exchange Tickers
   * @category Exchanges
   * @description Lists the stock tickers available on a specific exchange identified by its MIC code. Optionally filter by free-text search. Supports pagination.
   * @route GET /exchange-tickers
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"String","label":"MIC","name":"mic","required":true,"description":"Market Identifier Code (MIC) of the exchange, e.g. XNAS for NASDAQ."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search by company name or ticker symbol. Optional."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of results to skip). Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"limit":100,"offset":0,"count":1,"total":1},"data":{"name":"NASDAQ Stock Exchange","acronym":"NASDAQ","mic":"XNAS","tickers":[{"name":"Apple Inc","symbol":"AAPL"}]}}
   */
  async getExchangeTickers(mic, search, limit, offset) {
    return await this.#apiRequest({
      logTag: '[getExchangeTickers]',
      path: `/exchanges/${ encodeURIComponent(mic) }/tickers`,
      query: {
        search,
        limit,
        offset,
      },
    })
  }

  /**
   * @operationName List Currencies
   * @category Currencies & Timezones
   * @description Lists all currencies supported by the Marketstack API. Each record includes the ISO currency code, symbol, and name. Supports pagination.
   * @route GET /currencies
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of results to skip). Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"limit":100,"offset":0,"count":1,"total":1},"data":[{"code":"USD","symbol":"$","name":"US Dollar"}]}
   */
  async listCurrencies(limit, offset) {
    return await this.#apiRequest({
      logTag: '[listCurrencies]',
      path: '/currencies',
      query: {
        limit,
        offset,
      },
    })
  }

  /**
   * @operationName List Timezones
   * @category Currencies & Timezones
   * @description Lists all timezones supported by the Marketstack API. Each record includes the timezone name, its abbreviation, and UTC offset. Supports pagination.
   * @route GET /timezones
   * @appearanceColor #05263B #0A4B72
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of results to skip). Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"limit":100,"offset":0,"count":1,"total":1},"data":[{"timezone":"America/New_York","abbr":"EST","abbr_dst":"EDT"}]}
   */
  async listTimezones(limit, offset) {
    return await this.#apiRequest({
      logTag: '[listTimezones]',
      path: '/timezones',
      query: {
        limit,
        offset,
      },
    })
  }
}

Flowrunner.ServerCode.addService(MarketstackService, [
  {
    name: 'accessKey',
    displayName: 'API Access Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Marketstack API access key, sent as the access_key query parameter. Find it in Marketstack → Dashboard → API Access Key.',
  },
])
