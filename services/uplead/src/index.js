const logger = {
  info: (...args) => console.log('[UpLead] info:', ...args),
  debug: (...args) => console.log('[UpLead] debug:', ...args),
  error: (...args) => console.log('[UpLead] error:', ...args),
  warn: (...args) => console.log('[UpLead] warn:', ...args),
}

const API_BASE_URL = 'https://api.uplead.com/v2'

const MANAGEMENT_LEVELS = {
  'Manager': 'M',
  'Director': 'D',
  'Vice President': 'VP',
  'C-Level (C)': 'C',
  'C-Level (CX)': 'CX',
}

const JOB_FUNCTIONS = [
  'advisory', 'analyst', 'creative', 'education', 'engineering', 'finance',
  'fulfillment', 'health', 'hospitality', 'human resources', 'legal',
  'manufacturing', 'marketing', 'operations', 'partnerships', 'product',
  'professional service', 'public service', 'research', 'sales',
  'sales engineering', 'support', 'trade', 'unemployed',
]

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
 * @integrationName UpLead
 * @integrationIcon /icon.png
 */
class UpLeadService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(clean(body)) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.error?.message || error.body?.error || error.body?.message || error.message

      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`UpLead API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Enrich Person
   * @category Enrichment
   * @description Enriches a single person and returns their professional profile: full name, job title, job function, management level, verified work email (with email status), phone and mobile direct-dial numbers, location, LinkedIn URL, and current company. Look someone up by their work email, or by first name, last name, and company domain. One UpLead credit is consumed per successful match with a valid or accept-all email.
   * @route POST /enrich-person
   * @appearanceColor #0DA0BE #29B6D4
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Work email of the person to enrich. Provide either this or first name + last name + company domain."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Person's first name. Used together with last name and company domain when email is not provided."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Person's last name. Used together with first name and company domain when email is not provided."}
   * @paramDef {"type":"String","label":"Company Domain","name":"domain","description":"Company domain (e.g. amazon.com) the person works at. Used with first and last name when email is not provided."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"12345","first_name":"Jane","last_name":"Doe","title":"VP of Marketing","job_function":"marketing","job_sub_function":"brand marketing","management_level":"VP","gender":"female","email":"jane.doe@amazon.com","email_status":"valid","phone_number":"+1 206-266-1000","mobile_directdial":"+1 206-555-0100","city":"Seattle","state":"WA","county":"King","country":"United States","linkedin_url":"https://www.linkedin.com/in/janedoe","industry":"Retail","domain":"amazon.com","company_name":"Amazon"},"userInfo":{"availableCredits":950}}
   */
  async enrichPerson(email, firstName, lastName, domain) {
    const logTag = '[enrichPerson]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/person-search`,
      method: 'post',
      body: {
        email,
        first_name: firstName,
        last_name: lastName,
        domain,
      },
    })
  }

  /**
   * @operationName Enrich Company
   * @category Enrichment
   * @description Enriches a company and returns firmographic details: legal name, domain, full address, phone and fax, employee count, revenue, industry, SIC/NAICS codes and descriptions, description, year founded, logo URL, and social profiles (LinkedIn, Twitter, Facebook, YouTube, Crunchbase, Instagram). Look up a company by its domain or by company name. One UpLead credit is consumed per successful match.
   * @route POST /enrich-company
   * @appearanceColor #0DA0BE #29B6D4
   *
   * @paramDef {"type":"String","label":"Company Domain","name":"domain","description":"Company domain to enrich (e.g. amazon.com). Provide either this or the company name."}
   * @paramDef {"type":"String","label":"Company Name","name":"company","description":"Company name to enrich. Used when a domain is not available."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"6789","company_name":"Amazon","domain":"amazon.com","address":"410 Terry Ave N","city":"Seattle","state":"WA","zip":"98109","country":"United States","county":"King","phone_number":"+1 206-266-1000","fax_number":"+1 206-266-1001","employees":"10001+","revenue":"$1B+","industry":"Retail","sic_code":5961,"sic_description":"Retail Stores","naics_code":454110,"naics_description":"Electronic Shopping","description":"Online retailer","year_founded":1994,"logo":"https://logo.uplead.com/amazon.com","linkedin_url":"https://www.linkedin.com/company/amazon","twitter_url":"https://twitter.com/amazon","facebook_url":"https://facebook.com/amazon","type":"Public","ticker":"AMZN","exchange":"NASDAQ","alexa_rank":5},"userInfo":{"availableCredits":949}}
   */
  async enrichCompany(domain, company) {
    const logTag = '[enrichCompany]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/company-search`,
      method: 'post',
      body: {
        domain,
        company,
      },
    })
  }

  /**
   * @operationName Search Contacts
   * @category Prospecting
   * @description Searches UpLead's B2B database for contacts at a company and returns a paginated list of people (under data.results) with their titles, verified emails and email statuses, phone numbers, LinkedIn URLs, and locations. Filter by company domain plus optional job function, management level, job title, and location (city, state, country). The data.meta object carries pagination details (total, page, next_page, previous_page, first_page, last_page). Credits are consumed only when contact records are revealed.
   * @route POST /search-contacts
   * @appearanceColor #0DA0BE #29B6D4
   *
   * @paramDef {"type":"String","label":"Company Domain","name":"domain","required":true,"description":"Company domain to search contacts at (e.g. amazon.com)."}
   * @paramDef {"type":"String","label":"Job Title","name":"title","description":"Filter by job title keyword (e.g. Marketing Manager)."}
   * @paramDef {"type":"String","label":"Job Function","name":"jobFunction","uiComponent":{"type":"DROPDOWN","options":{"values":["advisory","analyst","creative","education","engineering","finance","fulfillment","health","hospitality","human resources","legal","manufacturing","marketing","operations","partnerships","product","professional service","public service","research","sales","sales engineering","support","trade","unemployed"]}},"description":"Filter by department / job function."}
   * @paramDef {"type":"String","label":"Management Level","name":"managementLevel","uiComponent":{"type":"DROPDOWN","options":{"values":["Manager","Director","Vice President","C-Level (C)","C-Level (CX)"]}},"description":"Filter by seniority / management level. Maps to UpLead codes M, D, VP, C, and CX."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"Filter by city."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"Filter by state or region."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Filter by country."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of results to return (default 1)."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of contacts per page (default 10)."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"results":[{"id":"12345","first_name":"Jane","last_name":"Doe","title":"VP of Marketing","email":"jane.doe@amazon.com","email_status":"valid","city":"Seattle","state":"WA","country":"United States","domain":"amazon.com","company_name":"Amazon"}],"meta":{"total":42,"page":1,"next_page":2,"previous_page":null,"first_page":true,"last_page":false}},"userInfo":{"availableCredits":940}}
   */
  async searchContacts(domain, title, jobFunction, managementLevel, city, state, country, page, perPage) {
    const logTag = '[searchContacts]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/prospector-search`,
      method: 'post',
      body: {
        domain,
        title,
        job_function: this.#resolveChoice(jobFunction, JOB_FUNCTIONS.reduce((acc, fn) => (acc[fn] = fn, acc), {})),
        management_level: this.#resolveChoice(managementLevel, MANAGEMENT_LEVELS),
        city,
        state,
        country,
        page,
        per_page: perPage,
      },
    })
  }

  /**
   * @operationName Enrich Person and Company
   * @category Enrichment
   * @description Enriches a person and their company in a single call from a work email. Returns the combined profile under data: the person's name, title, verified email and email status, mobile direct-dial, and LinkedIn, with the company's firmographics nested under data.company (industry, employee count, revenue, location, social links). Use this when you only have an email and want both records at once.
   * @route POST /enrich-person-and-company
   * @appearanceColor #0DA0BE #29B6D4
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Work email to enrich both the person and their company from (e.g. jane.doe@amazon.com)."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"12345","first_name":"Jane","last_name":"Doe","title":"VP of Marketing","job_function":"marketing","management_level":"VP","email":"jane.doe@amazon.com","email_status":"valid","mobile_directdial":"+1 206-555-0100","city":"Seattle","state":"WA","country":"United States","linkedin_url":"https://www.linkedin.com/in/janedoe","company":{"id":"6789","company_name":"Amazon","domain":"amazon.com","industry":"Retail","employees":"10001+","revenue":"$1B+","city":"Seattle","country":"United States","linkedin_url":"https://www.linkedin.com/company/amazon"}},"userInfo":{"availableCredits":938}}
   */
  async enrichPersonAndCompany(email) {
    const logTag = '[enrichPersonAndCompany]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/combined-search`,
      method: 'post',
      body: {
        email,
      },
    })
  }

  /**
   * @operationName Get Remaining Credits
   * @category Account
   * @description Returns the number of API credits remaining on the connected UpLead account (under data.credits), along with the account email (data.email). Use this to check account status and confirm the API key is valid before running enrichment or search operations.
   * @route GET /get-credits
   * @appearanceColor #0DA0BE #29B6D4
   *
   * @returns {Object}
   * @sampleResult {"data":{"email":"account@example.com","credits":950}}
   */
  async getCredits() {
    const logTag = '[getCredits]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/credits`,
      method: 'get',
    })
  }
}

Flowrunner.ServerCode.addService(UpLeadService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your UpLead API key, sent as the Authorization header. Get it in UpLead under Integrations / API.',
  },
])
