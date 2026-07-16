const logger = {
  info: (...args) => console.log('[SecurityScorecard] info:', ...args),
  debug: (...args) => console.log('[SecurityScorecard] debug:', ...args),
  error: (...args) => console.log('[SecurityScorecard] error:', ...args),
  warn: (...args) => console.log('[SecurityScorecard] warn:', ...args),
}

const API_BASE_URL = 'https://api.securityscorecard.io'

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
 * @integrationName SecurityScorecard
 * @integrationIcon /icon.png
 */
class SecurityScorecardService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Token ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.error?.message || error.body?.message || error.message

      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`SecurityScorecard API error: ${ message }`)
    }
  }

  /**
   * @operationName Get Company Score
   * @category Companies
   * @description Retrieves the overall Scorecard summary for a company identified by its primary domain. Returns the letter grade (A-F), the numeric score (0-100), company metadata (name, industry, size), and a breakdown of the ten risk factor grades. Use this as the entry point for assessing a company's security posture.
   * @route GET /company-score
   *
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The company's primary domain (scorecard identifier), e.g. google.com."}
   *
   * @returns {Object}
   * @sampleResult {"domain":"example.com","name":"Example Inc.","grade":"B","grade_url":"https://...","score":85,"industry":"technology","size":"size_more_than_10000","factors":[{"name":"network_security","grade":"A","score":95}]}
   */
  async getCompanyScore(domain) {
    return await this.#apiRequest({
      logTag: '[getCompanyScore]',
      url: `${ API_BASE_URL }/companies/${ encodeURIComponent(domain) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Company Factor Scores
   * @category Companies
   * @description Returns the per-factor scores for a company across the ten risk factors (e.g. network_security, dns_health, patching_cadence, application_security). Each factor includes its letter grade, numeric score, and a summary of contributing issue types. Optionally provide a date to retrieve factor scores as they were on that day.
   * @route GET /company-factors
   *
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The company's primary domain, e.g. google.com."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Optional. Return factor scores as of this date (YYYY-MM-DD). Defaults to the latest available."}
   *
   * @returns {Object}
   * @sampleResult {"entries":[{"name":"network_security","grade":"A","score":95,"issue_summary_results":[{"type":"exposed_ports","count":0,"severity":"low"}]}]}
   */
  async getCompanyFactorScores(domain, date) {
    return await this.#apiRequest({
      logTag: '[getCompanyFactorScores]',
      url: `${ API_BASE_URL }/companies/${ encodeURIComponent(domain) }/factors`,
      method: 'get',
      query: { date },
    })
  }

  /**
   * @operationName Get Company Historical Scores
   * @category Companies
   * @description Returns the historical overall security score for a company over a date range. Each entry contains a date and the numeric score (0-100) on that date, enabling trend analysis of a company's security posture over time.
   * @route GET /company-history-score
   *
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The company's primary domain, e.g. google.com."}
   * @paramDef {"type":"String","label":"From Date","name":"from","uiComponent":{"type":"DATE_PICKER"},"description":"Optional start date (YYYY-MM-DD) of the history window."}
   * @paramDef {"type":"String","label":"To Date","name":"to","uiComponent":{"type":"DATE_PICKER"},"description":"Optional end date (YYYY-MM-DD) of the history window."}
   *
   * @returns {Object}
   * @sampleResult {"entries":[{"date":"2026-06-01","score":85},{"date":"2026-07-01","score":88}]}
   */
  async getCompanyHistoricalScores(domain, from, to) {
    return await this.#apiRequest({
      logTag: '[getCompanyHistoricalScores]',
      url: `${ API_BASE_URL }/companies/${ encodeURIComponent(domain) }/history/score`,
      method: 'get',
      query: { from, to },
    })
  }

  /**
   * @operationName Get Company Historical Factor Scores
   * @category Companies
   * @description Returns the historical per-factor scores for a company over a date range. Each entry lists the factors with their numeric scores on a given date, enabling trend analysis for individual risk factors (e.g. tracking how patching_cadence changed over time).
   * @route GET /company-history-factors
   *
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The company's primary domain, e.g. google.com."}
   * @paramDef {"type":"String","label":"From Date","name":"from","uiComponent":{"type":"DATE_PICKER"},"description":"Optional start date (YYYY-MM-DD) of the history window."}
   * @paramDef {"type":"String","label":"To Date","name":"to","uiComponent":{"type":"DATE_PICKER"},"description":"Optional end date (YYYY-MM-DD) of the history window."}
   *
   * @returns {Object}
   * @sampleResult {"entries":[{"date":"2026-06-01","factors":[{"name":"network_security","score":95}]}]}
   */
  async getCompanyHistoricalFactorScores(domain, from, to) {
    return await this.#apiRequest({
      logTag: '[getCompanyHistoricalFactorScores]',
      url: `${ API_BASE_URL }/companies/${ encodeURIComponent(domain) }/history/factors/score`,
      method: 'get',
      query: { from, to },
    })
  }

  /**
   * @operationName Get Company Issues by Type
   * @category Companies
   * @description Returns the detailed findings for a company for a specific issue type (e.g. patching_cadence_high, tlscert_expired, malware_events). Each finding includes the affected asset, severity, first/last seen timestamps, and issue-specific details. Use Get Company Factor Scores first to discover which issue types apply.
   * @route GET /company-issues
   *
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The company's primary domain, e.g. google.com."}
   * @paramDef {"type":"String","label":"Issue Type","name":"issueType","required":true,"description":"The issue type key to retrieve, e.g. patching_cadence_high, tlscert_expired, malware_events. See a factor's issue_summary_results for valid types."}
   *
   * @returns {Object}
   * @sampleResult {"entries":[{"issue_id":"abc123","issue_type":"tlscert_expired","severity":"high","first_seen_time":"2026-05-01","last_seen_time":"2026-07-01","connection_attributes":{}}]}
   */
  async getCompanyIssuesByType(domain, issueType) {
    return await this.#apiRequest({
      logTag: '[getCompanyIssuesByType]',
      url: `${ API_BASE_URL }/companies/${ encodeURIComponent(domain) }/issues/${ encodeURIComponent(issueType) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Company Information
   * @category Companies
   * @description Returns descriptive information about a company such as its legal name, industry, size band, primary domain, description, and location. Useful for enriching a scorecard result with company profile metadata.
   * @route GET /company-information
   *
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The company's primary domain, e.g. google.com."}
   *
   * @returns {Object}
   * @sampleResult {"domain":"example.com","name":"Example Inc.","industry":"technology","size":"size_more_than_10000","description":"An example company.","location":"New York, US"}
   */
  async getCompanyInformation(domain) {
    return await this.#apiRequest({
      logTag: '[getCompanyInformation]',
      url: `${ API_BASE_URL }/companies/${ encodeURIComponent(domain) }/information`,
      method: 'get',
    })
  }

  /**
   * @operationName List Portfolios
   * @category Portfolios
   * @description Returns all portfolios the authenticated user has access to. Each portfolio includes its ID, name, description, privacy setting, and the number of companies it contains. Portfolios group companies for monitoring and reporting.
   * @route GET /portfolios
   *
   * @returns {Object}
   * @sampleResult {"entries":[{"id":"60c0f...","name":"Key Vendors","description":"Critical third parties","privacy":"shared","read_only":false}]}
   */
  async listPortfolios() {
    return await this.#apiRequest({
      logTag: '[listPortfolios]',
      url: `${ API_BASE_URL }/portfolios`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Portfolio
   * @category Portfolios
   * @description Creates a new portfolio to group companies for monitoring. Requires a name and privacy setting (Private, Shared, or Team). Returns the created portfolio including its generated ID, which can be used to add companies and pull portfolio scores.
   * @route POST /portfolios
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The portfolio name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of the portfolio's purpose."}
   * @paramDef {"type":"String","label":"Privacy","name":"privacy","required":true,"defaultValue":"private","uiComponent":{"type":"DROPDOWN","options":{"values":["private","shared","team"]}},"description":"Who can access the portfolio: private (only you), shared (your organization), or team."}
   *
   * @returns {Object}
   * @sampleResult {"id":"60c0f...","name":"Key Vendors","description":"Critical third parties","privacy":"private","read_only":false}
   */
  async createPortfolio(name, description, privacy) {
    return await this.#apiRequest({
      logTag: '[createPortfolio]',
      url: `${ API_BASE_URL }/portfolios`,
      method: 'post',
      body: clean({
        name,
        description,
        privacy: privacy || 'private',
      }),
    })
  }

  /**
   * @operationName Get Portfolio Companies
   * @category Portfolios
   * @description Returns the companies in a portfolio along with each company's current grade and score. Use List Portfolios (or the Portfolios dictionary) to obtain a portfolio ID.
   * @route GET /portfolio-companies
   *
   * @paramDef {"type":"String","label":"Portfolio","name":"portfolioId","required":true,"dictionary":"getPortfoliosDictionary","description":"The portfolio ID. Search and select a portfolio, or enter an ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"entries":[{"domain":"example.com","name":"Example Inc.","grade":"B","score":85,"industry":"technology"}]}
   */
  async getPortfolioCompanies(portfolioId) {
    return await this.#apiRequest({
      logTag: '[getPortfolioCompanies]',
      url: `${ API_BASE_URL }/portfolios/${ encodeURIComponent(portfolioId) }/companies`,
      method: 'get',
    })
  }

  /**
   * @operationName Add Company to Portfolio
   * @category Portfolios
   * @description Adds a company (by domain) to a portfolio so it is included in that portfolio's monitoring and scoring. Returns confirmation of the added company.
   * @route PUT /portfolio-add-company
   *
   * @paramDef {"type":"String","label":"Portfolio","name":"portfolioId","required":true,"dictionary":"getPortfoliosDictionary","description":"The portfolio ID to add the company to. Search and select a portfolio, or enter an ID directly."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The company's primary domain to add, e.g. google.com."}
   *
   * @returns {Object}
   * @sampleResult {"added":["example.com"]}
   */
  async addCompanyToPortfolio(portfolioId, domain) {
    return await this.#apiRequest({
      logTag: '[addCompanyToPortfolio]',
      url: `${ API_BASE_URL }/portfolios/${ encodeURIComponent(portfolioId) }/companies/${ encodeURIComponent(domain) }`,
      method: 'put',
    })
  }

  /**
   * @operationName Remove Company from Portfolio
   * @category Portfolios
   * @description Removes a company (by domain) from a portfolio. The company is no longer included in that portfolio's monitoring and scoring.
   * @route DELETE /portfolio-remove-company
   *
   * @paramDef {"type":"String","label":"Portfolio","name":"portfolioId","required":true,"dictionary":"getPortfoliosDictionary","description":"The portfolio ID to remove the company from. Search and select a portfolio, or enter an ID directly."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The company's primary domain to remove, e.g. google.com."}
   *
   * @returns {Object}
   * @sampleResult {"removed":["example.com"]}
   */
  async removeCompanyFromPortfolio(portfolioId, domain) {
    return await this.#apiRequest({
      logTag: '[removeCompanyFromPortfolio]',
      url: `${ API_BASE_URL }/portfolios/${ encodeURIComponent(portfolioId) }/companies/${ encodeURIComponent(domain) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Get Industry Score
   * @category Industries
   * @description Returns the aggregate security score and grade for an entire industry (e.g. technology, healthcare, financial_services). Useful for benchmarking a company's score against its industry peers.
   * @route GET /industry-score
   *
   * @paramDef {"type":"String","label":"Industry","name":"industry","required":true,"defaultValue":"technology","uiComponent":{"type":"DROPDOWN","options":{"values":["education","financial_services","food","government","healthcare","information_services","manufacturing","retail","technology"]}},"description":"The industry to score."}
   *
   * @returns {Object}
   * @sampleResult {"industry":"technology","grade":"B","score":84}
   */
  async getIndustryScore(industry) {
    return await this.#apiRequest({
      logTag: '[getIndustryScore]',
      url: `${ API_BASE_URL }/industries/${ encodeURIComponent(industry) }/score`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Industry Factor Scores
   * @category Industries
   * @description Returns the aggregate per-factor scores for an entire industry across the ten risk factors. Useful for benchmarking a company's individual factor scores against its industry peers.
   * @route GET /industry-factors
   *
   * @paramDef {"type":"String","label":"Industry","name":"industry","required":true,"defaultValue":"technology","uiComponent":{"type":"DROPDOWN","options":{"values":["education","financial_services","food","government","healthcare","information_services","manufacturing","retail","technology"]}},"description":"The industry to score."}
   *
   * @returns {Object}
   * @sampleResult {"industry":"technology","factors":[{"name":"network_security","grade":"B","score":84}]}
   */
  async getIndustryFactorScores(industry) {
    return await this.#apiRequest({
      logTag: '[getIndustryFactorScores]',
      url: `${ API_BASE_URL }/industries/${ encodeURIComponent(industry) }/factor/scores`,
      method: 'get',
    })
  }

  /**
   * @operationName Generate Report
   * @category Reports
   * @description Queues generation of a report of the given type (e.g. detailed, summary, issues, portfolio, events-json). Reports are generated asynchronously; the response includes a report ID/status that can be used to download the report once ready. Provide the report parameters (such as domain or portfolio_id) required by the chosen report type.
   * @route POST /generate-report
   *
   * @paramDef {"type":"String","label":"Report Type","name":"reportType","required":true,"description":"The report type key, e.g. detailed, summary, issues, portfolio, events-json. See the SecurityScorecard reports documentation for the full list."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"Company domain for company-scoped reports (e.g. detailed, summary). Leave empty for portfolio reports."}
   * @paramDef {"type":"String","label":"Portfolio","name":"portfolioId","dictionary":"getPortfoliosDictionary","description":"Portfolio ID for portfolio-scoped reports. Leave empty for company reports."}
   *
   * @returns {Object}
   * @sampleResult {"id":"report_abc123","status":"pending","report_type":"detailed"}
   */
  async generateReport(reportType, domain, portfolioId) {
    return await this.#apiRequest({
      logTag: '[generateReport]',
      url: `${ API_BASE_URL }/reports/${ encodeURIComponent(reportType) }`,
      method: 'post',
      body: clean({
        domain,
        portfolio_id: portfolioId,
      }),
    })
  }

  /**
   * @operationName Get Score Plan
   * @category Reports
   * @description Returns a prioritized plan of recommended actions for a company to reach a target overall score. Each recommendation describes the issue to fix and its expected score impact. Provide the company domain and the target score to aim for.
   * @route GET /score-plan
   *
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The company's primary domain, e.g. google.com."}
   * @paramDef {"type":"Number","label":"Target Score","name":"targetScore","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The overall score (0-100) to plan toward."}
   *
   * @returns {Object}
   * @sampleResult {"entries":[{"factor":"patching_cadence","recommendation":"Remediate high-severity CVEs","score_impact":3}]}
   */
  async getScorePlan(domain, targetScore) {
    return await this.#apiRequest({
      logTag: '[getScorePlan]',
      url: `${ API_BASE_URL }/companies/${ encodeURIComponent(domain) }/score-plans/by-target/${ encodeURIComponent(targetScore) }`,
      method: 'get',
    })
  }

  /**
   * @typedef {Object} getPortfoliosDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter portfolios by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The portfolios endpoint returns all results in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Portfolios Dictionary
   * @description Provides a searchable list of the portfolios you have access to for selecting a portfolio in dependent parameters. The option value is the portfolio ID.
   * @route POST /get-portfolios-dictionary
   * @paramDef {"type":"getPortfoliosDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter portfolios by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Key Vendors","value":"60c0f...","note":"shared"}],"cursor":null}
   */
  async getPortfoliosDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getPortfoliosDictionary]',
      url: `${ API_BASE_URL }/portfolios`,
      method: 'get',
    })

    const entries = response.entries || []
    const term = (search || '').toLowerCase()

    const filtered = term
      ? entries.filter(p => (p.name || '').toLowerCase().includes(term))
      : entries

    return {
      items: filtered.map(p => ({
        label: p.name || p.id,
        value: p.id,
        note: p.privacy || undefined,
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(SecurityScorecardService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your SecurityScorecard API token. Generate it in the SecurityScorecard app under My Settings → API. Sent as the "Authorization: Token {token}" header.',
  },
])
