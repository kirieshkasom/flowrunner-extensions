const OAUTH_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE_URL = 'https://graph.microsoft.com/v1.0'

const DEFAULT_SCOPE_LIST = [
  'offline_access',
  'User.Read',
  'Files.ReadWrite.All',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[Microsoft Excel 365] info:', ...args),
  debug: (...args) => console.log('[Microsoft Excel 365] debug:', ...args),
  error: (...args) => console.log('[Microsoft Excel 365] error:', ...args),
  warn: (...args) => console.log('[Microsoft Excel 365] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Microsoft Excel 365
 * @integrationIcon /icon.png
 **/
class MicrosoftExcelService {
  /**
   * @typedef {Object} getWorkbooksDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to find workbooks by file name across the signed-in user's OneDrive."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getWorksheetsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workbook ID","name":"itemId","required":true,"description":"The OneDrive item ID of the workbook whose worksheets to list."}
   */

  /**
   * @typedef {Object} getWorksheetsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter worksheets by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   * @paramDef {"type":"getWorksheetsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The workbook whose worksheets to list."}
   */

  /**
   * @typedef {Object} getTablesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workbook ID","name":"itemId","required":true,"description":"The OneDrive item ID of the workbook whose tables to list."}
   */

  /**
   * @typedef {Object} getTablesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tables by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   * @paramDef {"type":"getTablesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The workbook whose tables to list."}
   */
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ this.request.headers['oauth-access-token'] || accessToken }`,
    }
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url).set(this.#getAccessTokenHeader()).query(query).send(body)
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - error: ${ message }`)

      throw new Error(`Microsoft Excel 365 API error: ${ message }`)
    }
  }

  #workbookUrl(itemId, path) {
    return `${ API_BASE_URL }/me/drive/items/${ encodeURIComponent(itemId) }/workbook${ path }`
  }

  #rangeUrl(itemId, worksheet, address) {
    return this.#workbookUrl(
      itemId,
      `/worksheets/${ encodeURIComponent(worksheet) }/range(address='${ encodeURIComponent(address) }')`
    )
  }

  async #searchWorkbooks({ search, cursor, logTag }) {
    if (cursor) {
      return this.#apiRequest({ url: cursor, logTag })
    }

    const searchText = (search || 'xlsx').replace(/'/g, "''")

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/me/drive/root/search(q='${ encodeURIComponent(searchText) }')`,
      query: { $top: 50 },
      logTag,
    })

    return {
      ...response,
      value: (response.value || []).filter(item => item.file && item.name?.toLowerCase().endsWith('.xlsx')),
    }
  }

  async #getTableColumnNames(itemId, tableId, logTag) {
    const response = await this.#apiRequest({
      url: this.#workbookUrl(itemId, `/tables/${ encodeURIComponent(tableId) }/columns`),
      logTag,
    })

    return (response.value || []).map(column => column.name)
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('response_mode', 'query')

    return `${ OAUTH_BASE_URL }/authorize?${ params.toString() }`
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {Object} userData
   * @property {String} connectionIdentityName
   * @property {Boolean} overwrite
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const code = callbackObject.code
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('code', code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)

    const response = await Flowrunner.Request.post(url)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}

    try {
      userData = await Flowrunner.Request.get(`${ API_BASE_URL }/me`).set({
        Authorization: `Bearer ${ response.access_token }`,
        'Content-Type': 'application/json',
      })

      logger.debug(`[executeCallback] userData response: ${ JSON.stringify(userData, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] getUserProfile error: ${ error.message }`)
    }

    return {
      token: response.access_token,
      refreshToken: response.refresh_token,
      expirationInSeconds: response.expires_in,
      connectionIdentityName: constructIdentityName(userData),
      overwrite: true,
      userData: userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   * @property {String} refreshToken
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')
    params.append('client_secret', this.clientSecret)

    try {
      const response = await Flowrunner.Request.post(url)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        refreshToken: response.refresh_token,
        expirationInSeconds: response.expires_in,
      }
    } catch (error) {
      logger.error('Error refreshing token: ', error.message || error)
      throw error
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Workbooks Dictionary
   * @description Provides a searchable list of Excel workbooks (.xlsx files) from the signed-in user's OneDrive for dynamic parameter selection.
   * @route POST /get-workbooks-dictionary
   * @paramDef {"type":"getWorkbooksDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering workbooks."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Report.xlsx","value":"01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36K","note":"/drive/root:/Documents"}],"cursor":null}
   */
  async getWorkbooksDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#searchWorkbooks({
      search,
      cursor,
      logTag: 'getWorkbooksDictionary',
    })

    return {
      cursor: response['@odata.nextLink'] || null,
      items: (response.value || []).map(({ id, name, parentReference }) => ({
        label: name,
        note: parentReference?.path || `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Worksheets Dictionary
   * @description Provides a searchable list of worksheets within a selected workbook for dynamic parameter selection. Requires a workbook to be chosen first.
   * @route POST /get-worksheets-dictionary
   * @paramDef {"type":"getWorksheetsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination cursor, and the workbook criteria whose worksheets to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sheet1","value":"Sheet1","note":"ID: {00000000-0001-0000-0000-000000000000}"}],"cursor":null}
   */
  async getWorksheetsDictionary(payload) {
    const { search, criteria } = payload || {}
    const itemId = criteria?.itemId

    if (!itemId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      url: this.#workbookUrl(itemId, '/worksheets'),
      logTag: 'getWorksheetsDictionary',
    })

    const worksheets = response.value || []
    const filteredWorksheets = search ? searchFilter(worksheets, ['name'], search) : worksheets

    return {
      cursor: null,
      items: filteredWorksheets.map(({ id, name }) => ({
        label: name,
        note: `ID: ${ id }`,
        value: name,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Provides a searchable list of Excel tables within a selected workbook for dynamic parameter selection. Requires a workbook to be chosen first.
   * @route POST /get-tables-dictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination cursor, and the workbook criteria whose tables to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"SalesTable","value":"SalesTable","note":"ID: 1"}],"cursor":null}
   */
  async getTablesDictionary(payload) {
    const { search, criteria } = payload || {}
    const itemId = criteria?.itemId

    if (!itemId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      url: this.#workbookUrl(itemId, '/tables'),
      logTag: 'getTablesDictionary',
    })

    const tables = response.value || []
    const filteredTables = search ? searchFilter(tables, ['name'], search) : tables

    return {
      cursor: null,
      items: filteredTables.map(({ id, name }) => ({
        label: name,
        note: `ID: ${ id }`,
        value: name,
      })),
    }
  }

  /**
   * @operationName List Workbooks
   * @category Workbooks
   * @appearanceColor #217346 #185C37
   * @description Searches the signed-in user's OneDrive for Excel workbooks (.xlsx files) and returns each workbook's OneDrive item ID, name, folder path, size, and modification time. Use the returned ID as the Workbook parameter in other operations. Note: workbooks cannot be created by this service; create them in OneDrive or Excel first, then select them here.
   * @route GET /list-workbooks
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match against file names. When omitted, all .xlsx files in OneDrive are returned."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36K","name":"Sales Report.xlsx","webUrl":"https://onedrive.live.com/edit.aspx?resid=ABC123","parentPath":"/drive/root:/Documents","size":24576,"createdDateTime":"2026-06-01T09:00:00Z","lastModifiedDateTime":"2026-07-10T15:30:00Z"}],"nextLink":null}
   */
  async listWorkbooks(search, nextLink) {
    const response = await this.#searchWorkbooks({
      search,
      cursor: nextLink,
      logTag: 'listWorkbooks',
    })

    return {
      value: (response.value || []).map(item => ({
        id: item.id,
        name: item.name,
        webUrl: item.webUrl,
        parentPath: item.parentReference?.path || null,
        size: item.size,
        createdDateTime: item.createdDateTime,
        lastModifiedDateTime: item.lastModifiedDateTime,
      })),
      nextLink: response['@odata.nextLink'] || null,
    }
  }

  /**
   * @operationName List Worksheets
   * @category Worksheets
   * @appearanceColor #217346 #185C37
   * @description Retrieves all worksheets in a workbook, including each worksheet's ID, name, position, and visibility.
   * @route GET /list-worksheets
   * @paramDef {"type":"String","label":"Workbook","name":"itemId","required":true,"dictionary":"getWorkbooksDictionary","description":"The Excel workbook stored in OneDrive. Choose a workbook or paste a OneDrive item ID."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"{00000000-0001-0000-0000-000000000000}","name":"Sheet1","position":0,"visibility":"Visible"}]}
   */
  async listWorksheets(itemId) {
    if (!itemId) {
      throw new Error('Parameter "Workbook" is required')
    }

    return this.#apiRequest({
      url: this.#workbookUrl(itemId, '/worksheets'),
      logTag: 'listWorksheets',
    })
  }

  /**
   * @operationName Add Worksheet
   * @category Worksheets
   * @appearanceColor #217346 #185C37
   * @description Adds a new worksheet to a workbook. The worksheet is added at the end of the existing worksheets and becomes available immediately for range and table operations.
   * @route POST /add-worksheet
   * @paramDef {"type":"String","label":"Workbook","name":"itemId","required":true,"dictionary":"getWorkbooksDictionary","description":"The Excel workbook stored in OneDrive. Choose a workbook or paste a OneDrive item ID."}
   * @paramDef {"type":"String","label":"Worksheet Name","name":"name","required":true,"description":"The name of the new worksheet. Must be unique within the workbook and must not exceed 31 characters."}
   * @returns {Object}
   * @sampleResult {"id":"{00000000-0004-0000-0000-000000000000}","name":"Q3 Data","position":3,"visibility":"Visible"}
   */
  async addWorksheet(itemId, name) {
    if (!itemId) {
      throw new Error('Parameter "Workbook" is required')
    }

    if (!name) {
      throw new Error('Parameter "Worksheet Name" is required')
    }

    return this.#apiRequest({
      url: this.#workbookUrl(itemId, '/worksheets/add'),
      logTag: 'addWorksheet',
      method: 'post',
      body: { name },
    })
  }

  /**
   * @operationName Delete Worksheet
   * @category Worksheets
   * @appearanceColor #217346 #185C37
   * @description Deletes a worksheet from a workbook. All data on the worksheet is permanently removed. A workbook must always keep at least one worksheet; deleting the last one fails.
   * @route DELETE /delete-worksheet
   * @paramDef {"type":"String","label":"Workbook","name":"itemId","required":true,"dictionary":"getWorkbooksDictionary","description":"The Excel workbook stored in OneDrive. Choose a workbook or paste a OneDrive item ID."}
   * @paramDef {"type":"String","label":"Worksheet","name":"worksheet","required":true,"dictionary":"getWorksheetsDictionary","dependsOn":["itemId"],"description":"The worksheet to delete. Choose a workbook above to pick from its worksheets, or enter a worksheet name or ID."}
   * @returns {Object}
   * @sampleResult {"message":"Worksheet deleted successfully"}
   */
  async deleteWorksheet(itemId, worksheet) {
    if (!itemId) {
      throw new Error('Parameter "Workbook" is required')
    }

    if (!worksheet) {
      throw new Error('Parameter "Worksheet" is required')
    }

    await this.#apiRequest({
      url: this.#workbookUrl(itemId, `/worksheets/${ encodeURIComponent(worksheet) }`),
      logTag: 'deleteWorksheet',
      method: 'delete',
    })

    return { message: 'Worksheet deleted successfully' }
  }

  /**
   * @operationName Get Range Values
   * @category Ranges
   * @appearanceColor #217346 #185C37
   * @description Reads cell values from a worksheet range (for example A1:C10) and returns them as a two-dimensional array. When "First Row As Headers" is enabled, the result additionally includes an "objects" array where each row is converted to an object keyed by the header values from the first row.
   * @route GET /get-range-values
   * @paramDef {"type":"String","label":"Workbook","name":"itemId","required":true,"dictionary":"getWorkbooksDictionary","description":"The Excel workbook stored in OneDrive. Choose a workbook or paste a OneDrive item ID."}
   * @paramDef {"type":"String","label":"Worksheet","name":"worksheet","required":true,"dictionary":"getWorksheetsDictionary","dependsOn":["itemId"],"description":"The worksheet to read from. Choose a workbook above to pick from its worksheets, or enter a worksheet name or ID."}
   * @paramDef {"type":"String","label":"Range Address","name":"address","required":true,"description":"The range to read in A1 notation, for example A1:C10 or B2."}
   * @paramDef {"type":"Boolean","label":"First Row As Headers","name":"firstRowAsHeaders","uiComponent":{"type":"TOGGLE"},"description":"When enabled, treats the first row of the range as column headers and adds an \"objects\" array to the result where each remaining row is an object keyed by those headers."}
   * @returns {Object}
   * @sampleResult {"address":"Sheet1!A1:C3","rowCount":3,"columnCount":3,"values":[["Name","Email","Score"],["John","john@example.com",95],["Jane","jane@example.com",88]],"objects":[{"Name":"John","Email":"john@example.com","Score":95},{"Name":"Jane","Email":"jane@example.com","Score":88}]}
   */
  async getRangeValues(itemId, worksheet, address, firstRowAsHeaders) {
    if (!itemId) {
      throw new Error('Parameter "Workbook" is required')
    }

    if (!worksheet) {
      throw new Error('Parameter "Worksheet" is required')
    }

    if (!address) {
      throw new Error('Parameter "Range Address" is required')
    }

    const response = await this.#apiRequest({
      url: this.#rangeUrl(itemId, worksheet, address),
      query: { $select: 'address,rowCount,columnCount,values' },
      logTag: 'getRangeValues',
    })

    return buildRangeResult(response, firstRowAsHeaders)
  }

  /**
   * @operationName Update Range Values
   * @category Ranges
   * @appearanceColor #217346 #185C37
   * @description Writes cell values to a worksheet range. Values may be a two-dimensional array of rows (e.g. [["Name","Score"],["John",95]]) or an array of objects (e.g. [{"Name":"John","Score":95}]) — for objects, a header row is derived from the object keys. If Range Address is a single cell (e.g. A1), the range is automatically expanded to fit the data; otherwise the range dimensions must exactly match the data dimensions.
   * @route PATCH /update-range-values
   * @paramDef {"type":"String","label":"Workbook","name":"itemId","required":true,"dictionary":"getWorkbooksDictionary","description":"The Excel workbook stored in OneDrive. Choose a workbook or paste a OneDrive item ID."}
   * @paramDef {"type":"String","label":"Worksheet","name":"worksheet","required":true,"dictionary":"getWorksheetsDictionary","dependsOn":["itemId"],"description":"The worksheet to write to. Choose a workbook above to pick from its worksheets, or enter a worksheet name or ID."}
   * @paramDef {"type":"String","label":"Range Address","name":"address","required":true,"description":"The range to write in A1 notation. Use a single cell (e.g. A1) as the top-left anchor to auto-fit the data, or a full range (e.g. A1:C3) that exactly matches the data dimensions."}
   * @paramDef {"type":"Array","label":"Values","name":"values","required":true,"description":"The data to write. Either a two-dimensional array where each inner array is a row of cell values, or an array of objects where keys become column headers. A flat array of scalars is treated as a single row."}
   * @paramDef {"type":"Boolean","label":"Include Header Row","name":"includeHeaderRow","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When Values is an array of objects, controls whether the derived header row is written as the first row. Ignored when Values is a two-dimensional array. Defaults to true."}
   * @returns {Object}
   * @sampleResult {"address":"Sheet1!A1:C2","rowCount":2,"columnCount":3,"values":[["Name","Email","Score"],["John","john@example.com",95]]}
   */
  async updateRangeValues(itemId, worksheet, address, values, includeHeaderRow) {
    if (!itemId) {
      throw new Error('Parameter "Workbook" is required')
    }

    if (!worksheet) {
      throw new Error('Parameter "Worksheet" is required')
    }

    if (!address) {
      throw new Error('Parameter "Range Address" is required')
    }

    const normalizedValues = normalizeToMatrix(values, includeHeaderRow !== false)

    if (!normalizedValues.length || !normalizedValues[0].length) {
      throw new Error('Parameter "Values" must contain at least one row of data')
    }

    const targetAddress = expandSingleCellAddress(address, normalizedValues.length, normalizedValues[0].length)

    const response = await this.#apiRequest({
      url: this.#rangeUrl(itemId, worksheet, targetAddress),
      logTag: 'updateRangeValues',
      method: 'patch',
      body: { values: normalizedValues },
    })

    return buildRangeResult(response, false)
  }

  /**
   * @operationName Get Used Range
   * @category Ranges
   * @appearanceColor #217346 #185C37
   * @description Retrieves the used range of a worksheet — the smallest range that contains all cells with data or formatting — including its address and values. When "First Row As Headers" is enabled, the result additionally includes an "objects" array where each row is converted to an object keyed by the header values from the first row.
   * @route GET /get-used-range
   * @paramDef {"type":"String","label":"Workbook","name":"itemId","required":true,"dictionary":"getWorkbooksDictionary","description":"The Excel workbook stored in OneDrive. Choose a workbook or paste a OneDrive item ID."}
   * @paramDef {"type":"String","label":"Worksheet","name":"worksheet","required":true,"dictionary":"getWorksheetsDictionary","dependsOn":["itemId"],"description":"The worksheet whose used range to retrieve. Choose a workbook above to pick from its worksheets, or enter a worksheet name or ID."}
   * @paramDef {"type":"Boolean","label":"Values Only","name":"valuesOnly","uiComponent":{"type":"TOGGLE"},"description":"When enabled, considers only cells that contain values, ignoring cells that are merely formatted. Useful to skip trailing formatted-but-empty rows and columns."}
   * @paramDef {"type":"Boolean","label":"First Row As Headers","name":"firstRowAsHeaders","uiComponent":{"type":"TOGGLE"},"description":"When enabled, treats the first row of the used range as column headers and adds an \"objects\" array to the result where each remaining row is an object keyed by those headers."}
   * @returns {Object}
   * @sampleResult {"address":"Sheet1!A1:C3","rowCount":3,"columnCount":3,"values":[["Name","Email","Score"],["John","john@example.com",95],["Jane","jane@example.com",88]],"objects":[{"Name":"John","Email":"john@example.com","Score":95},{"Name":"Jane","Email":"jane@example.com","Score":88}]}
   */
  async getUsedRange(itemId, worksheet, valuesOnly, firstRowAsHeaders) {
    if (!itemId) {
      throw new Error('Parameter "Workbook" is required')
    }

    if (!worksheet) {
      throw new Error('Parameter "Worksheet" is required')
    }

    const usedRangePath = valuesOnly ? '/usedRange(valuesOnly=true)' : '/usedRange'

    const response = await this.#apiRequest({
      url: this.#workbookUrl(itemId, `/worksheets/${ encodeURIComponent(worksheet) }${ usedRangePath }`),
      query: { $select: 'address,rowCount,columnCount,values' },
      logTag: 'getUsedRange',
    })

    return buildRangeResult(response, firstRowAsHeaders)
  }

  /**
   * @operationName Clear Range
   * @category Ranges
   * @appearanceColor #217346 #185C37
   * @description Clears a worksheet range. Choose whether to clear everything (values and formatting), only cell contents, or only formatting. The cells themselves are not deleted and surrounding data does not shift.
   * @route POST /clear-range
   * @paramDef {"type":"String","label":"Workbook","name":"itemId","required":true,"dictionary":"getWorkbooksDictionary","description":"The Excel workbook stored in OneDrive. Choose a workbook or paste a OneDrive item ID."}
   * @paramDef {"type":"String","label":"Worksheet","name":"worksheet","required":true,"dictionary":"getWorksheetsDictionary","dependsOn":["itemId"],"description":"The worksheet that contains the range. Choose a workbook above to pick from its worksheets, or enter a worksheet name or ID."}
   * @paramDef {"type":"String","label":"Range Address","name":"address","required":true,"description":"The range to clear in A1 notation, for example A1:C10."}
   * @paramDef {"type":"String","label":"Apply To","name":"applyTo","defaultValue":"All","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Contents","Formats"]}},"description":"What to clear: All removes both values and formatting, Contents removes only cell values, Formats removes only formatting. Defaults to All."}
   * @returns {Object}
   * @sampleResult {"message":"Range cleared successfully"}
   */
  async clearRange(itemId, worksheet, address, applyTo) {
    if (!itemId) {
      throw new Error('Parameter "Workbook" is required')
    }

    if (!worksheet) {
      throw new Error('Parameter "Worksheet" is required')
    }

    if (!address) {
      throw new Error('Parameter "Range Address" is required')
    }

    await this.#apiRequest({
      url: `${ this.#rangeUrl(itemId, worksheet, address) }/clear`,
      logTag: 'clearRange',
      method: 'post',
      body: { applyTo: applyTo || 'All' },
    })

    return { message: 'Range cleared successfully' }
  }

  /**
   * @operationName List Tables
   * @category Tables
   * @appearanceColor #217346 #185C37
   * @description Retrieves all Excel tables in a workbook, including each table's ID, name, and settings such as header and total row visibility.
   * @route GET /list-tables
   * @paramDef {"type":"String","label":"Workbook","name":"itemId","required":true,"dictionary":"getWorkbooksDictionary","description":"The Excel workbook stored in OneDrive. Choose a workbook or paste a OneDrive item ID."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"1","name":"SalesTable","showHeaders":true,"showTotals":false,"style":"TableStyleMedium2"}]}
   */
  async listTables(itemId) {
    if (!itemId) {
      throw new Error('Parameter "Workbook" is required')
    }

    return this.#apiRequest({
      url: this.#workbookUrl(itemId, '/tables'),
      logTag: 'listTables',
    })
  }

  /**
   * @operationName Create Table
   * @category Tables
   * @appearanceColor #217346 #185C37
   * @description Creates a new Excel table over the given worksheet range. When "Has Headers" is enabled, the first row of the range is used as column headers; otherwise Excel generates default headers (Column1, Column2, ...) and shifts the data down by one row.
   * @route POST /create-table
   * @paramDef {"type":"String","label":"Workbook","name":"itemId","required":true,"dictionary":"getWorkbooksDictionary","description":"The Excel workbook stored in OneDrive. Choose a workbook or paste a OneDrive item ID."}
   * @paramDef {"type":"String","label":"Worksheet","name":"worksheet","required":true,"dictionary":"getWorksheetsDictionary","dependsOn":["itemId"],"description":"The worksheet on which to create the table. Choose a workbook above to pick from its worksheets, or enter a worksheet name or ID."}
   * @paramDef {"type":"String","label":"Range Address","name":"address","required":true,"description":"The range the table should cover, in A1 notation, for example A1:D8."}
   * @paramDef {"type":"Boolean","label":"Has Headers","name":"hasHeaders","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the first row of the range contains column headers. Defaults to true."}
   * @returns {Object}
   * @sampleResult {"id":"2","name":"Table2","showHeaders":true,"showTotals":false,"style":"TableStyleMedium2"}
   */
  async createTable(itemId, worksheet, address, hasHeaders) {
    if (!itemId) {
      throw new Error('Parameter "Workbook" is required')
    }

    if (!worksheet) {
      throw new Error('Parameter "Worksheet" is required')
    }

    if (!address) {
      throw new Error('Parameter "Range Address" is required')
    }

    return this.#apiRequest({
      url: this.#workbookUrl(itemId, `/worksheets/${ encodeURIComponent(worksheet) }/tables/add`),
      logTag: 'createTable',
      method: 'post',
      body: {
        address,
        hasHeaders: hasHeaders !== false,
      },
    })
  }

  /**
   * @operationName Add Table Rows
   * @category Tables
   * @appearanceColor #217346 #185C37
   * @description Appends one or more rows to an Excel table. Rows may be a two-dimensional array matching the table's column order (e.g. [["John",95],["Jane",88]]) or an array of objects keyed by column name (e.g. [{"Name":"John","Score":95}]) — objects are mapped to the table's columns automatically, with missing columns filled with null. Batching multiple rows in one call is significantly faster than adding rows one at a time.
   * @route POST /add-table-rows
   * @paramDef {"type":"String","label":"Workbook","name":"itemId","required":true,"dictionary":"getWorkbooksDictionary","description":"The Excel workbook stored in OneDrive. Choose a workbook or paste a OneDrive item ID."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["itemId"],"description":"The table to add rows to. Choose a workbook above to pick from its tables, or enter a table name or ID."}
   * @paramDef {"type":"Array","label":"Rows","name":"rows","required":true,"description":"The rows to append. Either a two-dimensional array where each inner array matches the table's column order, or an array of objects where keys are table column names. A flat array of scalars is treated as a single row."}
   * @paramDef {"type":"Number","label":"Insert At Index","name":"index","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional zero-based position at which to insert the rows. Existing rows below the insertion point shift down. When omitted, rows are appended at the end of the table."}
   * @returns {Object}
   * @sampleResult {"index":5,"values":[["John","john@example.com",95],["Jane","jane@example.com",88]]}
   */
  async addTableRows(itemId, tableId, rows, index) {
    if (!itemId) {
      throw new Error('Parameter "Workbook" is required')
    }

    if (!tableId) {
      throw new Error('Parameter "Table" is required')
    }

    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('Parameter "Rows" must be a non-empty array')
    }

    let values

    if (rows.every(row => Array.isArray(row))) {
      values = rows
    } else if (rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) {
      const columnNames = await this.#getTableColumnNames(itemId, tableId, 'addTableRows')

      values = rows.map(row => columnNames.map(columnName => resolveObjectValue(row, columnName)))
    } else {
      values = [rows]
    }

    const body = { values }

    if (index !== undefined && index !== null) {
      body.index = index
    }

    return this.#apiRequest({
      url: this.#workbookUrl(itemId, `/tables/${ encodeURIComponent(tableId) }/rows/add`),
      logTag: 'addTableRows',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName List Table Rows
   * @category Tables
   * @appearanceColor #217346 #185C37
   * @description Retrieves the data rows of an Excel table (header row excluded) and converts each row into an object keyed by the table's column names. The result includes the column names, the raw two-dimensional values array, and the converted row objects.
   * @route GET /list-table-rows
   * @paramDef {"type":"String","label":"Workbook","name":"itemId","required":true,"dictionary":"getWorkbooksDictionary","description":"The Excel workbook stored in OneDrive. Choose a workbook or paste a OneDrive item ID."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["itemId"],"description":"The table whose rows to retrieve. Choose a workbook above to pick from its tables, or enter a table name or ID."}
   * @returns {Object}
   * @sampleResult {"columnNames":["Name","Email","Score"],"rowCount":2,"values":[["John","john@example.com",95],["Jane","jane@example.com",88]],"rows":[{"index":0,"Name":"John","Email":"john@example.com","Score":95},{"index":1,"Name":"Jane","Email":"jane@example.com","Score":88}]}
   */
  async listTableRows(itemId, tableId) {
    if (!itemId) {
      throw new Error('Parameter "Workbook" is required')
    }

    if (!tableId) {
      throw new Error('Parameter "Table" is required')
    }

    const columnNames = await this.#getTableColumnNames(itemId, tableId, 'listTableRows')

    const response = await this.#apiRequest({
      url: this.#workbookUrl(itemId, `/tables/${ encodeURIComponent(tableId) }/rows`),
      logTag: 'listTableRows',
    })

    const tableRows = response.value || []
    const values = tableRows.map(row => (row.values && row.values[0]) || [])

    return {
      columnNames,
      rowCount: tableRows.length,
      values,
      rows: tableRows.map((row, rowIndex) => {
        const rowValues = (row.values && row.values[0]) || []
        const rowObject = { index: row.index !== undefined ? row.index : rowIndex }

        columnNames.forEach((columnName, columnIndex) => {
          rowObject[columnName] = rowValues[columnIndex] !== undefined ? rowValues[columnIndex] : null
        })

        return rowObject
      }),
    }
  }

  /**
   * @operationName List Table Columns
   * @category Tables
   * @appearanceColor #217346 #185C37
   * @description Retrieves the columns of an Excel table, including each column's ID, name, zero-based index, and cell values.
   * @route GET /list-table-columns
   * @paramDef {"type":"String","label":"Workbook","name":"itemId","required":true,"dictionary":"getWorkbooksDictionary","description":"The Excel workbook stored in OneDrive. Choose a workbook or paste a OneDrive item ID."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["itemId"],"description":"The table whose columns to retrieve. Choose a workbook above to pick from its tables, or enter a table name or ID."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"1","name":"Name","index":0,"values":[["Name"],["John"],["Jane"]]},{"id":"2","name":"Score","index":1,"values":[["Score"],[95],[88]]}]}
   */
  async listTableColumns(itemId, tableId) {
    if (!itemId) {
      throw new Error('Parameter "Workbook" is required')
    }

    if (!tableId) {
      throw new Error('Parameter "Table" is required')
    }

    return this.#apiRequest({
      url: this.#workbookUrl(itemId, `/tables/${ encodeURIComponent(tableId) }/columns`),
      logTag: 'listTableColumns',
    })
  }

  /**
   * @operationName Delete Table Row
   * @category Tables
   * @appearanceColor #217346 #185C37
   * @description Deletes a single data row from an Excel table by its zero-based index (the header row is not counted). Rows below the deleted row shift up, so their indexes decrease by one.
   * @route DELETE /delete-table-row
   * @paramDef {"type":"String","label":"Workbook","name":"itemId","required":true,"dictionary":"getWorkbooksDictionary","description":"The Excel workbook stored in OneDrive. Choose a workbook or paste a OneDrive item ID."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["itemId"],"description":"The table that contains the row. Choose a workbook above to pick from its tables, or enter a table name or ID."}
   * @paramDef {"type":"Number","label":"Row Index","name":"index","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The zero-based index of the data row to delete. The table's header row is not counted, so index 0 is the first data row."}
   * @returns {Object}
   * @sampleResult {"message":"Table row deleted successfully"}
   */
  async deleteTableRow(itemId, tableId, index) {
    if (!itemId) {
      throw new Error('Parameter "Workbook" is required')
    }

    if (!tableId) {
      throw new Error('Parameter "Table" is required')
    }

    if (index === undefined || index === null) {
      throw new Error('Parameter "Row Index" is required')
    }

    await this.#apiRequest({
      url: this.#workbookUrl(itemId, `/tables/${ encodeURIComponent(tableId) }/rows/${ index }`),
      logTag: 'deleteTableRow',
      method: 'delete',
    })

    return { message: 'Table row deleted successfully' }
  }
}

Flowrunner.ServerCode.addService(MicrosoftExcelService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID (Application ID) of your Microsoft Entra app registration.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret of your Microsoft Entra app registration.',
  },
])

function searchFilter(list, props, searchString) {
  const caseInsensitiveSearch = searchString.toLowerCase()

  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(caseInsensitiveSearch)
    })
  )
}

function cleanupObject(data) {
  if (!data) {
    return
  }

  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function constructIdentityName(user) {
  const email = user.mail || user.userPrincipalName

  if (email && user.displayName) {
    return `${ email } (${ user.displayName })`
  }

  return email || user.displayName || 'Microsoft Excel 365 Connection'
}

function buildRangeResult(response, firstRowAsHeaders) {
  const result = {
    address: response.address,
    rowCount: response.rowCount,
    columnCount: response.columnCount,
    values: response.values || [],
  }

  if (firstRowAsHeaders) {
    result.objects = valuesToObjects(result.values)
  }

  return result
}

function valuesToObjects(values) {
  if (!Array.isArray(values) || values.length < 1) {
    return []
  }

  const headers = (values[0] || []).map((header, index) => {
    const headerText = header === null || header === undefined ? '' : String(header).trim()

    return headerText || `column${ index + 1 }`
  })

  return values.slice(1).map(row =>
    headers.reduce((rowObject, header, columnIndex) => {
      rowObject[header] = row && row[columnIndex] !== undefined ? row[columnIndex] : null

      return rowObject
    }, {})
  )
}

function normalizeToMatrix(values, includeHeaderRow) {
  if (!Array.isArray(values)) {
    throw new Error('Parameter "Values" must be an array')
  }

  if (values.every(row => Array.isArray(row))) {
    return values
  }

  if (values.every(row => row && typeof row === 'object' && !Array.isArray(row))) {
    const headers = []

    values.forEach(row => {
      Object.keys(row).forEach(key => {
        if (!headers.includes(key)) {
          headers.push(key)
        }
      })
    })

    const dataRows = values.map(row => headers.map(header => (row[header] !== undefined ? row[header] : null)))

    return includeHeaderRow ? [headers, ...dataRows] : dataRows
  }

  return [values]
}

function resolveObjectValue(row, columnName) {
  if (row[columnName] !== undefined) {
    return row[columnName]
  }

  const caseInsensitiveKey = Object.keys(row).find(key => key.toLowerCase() === String(columnName).toLowerCase())

  return caseInsensitiveKey !== undefined ? row[caseInsensitiveKey] : null
}

function expandSingleCellAddress(address, rowCount, columnCount) {
  if (address.includes(':')) {
    return address
  }

  const match = address.match(/^(.*!)?\$?([A-Za-z]{1,3})\$?(\d+)$/)

  if (!match) {
    return address
  }

  const [, sheetPrefix, startColumn, startRow] = match
  const endColumn = columnNumberToLetters(columnLettersToNumber(startColumn) + columnCount - 1)
  const endRow = Number(startRow) + rowCount - 1

  return `${ sheetPrefix || '' }${ startColumn }${ startRow }:${ endColumn }${ endRow }`
}

function columnLettersToNumber(letters) {
  return letters
    .toUpperCase()
    .split('')
    .reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0)
}

function columnNumberToLetters(columnNumber) {
  let letters = ''

  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    columnNumber = Math.floor((columnNumber - 1) / 26)
  }

  return letters
}
