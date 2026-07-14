const logger = {
  info: (...args) => console.log('[CoinGecko] info:', ...args),
  debug: (...args) => console.log('[CoinGecko] debug:', ...args),
  error: (...args) => console.log('[CoinGecko] error:', ...args),
  warn: (...args) => console.log('[CoinGecko] warn:', ...args),
}

const DEMO_BASE_URL = 'https://api.coingecko.com/api/v3'
const PRO_BASE_URL = 'https://pro-api.coingecko.com/api/v3'

const PLAN_MAP = { Demo: 'demo', Pro: 'pro' }

const ORDER_MAP = {
  'Market Cap (High to Low)': 'market_cap_desc',
  'Market Cap (Low to High)': 'market_cap_asc',
  'Volume (High to Low)': 'volume_desc',
  'Volume (Low to High)': 'volume_asc',
  'ID (A to Z)': 'id_asc',
  'ID (Z to A)': 'id_desc',
}

const INTERVAL_MAP = {
  'Automatic (granularity based on range)': '',
  'Hourly': 'hourly',
  'Daily': 'daily',
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
 * @integrationName CoinGecko
 * @integrationIcon /icon.png
 */
class CoinGeckoService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.plan = this.#resolveChoice(config.plan, PLAN_MAP) || 'demo'
    this.baseUrl = this.plan === 'pro' ? PRO_BASE_URL : DEMO_BASE_URL
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #authHeaders() {
    const headers = { 'Content-Type': 'application/json' }

    if (this.apiKey) {
      if (this.plan === 'pro') {
        headers['x-cg-pro-api-key'] = this.apiKey
      } else {
        headers['x-cg-demo-api-key'] = this.apiKey
      }
    }

    return headers
  }

  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(this.#authHeaders())
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const apiMessage = error.body?.status?.error_message ||
        error.body?.error ||
        error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      let message = status ? `${ apiMessage } (HTTP ${ status })` : apiMessage

      if (status === 429) {
        message += ' - Rate limit exceeded. The free/Demo tier is rate limited; slow down requests or use a Pro API key.'
      }

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`CoinGecko API error: ${ message }`)
    }
  }

  /**
   * @operationName Ping
   * @category System
   * @description Checks that the CoinGecko API is reachable and that your API key and plan are valid. Returns a simple confirmation message. Use this to verify connectivity before running other operations.
   * @route GET /ping
   *
   * @returns {Object}
   * @sampleResult {"gecko_says":"(V3) To the Moon!"}
   */
  async ping() {
    return await this.#apiRequest({
      logTag: '[ping]',
      path: '/ping',
      method: 'get',
    })
  }

  /**
   * @operationName Get Price
   * @category Simple
   * @description Gets the current price of one or more coins in one or more target currencies. Provide coin IDs (e.g. "bitcoin,ethereum") and currency codes (e.g. "usd,eur"). Optionally include market cap and 24h price change. Supports up to 515 coin IDs per request.
   * @route GET /simple/price
   *
   * @paramDef {"type":"String","label":"Coin IDs","name":"ids","required":true,"description":"Comma-separated CoinGecko coin IDs, e.g. \"bitcoin,ethereum,solana\". Use the List Coins operation to find valid IDs."}
   * @paramDef {"type":"String","label":"Target Currencies","name":"vsCurrencies","required":true,"description":"Comma-separated target currency codes, e.g. \"usd,eur,btc\". Use Supported VS Currencies for the full list."}
   * @paramDef {"type":"Boolean","label":"Include Market Cap","name":"includeMarketCap","uiComponent":{"type":"CHECKBOX"},"description":"Include each coin's market capitalization in the response. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Include 24h Change","name":"include24hrChange","uiComponent":{"type":"CHECKBOX"},"description":"Include each coin's 24-hour price change percentage. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"bitcoin":{"usd":67890,"usd_market_cap":1341234567890,"usd_24h_change":1.23}}
   */
  async getPrice(ids, vsCurrencies, includeMarketCap, include24hrChange) {
    return await this.#apiRequest({
      logTag: '[getPrice]',
      path: '/simple/price',
      method: 'get',
      query: {
        ids,
        vs_currencies: vsCurrencies,
        include_market_cap: includeMarketCap ? 'true' : undefined,
        include_24hr_change: include24hrChange ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Get Token Price by Contract
   * @category Simple
   * @description Gets the current price of one or more tokens by their contract addresses on a given blockchain platform. Provide the asset platform ID (e.g. "ethereum") and comma-separated contract addresses. Useful for pricing tokens not listed by a simple coin ID.
   * @route GET /simple/token_price
   *
   * @paramDef {"type":"String","label":"Platform ID","name":"platform","required":true,"description":"Asset platform ID, e.g. \"ethereum\", \"binance-smart-chain\", \"polygon-pos\"."}
   * @paramDef {"type":"String","label":"Contract Addresses","name":"contractAddresses","required":true,"description":"Comma-separated token contract addresses on the specified platform."}
   * @paramDef {"type":"String","label":"Target Currencies","name":"vsCurrencies","required":true,"description":"Comma-separated target currency codes, e.g. \"usd,eur\"."}
   *
   * @returns {Object}
   * @sampleResult {"0xdac17f958d2ee523a2206206994597c13d831ec7":{"usd":1.0}}
   */
  async getTokenPriceByContract(platform, contractAddresses, vsCurrencies) {
    return await this.#apiRequest({
      logTag: '[getTokenPriceByContract]',
      path: `/simple/token_price/${ encodeURIComponent(platform) }`,
      method: 'get',
      query: {
        contract_addresses: contractAddresses,
        vs_currencies: vsCurrencies,
      },
    })
  }

  /**
   * @operationName Supported VS Currencies
   * @category Simple
   * @description Returns the full list of supported target ("vs") currency codes that can be used in price and market operations, such as usd, eur, btc, and eth.
   * @route GET /simple/supported_vs_currencies
   *
   * @returns {Array<String>}
   * @sampleResult ["btc","eth","usd","eur","gbp","jpy"]
   */
  async getSupportedVsCurrencies() {
    return await this.#apiRequest({
      logTag: '[getSupportedVsCurrencies]',
      path: '/simple/supported_vs_currencies',
      method: 'get',
    })
  }

  /**
   * @operationName List Coins
   * @category Coins
   * @description Returns the full list of coins supported by CoinGecko, each with its ID, symbol, and name. Use the returned "id" values as input to other operations such as Get Price, Get Coin Data, and Get Coin Market Chart. The list is large (thousands of coins).
   * @route GET /coins/list
   *
   * @paramDef {"type":"Boolean","label":"Include Platform","name":"includePlatform","uiComponent":{"type":"CHECKBOX"},"description":"Include each coin's contract addresses across blockchain platforms. Defaults to false."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"bitcoin","symbol":"btc","name":"Bitcoin"},{"id":"ethereum","symbol":"eth","name":"Ethereum"}]
   */
  async listCoins(includePlatform) {
    return await this.#apiRequest({
      logTag: '[listCoins]',
      path: '/coins/list',
      method: 'get',
      query: {
        include_platform: includePlatform ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Coins Markets
   * @category Coins
   * @description Returns market data (price, market cap, volume, rank, and price changes) for coins in a target currency, sorted and paginated. Optionally filter to specific coin IDs and request extra price-change windows. Ideal for building coin leaderboards and dashboards.
   * @route GET /coins/markets
   *
   * @paramDef {"type":"String","label":"Target Currency","name":"vsCurrency","required":true,"description":"Single target currency code for market values, e.g. \"usd\"."}
   * @paramDef {"type":"String","label":"Coin IDs","name":"ids","description":"Optional comma-separated coin IDs to limit results, e.g. \"bitcoin,ethereum\". Leave empty for all coins."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Market Cap (High to Low)","Market Cap (Low to High)","Volume (High to Low)","Volume (Low to High)","ID (A to Z)","ID (Z to A)"]}},"description":"Sort order for the results. Defaults to Market Cap (High to Low)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-250). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"String","label":"Price Change Windows","name":"priceChangePercentage","uiComponent":{"type":"DROPDOWN","options":{"values":["1h","24h","7d","14d","30d","200d","1y"]}},"description":"Include the price change percentage for the selected window (in addition to the default 24h). Leave empty to omit."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"bitcoin","symbol":"btc","name":"Bitcoin","current_price":67890,"market_cap":1341234567890,"market_cap_rank":1,"total_volume":25000000000,"price_change_percentage_24h":1.23}]
   */
  async coinsMarkets(vsCurrency, ids, order, perPage, page, priceChangePercentage) {
    return await this.#apiRequest({
      logTag: '[coinsMarkets]',
      path: '/coins/markets',
      method: 'get',
      query: {
        vs_currency: vsCurrency,
        ids,
        order: this.#resolveChoice(order, ORDER_MAP),
        per_page: perPage,
        page,
        price_change_percentage: priceChangePercentage,
      },
    })
  }

  /**
   * @operationName Get Coin Data
   * @category Coins
   * @description Returns detailed data for a single coin, including description, links, images, market data, and optionally exchange tickers and community metrics. Provide the coin's CoinGecko ID. Use the toggles to control which data sections are included.
   * @route GET /coins/{id}
   *
   * @paramDef {"type":"String","label":"Coin ID","name":"id","required":true,"description":"CoinGecko coin ID, e.g. \"bitcoin\". Find IDs with the List Coins operation."}
   * @paramDef {"type":"Boolean","label":"Include Localization","name":"localization","uiComponent":{"type":"CHECKBOX"},"description":"Include all localized name/description fields. Defaults to false to reduce payload size."}
   * @paramDef {"type":"Boolean","label":"Include Tickers","name":"tickers","uiComponent":{"type":"CHECKBOX"},"description":"Include exchange ticker data for the coin. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Include Market Data","name":"marketData","uiComponent":{"type":"CHECKBOX"},"description":"Include price, market cap, and volume data. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Include Community Data","name":"communityData","uiComponent":{"type":"CHECKBOX"},"description":"Include community metrics such as social followers. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"id":"bitcoin","symbol":"btc","name":"Bitcoin","market_cap_rank":1,"market_data":{"current_price":{"usd":67890}}}
   */
  async getCoinData(id, localization, tickers, marketData, communityData) {
    return await this.#apiRequest({
      logTag: '[getCoinData]',
      path: `/coins/${ encodeURIComponent(id) }`,
      method: 'get',
      query: {
        localization: localization ? 'true' : 'false',
        tickers: tickers ? 'true' : 'false',
        market_data: marketData === false ? 'false' : 'true',
        community_data: communityData ? 'true' : 'false',
      },
    })
  }

  /**
   * @operationName Get Coin Market Chart
   * @category Coins
   * @description Returns historical market data (prices, market caps, and total volumes) for a coin over a number of days in a target currency. Data granularity depends on the range: minutely for 1 day, hourly for 2-90 days, and daily beyond that unless an interval is specified.
   * @route GET /coins/{id}/market_chart
   *
   * @paramDef {"type":"String","label":"Coin ID","name":"id","required":true,"description":"CoinGecko coin ID, e.g. \"bitcoin\"."}
   * @paramDef {"type":"String","label":"Target Currency","name":"vsCurrency","required":true,"description":"Target currency for values, e.g. \"usd\"."}
   * @paramDef {"type":"String","label":"Days","name":"days","required":true,"description":"Number of days of data to return, e.g. \"1\", \"7\", \"30\", \"365\", or \"max\"."}
   * @paramDef {"type":"String","label":"Interval","name":"interval","uiComponent":{"type":"DROPDOWN","options":{"values":["Automatic (granularity based on range)","Hourly","Daily"]}},"description":"Data granularity. Automatic lets CoinGecko choose based on the range. Defaults to Automatic."}
   *
   * @returns {Object}
   * @sampleResult {"prices":[[1712000000000,67890.12]],"market_caps":[[1712000000000,1341234567890]],"total_volumes":[[1712000000000,25000000000]]}
   */
  async getCoinMarketChart(id, vsCurrency, days, interval) {
    return await this.#apiRequest({
      logTag: '[getCoinMarketChart]',
      path: `/coins/${ encodeURIComponent(id) }/market_chart`,
      method: 'get',
      query: {
        vs_currency: vsCurrency,
        days,
        interval: this.#resolveChoice(interval, INTERVAL_MAP),
      },
    })
  }

  /**
   * @operationName Get Coin OHLC
   * @category Coins
   * @description Returns open-high-low-close (OHLC) candlestick data for a coin over a selected time range in a target currency. Each entry is [timestamp, open, high, low, close]. Candle granularity is automatically determined by the selected number of days.
   * @route GET /coins/{id}/ohlc
   *
   * @paramDef {"type":"String","label":"Coin ID","name":"id","required":true,"description":"CoinGecko coin ID, e.g. \"bitcoin\"."}
   * @paramDef {"type":"String","label":"Target Currency","name":"vsCurrency","required":true,"description":"Target currency for OHLC values, e.g. \"usd\"."}
   * @paramDef {"type":"String","label":"Days","name":"days","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["1","7","14","30","90","180","365","max"]}},"description":"Time range for the OHLC data. Only these values are supported by the endpoint."}
   *
   * @returns {Array<Object>}
   * @sampleResult [[1712000000000,67000,68200,66800,67890]]
   */
  async getCoinOHLC(id, vsCurrency, days) {
    return await this.#apiRequest({
      logTag: '[getCoinOHLC]',
      path: `/coins/${ encodeURIComponent(id) }/ohlc`,
      method: 'get',
      query: {
        vs_currency: vsCurrency,
        days,
      },
    })
  }

  /**
   * @operationName Get Coin History
   * @category Coins
   * @description Returns a snapshot of a coin's data (price, market cap, and 24h volume across currencies) at 00:00 UTC on a specific historical date. Provide the coin ID and a date in dd-mm-yyyy format.
   * @route GET /coins/{id}/history
   *
   * @paramDef {"type":"String","label":"Coin ID","name":"id","required":true,"description":"CoinGecko coin ID, e.g. \"bitcoin\"."}
   * @paramDef {"type":"String","label":"Date","name":"date","required":true,"description":"Snapshot date in dd-mm-yyyy format, e.g. \"30-12-2023\". Data reflects 00:00 UTC on that date."}
   *
   * @returns {Object}
   * @sampleResult {"id":"bitcoin","symbol":"btc","name":"Bitcoin","market_data":{"current_price":{"usd":42000}}}
   */
  async getCoinHistory(id, date) {
    return await this.#apiRequest({
      logTag: '[getCoinHistory]',
      path: `/coins/${ encodeURIComponent(id) }/history`,
      method: 'get',
      query: {
        date,
      },
    })
  }

  /**
   * @operationName Search
   * @category Search & Trending
   * @description Searches CoinGecko for coins, exchanges, categories, and NFTs matching a query string. Returns matching entities with their IDs and names. Use a returned coin "id" with price and market operations.
   * @route GET /search
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search term, e.g. a coin name or symbol like \"bitcoin\" or \"eth\"."}
   *
   * @returns {Object}
   * @sampleResult {"coins":[{"id":"bitcoin","name":"Bitcoin","symbol":"BTC","market_cap_rank":1}],"exchanges":[],"categories":[]}
   */
  async search(query) {
    return await this.#apiRequest({
      logTag: '[search]',
      path: '/search',
      method: 'get',
      query: {
        query,
      },
    })
  }

  /**
   * @operationName Trending
   * @category Search & Trending
   * @description Returns the top trending coins, NFTs, and categories on CoinGecko over the last 24 hours, based on user search activity. Useful for surfacing what the market is currently interested in.
   * @route GET /search/trending
   *
   * @returns {Object}
   * @sampleResult {"coins":[{"item":{"id":"bitcoin","name":"Bitcoin","symbol":"BTC","market_cap_rank":1,"score":0}}],"nfts":[],"categories":[]}
   */
  async getTrending() {
    return await this.#apiRequest({
      logTag: '[getTrending]',
      path: '/search/trending',
      method: 'get',
    })
  }

  /**
   * @operationName Global Data
   * @category Global
   * @description Returns global cryptocurrency market data, including total market capitalization, total 24h volume, market cap percentage by coin, and the number of active cryptocurrencies and markets.
   * @route GET /global
   *
   * @returns {Object}
   * @sampleResult {"data":{"active_cryptocurrencies":12345,"markets":900,"total_market_cap":{"usd":2500000000000},"market_cap_percentage":{"btc":52.3,"eth":17.1}}}
   */
  async getGlobalData() {
    return await this.#apiRequest({
      logTag: '[getGlobalData]',
      path: '/global',
      method: 'get',
    })
  }

  /**
   * @operationName Global DeFi Data
   * @category Global
   * @description Returns global decentralized finance (DeFi) market data, including total DeFi market cap, DeFi-to-total market cap ratio, DeFi 24h trading volume, and the top DeFi coin by market share.
   * @route GET /global/decentralized_finance_defi
   *
   * @returns {Object}
   * @sampleResult {"data":{"defi_market_cap":"95000000000","eth_market_cap":"400000000000","defi_to_eth_ratio":"23.7","trading_volume_24h":"5000000000","top_coin_name":"Lido Staked Ether","top_coin_defi_dominance":18.4}}
   */
  async getGlobalDefiData() {
    return await this.#apiRequest({
      logTag: '[getGlobalDefiData]',
      path: '/global/decentralized_finance_defi',
      method: 'get',
    })
  }

  /**
   * @operationName List Exchanges
   * @category Exchanges
   * @description Returns a paginated list of cryptocurrency exchanges tracked by CoinGecko, including each exchange's ID, name, trust score, and trade volume. Use a returned "id" with Get Exchange for details.
   * @route GET /exchanges
   *
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-250). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"binance","name":"Binance","trust_score":10,"trust_score_rank":1,"trade_volume_24h_btc":250000}]
   */
  async listExchanges(perPage, page) {
    return await this.#apiRequest({
      logTag: '[listExchanges]',
      path: '/exchanges',
      method: 'get',
      query: {
        per_page: perPage,
        page,
      },
    })
  }

  /**
   * @operationName Get Exchange
   * @category Exchanges
   * @description Returns detailed data for a single exchange, including trust score, trade volume, year established, country, and top tickers. Provide the exchange's CoinGecko ID (find it with List Exchanges).
   * @route GET /exchanges/{id}
   *
   * @paramDef {"type":"String","label":"Exchange ID","name":"id","required":true,"description":"CoinGecko exchange ID, e.g. \"binance\". Find IDs with the List Exchanges operation."}
   *
   * @returns {Object}
   * @sampleResult {"name":"Binance","year_established":2017,"country":"Cayman Islands","trust_score":10,"trade_volume_24h_btc":250000}
   */
  async getExchange(id) {
    return await this.#apiRequest({
      logTag: '[getExchange]',
      path: `/exchanges/${ encodeURIComponent(id) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Categories
   * @category Categories
   * @description Returns the list of coin categories with market data, including market cap, 24h market cap change, 24h volume, and the top coins in each category. Useful for analyzing sectors such as DeFi, Layer 1, or meme coins.
   * @route GET /coins/categories
   *
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Market Cap (High to Low)","Market Cap (Low to High)","Name (A to Z)","Name (Z to A)","24h Change (High to Low)","24h Change (Low to High)"]}},"description":"Sort order for the categories. Defaults to Market Cap (High to Low)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"layer-1","name":"Layer 1 (L1)","market_cap":1200000000000,"market_cap_change_24h":1.5,"volume_24h":50000000000,"top_3_coins":["https://example.com/btc.png"]}]
   */
  async listCategories(order) {
    return await this.#apiRequest({
      logTag: '[listCategories]',
      path: '/coins/categories',
      method: 'get',
      query: {
        order: this.#resolveChoice(order, {
          'Market Cap (High to Low)': 'market_cap_desc',
          'Market Cap (Low to High)': 'market_cap_asc',
          'Name (A to Z)': 'name_asc',
          'Name (Z to A)': 'name_desc',
          '24h Change (High to Low)': 'market_cap_change_24h_desc',
          '24h Change (Low to High)': 'market_cap_change_24h_asc',
        }),
      },
    })
  }
}

Flowrunner.ServerCode.addService(CoinGeckoService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'CoinGecko → Developer Dashboard → API key. Leave blank for the free public rate-limited tier.',
  },
  {
    name: 'plan',
    displayName: 'Plan',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['Demo', 'Pro'],
    defaultValue: 'Demo',
    required: false,
    shared: false,
    hint: 'Demo key or free tier (api.coingecko.com) vs paid Pro key (pro-api.coingecko.com).',
  },
])
