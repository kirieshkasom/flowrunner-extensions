'use strict'

const API_VERSION = '2026-01'

const DEFAULT_SCOPE_LIST = [
  'read_orders',
  'write_orders',
  'read_products',
  'write_products',
  'read_inventory',
  'write_inventory',
  'read_customers',
  'write_customers',
  'read_shopify_payments_accounts',
  'read_locations',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(',')

const DEFAULT_LIMIT = 50

const INVENTORY_REASON_MAP = {
  'Correction': 'correction',
  'Cycle Count': 'cycle_count_available',
  'Damaged': 'damaged',
  'Movement Canceled': 'movement_canceled',
  'Movement Created': 'movement_created',
  'Movement Received': 'movement_received',
  'Movement Updated': 'movement_updated',
  'Other': 'other',
  'Promotion': 'promotion',
  'Quality Control': 'quality_control',
  'Received': 'received',
  'Reservation Created': 'reservation_created',
  'Reservation Deleted': 'reservation_deleted',
  'Reservation Updated': 'reservation_updated',
  'Restock': 'restock',
  'Safety Stock': 'safety_stock',
  'Shrinkage': 'shrinkage',
}

const logger = {
  info: (...args) => console.log('[Shopify Service] info:', ...args),
  debug: (...args) => console.log('[Shopify Service] debug:', ...args),
  error: (...args) => console.log('[Shopify Service] error:', ...args),
  warn: (...args) => console.log('[Shopify Service] warn:', ...args),
}

class ResponseError extends Error {
  constructor(message, httpStatusCode, data) {
    super(message)

    this.message = message
    this.httpStatusCode = httpStatusCode
    this.data = data
  }

  toJSON() {
    return {
      message: this.message,
      httpStatusCode: this.httpStatusCode,
      data: this.data,
    }
  }
}

function searchFilter(items, fields, search) {
  if (!search) {
    return items
  }

  const searchLower = search.toLowerCase()

  return items.filter(item => {
    return fields.some(field => {
      const value = item[field]

      return value && String(value).toLowerCase().includes(searchLower)
    })
  })
}

/**
 * @requireOAuth
 * @integrationTriggersScope SINGLE_APP
 * @integrationName Shopify
 * @integrationIcon /icon.png
 **/
class Shopify {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.shopDomain = config.shopDomain
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  #getShopDomain() {
    return this.shopDomain
  }

  #cleanObject(obj) {
    if (Array.isArray(obj)) {
      return obj.map(item => this.#cleanObject(item))
    }

    if (obj && typeof obj === 'object') {
      return Object.fromEntries(
        Object.entries(obj)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, this.#cleanObject(v)])
      )
    }

    return obj
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #graphqlRequest(query, variables = {}) {
    const shop = this.#getShopDomain()
    const url = `https://${ shop }/admin/api/${ API_VERSION }/graphql.json`

    try {
      logger.debug(`graphqlRequest - shop=${ shop }`)

      const response = await Flowrunner.Request.post(url)
        .set({ 'X-Shopify-Access-Token': this.#getAccessToken() })
        .set({ 'Content-Type': 'application/json' })
        .send({ query, variables: this.#cleanObject(variables) })

      if (response.errors && response.errors.length > 0) {
        const errorMessages = response.errors.map(e => e.message).join('; ')
        throw new ResponseError(`[ShopifyError]: ${ errorMessages }`, 400, { errors: response.errors })
      }

      return response.data
    } catch (error) {
      if (error instanceof ResponseError) {
        throw error
      }

      logger.error(`graphqlRequest - error: ${ error.message }`)

      if (error.body?.errors) {
        const errorMessages = Array.isArray(error.body.errors)
          ? error.body.errors.map(e => e.message).join('; ')
          : JSON.stringify(error.body.errors)
        throw new ResponseError(`[ShopifyError]: ${ errorMessages }`, error.status || 400, error.body)
      }

      throw error
    }
  }

  // ========================================== OAUTH METHODS ===========================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)

    return `https://${ this.shopDomain }/admin/oauth/authorize?${ params.toString() }`
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    // Shopify access tokens don't expire, so we just return the existing token
    return {
      token: refreshToken,
      expirationInSeconds: null,
    }
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const { code } = callbackObject
    const shop = callbackObject.shop || this.shopDomain

    if (!shop) {
      logger.error('[executeCallback] Shop domain not found in callback or configuration')

      return {}
    }

    const tokenUrl = `https://${ shop }/admin/oauth/access_token`

    let tokenResponse = {}

    try {
      tokenResponse = await Flowrunner.Request.post(tokenUrl)
        .set({ 'Content-Type': 'application/json' })
        .send({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code: code,
        })

      logger.debug(`[executeCallback] tokenResponse: ${ JSON.stringify(tokenResponse) }`)
    } catch (error) {
      logger.error(`[executeCallback] token exchange error: ${ error.message }`)

      return {}
    }

    const accessToken = tokenResponse.access_token

    // Fetch shop info over GraphQL (the REST shop.json endpoint is legacy and being retired).
    let shopInfo = {}

    try {
      const shopInfoUrl = `https://${ shop }/admin/api/${ API_VERSION }/graphql.json`
      const shopQuery = `
        query GetShopInfo {
          shop {
            id
            name
            email
            myshopifyDomain
            primaryDomain {
              host
            }
            currencyCode
            ianaTimezone
            plan {
              displayName
            }
          }
        }
      `

      const shopResponse = await Flowrunner.Request.post(shopInfoUrl)
        .set({ 'X-Shopify-Access-Token': accessToken })
        .set({ 'Content-Type': 'application/json' })
        .send({ query: shopQuery })

      shopInfo = shopResponse.data?.shop || {}
      logger.debug(`[executeCallback] shopInfo: ${ JSON.stringify(shopInfo) }`)
    } catch (error) {
      logger.error(`[executeCallback] shop info error: ${ error.message }`)
    }

    return {
      token: accessToken,
      refreshToken: accessToken, // Shopify tokens don't expire
      expirationInSeconds: null,
      connectionIdentityName: shopInfo.name || shop,
      connectionIdentityImageURL: null,
      overwrite: true,
      userData: {
        shop: shop,
        shopId: shopInfo.id,
        email: shopInfo.email,
        domain: shopInfo.primaryDomain?.host,
        myshopifyDomain: shopInfo.myshopifyDomain,
        planName: shopInfo.plan?.displayName,
        currency: shopInfo.currencyCode,
        timezone: shopInfo.ianaTimezone,
      },
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
   * @property {Object} [criteria]
   */

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getOrdersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter orders by order name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Orders Dictionary
   * @description Provides a searchable list of recent orders for selecting an order in dependent parameters. Filter by order name or ID.
   *
   * @route POST /get-orders-dictionary
   *
   * @paramDef {"type":"getOrdersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   *
   * @sampleResult {"cursor":"next_cursor","items":[{"label":"#1001","note":"John Doe - $99.99","value":"gid://shopify/Order/1234567890"}]}
   * @returns {DictionaryResponse}
   */
  async getOrdersDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = `
      query GetOrders($first: Int!, $after: String) {
        orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              customer {
                displayName
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      first: DEFAULT_LIMIT,
      after: cursor || null,
    })

    const orders = data.orders.edges.map(({ node }) => node)
    const filteredOrders = search ? searchFilter(orders, ['name', 'id'], search) : orders

    return {
      cursor: data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null,
      items: filteredOrders.map(order => ({
        label: order.name,
        note: `${ order.customer?.displayName || 'Guest' } - ${ order.totalPriceSet?.shopMoney?.currencyCode || '' } ${ order.totalPriceSet?.shopMoney?.amount || '0' }`,
        value: order.id,
      })),
    }
  }

  /**
   * @typedef {Object} getProductsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter products by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Products Dictionary
   * @description Provides a searchable list of products for selecting a product in dependent parameters. Filter by product title.
   *
   * @route POST /get-products-dictionary
   *
   * @paramDef {"type":"getProductsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   *
   * @sampleResult {"cursor":"next_cursor","items":[{"label":"Blue T-Shirt","note":"SKU: TSHIRT-BLU","value":"gid://shopify/Product/1234567890"}]}
   * @returns {DictionaryResponse}
   */
  async getProductsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = `
      query GetProducts($first: Int!, $after: String, $query: String) {
        products(first: $first, after: $after, query: $query) {
          edges {
            node {
              id
              title
              status
              variants(first: 1) {
                edges {
                  node {
                    sku
                    price
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      first: DEFAULT_LIMIT,
      after: cursor || null,
      query: search || null,
    })

    const products = data.products.edges.map(({ node }) => node)

    return {
      cursor: data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null,
      items: products.map(product => {
        const variant = product.variants?.edges?.[0]?.node

        return {
          label: product.title,
          note: variant?.sku ? `SKU: ${ variant.sku }` : `Status: ${ product.status }`,
          value: product.id,
        }
      }),
    }
  }

  /**
   * @typedef {Object} getCollectionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter collections by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Collections Dictionary
   * @description Provides a searchable list of collections for selecting a collection in dependent parameters. Filter by collection title.
   *
   * @route POST /get-collections-dictionary
   *
   * @paramDef {"type":"getCollectionsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   *
   * @sampleResult {"cursor":"next_cursor","items":[{"label":"Summer Collection","note":"12 products","value":"gid://shopify/Collection/1234567890"}]}
   * @returns {DictionaryResponse}
   */
  async getCollectionsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = `
      query GetCollections($first: Int!, $after: String, $query: String) {
        collections(first: $first, after: $after, query: $query) {
          edges {
            node {
              id
              title
              productsCount {
                count
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      first: DEFAULT_LIMIT,
      after: cursor || null,
      query: search || null,
    })

    const collections = data.collections.edges.map(({ node }) => node)

    return {
      cursor: data.collections.pageInfo.hasNextPage ? data.collections.pageInfo.endCursor : null,
      items: collections.map(collection => ({
        label: collection.title,
        note: `${ collection.productsCount?.count || 0 } products`,
        value: collection.id,
      })),
    }
  }

  /**
   * @typedef {Object} getCustomersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter customers by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customers Dictionary
   * @description Provides a searchable list of customers for selecting a customer in dependent parameters. Filter by name or email.
   *
   * @route POST /get-customers-dictionary
   *
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   *
   * @sampleResult {"cursor":"next_cursor","items":[{"label":"John Doe","note":"john@example.com","value":"gid://shopify/Customer/1234567890"}]}
   * @returns {DictionaryResponse}
   */
  async getCustomersDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = `
      query GetCustomers($first: Int!, $after: String, $query: String) {
        customers(first: $first, after: $after, query: $query) {
          edges {
            node {
              id
              displayName
              email
              numberOfOrders
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      first: DEFAULT_LIMIT,
      after: cursor || null,
      query: search || null,
    })

    const customers = data.customers.edges.map(({ node }) => node)

    return {
      cursor: data.customers.pageInfo.hasNextPage ? data.customers.pageInfo.endCursor : null,
      items: customers.map(customer => ({
        label: customer.displayName || 'Unknown',
        note: customer.email || `${ customer.numberOfOrders || 0 } orders`,
        value: customer.id,
      })),
    }
  }

  /**
   * @typedef {Object} getLocationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter locations by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Locations Dictionary
   * @description Provides a searchable list of store locations for selecting a location in dependent parameters. Filter by location name.
   *
   * @route POST /get-locations-dictionary
   *
   * @paramDef {"type":"getLocationsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   *
   * @sampleResult {"cursor":"next_cursor","items":[{"label":"Main Warehouse","note":"New York, NY","value":"gid://shopify/Location/1234567890"}]}
   * @returns {DictionaryResponse}
   */
  async getLocationsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = `
      query GetLocations($first: Int!, $after: String) {
        locations(first: $first, after: $after) {
          edges {
            node {
              id
              name
              address {
                city
                provinceCode
                country
              }
              isActive
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      first: DEFAULT_LIMIT,
      after: cursor || null,
    })

    let locations = data.locations.edges.map(({ node }) => node)
    locations = search ? searchFilter(locations, ['name'], search) : locations

    return {
      cursor: data.locations.pageInfo.hasNextPage ? data.locations.pageInfo.endCursor : null,
      items: locations.map(location => {
        const address = location.address
        const locationNote = address
          ? `${ address.city || '' }, ${ address.provinceCode || address.country || '' }`.trim()
          : location.isActive ? 'Active' : 'Inactive'

        return {
          label: location.name,
          note: locationNote,
          value: location.id,
        }
      }),
    }
  }

  /**
   * @typedef {Object} getInventoryItemsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter inventory items by product title or SKU."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Inventory Items Dictionary
   * @description Provides a searchable list of inventory items (product variants) for selecting an item in dependent parameters. Filter by SKU.
   *
   * @route POST /get-inventory-items-dictionary
   *
   * @paramDef {"type":"getInventoryItemsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   *
   * @sampleResult {"cursor":"next_cursor","items":[{"label":"Blue T-Shirt - Small","note":"SKU: TSHIRT-BLU-S","value":"gid://shopify/InventoryItem/1234567890"}]}
   * @returns {DictionaryResponse}
   */
  async getInventoryItemsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = `
      query GetProductVariants($first: Int!, $after: String, $query: String) {
        productVariants(first: $first, after: $after, query: $query) {
          edges {
            node {
              id
              title
              sku
              product {
                title
              }
              inventoryItem {
                id
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `

    // A search term is matched against the variant SKU (the usual way a merchant locates an
    // item to restock). Leave it empty to browse the most recent variants.
    const data = await this.#graphqlRequest(query, {
      first: DEFAULT_LIMIT,
      after: cursor || null,
      query: search ? `sku:*${ search }*` : null,
    })

    const variants = data.productVariants.edges.map(({ node }) => node)

    return {
      cursor: data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null,
      items: variants
        .filter(v => v.inventoryItem)
        .map(variant => {
          const productTitle = variant.product?.title
          const variantTitle = variant.title && variant.title !== 'Default Title' ? variant.title : null
          const label = [productTitle, variantTitle].filter(Boolean).join(' - ') || 'Variant'

          return {
            label,
            note: variant.sku ? `SKU: ${ variant.sku }` : 'No SKU',
            value: variant.inventoryItem.id,
          }
        }),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  // ========================================== READ OPERATIONS ===========================================

  /**
   * @description Retrieves a list of orders from your Shopify store with optional filtering and pagination.
   *
   * @route POST /getOrders
   * @operationName Get List of Orders
   * @category Orders
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of orders to retrieve (default: 50, max: 250)."}
   * @paramDef {"type":"String","label":"Payment Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Paid","Pending","Authorized","Partially Paid","Partially Refunded","Refunded","Voided","Expired"]}},"description":"Filter by payment status. Leave empty for all orders."}
   * @paramDef {"type":"String","label":"Fulfillment Status","name":"fulfillmentStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Unfulfilled","Partially Fulfilled","Fulfilled","Shipped","Unshipped","Scheduled","On Hold"]}},"description":"Filter by fulfillment status. Leave empty for all orders."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   *
   * @returns {Object} Returns an object containing orders array and pagination info.
   * @sampleResult {"orders":[{"id":"gid://shopify/Order/123","name":"#1001","createdAt":"2024-01-01T00:00:00Z","totalPrice":"99.99","currency":"USD","financialStatus":"PAID","fulfillmentStatus":"FULFILLED","customer":{"displayName":"John Doe","email":"john@example.com"},"lineItems":[{"title":"Blue T-Shirt","quantity":1}]}],"pageInfo":{"hasNextPage":false,"endCursor":null}}
   */
  async getOrders(limit, status, fulfillmentStatus, cursor) {
    const queryParts = []

    const resolvedStatus = this.#resolveChoice(status, {
      'Paid': 'paid',
      'Pending': 'pending',
      'Authorized': 'authorized',
      'Partially Paid': 'partially_paid',
      'Partially Refunded': 'partially_refunded',
      'Refunded': 'refunded',
      'Voided': 'voided',
      'Expired': 'expired',
    })

    const resolvedFulfillment = this.#resolveChoice(fulfillmentStatus, {
      'Unfulfilled': 'unfulfilled',
      'Partially Fulfilled': 'partial',
      'Fulfilled': 'fulfilled',
      'Shipped': 'shipped',
      'Unshipped': 'unshipped',
      'Scheduled': 'scheduled',
      'On Hold': 'on_hold',
    })

    if (resolvedStatus) {
      queryParts.push(`financial_status:${ resolvedStatus }`)
    }

    if (resolvedFulfillment) {
      queryParts.push(`fulfillment_status:${ resolvedFulfillment }`)
    }

    const queryString = queryParts.length > 0 ? queryParts.join(' AND ') : null

    const query = `
      query GetOrders($first: Int!, $after: String, $query: String) {
        orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              updatedAt
              cancelledAt
              closedAt
              processedAt
              note
              tags
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              subtotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalShippingPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalTaxSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalDiscountsSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              financialStatus: displayFinancialStatus
              fulfillmentStatus: displayFulfillmentStatus
              customer {
                id
                displayName
                email
                phone
              }
              shippingAddress {
                address1
                address2
                city
                province
                country
                zip
                phone
              }
              billingAddress {
                address1
                address2
                city
                province
                country
                zip
              }
              lineItems(first: 50) {
                edges {
                  node {
                    id
                    title
                    quantity
                    variant {
                      id
                      title
                      sku
                      price
                    }
                    originalTotalSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      first: Math.min(limit || DEFAULT_LIMIT, 250),
      after: cursor || null,
      query: queryString,
    })

    const orders = data.orders.edges.map(({ node }) => ({
      ...node,
      totalPrice: node.totalPriceSet?.shopMoney?.amount,
      currency: node.totalPriceSet?.shopMoney?.currencyCode,
      subtotalPrice: node.subtotalPriceSet?.shopMoney?.amount,
      totalShipping: node.totalShippingPriceSet?.shopMoney?.amount,
      totalTax: node.totalTaxSet?.shopMoney?.amount,
      totalDiscounts: node.totalDiscountsSet?.shopMoney?.amount,
      lineItems: node.lineItems.edges.map(({ node: item }) => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        variantId: item.variant?.id,
        variantTitle: item.variant?.title,
        sku: item.variant?.sku,
        price: item.variant?.price,
        totalPrice: item.originalTotalSet?.shopMoney?.amount,
      })),
    }))

    return {
      orders,
      pageInfo: data.orders.pageInfo,
    }
  }

  /**
   * @description Retrieves a single order by its ID with full details including line items, customer, and addresses.
   *
   * @route POST /getOrder
   * @operationName Get Order
   * @category Orders
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The unique identifier of the order to retrieve."}
   *
   * @returns {Object} Returns the order object with full details.
   * @sampleResult {"id":"gid://shopify/Order/123","name":"#1001","createdAt":"2024-01-01T00:00:00Z","totalPrice":"99.99","currency":"USD","financialStatus":"PAID","fulfillmentStatus":"FULFILLED","customer":{"displayName":"John Doe","email":"john@example.com"},"lineItems":[{"title":"Blue T-Shirt","quantity":1,"price":"49.99"}]}
   */
  async getOrder(orderId) {
    const query = `
      query GetOrder($id: ID!) {
        order(id: $id) {
          id
          name
          createdAt
          updatedAt
          cancelledAt
          closedAt
          processedAt
          note
          tags
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          subtotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalShippingPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalTaxSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalDiscountsSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalRefundedSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          financialStatus: displayFinancialStatus
          fulfillmentStatus: displayFulfillmentStatus
          email
          phone
          customer {
            id
            displayName
            email
            phone
            numberOfOrders
          }
          shippingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            provinceCode
            country
            countryCode
            zip
            phone
          }
          billingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            provinceCode
            country
            countryCode
            zip
          }
          lineItems(first: 100) {
            edges {
              node {
                id
                title
                quantity
                variant {
                  id
                  title
                  sku
                  price
                }
                originalTotalSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                discountedTotalSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
          fulfillments {
            id
            status
            createdAt
            trackingInfo {
              company
              number
              url
            }
          }
          refunds {
            id
            createdAt
            note
            totalRefundedSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
          transactions {
            id
            kind
            status
            gateway
            amountSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, { id: orderId })

    if (!data.order) {
      throw new Error(`Order not found: ${ orderId }`)
    }

    const order = data.order

    return {
      ...order,
      totalPrice: order.totalPriceSet?.shopMoney?.amount,
      currency: order.totalPriceSet?.shopMoney?.currencyCode,
      subtotalPrice: order.subtotalPriceSet?.shopMoney?.amount,
      totalShipping: order.totalShippingPriceSet?.shopMoney?.amount,
      totalTax: order.totalTaxSet?.shopMoney?.amount,
      totalDiscounts: order.totalDiscountsSet?.shopMoney?.amount,
      totalRefunded: order.totalRefundedSet?.shopMoney?.amount,
      lineItems: order.lineItems.edges.map(({ node: item }) => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        variantId: item.variant?.id,
        variantTitle: item.variant?.title,
        sku: item.variant?.sku,
        price: item.variant?.price,
        totalPrice: item.originalTotalSet?.shopMoney?.amount,
        discountedPrice: item.discountedTotalSet?.shopMoney?.amount,
      })),
      transactions: order.transactions?.map(t => ({
        id: t.id,
        kind: t.kind,
        status: t.status,
        gateway: t.gateway,
        amount: t.amountSet?.shopMoney?.amount,
      })),
    }
  }

  /**
   * @description Retrieves a list of products from your Shopify store with optional filtering and pagination.
   *
   * @route POST /getProducts
   * @operationName Get List of Products
   * @category Products
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of products to retrieve (default: 50, max: 250)."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Draft","Archived"]}},"description":"Filter by product status. Leave empty for all products."}
   * @paramDef {"type":"String","label":"Search Query","name":"searchQuery","description":"Search products by title, vendor, or product type."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   *
   * @returns {Object} Returns an object containing products array and pagination info.
   * @sampleResult {"products":[{"id":"gid://shopify/Product/123","title":"Blue T-Shirt","status":"ACTIVE","vendor":"My Store","productType":"Clothing","variants":[{"id":"gid://shopify/ProductVariant/456","title":"Small","price":"29.99","sku":"TSHIRT-S"}]}],"pageInfo":{"hasNextPage":false,"endCursor":null}}
   */
  async getProducts(limit, status, searchQuery, cursor) {
    const queryParts = []

    const resolvedStatus = this.#resolveChoice(status, { 'Active': 'ACTIVE', 'Draft': 'DRAFT', 'Archived': 'ARCHIVED' })

    if (resolvedStatus) {
      queryParts.push(`status:${ resolvedStatus }`)
    }

    if (searchQuery) {
      queryParts.push(searchQuery)
    }

    const queryString = queryParts.length > 0 ? queryParts.join(' AND ') : null

    const query = `
      query GetProducts($first: Int!, $after: String, $query: String) {
        products(first: $first, after: $after, query: $query) {
          edges {
            node {
              id
              title
              handle
              description
              descriptionHtml
              status
              vendor
              productType
              tags
              createdAt
              updatedAt
              publishedAt
              totalInventory
              featuredImage {
                url
                altText
              }
              images(first: 10) {
                edges {
                  node {
                    url
                    altText
                  }
                }
              }
              variants(first: 100) {
                edges {
                  node {
                    id
                    title
                    sku
                    price
                    compareAtPrice
                    inventoryQuantity
                    barcode
                    inventoryItem {
                      id
                    }
                    selectedOptions {
                      name
                      value
                    }
                  }
                }
              }
              options {
                id
                name
                values
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      first: Math.min(limit || DEFAULT_LIMIT, 250),
      after: cursor || null,
      query: queryString,
    })

    const products = data.products.edges.map(({ node }) => ({
      ...node,
      featuredImageUrl: node.featuredImage?.url,
      images: node.images.edges.map(({ node: img }) => ({
        url: img.url,
        altText: img.altText,
      })),
      variants: node.variants.edges.map(({ node: variant }) => ({
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        inventoryQuantity: variant.inventoryQuantity,
        barcode: variant.barcode,
        inventoryItemId: variant.inventoryItem?.id,
        options: variant.selectedOptions,
      })),
    }))

    return {
      products,
      pageInfo: data.products.pageInfo,
    }
  }

  /**
   * @description Retrieves a single product by its ID with full details including variants, images, and options.
   *
   * @route POST /getProduct
   * @operationName Get Product
   * @category Products
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Product ID","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The unique identifier of the product to retrieve."}
   *
   * @returns {Object} Returns the product object with full details.
   * @sampleResult {"id":"gid://shopify/Product/123","title":"Blue T-Shirt","status":"ACTIVE","vendor":"My Store","productType":"Clothing","description":"A comfortable blue t-shirt","variants":[{"id":"gid://shopify/ProductVariant/456","title":"Small","price":"29.99","sku":"TSHIRT-S","inventoryQuantity":50}]}
   */
  async getProduct(productId) {
    const query = `
      query GetProduct($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          description
          descriptionHtml
          status
          vendor
          productType
          tags
          createdAt
          updatedAt
          publishedAt
          totalInventory
          seo {
            title
            description
          }
          featuredImage {
            url
            altText
          }
          images(first: 50) {
            edges {
              node {
                id
                url
                altText
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                price
                compareAtPrice
                inventoryQuantity
                barcode
                inventoryItem {
                  id
                  tracked
                }
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
          options {
            id
            name
            values
          }
          collections(first: 20) {
            edges {
              node {
                id
                title
              }
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, { id: productId })

    if (!data.product) {
      throw new Error(`Product not found: ${ productId }`)
    }

    const product = data.product

    return {
      ...product,
      featuredImageUrl: product.featuredImage?.url,
      images: product.images.edges.map(({ node: img }) => ({
        id: img.id,
        url: img.url,
        altText: img.altText,
      })),
      variants: product.variants.edges.map(({ node: variant }) => ({
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        inventoryQuantity: variant.inventoryQuantity,
        barcode: variant.barcode,
        inventoryItemId: variant.inventoryItem?.id,
        tracked: variant.inventoryItem?.tracked,
        options: variant.selectedOptions,
      })),
      collections: product.collections.edges.map(({ node }) => ({
        id: node.id,
        title: node.title,
      })),
    }
  }

  /**
   * @description Retrieves a list of collections from your Shopify store.
   *
   * @route POST /getCollections
   * @operationName Get List of Collections
   * @category Collections
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of collections to retrieve (default: 50, max: 250)."}
   * @paramDef {"type":"String","label":"Search Query","name":"searchQuery","description":"Search collections by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   *
   * @returns {Object} Returns an object containing collections array and pagination info.
   * @sampleResult {"collections":[{"id":"gid://shopify/Collection/123","title":"Summer Collection","description":"Our summer collection","productsCount":24}],"pageInfo":{"hasNextPage":false,"endCursor":null}}
   */
  async getCollections(limit, searchQuery, cursor) {
    const query = `
      query GetCollections($first: Int!, $after: String, $query: String) {
        collections(first: $first, after: $after, query: $query) {
          edges {
            node {
              id
              title
              handle
              description
              descriptionHtml
              updatedAt
              productsCount {
                count
              }
              image {
                url
                altText
              }
              seo {
                title
                description
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      first: Math.min(limit || DEFAULT_LIMIT, 250),
      after: cursor || null,
      query: searchQuery || null,
    })

    const collections = data.collections.edges.map(({ node }) => ({
      ...node,
      productsCount: node.productsCount?.count || 0,
      imageUrl: node.image?.url,
    }))

    return {
      collections,
      pageInfo: data.collections.pageInfo,
    }
  }

  /**
   * @description Retrieves a single collection by its ID with product list.
   *
   * @route POST /getCollection
   * @operationName Get Collection
   * @category Collections
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Collection ID","name":"collectionId","required":true,"dictionary":"getCollectionsDictionary","description":"The unique identifier of the collection to retrieve."}
   * @paramDef {"type":"Number","label":"Products Limit","name":"productsLimit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of products to include (default: 50)."}
   *
   * @returns {Object} Returns the collection object with product list.
   * @sampleResult {"id":"gid://shopify/Collection/123","title":"Summer Collection","description":"Our summer collection","productsCount":24,"products":[{"id":"gid://shopify/Product/456","title":"Blue T-Shirt"}]}
   */
  async getCollection(collectionId, productsLimit) {
    const query = `
      query GetCollection($id: ID!, $productsFirst: Int!) {
        collection(id: $id) {
          id
          title
          handle
          description
          descriptionHtml
          updatedAt
          productsCount {
            count
          }
          image {
            url
            altText
          }
          seo {
            title
            description
          }
          products(first: $productsFirst) {
            edges {
              node {
                id
                title
                handle
                status
                featuredImage {
                  url
                }
                variants(first: 1) {
                  edges {
                    node {
                      price
                    }
                  }
                }
              }
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      id: collectionId,
      productsFirst: Math.min(productsLimit || DEFAULT_LIMIT, 250),
    })

    if (!data.collection) {
      throw new Error(`Collection not found: ${ collectionId }`)
    }

    const collection = data.collection

    return {
      ...collection,
      productsCount: collection.productsCount?.count || 0,
      imageUrl: collection.image?.url,
      products: collection.products.edges.map(({ node }) => ({
        id: node.id,
        title: node.title,
        handle: node.handle,
        status: node.status,
        featuredImageUrl: node.featuredImage?.url,
        price: node.variants?.edges?.[0]?.node?.price,
      })),
    }
  }

  /**
   * @description Retrieves a list of customers from your Shopify store.
   *
   * @route POST /getCustomers
   * @operationName Get List of Customers
   * @category Customers
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of customers to retrieve (default: 50, max: 250)."}
   * @paramDef {"type":"String","label":"Search Query","name":"searchQuery","description":"Search customers by name, email, or phone."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   *
   * @returns {Object} Returns an object containing customers array and pagination info.
   * @sampleResult {"customers":[{"id":"gid://shopify/Customer/123","displayName":"John Doe","email":"john@example.com","phone":"+1234567890","ordersCount":5,"totalSpent":"499.95"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}
   */
  async getCustomers(limit, searchQuery, cursor) {
    const query = `
      query GetCustomers($first: Int!, $after: String, $query: String) {
        customers(first: $first, after: $after, query: $query) {
          edges {
            node {
              id
              displayName
              firstName
              lastName
              email
              phone
              createdAt
              updatedAt
              note
              tags
              verifiedEmail
              taxExempt
              numberOfOrders
              amountSpent {
                amount
                currencyCode
              }
              defaultAddress {
                address1
                address2
                city
                province
                country
                zip
                phone
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      first: Math.min(limit || DEFAULT_LIMIT, 250),
      after: cursor || null,
      query: searchQuery || null,
    })

    const customers = data.customers.edges.map(({ node }) => ({
      ...node,
      ordersCount: node.numberOfOrders || 0,
      totalSpent: node.amountSpent?.amount,
      currency: node.amountSpent?.currencyCode,
    }))

    return {
      customers,
      pageInfo: data.customers.pageInfo,
    }
  }

  /**
   * @description Retrieves a single customer by their ID with full details including addresses and order history.
   *
   * @route POST /getCustomer
   * @operationName Get Customer
   * @category Customers
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The unique identifier of the customer to retrieve."}
   *
   * @returns {Object} Returns the customer object with full details.
   * @sampleResult {"id":"gid://shopify/Customer/123","displayName":"John Doe","firstName":"John","lastName":"Doe","email":"john@example.com","phone":"+1234567890","ordersCount":5,"totalSpent":"499.95","addresses":[{"address1":"123 Main St","city":"New York","country":"US"}]}
   */
  async getCustomer(customerId) {
    const query = `
      query GetCustomer($id: ID!) {
        customer(id: $id) {
          id
          displayName
          firstName
          lastName
          email
          phone
          createdAt
          updatedAt
          note
          tags
          verifiedEmail
          taxExempt
          locale
          numberOfOrders
          amountSpent {
            amount
            currencyCode
          }
          defaultAddress {
            id
            firstName
            lastName
            address1
            address2
            city
            province
            provinceCode
            country
            countryCode
            zip
            phone
          }
          addresses {
            id
            firstName
            lastName
            address1
            address2
            city
            province
            provinceCode
            country
            countryCode
            zip
            phone
          }
          orders(first: 10) {
            edges {
              node {
                id
                name
                createdAt
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                displayFinancialStatus
                displayFulfillmentStatus
              }
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, { id: customerId })

    if (!data.customer) {
      throw new Error(`Customer not found: ${ customerId }`)
    }

    const customer = data.customer

    return {
      ...customer,
      ordersCount: customer.numberOfOrders || 0,
      totalSpent: customer.amountSpent?.amount,
      currency: customer.amountSpent?.currencyCode,
      recentOrders: customer.orders?.edges?.map(({ node }) => ({
        id: node.id,
        name: node.name,
        createdAt: node.createdAt,
        totalPrice: node.totalPriceSet?.shopMoney?.amount,
        currency: node.totalPriceSet?.shopMoney?.currencyCode,
        financialStatus: node.displayFinancialStatus,
        fulfillmentStatus: node.displayFulfillmentStatus,
      })),
    }
  }

  /**
   * @description Retrieves a list of store locations.
   *
   * @route POST /getLocations
   * @operationName Get List of Locations
   * @category Inventory
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of locations to retrieve (default: 50)."}
   *
   * @returns {Object} Returns an object containing locations array.
   * @sampleResult {"locations":[{"id":"gid://shopify/Location/123","name":"Main Warehouse","address":{"address1":"123 Warehouse St","city":"New York","country":"US"},"isActive":true}]}
   */
  async getLocations(limit) {
    const query = `
      query GetLocations($first: Int!) {
        locations(first: $first) {
          edges {
            node {
              id
              name
              isActive
              fulfillsOnlineOrders
              hasActiveInventory
              shipsInventory
              address {
                address1
                address2
                city
                province
                provinceCode
                country
                countryCode
                zip
                phone
              }
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      first: Math.min(limit || DEFAULT_LIMIT, 250),
    })

    const locations = data.locations.edges.map(({ node }) => node)

    return { locations }
  }

  /**
   * @description Retrieves a single location by its ID with inventory levels.
   *
   * @route POST /getLocation
   * @operationName Get Location
   * @category Inventory
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"The unique identifier of the location to retrieve."}
   *
   * @returns {Object} Returns the location object with details.
   * @sampleResult {"id":"gid://shopify/Location/123","name":"Main Warehouse","address":{"address1":"123 Warehouse St","city":"New York","country":"US"},"isActive":true}
   */
  async getLocation(locationId) {
    const query = `
      query GetLocation($id: ID!) {
        location(id: $id) {
          id
          name
          isActive
          fulfillsOnlineOrders
          hasActiveInventory
          shipsInventory
          address {
            address1
            address2
            city
            province
            provinceCode
            country
            countryCode
            zip
            phone
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, { id: locationId })

    if (!data.location) {
      throw new Error(`Location not found: ${ locationId }`)
    }

    return data.location
  }

  /**
   * @description Retrieves inventory levels for a specific location.
   *
   * @route POST /getInventoryLevels
   * @operationName Get List of Inventory Levels
   * @category Inventory
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"The location to get inventory levels for."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of inventory items to retrieve (default: 50)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   *
   * @returns {Object} Returns inventory levels for the location.
   * @sampleResult {"inventoryLevels":[{"inventoryItemId":"gid://shopify/InventoryItem/123","available":50,"productTitle":"Blue T-Shirt","variantTitle":"Small","sku":"TSHIRT-S"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}
   */
  async getInventoryLevels(locationId, limit, cursor) {
    const query = `
      query GetInventoryLevels($locationId: ID!, $first: Int!, $after: String) {
        location(id: $locationId) {
          inventoryLevels(first: $first, after: $after) {
            edges {
              node {
                id
                quantities(names: ["available", "incoming", "committed", "damaged", "on_hand", "reserved", "safety_stock"]) {
                  name
                  quantity
                }
                item {
                  id
                  sku
                  variant {
                    id
                    title
                    product {
                      id
                      title
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      locationId,
      first: Math.min(limit || DEFAULT_LIMIT, 250),
      after: cursor || null,
    })

    if (!data.location) {
      throw new Error(`Location not found: ${ locationId }`)
    }

    const inventoryLevels = data.location.inventoryLevels.edges.map(({ node }) => {
      const quantities = {}

      node.quantities?.forEach(q => {
        quantities[q.name] = q.quantity
      })

      return {
        id: node.id,
        inventoryItemId: node.item?.id,
        sku: node.item?.sku,
        variantId: node.item?.variant?.id,
        variantTitle: node.item?.variant?.title,
        productId: node.item?.variant?.product?.id,
        productTitle: node.item?.variant?.product?.title,
        available: quantities.available || 0,
        incoming: quantities.incoming || 0,
        committed: quantities.committed || 0,
        damaged: quantities.damaged || 0,
        onHand: quantities.on_hand || 0,
        reserved: quantities.reserved || 0,
        safetyStock: quantities.safety_stock || 0,
      }
    })

    return {
      inventoryLevels,
      pageInfo: data.location.inventoryLevels.pageInfo,
    }
  }

  /**
   * @description Retrieves the shop's Shopify Payments account balance.
   *
   * @route POST /getShopBalance
   * @operationName Get Shop Balance
   * @category Payouts
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object} Returns the shop's payment balance.
   * @sampleResult {"balance":[{"amount":"1234.56","currency":"USD"}]}
   */
  async getShopBalance() {
    const query = `
      query GetShopBalance {
        shopifyPaymentsAccount {
          balance {
            amount
            currencyCode
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query)

    if (!data.shopifyPaymentsAccount) {
      return { balance: [], message: 'Shopify Payments is not enabled for this store' }
    }

    const balance = data.shopifyPaymentsAccount.balance || []

    return {
      balance: balance.map(b => ({
        amount: b.amount,
        currency: b.currencyCode,
      })),
    }
  }

  /**
   * @description Retrieves a list of payouts from your Shopify Payments account.
   *
   * @route POST /getPayouts
   * @operationName Get List of Payouts
   * @category Payouts
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of payouts to retrieve (default: 50)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   *
   * @returns {Object} Returns an object containing payouts array and pagination info.
   * @sampleResult {"payouts":[{"id":"gid://shopify/ShopifyPaymentsPayout/123","issuedAt":"2024-01-01T00:00:00Z","amount":"1234.56","currency":"USD","status":"PAID"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}
   */
  async getPayouts(limit, cursor) {
    const query = `
      query GetPayouts($first: Int!, $after: String) {
        shopifyPaymentsAccount {
          payouts(first: $first, after: $after) {
            edges {
              node {
                id
                issuedAt
                net {
                  amount
                  currencyCode
                }
                gross {
                  amount
                  currencyCode
                }
                status
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      first: Math.min(limit || DEFAULT_LIMIT, 250),
      after: cursor || null,
    })

    if (!data.shopifyPaymentsAccount) {
      return {
        payouts: [],
        pageInfo: { hasNextPage: false, endCursor: null },
        message: 'Shopify Payments is not enabled for this store',
      }
    }

    const payouts = data.shopifyPaymentsAccount.payouts.edges.map(({ node }) => ({
      id: node.id,
      issuedAt: node.issuedAt,
      netAmount: node.net?.amount,
      grossAmount: node.gross?.amount,
      currency: node.net?.currencyCode,
      status: node.status,
    }))

    return {
      payouts,
      pageInfo: data.shopifyPaymentsAccount.payouts.pageInfo,
    }
  }

  /**
   * @description Retrieves a list of payment disputes from your Shopify Payments account.
   *
   * @route POST /getDisputes
   * @operationName Get List of Disputes
   * @category Payouts
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of disputes to retrieve (default: 50)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   *
   * @returns {Object} Returns an object containing disputes array and pagination info.
   * @sampleResult {"disputes":[{"id":"gid://shopify/ShopifyPaymentsDispute/123","initiatedAt":"2024-01-01T00:00:00Z","amount":"99.99","currency":"USD","status":"OPEN","reasonDetails":{"reason":"FRAUDULENT"}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}
   */
  async getDisputes(limit, cursor) {
    const query = `
      query GetDisputes($first: Int!, $after: String) {
        shopifyPaymentsAccount {
          disputes(first: $first, after: $after) {
            edges {
              node {
                id
                initiatedAt
                amount {
                  amount
                  currencyCode
                }
                status
                reasonDetails {
                  reason
                }
                evidenceDueBy
                finalizedOn
                order {
                  id
                  name
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, {
      first: Math.min(limit || DEFAULT_LIMIT, 250),
      after: cursor || null,
    })

    if (!data.shopifyPaymentsAccount) {
      return {
        disputes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
        message: 'Shopify Payments is not enabled for this store',
      }
    }

    const disputes = data.shopifyPaymentsAccount.disputes.edges.map(({ node }) => ({
      id: node.id,
      initiatedAt: node.initiatedAt,
      amount: node.amount?.amount,
      currency: node.amount?.currencyCode,
      status: node.status,
      reason: node.reasonDetails?.reason,
      evidenceDueBy: node.evidenceDueBy,
      finalizedOn: node.finalizedOn,
      orderId: node.order?.id,
      orderName: node.order?.name,
    }))

    return {
      disputes,
      pageInfo: data.shopifyPaymentsAccount.disputes.pageInfo,
    }
  }

  // ========================================== WRITE OPERATIONS ===========================================

  /**
   * @description Creates a new customer in your Shopify store.
   *
   * @route POST /createCustomer
   * @operationName Create Customer
   * @category Customers
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Customer's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Customer's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Customer's email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Customer's phone number in E.164 format (e.g., +14155552671)."}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"A note about the customer."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to add to the customer."}
   * @paramDef {"type":"Boolean","label":"Tax Exempt","name":"taxExempt","uiComponent":{"type":"TOGGLE"},"description":"Whether the customer is exempt from taxes."}
   * @paramDef {"type":"Boolean","label":"Accepts Marketing","name":"acceptsMarketing","uiComponent":{"type":"TOGGLE"},"description":"Whether the customer has consented to receive marketing material."}
   *
   * @returns {Object} Returns the created customer object.
   * @sampleResult {"id":"gid://shopify/Customer/123","displayName":"John Doe","email":"john@example.com","phone":"+14155552671"}
   */
  async createCustomer(firstName, lastName, email, phone, note, tags, taxExempt, acceptsMarketing) {
    const mutation = `
      mutation CustomerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
            displayName
            firstName
            lastName
            email
            phone
            note
            tags
            taxExempt
            createdAt
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const input = {}

    if (email) input.email = email
    if (firstName) input.firstName = firstName
    if (lastName) input.lastName = lastName
    if (phone) input.phone = phone
    if (note) input.note = note
    if (tags && tags.length > 0) input.tags = tags
    if (typeof taxExempt === 'boolean') input.taxExempt = taxExempt

    if (acceptsMarketing && email) {
      input.emailMarketingConsent = {
        marketingState: 'SUBSCRIBED',
        marketingOptInLevel: 'SINGLE_OPT_IN',
      }
    }

    const data = await this.#graphqlRequest(mutation, { input })

    if (data.customerCreate.userErrors?.length > 0) {
      const errors = data.customerCreate.userErrors.map(e => e.message).join('; ')
      throw new Error(`Failed to create customer: ${ errors }`)
    }

    return data.customerCreate.customer
  }

  /**
   * @description Updates an existing customer in your Shopify store.
   *
   * @route POST /updateCustomer
   * @operationName Update Customer
   * @category Customers
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The unique identifier of the customer to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Customer's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Customer's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Customer's email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Customer's phone number."}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"A note about the customer."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags for the customer (replaces existing tags)."}
   * @paramDef {"type":"Boolean","label":"Tax Exempt","name":"taxExempt","uiComponent":{"type":"TOGGLE"},"description":"Whether the customer is exempt from taxes."}
   *
   * @returns {Object} Returns the updated customer object.
   * @sampleResult {"id":"gid://shopify/Customer/123","displayName":"John Doe","email":"john@example.com"}
   */
  async updateCustomer(customerId, firstName, lastName, email, phone, note, tags, taxExempt) {
    const mutation = `
      mutation CustomerUpdate($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer {
            id
            displayName
            firstName
            lastName
            email
            phone
            note
            tags
            taxExempt
            updatedAt
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const input = { id: customerId }

    if (firstName !== undefined) input.firstName = firstName
    if (lastName !== undefined) input.lastName = lastName
    if (email !== undefined) input.email = email
    if (phone !== undefined) input.phone = phone
    if (note !== undefined) input.note = note
    if (tags !== undefined) input.tags = tags
    if (typeof taxExempt === 'boolean') input.taxExempt = taxExempt

    const data = await this.#graphqlRequest(mutation, { input })

    if (data.customerUpdate.userErrors?.length > 0) {
      const errors = data.customerUpdate.userErrors.map(e => e.message).join('; ')
      throw new Error(`Failed to update customer: ${ errors }`)
    }

    return data.customerUpdate.customer
  }

  /**
   * @description Deletes a customer from your Shopify store.
   *
   * @route POST /deleteCustomer
   * @operationName Delete Customer
   * @category Customers
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The unique identifier of the customer to delete."}
   *
   * @returns {Object} Returns the deletion result.
   * @sampleResult {"deletedCustomerId":"gid://shopify/Customer/123","deleted":true}
   */
  async deleteCustomer(customerId) {
    const mutation = `
      mutation CustomerDelete($input: CustomerDeleteInput!) {
        customerDelete(input: $input) {
          deletedCustomerId
          userErrors {
            field
            message
          }
        }
      }
    `

    const data = await this.#graphqlRequest(mutation, {
      input: { id: customerId },
    })

    if (data.customerDelete.userErrors?.length > 0) {
      const errors = data.customerDelete.userErrors.map(e => e.message).join('; ')
      throw new Error(`Failed to delete customer: ${ errors }`)
    }

    return {
      deletedCustomerId: data.customerDelete.deletedCustomerId,
      deleted: true,
    }
  }

  /**
   * @description Adds products to a collection.
   *
   * @route POST /addProductsToCollection
   * @operationName Add Products to Collection
   * @category Collections
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Collection ID","name":"collectionId","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to add products to."}
   * @paramDef {"type":"Array<String>","label":"Product IDs","name":"productIds","required":true,"dictionary":"getProductsDictionary","description":"Array of product IDs to add to the collection."}
   *
   * @returns {Object} Returns the updated collection.
   * @sampleResult {"collectionId":"gid://shopify/Collection/123","added":true,"productsAdded":5}
   */
  async addProductsToCollection(collectionId, productIds) {
    const mutation = `
      mutation CollectionAddProducts($id: ID!, $productIds: [ID!]!) {
        collectionAddProducts(id: $id, productIds: $productIds) {
          collection {
            id
            title
            productsCount {
              count
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const data = await this.#graphqlRequest(mutation, {
      id: collectionId,
      productIds: Array.isArray(productIds) ? productIds : [productIds],
    })

    if (data.collectionAddProducts.userErrors?.length > 0) {
      const errors = data.collectionAddProducts.userErrors.map(e => e.message).join('; ')
      throw new Error(`Failed to add products to collection: ${ errors }`)
    }

    const collection = data.collectionAddProducts.collection

    return {
      collectionId: collection.id,
      collectionTitle: collection.title,
      productsCount: collection.productsCount?.count || 0,
      added: true,
    }
  }

  /**
   * @description Removes products from a collection.
   *
   * @route POST /removeProductsFromCollection
   * @operationName Remove Products from Collection
   * @category Collections
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Collection ID","name":"collectionId","required":true,"dictionary":"getCollectionsDictionary","description":"The collection to remove products from."}
   * @paramDef {"type":"Array<String>","label":"Product IDs","name":"productIds","required":true,"dictionary":"getProductsDictionary","description":"Array of product IDs to remove from the collection."}
   *
   * @returns {Object} Returns the updated collection.
   * @sampleResult {"collectionId":"gid://shopify/Collection/123","removed":true}
   */
  async removeProductsFromCollection(collectionId, productIds) {
    const mutation = `
      mutation CollectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
        collectionRemoveProducts(id: $id, productIds: $productIds) {
          userErrors {
            field
            message
          }
        }
      }
    `

    const data = await this.#graphqlRequest(mutation, {
      id: collectionId,
      productIds: Array.isArray(productIds) ? productIds : [productIds],
    })

    if (data.collectionRemoveProducts.userErrors?.length > 0) {
      const errors = data.collectionRemoveProducts.userErrors.map(e => e.message).join('; ')
      throw new Error(`Failed to remove products from collection: ${ errors }`)
    }

    return {
      collectionId,
      removed: true,
    }
  }

  /**
   * @description Adjusts inventory levels for an item at a location by a delta amount.
   *
   * @route POST /adjustInventoryLevels
   * @operationName Adjust Inventory Levels
   * @category Inventory
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Inventory Item ID","name":"inventoryItemId","required":true,"dictionary":"getInventoryItemsDictionary","description":"The inventory item to adjust."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"The location where the adjustment takes place."}
   * @paramDef {"type":"Number","label":"Delta","name":"delta","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The amount to adjust by (positive to add, negative to subtract)."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Correction","Cycle Count","Damaged","Movement Canceled","Movement Created","Movement Received","Movement Updated","Other","Promotion","Quality Control","Received","Reservation Created","Reservation Deleted","Reservation Updated","Restock","Safety Stock","Shrinkage"]}},"description":"The reason for the adjustment."}
   *
   * @returns {Object} Returns the adjustment result.
   * @sampleResult {"inventoryItemId":"gid://shopify/InventoryItem/123","locationId":"gid://shopify/Location/456","delta":10,"adjusted":true}
   */
  async adjustInventoryLevels(inventoryItemId, locationId, delta, reason) {
    const mutation = `
      mutation InventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          inventoryAdjustmentGroup {
            reason
            changes {
              delta
              quantityAfterChange
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const input = {
      reason: this.#resolveChoice(reason, INVENTORY_REASON_MAP) || 'correction',
      name: 'available',
      changes: [
        {
          inventoryItemId,
          locationId,
          delta: parseInt(delta, 10),
        },
      ],
    }

    const data = await this.#graphqlRequest(mutation, { input })

    if (data.inventoryAdjustQuantities.userErrors?.length > 0) {
      const errors = data.inventoryAdjustQuantities.userErrors.map(e => e.message).join('; ')
      throw new Error(`Failed to adjust inventory: ${ errors }`)
    }

    const change = data.inventoryAdjustQuantities.inventoryAdjustmentGroup?.changes?.[0]

    return {
      inventoryItemId,
      locationId,
      delta,
      quantityAfterChange: change?.quantityAfterChange,
      adjusted: true,
    }
  }

  /**
   * @description Sets the absolute inventory quantity for an item at a location.
   *
   * @route POST /setInventoryQuantities
   * @operationName Set Inventory Quantities
   * @category Inventory
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Inventory Item ID","name":"inventoryItemId","required":true,"dictionary":"getInventoryItemsDictionary","description":"The inventory item to update."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"The location where the inventory is set."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The absolute quantity to set."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Correction","Cycle Count","Damaged","Movement Canceled","Movement Created","Movement Received","Movement Updated","Other","Promotion","Quality Control","Received","Reservation Created","Reservation Deleted","Reservation Updated","Restock","Safety Stock","Shrinkage"]}},"description":"The reason for setting the quantity."}
   *
   * @returns {Object} Returns the update result.
   * @sampleResult {"inventoryItemId":"gid://shopify/InventoryItem/123","locationId":"gid://shopify/Location/456","quantity":100,"updated":true}
   */
  async setInventoryQuantities(inventoryItemId, locationId, quantity, reason) {
    const mutation = `
      mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup {
            reason
            changes {
              quantityAfterChange
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const input = {
      reason: this.#resolveChoice(reason, INVENTORY_REASON_MAP) || 'correction',
      name: 'available',
      ignoreCompareQuantity: true,
      quantities: [
        {
          inventoryItemId,
          locationId,
          quantity: parseInt(quantity, 10),
        },
      ],
    }

    const data = await this.#graphqlRequest(mutation, { input })

    if (data.inventorySetQuantities.userErrors?.length > 0) {
      const errors = data.inventorySetQuantities.userErrors.map(e => e.message).join('; ')
      throw new Error(`Failed to set inventory quantity: ${ errors }`)
    }

    return {
      inventoryItemId,
      locationId,
      quantity,
      updated: true,
    }
  }

  /**
   * @description Updates an inventory item's properties.
   *
   * @route POST /updateInventoryItem
   * @operationName Update Inventory Item
   * @category Inventory
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Inventory Item ID","name":"inventoryItemId","required":true,"dictionary":"getInventoryItemsDictionary","description":"The inventory item to update."}
   * @paramDef {"type":"Boolean","label":"Tracked","name":"tracked","uiComponent":{"type":"TOGGLE"},"description":"Whether inventory tracking is enabled."}
   * @paramDef {"type":"String","label":"Country Code of Origin","name":"countryCodeOfOrigin","description":"ISO 3166-1 alpha-2 country code for the country of origin."}
   * @paramDef {"type":"String","label":"Province Code of Origin","name":"provinceCodeOfOrigin","description":"Province/state code for the province of origin."}
   * @paramDef {"type":"String","label":"Harmonized System Code","name":"harmonizedSystemCode","description":"The harmonized system code for customs."}
   *
   * @returns {Object} Returns the updated inventory item.
   * @sampleResult {"id":"gid://shopify/InventoryItem/123","tracked":true,"countryCodeOfOrigin":"US","updated":true}
   */
  async updateInventoryItem(inventoryItemId, tracked, countryCodeOfOrigin, provinceCodeOfOrigin, harmonizedSystemCode) {
    const mutation = `
      mutation InventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          inventoryItem {
            id
            tracked
            countryCodeOfOrigin
            provinceCodeOfOrigin
            harmonizedSystemCode
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const input = {}

    if (tracked !== undefined) input.tracked = tracked
    if (countryCodeOfOrigin !== undefined) input.countryCodeOfOrigin = countryCodeOfOrigin
    if (provinceCodeOfOrigin !== undefined) input.provinceCodeOfOrigin = provinceCodeOfOrigin
    if (harmonizedSystemCode !== undefined) input.harmonizedSystemCode = harmonizedSystemCode

    const data = await this.#graphqlRequest(mutation, {
      id: inventoryItemId,
      input,
    })

    if (data.inventoryItemUpdate.userErrors?.length > 0) {
      const errors = data.inventoryItemUpdate.userErrors.map(e => e.message).join('; ')
      throw new Error(`Failed to update inventory item: ${ errors }`)
    }

    return {
      ...data.inventoryItemUpdate.inventoryItem,
      updated: true,
    }
  }

  /**
   * @description Adds tags to a resource (order, customer, product, etc.).
   *
   * @route POST /addTags
   * @operationName Add Tags
   * @category Tags
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Resource ID","name":"resourceId","required":true,"freeform":true,"description":"The Shopify GID of the resource to tag, e.g. gid://shopify/Order/123 or gid://shopify/Customer/456. Copy it from the id field of a Get Order, Get Product, or Get Customer step. No single picker is offered because tags apply to many resource types."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","required":true,"description":"Array of tags to add."}
   *
   * @returns {Object} Returns the result of the tag addition.
   * @sampleResult {"resourceId":"gid://shopify/Order/123","tags":["vip","priority"],"added":true}
   */
  async addTags(resourceId, tags) {
    const mutation = `
      mutation TagsAdd($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const data = await this.#graphqlRequest(mutation, {
      id: resourceId,
      tags: Array.isArray(tags) ? tags : [tags],
    })

    if (data.tagsAdd.userErrors?.length > 0) {
      const errors = data.tagsAdd.userErrors.map(e => e.message).join('; ')
      throw new Error(`Failed to add tags: ${ errors }`)
    }

    return {
      resourceId,
      tags,
      added: true,
    }
  }

  /**
   * @description Removes tags from a resource (order, customer, product, etc.).
   *
   * @route POST /removeTags
   * @operationName Remove Tags
   * @category Tags
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Resource ID","name":"resourceId","required":true,"freeform":true,"description":"The Shopify GID of the resource to untag, e.g. gid://shopify/Order/123 or gid://shopify/Customer/456. Copy it from the id field of a Get Order, Get Product, or Get Customer step. No single picker is offered because tags apply to many resource types."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","required":true,"description":"Array of tags to remove."}
   *
   * @returns {Object} Returns the result of the tag removal.
   * @sampleResult {"resourceId":"gid://shopify/Order/123","tags":["old-tag"],"removed":true}
   */
  async removeTags(resourceId, tags) {
    const mutation = `
      mutation TagsRemove($id: ID!, $tags: [String!]!) {
        tagsRemove(id: $id, tags: $tags) {
          node {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const data = await this.#graphqlRequest(mutation, {
      id: resourceId,
      tags: Array.isArray(tags) ? tags : [tags],
    })

    if (data.tagsRemove.userErrors?.length > 0) {
      const errors = data.tagsRemove.userErrors.map(e => e.message).join('; ')
      throw new Error(`Failed to remove tags: ${ errors }`)
    }

    return {
      resourceId,
      tags,
      removed: true,
    }
  }

  /**
   * @typedef {Object} createRefund__refundLineItem
   * @paramDef {"type":"String","label":"Line Item ID","name":"lineItemId","required":true,"description":"The ID of the line item to refund."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The quantity of this line item to refund."}
   * @paramDef {"type":"String","label":"Restock Type","name":"restockType","uiComponent":{"type":"DROPDOWN","options":{"values":["No Restock","Cancel","Return"]}},"description":"How to restock the refunded item. No Restock leaves inventory unchanged, Cancel restocks to the original location, Return restocks to a return location."}
   */

  /**
   * @description Creates a refund for an order.
   *
   * @route POST /createRefund
   * @operationName Create Refund
   * @category Orders
   *
   * @appearanceColor #96BF48 #5E8E3E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order to refund."}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"Note about the refund."}
   * @paramDef {"type":"Boolean","label":"Notify Customer","name":"notify","uiComponent":{"type":"TOGGLE"},"description":"Whether to notify the customer about the refund."}
   * @paramDef {"type":"Number","label":"Shipping Amount","name":"shippingAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount of shipping to refund."}
   * @paramDef {"type":"Array<createRefund__refundLineItem>","label":"Refund Line Items","name":"refundLineItems","required":true,"description":"Line items to refund with quantities."}
   *
   * @returns {Object} Returns the created refund.
   * @sampleResult {"id":"gid://shopify/Refund/123","orderId":"gid://shopify/Order/456","totalRefunded":"99.99","currency":"USD"}
   */
  async createRefund(orderId, note, notify, shippingAmount, refundLineItems) {
    const mutation = `
      mutation RefundCreate($input: RefundInput!) {
        refundCreate(input: $input) {
          refund {
            id
            createdAt
            note
            totalRefundedSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            refundLineItems(first: 20) {
              edges {
                node {
                  lineItem {
                    id
                    title
                  }
                  quantity
                  restockType
                  subtotalSet {
                    shopMoney {
                      amount
                    }
                  }
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const input = {
      orderId,
      notify: notify || false,
    }

    if (note) input.note = note

    if (shippingAmount !== undefined) {
      input.shipping = {
        amount: parseFloat(shippingAmount),
        fullRefund: false,
      }
    }

    if (refundLineItems && refundLineItems.length > 0) {
      input.refundLineItems = refundLineItems.map(item => ({
        lineItemId: item.lineItemId,
        quantity: parseInt(item.quantity, 10),
        restockType: this.#resolveChoice(item.restockType, { 'No Restock': 'NO_RESTOCK', 'Cancel': 'CANCEL', 'Return': 'RETURN' }) || 'NO_RESTOCK',
      }))
    }

    const data = await this.#graphqlRequest(mutation, { input })

    if (data.refundCreate.userErrors?.length > 0) {
      const errors = data.refundCreate.userErrors.map(e => e.message).join('; ')
      throw new Error(`Failed to create refund: ${ errors }`)
    }

    const refund = data.refundCreate.refund

    return {
      id: refund.id,
      orderId,
      createdAt: refund.createdAt,
      note: refund.note,
      totalRefunded: refund.totalRefundedSet?.shopMoney?.amount,
      currency: refund.totalRefundedSet?.shopMoney?.currencyCode,
      lineItems: refund.refundLineItems?.edges?.map(({ node }) => ({
        lineItemId: node.lineItem?.id,
        title: node.lineItem?.title,
        quantity: node.quantity,
        restockType: node.restockType,
        subtotal: node.subtotalSet?.shopMoney?.amount,
      })),
    }
  }

  // ========================================== POLLING TRIGGERS ===========================================

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On New Order
   * @description Triggers when a new order is created in your Shopify store. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @category Orders
   *
   * @route POST /onNewOrder
   * @appearanceColor #96BF48 #5E8E3E
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object} Returns the new order data.
   * @sampleResult {"id":"gid://shopify/Order/123","name":"#1001","createdAt":"2024-01-01T00:00:00Z","totalPrice":"99.99","customer":{"displayName":"John Doe","email":"john@example.com"}}
   */
  async onNewOrder(invocation) {
    const query = `
      query GetLatestOrders($first: Int!) {
        orders(first: $first, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              updatedAt
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              financialStatus: displayFinancialStatus
              fulfillmentStatus: displayFulfillmentStatus
              customer {
                id
                displayName
                email
              }
              lineItems(first: 20) {
                edges {
                  node {
                    title
                    quantity
                    variant {
                      sku
                      price
                    }
                  }
                }
              }
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, { first: DEFAULT_LIMIT })
    const orders = data.orders.edges.map(({ node }) => ({
      ...node,
      totalPrice: node.totalPriceSet?.shopMoney?.amount,
      currency: node.totalPriceSet?.shopMoney?.currencyCode,
      lineItems: node.lineItems.edges.map(({ node: item }) => ({
        title: item.title,
        quantity: item.quantity,
        sku: item.variant?.sku,
        price: item.variant?.price,
      })),
    }))

    if (invocation.learningMode) {
      return {
        events: orders.length > 0 ? [orders[0]] : [],
        state: null,
      }
    }

    if (!invocation.state?.orderIds) {
      return {
        events: [],
        state: { orderIds: orders.map(o => o.id) },
      }
    }

    const prevOrderIds = new Set(invocation.state.orderIds)
    const newOrders = orders.filter(order => !prevOrderIds.has(order.id))

    logger.debug(`[onNewOrder] found ${ newOrders.length } new orders`)

    return {
      events: newOrders,
      state: { orderIds: orders.map(o => o.id) },
    }
  }

  /**
   * @operationName On Order Updated
   * @description Triggers when an existing order is updated in your Shopify store. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @category Orders
   *
   * @route POST /onOrderUpdated
   * @appearanceColor #96BF48 #5E8E3E
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object} Returns the updated order data.
   * @sampleResult {"id":"gid://shopify/Order/123","name":"#1001","updatedAt":"2024-01-02T00:00:00Z","totalPrice":"99.99","financialStatus":"PAID","fulfillmentStatus":"FULFILLED"}
   */
  async onOrderUpdated(invocation) {
    const query = `
      query GetLatestOrders($first: Int!) {
        orders(first: $first, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              updatedAt
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              financialStatus: displayFinancialStatus
              fulfillmentStatus: displayFulfillmentStatus
              customer {
                id
                displayName
                email
              }
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, { first: DEFAULT_LIMIT })
    const orders = data.orders.edges.map(({ node }) => ({
      ...node,
      totalPrice: node.totalPriceSet?.shopMoney?.amount,
      currency: node.totalPriceSet?.shopMoney?.currencyCode,
    }))

    if (invocation.learningMode) {
      return {
        events: orders.length > 0 ? [orders[0]] : [],
        state: null,
      }
    }

    if (!invocation.state?.orderUpdates) {
      const orderUpdates = {}

      orders.forEach(o => {
        orderUpdates[o.id] = o.updatedAt
      })

      return {
        events: [],
        state: { orderUpdates },
      }
    }

    const prevUpdates = invocation.state.orderUpdates
    const updatedOrders = orders.filter(order => {
      const prevUpdate = prevUpdates[order.id]

      return !prevUpdate || order.updatedAt !== prevUpdate
    })

    const newOrderUpdates = {}

    orders.forEach(o => {
      newOrderUpdates[o.id] = o.updatedAt
    })

    logger.debug(`[onOrderUpdated] found ${ updatedOrders.length } updated orders`)

    return {
      events: updatedOrders,
      state: { orderUpdates: newOrderUpdates },
    }
  }

  /**
   * @operationName On New Customer
   * @description Triggers when a new customer is created in your Shopify store. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @category Customers
   *
   * @route POST /onNewCustomer
   * @appearanceColor #96BF48 #5E8E3E
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object} Returns the new customer data.
   * @sampleResult {"id":"gid://shopify/Customer/123","displayName":"John Doe","email":"john@example.com","createdAt":"2024-01-01T00:00:00Z"}
   */
  async onNewCustomer(invocation) {
    const query = `
      query GetLatestCustomers($first: Int!) {
        customers(first: $first, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              displayName
              firstName
              lastName
              email
              phone
              createdAt
              updatedAt
              numberOfOrders
              amountSpent {
                amount
                currencyCode
              }
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, { first: DEFAULT_LIMIT })
    const customers = data.customers.edges.map(({ node }) => ({
      ...node,
      ordersCount: node.numberOfOrders || 0,
      totalSpent: node.amountSpent?.amount,
      currency: node.amountSpent?.currencyCode,
    }))

    if (invocation.learningMode) {
      return {
        events: customers.length > 0 ? [customers[0]] : [],
        state: null,
      }
    }

    if (!invocation.state?.customerIds) {
      return {
        events: [],
        state: { customerIds: customers.map(c => c.id) },
      }
    }

    const prevCustomerIds = new Set(invocation.state.customerIds)
    const newCustomers = customers.filter(customer => !prevCustomerIds.has(customer.id))

    logger.debug(`[onNewCustomer] found ${ newCustomers.length } new customers`)

    return {
      events: newCustomers,
      state: { customerIds: customers.map(c => c.id) },
    }
  }

  /**
   * @operationName On Customer Updated
   * @description Triggers when a customer is updated in your Shopify store. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @category Customers
   *
   * @route POST /onCustomerUpdated
   * @appearanceColor #96BF48 #5E8E3E
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object} Returns the updated customer data.
   * @sampleResult {"id":"gid://shopify/Customer/123","displayName":"John Doe","email":"john@example.com","updatedAt":"2024-01-02T00:00:00Z"}
   */
  async onCustomerUpdated(invocation) {
    const query = `
      query GetLatestCustomers($first: Int!) {
        customers(first: $first, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              displayName
              firstName
              lastName
              email
              phone
              createdAt
              updatedAt
              numberOfOrders
              amountSpent {
                amount
                currencyCode
              }
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, { first: DEFAULT_LIMIT })
    const customers = data.customers.edges.map(({ node }) => ({
      ...node,
      ordersCount: node.numberOfOrders || 0,
      totalSpent: node.amountSpent?.amount,
      currency: node.amountSpent?.currencyCode,
    }))

    if (invocation.learningMode) {
      return {
        events: customers.length > 0 ? [customers[0]] : [],
        state: null,
      }
    }

    if (!invocation.state?.customerUpdates) {
      const customerUpdates = {}

      customers.forEach(c => {
        customerUpdates[c.id] = c.updatedAt
      })

      return {
        events: [],
        state: { customerUpdates },
      }
    }

    const prevUpdates = invocation.state.customerUpdates
    const updatedCustomers = customers.filter(customer => {
      const prevUpdate = prevUpdates[customer.id]

      return !prevUpdate || customer.updatedAt !== prevUpdate
    })

    const newCustomerUpdates = {}

    customers.forEach(c => {
      newCustomerUpdates[c.id] = c.updatedAt
    })

    logger.debug(`[onCustomerUpdated] found ${ updatedCustomers.length } updated customers`)

    return {
      events: updatedCustomers,
      state: { customerUpdates: newCustomerUpdates },
    }
  }

  /**
   * @operationName On New Product
   * @description Triggers when a new product is created in your Shopify store. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @category Products
   *
   * @route POST /onNewProduct
   * @appearanceColor #96BF48 #5E8E3E
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object} Returns the new product data.
   * @sampleResult {"id":"gid://shopify/Product/123","title":"Blue T-Shirt","status":"ACTIVE","createdAt":"2024-01-01T00:00:00Z"}
   */
  async onNewProduct(invocation) {
    const query = `
      query GetLatestProducts($first: Int!) {
        products(first: $first, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              handle
              status
              vendor
              productType
              createdAt
              updatedAt
              totalInventory
              variants(first: 5) {
                edges {
                  node {
                    id
                    title
                    sku
                    price
                    inventoryQuantity
                  }
                }
              }
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, { first: DEFAULT_LIMIT })
    const products = data.products.edges.map(({ node }) => ({
      ...node,
      variants: node.variants.edges.map(({ node: v }) => v),
    }))

    if (invocation.learningMode) {
      return {
        events: products.length > 0 ? [products[0]] : [],
        state: null,
      }
    }

    if (!invocation.state?.productIds) {
      return {
        events: [],
        state: { productIds: products.map(p => p.id) },
      }
    }

    const prevProductIds = new Set(invocation.state.productIds)
    const newProducts = products.filter(product => !prevProductIds.has(product.id))

    logger.debug(`[onNewProduct] found ${ newProducts.length } new products`)

    return {
      events: newProducts,
      state: { productIds: products.map(p => p.id) },
    }
  }

  /**
   * @operationName On New Dispute
   * @description Triggers when a new payment dispute is created. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @category Payouts
   *
   * @route POST /onNewDispute
   * @appearanceColor #96BF48 #5E8E3E
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object} Returns the new dispute data.
   * @sampleResult {"id":"gid://shopify/ShopifyPaymentsDispute/123","initiatedAt":"2024-01-01T00:00:00Z","amount":"99.99","currency":"USD","status":"OPEN","reason":"FRAUDULENT"}
   */
  async onNewDispute(invocation) {
    const query = `
      query GetLatestDisputes($first: Int!) {
        shopifyPaymentsAccount {
          disputes(first: $first) {
            edges {
              node {
                id
                initiatedAt
                amount {
                  amount
                  currencyCode
                }
                status
                reasonDetails {
                  reason
                }
                evidenceDueBy
                order {
                  id
                  name
                }
              }
            }
          }
        }
      }
    `

    const data = await this.#graphqlRequest(query, { first: DEFAULT_LIMIT })

    if (!data.shopifyPaymentsAccount) {
      return {
        events: [],
        state: { disputeIds: [] },
      }
    }

    const disputes = data.shopifyPaymentsAccount.disputes.edges.map(({ node }) => ({
      id: node.id,
      initiatedAt: node.initiatedAt,
      amount: node.amount?.amount,
      currency: node.amount?.currencyCode,
      status: node.status,
      reason: node.reasonDetails?.reason,
      evidenceDueBy: node.evidenceDueBy,
      orderId: node.order?.id,
      orderName: node.order?.name,
    }))

    if (invocation.learningMode) {
      return {
        events: disputes.length > 0 ? [disputes[0]] : [],
        state: null,
      }
    }

    if (!invocation.state?.disputeIds) {
      return {
        events: [],
        state: { disputeIds: disputes.map(d => d.id) },
      }
    }

    const prevDisputeIds = new Set(invocation.state.disputeIds)
    const newDisputes = disputes.filter(dispute => !prevDisputeIds.has(dispute.id))

    logger.debug(`[onNewDispute] found ${ newDisputes.length } new disputes`)

    return {
      events: newDisputes,
      state: { disputeIds: disputes.map(d => d.id) },
    }
  }
}

Flowrunner.ServerCode.addService(Shopify, [
  {
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientId',
    hint: 'Your Shopify App Client ID from the Partner Dashboard (Apps > Your App > API credentials).',
  },
  {
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientSecret',
    hint: 'Your Shopify App Client Secret from the Partner Dashboard (Apps > Your App > API credentials).',
  },
  {
    displayName: 'Shop Domain',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    name: 'shopDomain',
    hint: 'Your Shopify store domain (e.g., my-store.myshopify.com).',
  },
])
