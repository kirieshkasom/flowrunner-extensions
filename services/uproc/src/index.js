const logger = {
  info: (...args) => console.log('[uProc] info:', ...args),
  debug: (...args) => console.log('[uProc] debug:', ...args),
  error: (...args) => console.log('[uProc] error:', ...args),
  warn: (...args) => console.log('[uProc] warn:', ...args),
}

// uProc API v2 lives under /api/v2 (verified against a working POST /process example).
const API_BASE_URL = 'https://api.uproc.io/api/v2'

function clean(obj) {
  if (!obj || typeof obj !== 'object') {
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
 * @integrationName uProc
 * @integrationIcon /icon.png
 */
class UprocService {
  constructor(config) {
    this.email = config.email
    this.apiKey = config.apiKey
  }

  #authHeader() {
    const token = Buffer.from(`${ this.email }:${ this.apiKey }`).toString('base64')

    return `Basic ${ token }`
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': this.#authHeader(),
          'Content-Type': 'application/json',
        })
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.message ||
        error.body?.error ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`uProc API error: ${ message }`)
    }
  }

  // Runs a named uProc tool (processor) with the given params and unwraps the result payload.
  async #runProcessor(processor, params, logTag) {
    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/process`,
      method: 'post',
      body: {
        processor,
        params: clean(params) || {},
      },
    })

    // uProc returns the processed value(s) under result (sometimes response); expose the
    // unwrapped value while keeping the raw envelope available under `raw`.
    const result = response && (response.result !== undefined ? response.result : response.response)

    return {
      processor,
      result: result !== undefined ? result : response,
      message: response?.message,
      raw: response,
    }
  }

  /**
   * @operationName Run Tool
   * @category Tools
   * @description Runs any uProc tool (processor) by name and returns its processed result. This is the flagship, fully generic runner covering uProc's entire tool catalog (email, phone, company, IP, geolocation, text, image, and more). Provide the processor name using the "group-tool" convention (for example "email-check-exists", "phone-check-exists", "company-search-by-name", "text-to-uppercase") and a params object holding the inputs that tool expects. Each successful call consumes uProc credits. Consult the uProc tool catalog at https://app.uproc.io/#/tools for the exact processor name and required params of each tool.
   * @route POST /run-tool
   * @paramDef {"type":"String","label":"Tool","name":"tool","required":true,"description":"Processor name in group-tool form, e.g. 'email-check-exists', 'phone-check-exists', 'company-search-by-name', 'text-to-uppercase'."}
   * @paramDef {"type":"Object","label":"Parameters","name":"params","required":true,"description":"Key/value inputs the chosen tool expects, e.g. {\"email\":\"john@doe.com\"} for email-check-exists. See the tool's page in the uProc catalog for its required keys."}
   * @returns {Object}
   * @sampleResult {"processor":"email-check-exists","result":{"exists":"yes"},"message":"success","raw":{"result":{"exists":"yes"},"message":"success"}}
   */
  async runTool(tool, params) {
    return await this.#runProcessor(tool, params, '[runTool]')
  }

  /**
   * @operationName Verify Email
   * @category Email
   * @description Checks whether an email address exists and can receive mail using uProc's "email-check-exists" tool. Returns the deliverability verdict for the address. Consumes uProc credits per verification.
   * @route POST /verify-email
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address to verify, e.g. 'john@doe.com'."}
   * @returns {Object}
   * @sampleResult {"processor":"email-check-exists","result":{"exists":"yes"},"message":"success","raw":{"result":{"exists":"yes"},"message":"success"}}
   */
  async verifyEmail(email) {
    return await this.#runProcessor('email-check-exists', { email }, '[verifyEmail]')
  }

  /**
   * @operationName Verify Phone
   * @category Phone
   * @description Checks whether a phone number is valid and reachable using uProc's "phone-check-exists" tool. Provide the phone number and its two-letter ISO country code for accurate line-type and validity detection. Consumes uProc credits per verification.
   * @route POST /verify-phone
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":true,"description":"Phone number to verify, in national or international format, e.g. '+14155552671'."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"description":"Two-letter ISO 3166-1 alpha-2 country code for the number, e.g. 'US', 'ES', 'GB'."}
   * @returns {Object}
   * @sampleResult {"processor":"phone-check-exists","result":{"exists":"yes","type":"mobile"},"message":"success","raw":{"result":{"exists":"yes","type":"mobile"},"message":"success"}}
   */
  async verifyPhone(phone, country) {
    return await this.#runProcessor('phone-check-exists', { phone, country }, '[verifyPhone]')
  }

  /**
   * @operationName Get Gender by Name
   * @category Enrichment
   * @description Infers the likely gender for a given first name using uProc's "name-get-gender" tool. Returns the predicted gender for the supplied name. Consumes uProc credits per lookup.
   * @route POST /get-gender
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"First name to analyze, e.g. 'Alexandra'."}
   * @returns {Object}
   * @sampleResult {"processor":"name-get-gender","result":{"gender":"female"},"message":"success","raw":{"result":{"gender":"female"},"message":"success"}}
   */
  async getGenderByName(name) {
    return await this.#runProcessor('name-get-gender', { name }, '[getGenderByName]')
  }

  /**
   * @operationName Company Search
   * @category Enrichment
   * @description Searches for company records by name using uProc's "company-search-by-name" tool. Provide the company name and a two-letter ISO country code to scope the search. Returns matching company data. Consumes uProc credits per search.
   * @route POST /company-search
   * @paramDef {"type":"String","label":"Company Name","name":"name","required":true,"description":"Company name to search for, e.g. 'uProc'."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"description":"Two-letter ISO 3166-1 alpha-2 country code to scope the search, e.g. 'ES', 'US'."}
   * @returns {Object}
   * @sampleResult {"processor":"company-search-by-name","result":{"name":"uProc","country":"ES","website":"uproc.io"},"message":"success","raw":{"result":{"name":"uProc"},"message":"success"}}
   */
  async companySearch(name, country) {
    return await this.#runProcessor('company-search-by-name', { name, country }, '[companySearch]')
  }

  /**
   * @operationName List Groups
   * @category Catalog
   * @description Lists the uProc tool groups (categories such as email, phone, company, communication, image, text). Use a group name together with its tools to build a "group-tool" processor name for the Run Tool operation.
   * @route GET /groups
   * @returns {Object}
   * @sampleResult {"groups":[{"name":"email","title":"Email"},{"name":"phone","title":"Phone"},{"name":"company","title":"Company"}]}
   */
  async listGroups() {
    return await this.#apiRequest({
      logTag: '[listGroups]',
      url: `${ API_BASE_URL }/groups`,
      method: 'get',
    })
  }

  /**
   * @operationName List Tools
   * @category Catalog
   * @description Lists the uProc tools (processors) available to your account, including each tool's name and the parameters it expects. Use a tool's name as the processor argument for the Run Tool operation. Optionally filter to a single group.
   * @route GET /tools
   * @paramDef {"type":"String","label":"Group","name":"group","description":"Optional group name to filter the tool list, e.g. 'email', 'phone', 'company'. Leave empty to list all tools."}
   * @returns {Object}
   * @sampleResult {"tools":[{"name":"email-check-exists","group":"email","params":["email"]},{"name":"phone-check-exists","group":"phone","params":["phone","country"]}]}
   */
  async listTools(group) {
    return await this.#apiRequest({
      logTag: '[listTools]',
      url: `${ API_BASE_URL }/tools`,
      method: 'get',
      query: { group },
    })
  }

  /**
   * @operationName Get Profile
   * @category Account
   * @description Retrieves the authenticated uProc account profile, including remaining credits. Use this as a connection check to confirm the email and API key are valid and to monitor your available credit balance before running tools.
   * @route GET /profile
   * @returns {Object}
   * @sampleResult {"email":"john@doe.com","credits":9500,"plan":"pro"}
   */
  async getProfile() {
    return await this.#apiRequest({
      logTag: '[getProfile]',
      url: `${ API_BASE_URL }/profile`,
      method: 'get',
    })
  }
}

Flowrunner.ServerCode.addService(UprocService, [
  {
    name: 'email',
    displayName: 'Account Email',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The email address you use to sign in to your uProc account.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'uProc → Integration → API Key. Use the Real key for production (the Test key returns fake data).',
  },
])
