const logger = {
  info: (...args) => console.log('[Clearbit] info:', ...args),
  debug: (...args) => console.log('[Clearbit] debug:', ...args),
  error: (...args) => console.log('[Clearbit] error:', ...args),
  warn: (...args) => console.log('[Clearbit] warn:', ...args),
}

// Clearbit exposes each capability on its own subdomain.
const PERSON_API = 'https://person.clearbit.com/v2'
const COMPANY_API = 'https://company.clearbit.com/v2'
const PROSPECTOR_API = 'https://prospector.clearbit.com/v1'
const DISCOVERY_API = 'https://discovery.clearbit.com/v1'
const REVEAL_API = 'https://reveal.clearbit.com/v1'

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
 * @integrationName Clearbit
 * @integrationIcon /icon.svg
 */
class ClearbitService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Clearbit authenticates with HTTP Basic auth: the secret API key is the
  // username and the password is empty, i.e. base64("<apiKey>:").
  #authHeader() {
    const token = Buffer.from(`${ this.apiKey }:`).toString('base64')

    return `Basic ${ token }`
  }

  // Single private request helper — every external call goes through here.
  async #apiRequest({ url, method = 'get', query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': this.#authHeader(),
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      return await request
    } catch (error) {
      // Clearbit returns 202 Accepted while a lookup is still being resolved.
      // This surfaces as an error in the request layer, so translate it into a
      // structured "pending" payload the caller can act on by retrying.
      const status = error.status || error.statusCode

      if (status === 202) {
        logger.info(`${ logTag } - lookup pending (202); caller should retry shortly`)

        return {
          pending: true,
          status: 202,
          message: 'Clearbit is still resolving this lookup. Retry the request in a few seconds.',
        }
      }

      const errorBody = error.body?.error
      const message = errorBody?.message || error.body?.message || error.message
      const type = errorBody?.type

      logger.error(`${ logTag } - failed (${ status || 'n/a' }): ${ message }`)

      const detail = [message, type ? `type=${ type }` : null, status ? `status=${ status }` : null]
        .filter(Boolean)
        .join(' | ')

      throw new Error(`Clearbit API error: ${ detail }`)
    }
  }

  /**
   * @operationName Enrich Person
   * @category Enrichment
   * @description Enriches a person from their email address using the Clearbit Person Enrichment API. Returns the person's full name, employment (company, title, seniority, role), social handles (LinkedIn, Twitter, GitHub, Facebook), geographic location, bio, and avatar. If Clearbit is still resolving the lookup it returns a pending payload (HTTP 202) — retry after a few seconds. NOTE: Clearbit is now part of HubSpot (Breeze Intelligence); this endpoint works with a legacy Clearbit secret API key.
   * @route GET /enrich-person
   * @appearanceColor #2C63F6 #5C8CFF
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The person's email address to enrich, e.g. alex@example.com."}
   * @paramDef {"type":"Boolean","label":"Webhook Only","name":"webhookOnly","uiComponent":{"type":"TOGGLE"},"description":"When true, Clearbit will not respond with data inline and instead only delivers results to a configured webhook. Leave false for a direct response."}
   *
   * @returns {Object}
   * @sampleResult {"id":"d54c54ad-40be-4305-8a34-0ab44710b90d","name":{"fullName":"Alex Maccaw","givenName":"Alex","familyName":"Maccaw"},"email":"alex@clearbit.com","location":"San Francisco, CA, US","employment":{"name":"Clearbit","title":"CEO","role":"leadership","seniority":"executive","domain":"clearbit.com"},"linkedin":{"handle":"pub/alex-maccaw/78/929/ab5"},"twitter":{"handle":"maccaw","followers":15248},"github":{"handle":"maccaw","followers":2932},"avatar":"https://logo.clearbit.com/clearbit.com"}
   */
  async enrichPerson(email, webhookOnly) {
    const logTag = '[enrichPerson]'

    return await this.#apiRequest({
      logTag,
      url: `${ PERSON_API }/people/find`,
      method: 'get',
      query: {
        email,
        webhook_only: webhookOnly ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Enrich Company
   * @category Enrichment
   * @description Enriches a company from its domain using the Clearbit Company Enrichment API. Returns the legal and common name, description, category (industry, sector, SIC/NAICS), metrics (employees, estimated revenue, Alexa rank, market cap), technology stack, social profiles, logo, and location. If Clearbit is still resolving the lookup it returns a pending payload (HTTP 202) — retry after a few seconds. NOTE: Clearbit is now part of HubSpot (Breeze Intelligence); this endpoint works with a legacy Clearbit secret API key.
   * @route GET /enrich-company
   * @appearanceColor #2C63F6 #5C8CFF
   *
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The company's website domain to enrich, e.g. clearbit.com (do not include https:// or www)."}
   * @paramDef {"type":"Boolean","label":"Webhook Only","name":"webhookOnly","uiComponent":{"type":"TOGGLE"},"description":"When true, Clearbit will not respond with data inline and instead only delivers results to a configured webhook. Leave false for a direct response."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c8b7e9f0-1234-4abc-9def-0123456789ab","name":"Clearbit","legalName":"APIHub, Inc.","domain":"clearbit.com","category":{"sector":"Information Technology","industry":"Internet Software & Services","subIndustry":"Application Software","sicCode":"7372","naicsCode":"5112"},"metrics":{"employees":121,"employeesRange":"51-250","estimatedAnnualRevenue":"$10M-$50M","alexaGlobalRank":33889,"marketCap":null},"tech":["google_apps","marketo","salesforce"],"logo":"https://logo.clearbit.com/clearbit.com","twitter":{"handle":"clearbit","followers":10306},"geo":{"city":"San Francisco","state":"California","country":"United States"}}
   */
  async enrichCompany(domain, webhookOnly) {
    const logTag = '[enrichCompany]'

    return await this.#apiRequest({
      logTag,
      url: `${ COMPANY_API }/companies/find`,
      method: 'get',
      query: {
        domain,
        webhook_only: webhookOnly ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Enrich Combined
   * @category Enrichment
   * @description Enriches a person and their employer in a single call using the Clearbit Combined Enrichment API. Returns a person object (name, employment, social, location, avatar) alongside a company object (name, category, metrics, technology, social, logo) for the domain of the person's email. If Clearbit is still resolving the lookup it returns a pending payload (HTTP 202) — retry after a few seconds. NOTE: Clearbit is now part of HubSpot (Breeze Intelligence); this endpoint works with a legacy Clearbit secret API key.
   * @route GET /enrich-combined
   * @appearanceColor #2C63F6 #5C8CFF
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The person's email address to enrich together with their company, e.g. alex@example.com."}
   * @paramDef {"type":"Boolean","label":"Webhook Only","name":"webhookOnly","uiComponent":{"type":"TOGGLE"},"description":"When true, Clearbit will not respond with data inline and instead only delivers results to a configured webhook. Leave false for a direct response."}
   *
   * @returns {Object}
   * @sampleResult {"person":{"id":"d54c54ad-40be-4305-8a34-0ab44710b90d","name":{"fullName":"Alex Maccaw"},"email":"alex@clearbit.com","employment":{"name":"Clearbit","title":"CEO","seniority":"executive"}},"company":{"id":"c8b7e9f0-1234-4abc-9def-0123456789ab","name":"Clearbit","domain":"clearbit.com","category":{"industry":"Internet Software & Services"},"metrics":{"employees":121,"estimatedAnnualRevenue":"$10M-$50M"}}}
   */
  async enrichCombined(email, webhookOnly) {
    const logTag = '[enrichCombined]'

    return await this.#apiRequest({
      logTag,
      url: `${ PERSON_API }/combined/find`,
      method: 'get',
      query: {
        email,
        webhook_only: webhookOnly ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Find Contacts (Prospector)
   * @category Prospecting
   * @description Finds business contacts at a company domain using the Clearbit Prospector API, optionally filtered by role, seniority, and job title. Returns matching people with name, title, role, seniority, verified email, and company details. LEGACY: the Prospector API was deprecated ahead of the HubSpot (Breeze Intelligence) migration and may be unavailable on newer accounts; use with an established legacy Clearbit account.
   * @route GET /find-contacts
   * @appearanceColor #2C63F6 #5C8CFF
   *
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The company website domain to search for contacts, e.g. clearbit.com."}
   * @paramDef {"type":"Array<String>","label":"Roles","name":"roles","description":"Optional department roles to filter by, e.g. sales, engineering, marketing, finance, executive."}
   * @paramDef {"type":"String","label":"Seniority","name":"seniority","uiComponent":{"type":"DROPDOWN","options":{"values":["Executive","Director","Manager"]}},"description":"Optional seniority level to filter contacts by."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional job title keyword to filter by, e.g. \"Head of Sales\"."}
   * @paramDef {"type":"Array<String>","label":"Names","name":"names","description":"Optional person name(s) to filter results by."}
   * @paramDef {"type":"String","label":"Page","name":"page","description":"Page number for paginating results (starts at 1)."}
   *
   * @returns {Object}
   * @sampleResult {"page":1,"pageSize":20,"total":1,"results":[{"id":"f9a1c2d3-1111-2222-3333-444455556666","name":{"fullName":"Jamie Rivera","givenName":"Jamie","familyName":"Rivera"},"title":"Head of Sales","role":"sales","seniority":"director","email":"jamie@clearbit.com","company":{"name":"Clearbit","domain":"clearbit.com"},"verified":true}]}
   */
  async findContacts(domain, roles, seniority, title, names, page) {
    const logTag = '[findContacts]'

    return await this.#apiRequest({
      logTag,
      url: `${ PROSPECTOR_API }/people/search`,
      method: 'get',
      query: {
        domain,
        role: Array.isArray(roles) && roles.length ? roles.join(',') : undefined,
        seniority: this.#resolveChoice(seniority, {
          Executive: 'executive',
          Director: 'director',
          Manager: 'manager',
        }),
        title,
        name: Array.isArray(names) && names.length ? names.join(',') : undefined,
        page,
      },
    })
  }

  /**
   * @operationName Search Companies (Discovery)
   * @category Discovery
   * @description Searches for companies matching a query using the Clearbit Discovery API. Accepts a free-text or Clearbit Discovery query string (e.g. "tag:SaaS employees:>100 tech:salesforce") and returns matching company records with name, domain, category, and metrics. LEGACY: the Discovery API was deprecated ahead of the HubSpot (Breeze Intelligence) migration and may be unavailable on newer accounts; use with an established legacy Clearbit account.
   * @route GET /search-companies
   * @appearanceColor #2C63F6 #5C8CFF
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Clearbit Discovery query string, e.g. \"tag:SaaS employees:>100\" or a plain domain/name fragment."}
   * @paramDef {"type":"String","label":"Page","name":"page","description":"Pagination token or page number returned by a previous Discovery response."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of companies to return per page (default 20, max 100)."}
   *
   * @returns {Object}
   * @sampleResult {"total":1,"page":"eyJvIjoxfQ","results":[{"id":"c8b7e9f0-1234-4abc-9def-0123456789ab","name":"Clearbit","domain":"clearbit.com","category":{"industry":"Internet Software & Services"},"metrics":{"employees":121,"estimatedAnnualRevenue":"$10M-$50M"}}]}
   */
  async searchCompanies(query, page, limit) {
    const logTag = '[searchCompanies]'

    return await this.#apiRequest({
      logTag,
      url: `${ DISCOVERY_API }/companies/search`,
      method: 'get',
      query: {
        query,
        page,
        limit,
      },
    })
  }

  /**
   * @operationName Reveal Company (IP Lookup)
   * @category Discovery
   * @description Identifies the company associated with an IP address using the Clearbit Reveal API — useful for de-anonymizing website visitors. Returns the matched company (name, domain, category, metrics), the match confidence, geo/IP details, and type (company, education, government, isp). LEGACY: the Reveal API was deprecated ahead of the HubSpot (Breeze Intelligence) migration and may be unavailable on newer accounts; use with an established legacy Clearbit account.
   * @route GET /reveal-company
   * @appearanceColor #2C63F6 #5C8CFF
   *
   * @paramDef {"type":"String","label":"IP Address","name":"ip","required":true,"description":"The IPv4 or IPv6 address to resolve to a company, e.g. 104.193.168.24."}
   *
   * @returns {Object}
   * @sampleResult {"ip":"104.193.168.24","fuzzy":false,"domain":"clearbit.com","type":"company","company":{"id":"c8b7e9f0-1234-4abc-9def-0123456789ab","name":"Clearbit","domain":"clearbit.com","category":{"industry":"Internet Software & Services"},"metrics":{"employees":121}},"geoIP":{"city":"San Francisco","state":"California","country":"United States","countryCode":"US"},"confidenceScore":"high"}
   */
  async revealCompany(ip) {
    const logTag = '[revealCompany]'

    return await this.#apiRequest({
      logTag,
      url: `${ REVEAL_API }/companies/find`,
      method: 'get',
      query: {
        ip,
      },
    })
  }

  // Maps a friendly dropdown label to the API value; passes unknown values through.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }
}

Flowrunner.ServerCode.addService(ClearbitService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Clearbit secret API key (Clearbit dashboard → API keys). Sent as HTTP Basic auth with the key as the username and an empty password. NOTE: Clearbit is now part of HubSpot (Breeze Intelligence); a legacy Clearbit API key may still work with these endpoints.',
  },
])
