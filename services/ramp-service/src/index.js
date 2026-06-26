const logger = {
  info: (...args) => console.log('[Ramp Service] info:', ...args),
  debug: (...args) => console.log('[Ramp Service] debug:', ...args),
  error: (...args) => console.log('[Ramp Service] error:', ...args),
  warn: (...args) => console.log('[Ramp Service] warn:', ...args),
}

const PRODUCTION_BASE_URL = 'https://api.ramp.com'
const SANDBOX_BASE_URL = 'https://demo-api.ramp.com'

const DEFAULT_SCOPE_LIST = [
  'transactions:read',
  'cards:read',
  'cards:write',
  'users:read',
  'users:write',
  'departments:read',
  'locations:read',
  'bills:read',
  'vendors:read',
  'vendors:write',
  'reimbursements:read',
  'reimbursements:write',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_PAGE_SIZE = 25

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
 * @integrationName Ramp
 * @integrationIcon /logo.png
 * @integrationTriggersScope SINGLE_APP
 */
class RampService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.baseUrl = config.environment === 'sandbox' ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL
    this.tokenCache = null
  }

  async #getAccessToken() {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token
    }

    try {
      const credentials = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

      const response = await Flowrunner.Request.post(`${ this.baseUrl }/developer/v1/token`)
        .set({
          Authorization: `Basic ${ credentials }`,
          'Content-Type': 'application/x-www-form-urlencoded',
        })
        .send(`grant_type=client_credentials&scope=${ encodeURIComponent(DEFAULT_SCOPE_STRING) }`)

      this.tokenCache = {
        token: response.access_token,
        expiresAt: Date.now() + (response.expires_in - 60) * 1000,
      }

      logger.debug(`Acquired access token (expires_in=${ response.expires_in })`)

      return this.tokenCache.token
    } catch (error) {
      const message = error.message && typeof error.message === 'string'
        ? error.message
        : JSON.stringify(error.message)

      logger.error(`Failed to acquire access token: ${ message }`)

      throw new Error(`Ramp authentication failed: ${ message }`)
    }
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const token = await this.#getAccessToken()
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          Authorization: `Bearer ${ token }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      if (body !== undefined) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      if (error.message && error.message.startsWith('Ramp authentication failed:')) {
        throw error
      }

      const message = error.message && typeof error.message === 'string'
        ? error.message
        : JSON.stringify(error.message)

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Ramp API error: ${ message }`)
    }
  }

  // -------------------- Dictionaries --------------------

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter users by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor token returned in the previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of Ramp users for selecting cardholders, transaction owners, or reimbursement recipients.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search string and pagination cursor for filtering Ramp users."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"usr_abc123","note":"jane@example.com"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getUsersDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/users`,
      query: { page_size: DEFAULT_PAGE_SIZE, start: cursor },
    })

    let users = response.data || []

    if (search) {
      const term = search.toLowerCase()

      users = users.filter(u => {
        const name = `${ u.first_name || '' } ${ u.last_name || '' }`.trim().toLowerCase()
        const email = (u.email || '').toLowerCase()

        return name.includes(term) || email.includes(term)
      })
    }

    return {
      items: users.map(u => ({
        label: `${ u.first_name || '' } ${ u.last_name || '' }`.trim() || u.email,
        value: u.id,
        note: u.email,
      })),
      cursor: response.page?.next || null,
    }
  }

  /**
   * @typedef {Object} getDepartmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter departments by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor token returned in the previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Departments Dictionary
   * @description Provides a list of departments configured in Ramp for organizational filtering and assignment.
   * @route POST /get-departments-dictionary
   * @paramDef {"type":"getDepartmentsDictionary__payload","label":"Payload","name":"payload","description":"Search string and pagination cursor for filtering departments."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engineering","value":"dpt_xyz789","note":"ID: dpt_xyz789"}],"cursor":null}
   */
  async getDepartmentsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getDepartmentsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/departments`,
      query: { page_size: DEFAULT_PAGE_SIZE, start: cursor },
    })

    let departments = response.data || []

    if (search) {
      const term = search.toLowerCase()

      departments = departments.filter(d => (d.name || '').toLowerCase().includes(term))
    }

    return {
      items: departments.map(d => ({
        label: d.name,
        value: d.id,
        note: `ID: ${ d.id }`,
      })),
      cursor: response.page?.next || null,
    }
  }

  /**
   * @typedef {Object} getLocationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter locations by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor token returned in the previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Locations Dictionary
   * @description Provides a list of physical locations configured in Ramp for assignment and filtering.
   * @route POST /get-locations-dictionary
   * @paramDef {"type":"getLocationsDictionary__payload","label":"Payload","name":"payload","description":"Search string and pagination cursor for filtering locations."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"NYC HQ","value":"loc_001","note":"ID: loc_001"}],"cursor":null}
   */
  async getLocationsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getLocationsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/locations`,
      query: { page_size: DEFAULT_PAGE_SIZE, start: cursor },
    })

    let locations = response.data || []

    if (search) {
      const term = search.toLowerCase()

      locations = locations.filter(l => (l.name || '').toLowerCase().includes(term))
    }

    return {
      items: locations.map(l => ({
        label: l.name,
        value: l.id,
        note: `ID: ${ l.id }`,
      })),
      cursor: response.page?.next || null,
    }
  }

  /**
   * @typedef {Object} getVendorsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter vendors by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor token returned in the previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Vendors Dictionary
   * @description Provides a searchable list of vendors configured in Ramp for bill creation, vendor lookup, and bill filtering.
   * @route POST /get-vendors-dictionary
   * @paramDef {"type":"getVendorsDictionary__payload","label":"Payload","name":"payload","description":"Search string and pagination cursor for filtering vendors."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Supplies","value":"vnd_555","note":"ID: vnd_555"}],"cursor":null}
   */
  async getVendorsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getVendorsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/vendors`,
      query: {
        page_size: DEFAULT_PAGE_SIZE,
        start: cursor,
        search: search || undefined,
      },
    })

    const vendors = response.data || []

    return {
      items: vendors.map(v => ({
        label: v.name || v.business_name,
        value: v.id,
        note: `ID: ${ v.id }`,
      })),
      cursor: response.page?.next || null,
    }
  }

  /**
   * @typedef {Object} getCardsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter cards by display name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor token returned in the previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Cards Dictionary
   * @description Provides a list of corporate cards for use as a filter when querying transactions or for selecting a specific card to manage.
   * @route POST /get-cards-dictionary
   * @paramDef {"type":"getCardsDictionary__payload","label":"Payload","name":"payload","description":"Search string and pagination cursor for filtering cards."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Marketing - Jane","value":"crd_abc","note":"••1234 ACTIVE"}],"cursor":null}
   */
  async getCardsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getCardsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/cards`,
      query: { page_size: DEFAULT_PAGE_SIZE, start: cursor },
    })

    let cards = response.data || []

    if (search) {
      const term = search.toLowerCase()

      cards = cards.filter(c => (c.display_name || '').toLowerCase().includes(term))
    }

    return {
      items: cards.map(c => ({
        label: c.display_name || `Card ${ c.last_four }`,
        value: c.id,
        note: `••${ c.last_four || '----' } ${ c.state || '' }`.trim(),
      })),
      cursor: response.page?.next || null,
    }
  }

  // -------------------- Transactions --------------------

  /**
   * @operationName List Transactions
   * @description Retrieves a paginated list of card transactions with optional filters by date range, card, user, department, and state (CLEARED, PENDING, DECLINED, etc.). Use this to query historical spend or build expense reports.
   * @category Transactions
   * @route POST /list-transactions
   * @appearanceColor #FFD93B #FFE36E
   *
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional earliest transaction date (ISO-8601). Only transactions on or after this moment are returned."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional latest transaction date (ISO-8601). Only transactions on or before this moment are returned."}
   * @paramDef {"type":"String","label":"Card","name":"cardId","dictionary":"getCardsDictionary","description":"Optional card to filter transactions to."}
   * @paramDef {"type":"String","label":"User","name":"userId","dictionary":"getUsersDictionary","description":"Optional user whose transactions you want."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","dictionary":"getDepartmentsDictionary","description":"Optional department to filter by."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["CLEARED","PENDING","DECLINED","ALL"]}},"description":"Optional transaction state filter. ALL returns transactions regardless of state."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of transactions per page. Defaults to 25, typically up to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a prior response. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"txn_001","amount":42.50,"currency_code":"USD","merchant_name":"Starbucks","state":"CLEARED","user_transaction_time":"2026-05-30T14:22:00Z","card_id":"crd_abc","card_holder":{"user_id":"usr_001","first_name":"Jane","last_name":"Doe"}}],"page":{"next":null}}
   */
  async listTransactions(fromDate, toDate, cardId, userId, departmentId, state, limit, cursor) {
    const logTag = '[listTransactions]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/transactions`,
      query: {
        from_date: fromDate,
        to_date: toDate,
        card_id: cardId,
        user_id: userId,
        department_id: departmentId,
        state: state && state !== 'ALL' ? state : undefined,
        page_size: limit || DEFAULT_PAGE_SIZE,
        start: cursor,
      },
    })
  }

  /**
   * @operationName Get Transaction
   * @description Retrieves a single card transaction by ID, including merchant details, amount, state, line items, the cardholder, and any associated receipt or memo.
   * @category Transactions
   * @route POST /get-transaction
   * @appearanceColor #FFD93B #FFE36E
   *
   * @paramDef {"type":"String","label":"Transaction ID","name":"transactionId","required":true,"description":"The unique Ramp transaction ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"txn_001","amount":42.50,"currency_code":"USD","merchant_name":"Starbucks","state":"CLEARED","user_transaction_time":"2026-05-30T14:22:00Z","card_id":"crd_abc","memo":"Client coffee","sk_category_name":"Restaurants"}
   */
  async getTransaction(transactionId) {
    const logTag = '[getTransaction]'

    if (!transactionId) {
      throw new Error('Transaction ID is required')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/transactions/${ transactionId }`,
    })
  }

  // -------------------- Cards --------------------

  /**
   * @operationName List Cards
   * @description Retrieves a paginated list of corporate cards with optional filters by user, department, and state (ACTIVE, FROZEN, TERMINATED). Useful for card audits and management workflows.
   * @category Cards
   * @route POST /list-cards
   * @appearanceColor #1465FF #4B8FFF
   *
   * @paramDef {"type":"String","label":"User","name":"userId","dictionary":"getUsersDictionary","description":"Optional cardholder filter."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","dictionary":"getDepartmentsDictionary","description":"Optional department filter."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["ACTIVE","FROZEN","TERMINATED","SUSPENDED","UNACTIVATED","ALL"]}},"description":"Optional card state filter. ALL returns cards regardless of state."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of cards per page. Defaults to 25."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a prior response."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"crd_abc","display_name":"Marketing - Jane","last_four":"1234","state":"ACTIVE","cardholder_id":"usr_001","cardholder_name":"Jane Doe","spending_restrictions":{"amount":500000,"interval":"MONTHLY"}}],"page":{"next":null}}
   */
  async listCards(userId, departmentId, state, limit, cursor) {
    const logTag = '[listCards]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/cards`,
      query: {
        user_id: userId,
        department_id: departmentId,
        state: state && state !== 'ALL' ? state : undefined,
        page_size: limit || DEFAULT_PAGE_SIZE,
        start: cursor,
      },
    })
  }

  /**
   * @operationName Get Card
   * @description Retrieves a single card by ID, including cardholder info, spending restrictions, state, fulfillment status, and last-four digits.
   * @category Cards
   * @route POST /get-card
   * @appearanceColor #1465FF #4B8FFF
   *
   * @paramDef {"type":"String","label":"Card","name":"cardId","required":true,"dictionary":"getCardsDictionary","description":"The card to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"crd_abc","display_name":"Marketing - Jane","last_four":"1234","state":"ACTIVE","cardholder_id":"usr_001","spending_restrictions":{"amount":500000,"interval":"MONTHLY","categories":[],"blocked_categories":[]}}
   */
  async getCard(cardId) {
    const logTag = '[getCard]'

    if (!cardId) {
      throw new Error('Card ID is required')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/cards/${ cardId }`,
    })
  }

  /**
   * @operationName Issue Card
   * @description Issues a new corporate card to a Ramp user. The card is created asynchronously via a deferred task; the response includes a task ID you can poll. Spending restrictions (amount in cents, interval, allowed/blocked categories) are required.
   * @category Cards
   * @route POST /issue-card
   * @appearanceColor #1465FF #4B8FFF
   *
   * @paramDef {"type":"String","label":"Cardholder","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user to issue the card to."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"Card display name shown in Ramp and on the card UI."}
   * @paramDef {"type":"Object","label":"Spending Restrictions","name":"spendingRestrictions","required":true,"description":"Object: {amount: cents number, interval: 'DAILY'|'WEEKLY'|'MONTHLY'|'QUARTERLY'|'YEARLY'|'TOTAL', categories?: number[], blocked_categories?: number[], lock_date?: ISO-8601 string}."}
   * @paramDef {"type":"Object","label":"Fulfillment","name":"fulfillment","description":"Optional. For physical cards: {shipping: {recipient_address: {...}}}. Omit for virtual cards (default)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"task_001","status":"STARTED","data":null}
   */
  async issueCard(userId, displayName, spendingRestrictions, fulfillment) {
    const logTag = '[issueCard]'

    if (!userId) {
      throw new Error('Cardholder user ID is required')
    }

    if (!displayName) {
      throw new Error('Card display name is required')
    }

    if (!spendingRestrictions) {
      throw new Error('Spending restrictions are required')
    }

    const body = {
      user_id: userId,
      display_name: displayName,
      spending_restrictions: spendingRestrictions,
    }

    if (fulfillment) {
      body.fulfillment = fulfillment
    }

    return await this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ this.baseUrl }/developer/v1/cards/deferred`,
      body,
    })
  }

  /**
   * @operationName Freeze Card
   * @description Freezes a card so no new transactions can be made. The card remains in the user's wallet and can be unfrozen later without re-issuing.
   * @category Cards
   * @route POST /freeze-card
   * @appearanceColor #1465FF #4B8FFF
   *
   * @paramDef {"type":"String","label":"Card","name":"cardId","required":true,"dictionary":"getCardsDictionary","description":"The card to freeze."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async freezeCard(cardId) {
    const logTag = '[freezeCard]'

    if (!cardId) {
      throw new Error('Card ID is required')
    }

    await this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ this.baseUrl }/developer/v1/cards/${ cardId }/freeze`,
    })

    return { success: true }
  }

  /**
   * @operationName Unfreeze Card
   * @description Unfreezes a previously frozen card, restoring its ability to make new transactions.
   * @category Cards
   * @route POST /unfreeze-card
   * @appearanceColor #1465FF #4B8FFF
   *
   * @paramDef {"type":"String","label":"Card","name":"cardId","required":true,"dictionary":"getCardsDictionary","description":"The card to unfreeze."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async unfreezeCard(cardId) {
    const logTag = '[unfreezeCard]'

    if (!cardId) {
      throw new Error('Card ID is required')
    }

    await this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ this.baseUrl }/developer/v1/cards/${ cardId }/unfreeze`,
    })

    return { success: true }
  }

  /**
   * @operationName Terminate Card
   * @description Permanently terminates a card. This is irreversible — the card cannot be reactivated and a new card must be issued to replace it.
   * @category Cards
   * @route POST /terminate-card
   * @appearanceColor #FF4444 #FF6666
   *
   * @paramDef {"type":"String","label":"Card","name":"cardId","required":true,"dictionary":"getCardsDictionary","description":"The card to terminate. This action cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async terminateCard(cardId) {
    const logTag = '[terminateCard]'

    if (!cardId) {
      throw new Error('Card ID is required')
    }

    await this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ this.baseUrl }/developer/v1/cards/${ cardId }/termination`,
    })

    return { success: true }
  }

  // -------------------- Users --------------------

  /**
   * @operationName List Users
   * @description Retrieves a paginated list of users in the Ramp account, with optional filters by department, location, and role. Useful for HR sync, audit reports, and admin workflows.
   * @category Users
   * @route POST /list-users
   * @appearanceColor #00C49A #6FE3C8
   *
   * @paramDef {"type":"String","label":"Department","name":"departmentId","dictionary":"getDepartmentsDictionary","description":"Optional department to filter users by."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"getLocationsDictionary","description":"Optional location to filter users by."}
   * @paramDef {"type":"String","label":"Role","name":"role","uiComponent":{"type":"DROPDOWN","options":{"values":["BUSINESS_USER","BUSINESS_ADMIN","BUSINESS_OWNER","IT_ADMIN","BUSINESS_BOOKKEEPER","DEVELOPER_ADMIN","ALL"]}},"description":"Optional Ramp role filter. ALL returns users regardless of role."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of users per page. Defaults to 25."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a prior response."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"usr_001","first_name":"Jane","last_name":"Doe","email":"jane@example.com","role":"BUSINESS_ADMIN","department_id":"dpt_xyz789","location_id":"loc_001","is_manager":true,"status":"USER_ACTIVE"}],"page":{"next":null}}
   */
  async listUsers(departmentId, locationId, role, limit, cursor) {
    const logTag = '[listUsers]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/users`,
      query: {
        department_id: departmentId,
        location_id: locationId,
        role: role && role !== 'ALL' ? role : undefined,
        page_size: limit || DEFAULT_PAGE_SIZE,
        start: cursor,
      },
    })
  }

  /**
   * @operationName Get User
   * @description Retrieves a single user by ID, including name, email, role, department, location, manager status, and account status.
   * @category Users
   * @route POST /get-user
   * @appearanceColor #00C49A #6FE3C8
   *
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"usr_001","first_name":"Jane","last_name":"Doe","email":"jane@example.com","role":"BUSINESS_ADMIN","department_id":"dpt_xyz789","location_id":"loc_001","is_manager":true,"status":"USER_ACTIVE","phone":"+15551234567"}
   */
  async getUser(userId) {
    const logTag = '[getUser]'

    if (!userId) {
      throw new Error('User ID is required')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/users/${ userId }`,
    })
  }

  /**
   * @operationName Invite User
   * @description Invites a new user to join the Ramp account with a specified role and optional department/location. Invitation is created asynchronously via a deferred task; the new user receives an email to set up their account.
   * @category Users
   * @route POST /invite-user
   * @appearanceColor #00C49A #6FE3C8
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"The new user's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"The new user's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The new user's email address; the invitation is sent here."}
   * @paramDef {"type":"String","label":"Role","name":"role","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["BUSINESS_USER","BUSINESS_ADMIN","BUSINESS_OWNER","IT_ADMIN","BUSINESS_BOOKKEEPER"]}},"description":"The Ramp role to grant the new user."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","dictionary":"getDepartmentsDictionary","description":"Optional department to assign the new user to."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"getLocationsDictionary","description":"Optional location to assign the new user to."}
   *
   * @returns {Object}
   * @sampleResult {"id":"task_002","status":"STARTED","data":null}
   */
  async inviteUser(firstName, lastName, email, role, departmentId, locationId) {
    const logTag = '[inviteUser]'

    if (!firstName) {
      throw new Error('First name is required')
    }

    if (!lastName) {
      throw new Error('Last name is required')
    }

    if (!email) {
      throw new Error('Email is required')
    }

    if (!role) {
      throw new Error('Role is required')
    }

    return await this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ this.baseUrl }/developer/v1/users/deferred`,
      body: clean({
        first_name: firstName,
        last_name: lastName,
        email,
        role,
        department_id: departmentId,
        location_id: locationId,
      }),
    })
  }

  // -------------------- Organization --------------------

  /**
   * @operationName List Departments
   * @description Retrieves all departments configured in the Ramp account. Departments are used to organize users, cards, and transactions.
   * @category Organization
   * @route POST /list-departments
   * @appearanceColor #8E44AD #B07CD0
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of departments per page. Defaults to 25."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a prior response."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"dpt_xyz789","name":"Engineering"}],"page":{"next":null}}
   */
  async listDepartments(limit, cursor) {
    const logTag = '[listDepartments]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/departments`,
      query: {
        page_size: limit || DEFAULT_PAGE_SIZE,
        start: cursor,
      },
    })
  }

  /**
   * @operationName List Locations
   * @description Retrieves all physical locations configured in the Ramp account. Locations are used for assigning users and cards to offices or sites.
   * @category Organization
   * @route POST /list-locations
   * @appearanceColor #8E44AD #B07CD0
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of locations per page. Defaults to 25."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a prior response."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"loc_001","name":"NYC HQ"}],"page":{"next":null}}
   */
  async listLocations(limit, cursor) {
    const logTag = '[listLocations]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/locations`,
      query: {
        page_size: limit || DEFAULT_PAGE_SIZE,
        start: cursor,
      },
    })
  }

  // -------------------- Vendors --------------------

  /**
   * @operationName List Vendors
   * @description Retrieves a paginated list of vendors configured for Ramp Bill Pay, with optional name search. Vendors are entities that bills are paid to.
   * @category Vendors
   * @route POST /list-vendors
   * @appearanceColor #FF6B6B #FF9999
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring to filter vendors by name."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of vendors per page. Defaults to 25."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a prior response."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"vnd_555","name":"Acme Supplies","contact_name":"John Smith","contact_email":"ar@acme.com","payment_method":"ACH","account_number":"****6789"}],"page":{"next":null}}
   */
  async listVendors(search, limit, cursor) {
    const logTag = '[listVendors]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/vendors`,
      query: {
        search,
        page_size: limit || DEFAULT_PAGE_SIZE,
        start: cursor,
      },
    })
  }

  /**
   * @operationName Get Vendor
   * @description Retrieves a single vendor by ID, including contact details, payment method, and account/routing info (masked).
   * @category Vendors
   * @route POST /get-vendor
   * @appearanceColor #FF6B6B #FF9999
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"vnd_555","name":"Acme Supplies","contact_name":"John Smith","contact_email":"ar@acme.com","payment_method":"ACH","account_number":"****6789","routing_number":"****4321","notes":"Net 30"}
   */
  async getVendor(vendorId) {
    const logTag = '[getVendor]'

    if (!vendorId) {
      throw new Error('Vendor ID is required')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/vendors/${ vendorId }`,
    })
  }

  /**
   * @operationName Create Vendor
   * @description Creates a new vendor in Ramp Bill Pay. Vendors are required before bills can be created against them. Provide payment method (ACH, CHECK, WIRE) and the corresponding banking details.
   * @category Vendors
   * @route POST /create-vendor
   * @appearanceColor #FF6B6B #FF9999
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The legal or business name of the vendor."}
   * @paramDef {"type":"String","label":"Payment Method","name":"paymentMethod","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["ACH","CHECK","WIRE","INTERNATIONAL_WIRE"]}},"description":"How payments to this vendor will be made."}
   * @paramDef {"type":"String","label":"Account Number","name":"accountNumber","description":"Vendor bank account number. Required for ACH and WIRE payment methods."}
   * @paramDef {"type":"String","label":"Routing Number","name":"routingNumber","description":"Vendor bank routing number. Required for ACH payments."}
   * @paramDef {"type":"String","label":"Contact Name","name":"contactName","description":"Optional name of the vendor contact."}
   * @paramDef {"type":"String","label":"Contact Email","name":"contactEmail","description":"Optional email of the vendor contact."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes about the vendor (e.g., payment terms)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"vnd_new123","name":"New Vendor LLC","payment_method":"ACH","account_number":"****6789","contact_name":"Jane Smith","contact_email":"ap@newvendor.com"}
   */
  async createVendor(name, paymentMethod, accountNumber, routingNumber, contactName, contactEmail, notes) {
    const logTag = '[createVendor]'

    if (!name) {
      throw new Error('Vendor name is required')
    }

    if (!paymentMethod) {
      throw new Error('Payment method is required')
    }

    return await this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ this.baseUrl }/developer/v1/vendors`,
      body: clean({
        name,
        payment_method: paymentMethod,
        account_number: accountNumber,
        routing_number: routingNumber,
        contact_name: contactName,
        contact_email: contactEmail,
        notes,
      }),
    })
  }

  // -------------------- Bills --------------------

  /**
   * @operationName List Bills
   * @description Retrieves a paginated list of bills (AP invoices) in Ramp, with optional filters by vendor and status (OPEN, PAID, PENDING_APPROVAL, etc.). Useful for AP dashboards and payment reconciliation.
   * @category Bills
   * @route POST /list-bills
   * @appearanceColor #6E4AFF #9B85FF
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","dictionary":"getVendorsDictionary","description":"Optional vendor to filter bills by."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["OPEN","PAID","PENDING_APPROVAL","SCHEDULED","FAILED","CANCELED","ALL"]}},"description":"Optional bill status filter. ALL returns bills regardless of status."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of bills per page. Defaults to 25."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a prior response."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"bil_001","vendor_id":"vnd_555","amount":12500,"currency_code":"USD","invoice_number":"INV-2026-001","due_date":"2026-06-30","status":"OPEN","created_at":"2026-05-15T10:00:00Z"}],"page":{"next":null}}
   */
  async listBills(vendorId, status, limit, cursor) {
    const logTag = '[listBills]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/bills`,
      query: {
        vendor_id: vendorId,
        status: status && status !== 'ALL' ? status : undefined,
        page_size: limit || DEFAULT_PAGE_SIZE,
        start: cursor,
      },
    })
  }

  /**
   * @operationName Get Bill
   * @description Retrieves a single bill (AP invoice) by ID, including vendor, line items, amounts, due date, status, and any attached invoice files.
   * @category Bills
   * @route POST /get-bill
   * @appearanceColor #6E4AFF #9B85FF
   *
   * @paramDef {"type":"String","label":"Bill ID","name":"billId","required":true,"description":"The unique bill ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"bil_001","vendor_id":"vnd_555","amount":12500,"currency_code":"USD","invoice_number":"INV-2026-001","due_date":"2026-06-30","status":"OPEN","line_items":[{"description":"Consulting","amount":12500,"quantity":1}],"created_at":"2026-05-15T10:00:00Z"}
   */
  async getBill(billId) {
    const logTag = '[getBill]'

    if (!billId) {
      throw new Error('Bill ID is required')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/bills/${ billId }`,
    })
  }

  // -------------------- Reimbursements --------------------

  /**
   * @operationName List Reimbursements
   * @description Retrieves a paginated list of expense reimbursements with optional filters by user, status (PENDING, APPROVED, PAID, DENIED), and date range. Useful for expense audits and payroll integration.
   * @category Reimbursements
   * @route POST /list-reimbursements
   * @appearanceColor #1ABC9C #5CD1B8
   *
   * @paramDef {"type":"String","label":"User","name":"userId","dictionary":"getUsersDictionary","description":"Optional user whose reimbursements you want."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["PENDING","APPROVED","PAID","DENIED","ALL"]}},"description":"Optional reimbursement status filter. ALL returns all states."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional earliest creation date (ISO-8601)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional latest creation date (ISO-8601)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of reimbursements per page. Defaults to 25."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a prior response."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"rem_001","user_id":"usr_001","amount":4500,"currency_code":"USD","status":"PENDING","merchant":"Uber","memo":"Client airport ride","created_at":"2026-05-28T12:00:00Z"}],"page":{"next":null}}
   */
  async listReimbursements(userId, status, fromDate, toDate, limit, cursor) {
    const logTag = '[listReimbursements]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/reimbursements`,
      query: {
        user_id: userId,
        status: status && status !== 'ALL' ? status : undefined,
        from_date: fromDate,
        to_date: toDate,
        page_size: limit || DEFAULT_PAGE_SIZE,
        start: cursor,
      },
    })
  }

  /**
   * @operationName Get Reimbursement
   * @description Retrieves a single reimbursement by ID, including the submitting user, amount, merchant, status, memo, and any receipts or attachments.
   * @category Reimbursements
   * @route POST /get-reimbursement
   * @appearanceColor #1ABC9C #5CD1B8
   *
   * @paramDef {"type":"String","label":"Reimbursement ID","name":"reimbursementId","required":true,"description":"The unique reimbursement ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"rem_001","user_id":"usr_001","amount":4500,"currency_code":"USD","status":"PENDING","merchant":"Uber","memo":"Client airport ride","created_at":"2026-05-28T12:00:00Z","receipts":["rcp_x"]}
   */
  async getReimbursement(reimbursementId) {
    const logTag = '[getReimbursement]'

    if (!reimbursementId) {
      throw new Error('Reimbursement ID is required')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/reimbursements/${ reimbursementId }`,
    })
  }

  /**
   * @operationName Approve Reimbursement
   * @description Approves a pending reimbursement, advancing it to the APPROVED state and queueing it for payment. The caller must have approval authority for the submitting user.
   * @category Reimbursements
   * @route POST /approve-reimbursement
   * @appearanceColor #1ABC9C #5CD1B8
   *
   * @paramDef {"type":"String","label":"Reimbursement ID","name":"reimbursementId","required":true,"description":"The reimbursement to approve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"rem_001","status":"APPROVED","approved_at":"2026-06-01T10:00:00Z"}
   */
  async approveReimbursement(reimbursementId) {
    const logTag = '[approveReimbursement]'

    if (!reimbursementId) {
      throw new Error('Reimbursement ID is required')
    }

    return await this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ this.baseUrl }/developer/v1/reimbursements/${ reimbursementId }/approve`,
    })
  }

  // -------------------- Triggers --------------------

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On New Transaction
   * @description Triggers when a new card transaction appears in Ramp. Optionally filter by card or user to scope which transactions wake the flow. Polling interval can be customized (minimum 30 seconds).
   * @category Triggers
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-transaction
   * @appearanceColor #FFD93B #FFE36E
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Card","name":"cardId","dictionary":"getCardsDictionary","description":"Optional. Only transactions on this card trigger the flow."}
   * @paramDef {"type":"String","label":"User","name":"userId","dictionary":"getUsersDictionary","description":"Optional. Only transactions by this user trigger the flow."}
   *
   * @returns {Object}
   * @sampleResult {"id":"txn_001","amount":42.50,"currency_code":"USD","merchant_name":"Starbucks","state":"CLEARED","user_transaction_time":"2026-05-30T14:22:00Z","card_id":"crd_abc"}
   */
  async onNewTransaction(invocation) {
    const logTag = '[onNewTransaction]'
    const { cardId, userId } = invocation.triggerData || {}

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/transactions`,
      query: {
        card_id: cardId,
        user_id: userId,
        page_size: DEFAULT_PAGE_SIZE,
      },
    })

    return this.#diffPollingEvents(response.data || [], invocation, logTag)
  }

  /**
   * @operationName On New Bill
   * @description Triggers when a new bill is created in Ramp Bill Pay. Optionally filter by vendor to scope which bills wake the flow. Useful for AP approval workflows. Polling interval can be customized (minimum 30 seconds).
   * @category Triggers
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-bill
   * @appearanceColor #6E4AFF #9B85FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","dictionary":"getVendorsDictionary","description":"Optional. Only bills for this vendor trigger the flow."}
   *
   * @returns {Object}
   * @sampleResult {"id":"bil_001","vendor_id":"vnd_555","amount":12500,"currency_code":"USD","invoice_number":"INV-2026-001","due_date":"2026-06-30","status":"OPEN","created_at":"2026-05-15T10:00:00Z"}
   */
  async onNewBill(invocation) {
    const logTag = '[onNewBill]'
    const { vendorId } = invocation.triggerData || {}

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/bills`,
      query: {
        vendor_id: vendorId,
        page_size: DEFAULT_PAGE_SIZE,
      },
    })

    return this.#diffPollingEvents(response.data || [], invocation, logTag)
  }

  /**
   * @operationName On New Reimbursement
   * @description Triggers when a new reimbursement is submitted in Ramp. Optionally filter by submitting user. Useful for expense approval routing. Polling interval can be customized (minimum 30 seconds).
   * @category Triggers
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-reimbursement
   * @appearanceColor #1ABC9C #5CD1B8
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"User","name":"userId","dictionary":"getUsersDictionary","description":"Optional. Only reimbursements submitted by this user trigger the flow."}
   *
   * @returns {Object}
   * @sampleResult {"id":"rem_001","user_id":"usr_001","amount":4500,"currency_code":"USD","status":"PENDING","merchant":"Uber","memo":"Client airport ride","created_at":"2026-05-28T12:00:00Z"}
   */
  async onNewReimbursement(invocation) {
    const logTag = '[onNewReimbursement]'
    const { userId } = invocation.triggerData || {}

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/developer/v1/reimbursements`,
      query: {
        user_id: userId,
        page_size: DEFAULT_PAGE_SIZE,
      },
    })

    return this.#diffPollingEvents(response.data || [], invocation, logTag)
  }

  #diffPollingEvents(items, invocation, logTag) {
    if (invocation.learningMode) {
      logger.debug(`${ logTag } learningMode returning latest item`)

      return {
        events: items[0] ? [items[0]] : [],
        state: null,
      }
    }

    if (!invocation.state?.ids) {
      logger.debug(`${ logTag } seeding state with ${ items.length } ids`)

      return {
        events: [],
        state: { ids: items.map(i => i.id) },
      }
    }

    const seen = new Set(invocation.state.ids)
    const newOnes = items.filter(i => !seen.has(i.id))

    const merged = [...items.map(i => i.id), ...invocation.state.ids]
    const dedupedIds = [...new Set(merged)].slice(0, 200)

    logger.debug(`${ logTag } emitting ${ newOnes.length } new event(s)`)

    return {
      events: newOnes,
      state: { ids: dedupedIds },
    }
  }
}

Flowrunner.ServerCode.addService(RampService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'OAuth Client ID from Ramp Developer Settings: https://app.ramp.com/developer',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'OAuth Client Secret from Ramp Developer Settings. Treat as a password; do not share.',
  },
  {
    name: 'environment',
    displayName: 'Environment',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['production', 'sandbox'],
    defaultValue: 'production',
    required: false,
    shared: false,
    hint: 'Use sandbox (demo-api.ramp.com) for testing, production (api.ramp.com) for live data.',
  },
])
