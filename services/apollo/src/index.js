const AUTH_URL = 'https://app.apollo.io/#/oauth/authorize'
const ACCESS_TOKEN_URL = 'https://app.apollo.io/api/v1/oauth/token'
const API_BASE_URL = ' https://app.apollo.io/api/v1'

const USER_SCOPE_LIST = [
  'read_user_profile',
  'app_scopes',
  'organizations_search',
  'mixed_companies_search',
  'people_match',
  'organization_read',
  'mixed_people_search',
  'people_search',
  'person_read',
  'mixed_people_organization_top_people',
  'contacts_search',
  'accounts_search',
  'tasks_list',
  'users_list',
  'email_accounts_list',
]

const USER_SCOPE_STRING = USER_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[Apollo.IO Service] info:', ...args),
  debug: (...args) => console.log('[Apollo.IO Service] debug:', ...args),
  error: (...args) => console.log('[Apollo.IO Service] error:', ...args),
  warn: (...args) => console.log('[Apollo.IO Service] warn:', ...args),
}

/**
 *  @requireOAuth
 *  @integrationName Apollo.io
 *  @integrationIcon /icon.png
 **/
class Apollo {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.masterAPIKey = config.masterAPIKey
    this.userScope = USER_SCOPE_STRING
  }

  /**
   * @route GET /getOAuth2ConnectionURL
   * @registerAs SYSTEM
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.userScope)

    return `${ AUTH_URL }?${ params.toString() }`
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   */

  /**
   * @route PUT /refreshToken
   * @registerAs SYSTEM
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)

    try {
      const response = await Flowrunner.Request.post(ACCESS_TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`[refreshToken] response: ${ JSON.stringify(response) }`)

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in,
        refreshToken: response.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken: ${ JSON.stringify(error) }`)

      throw error
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
   * @route POST /executeCallback
   * @registerAs SYSTEM
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    let codeExchangeResponse = {}

    const params = new URLSearchParams()
    params.append('grant_type', 'authorization_code')
    params.append('code', callbackObject.code)
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('redirect_uri', callbackObject.redirectURI)

    try {
      codeExchangeResponse = await Flowrunner.Request.post(ACCESS_TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`[executeCallback] codeExchangeResponse response: ${ JSON.stringify(
        codeExchangeResponse,
        null,
        2
      ) }`)
    } catch (error) {
      logger.error(`[executeCallback] codeExchangeResponse error: ${ JSON.stringify(error, null, 2) }`)
    }

    let userInfo = {}

    try {
      userInfo = await Flowrunner.Request
        .get(`${ API_BASE_URL }/users/api_profile`)
        .set(this.#getAccessTokenHeader(codeExchangeResponse['access_token']))

      logger.debug(`[executeCallback] userInfo response: ${ JSON.stringify(userInfo, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ JSON.stringify(error, null, 2) }`)

      return {}
    }

    return {
      token: codeExchangeResponse['access_token'],
      expirationInSeconds: codeExchangeResponse['expires_in'],
      refreshToken: codeExchangeResponse['refresh_token'],
      connectionIdentityName: `${ userInfo.first_name } ${ userInfo.last_name } (${ userInfo.email })`,
      overwrite: true, // Overwrites the connection if connectionIdentityName already exists.
      userData: {}, // Stores any relevant information about the authenticated account.
    }
  }

  /**
   * @description Enriches a person's profile using Apollo for AI-powered lead qualification and contact data verification. Ideal for AI agents building prospect lists, validating contact information before outreach, or enriching CRM data with comprehensive professional details including employment history, contact info, and social profiles.
   *
   * @route POST /enrichPerson
   * @operationName Enrich Person
   * @category People Enrichment
   *
   * @appearanceColor #FFB400 #000000
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Apollo Person ID","name":"id","description":"Unique identifier for the person in Apollo. Use when you already have the Apollo ID for direct lookup."}
   * @paramDef {"type":"String","label":"Email Address","name":"email","description":"The person's work or personal email address for identification. Example: 'john.doe@company.com'. Use this for most reliable matching when available."}
   * @paramDef {"type":"String","label":"First Name","name":"first_name","description":"The person's first name. Example: 'John'. Use with last name and company information for matching."}
   * @paramDef {"type":"String","label":"Last Name","name":"last_name","description":"The person's last name. Example: 'Doe'. Use with first name and company information for matching."}
   * @paramDef {"type":"String","label":"Full Name","name":"name","description":"The person's complete name. Example: 'John Doe'. Alternative to using separate first and last name fields."}
   * @paramDef {"type":"String","label":"Company Domain","name":"domain","description":"The domain of the person's company for precise matching. Example: 'techcorp.com'. More reliable than company name alone."}
   * @paramDef {"type":"String","label":"Company Name","name":"organization_name","description":"The name of the person's company. Example: 'TechCorp Inc'. Used with name fields for person identification."}
   * @paramDef {"type":"String","label":"LinkedIn Profile URL","name":"linkedin_url","description":"Full LinkedIn profile URL for precise person identification. Example: 'https://www.linkedin.com/in/johndoe'. More reliable than name-based matching."}
   * @paramDef {"type":"Boolean","label":"Reveal Personal Email","name":"reveal_personal_emails","description":"Enable to access personal email addresses beyond work emails (consumes additional credits). Useful for multi-channel outreach campaigns.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"Boolean","label":"Reveal Phone Number","name":"reveal_phone_number","description":"Enable to access phone numbers including mobile and work phones (consumes additional credits). Essential for direct outreach and lead verification.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"String","label":"Phone Webhook URL","name":"webhook_url","description":"Webhook URL to receive phone number data when revealed. Example: 'https://your-app.com/webhook/phone-data'. Required if reveal_phone_number is enabled."}
   *
   * @sampleResult {"person":{"id":"587cf802f65125cad923a266","first_name":"Sarah","last_name":"Johnson","name":"Sarah Johnson","email":"sarah.johnson@techcorp.com","title":"VP of Marketing","linkedin_url":"https://www.linkedin.com/in/sarahjohnson","organization_name":"TechCorp Inc","organization_id":"5e66b6381e05b4008c8331b8","phone_numbers":[{"number":"+1-555-0123","type":"work"}],"location":"San Francisco, CA","employment_history":[{"organization_name":"TechCorp Inc","title":"VP of Marketing","start_date":"2022-01-01","current":true}]}}
   */
  async enrichPerson(
    id,
    email,
    first_name,
    last_name,
    name,
    domain,
    organization_name,
    linkedin_url,
    reveal_personal_emails,
    reveal_phone_number,
    webhook_url
  ) {
    const payload = {}

    if (id) payload.id = id
    if (email) payload.email = email
    if (first_name) payload.first_name = first_name
    if (last_name) payload.last_name = last_name
    if (name) payload.name = name
    if (domain) payload.domain = domain
    if (organization_name) payload.organization_name = organization_name
    if (linkedin_url) payload.linkedin_url = linkedin_url

    if (typeof reveal_personal_emails === 'boolean') {
      payload.reveal_personal_emails = reveal_personal_emails
    }

    if (typeof reveal_phone_number === 'boolean') {
      payload.reveal_phone_number = reveal_phone_number

      if (reveal_phone_number && webhook_url) {
        payload.webhook_url = webhook_url
      }
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/people/match`,
      method: 'post',
      body: payload,
      logTag: '[enrichPerson]',
    })

    return response
  }

  /**
   * @typedef {Object} PersonInput
   * @property {String} [email] - Email address to identify the person
   * @property {String} [linkedin_url] - LinkedIn profile URL
   * @property {String} [first_name] - First name of the person
   * @property {String} [last_name] - Last name of the person
   * @property {String} [organization_name] - Name of the associated company
   * @property {String} [organization_website_url] - Website URL of the company
   * @property {String} [title] - Job title of the person
   * @property {String} [location] - City, region, or location string
   */

  /**
   * Enriches a list of up to 100 people using Apollo.io’s Bulk People Enrichment API.
   * The action supports identifiers such as email, LinkedIn URL, or company metadata.
   *
   * @description Enriches up to 100 people using Apollo's Bulk Enrichment endpoint.
   * @operationName Enrich People
   * @category People Enrichment
   * @appearanceColor #FFB400 #000000
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array.<PersonInput>","label":"People to Enrich","name":"people","required":true,"description":"Array of up to 100 people objects to be enriched using identifiers like email or LinkedIn URL."}
   * @paramDef {"type":"Boolean","label":"Reveal Personal Emails","name":"reveal_personal_emails","required":false,"description":"Include personal email addresses in the enrichment results.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"Boolean","label":"Reveal Phone Numbers","name":"reveal_phone_number","required":false,"description":"Include phone numbers in the enrichment results.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhook_url","required":false,"description":"Optional callback URL to receive async enrichment results from Apollo."}
   *
   * @route POST /enrichPeople
   * @sampleResult {"status":{"code":200,"message":""},"data":{"people":[{"first_name":"John","last_name":"Doe","email":"john.doe@example.com"}]}}
   */
  async enrichPeople(people, reveal_personal_emails, reveal_phone_number, webhook_url) {
    if (!Array.isArray(people) || people.length === 0) {
      throw new Error('The \'people\' parameter must be a non-empty array.')
    }

    if (people.length > 100) {
      throw new Error('Apollo API supports a maximum of 100 people per request.')
    }

    const body = {
      people,
      ...(reveal_personal_emails !== undefined && { reveal_personal_emails }),
      ...(reveal_phone_number !== undefined && { reveal_phone_number }),
      ...(webhook_url && { webhook_url }),
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/mixed_people/bulk_enrich`,
      method: 'post',
      body,
      headers: { 'Content-Type': 'application/json' },
      logTag: 'enrichPeople',
    })

    return {
      status: { code: 200, message: '' },
      data: response.people || [],
    }
  }

  /**
   * @operationName Enrich Organization
   * @category Company Research
   * @description Enriches a company using its domain.
   *
   * @route POST /enrichOrganization
   *
   * @appearanceColor #FFB400 #000000
   *
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Company Domain","name":"domain","required":true,"description":"The domain of the company that you want to enrich. Do not include www., the @ symbol, or similar."}
   *
   * @returns {Object} Enriched organization data.
   * @sampleResult {"organization":{"id":"5e66b6381e05b4008c8331b8","name":"Apollo.io","website_url":"http://www.apollo.io","blog_url":null,"angellist_url":null,"linkedin_url":"http://www.linkedin.com/company/apolloio","twitter_url":"https://twitter.com/meetapollo/","facebook_url":"https://www.facebook.com/MeetApollo","primary_phone":{},"languages":[],"alexa_ranking":3514,"phone":null,"linkedin_uid":"18511550","founded_year":2015,"publicly_traded_symbol":null,"publicly_traded_exchange":null,"logo_url":"https://zenprospect-production.s3.amazonaws.com/uploads/pictures/66d13c8d98ec9600013525b8/picture","crunchbase_url":null,"primary_domain":"apollo.io","industry":"information technology & services","keywords":["sales engagement","lead generation","predictive analytics","lead scoring","sales strategy","conversation intelligence","sales enablement","lead routing","sales development","email engagement","revenue intelligence","sales operations","sales intelligence","lead intelligence","prospecting","b2b data"],"estimated_num_employees":1600,"industries":["information technology & services"],"secondary_industries":[],"snippets_loaded":true,"industry_tag_id":"5567cd4773696439b10b0000","industry_tag_hash":{"information technology & services":"5567cd4773696439b10b0000"},"retail_location_count":0,"raw_address":"415 Mission St, Floor 37, San Francisco, California 94105, US","street_address":"415 Mission St","city":"San Francisco","state":"California","postal_code":"94105-2301","country":"United States","owned_by_organization_id":null,"seo_description":"Search, engage, and convert over 275 million contacts at over 73 million companies with Apollo's sales intelligence and engagement platform.","short_description":"Apollo.io combines a buyer database of over 270M contacts and powerful sales engagement and automation tools in one, easy to use platform. Trusted by over 160,000 companies including Autodesk, Rippling, Deel, Jasper.ai, Divvy, and Heap, Apollo has more than one million users globally. By helping sales professionals find their ideal buyers and intelligently automate outreach, Apollo helps go-to-market teams sell anything.\n\nCelebrating a $100M Series D Funding Round 🦄","suborganizations":[],"num_suborganizations":0,"annual_revenue_printed":"100M","annual_revenue":100000000,"total_funding":251200000,"total_funding_printed":"251.2M","latest_funding_round_date":"2023-08-01T00:00:00.000+00:00","latest_funding_stage":"Series D","funding_events":[{"id":"6574c1ff9b797d0001fdab1b","date":"2023-08-01T00:00:00.000+00:00","news_url":null,"type":"Series D","investors":"Bain Capital Ventures, Sequoia Capital, Tribe Capital, Nexus Venture Partners","amount":"100M","currency":"$"},{"id":"624f4dfec786590001768016","date":"2022-03-01T00:00:00.000+00:00","news_url":null,"type":"Series C","investors":"Sequoia Capital, Tribe Capital, Nexus Venture Partners, NewView Capital","amount":"110M","currency":"$"},{"id":"61b13677623110000186a478","date":"2021-10-01T00:00:00.000+00:00","news_url":null,"type":"Series B","investors":"Tribe Capital, NewView Capital, Nexus Venture Partners","amount":"32M","currency":"$"},{"id":"5ffe93caa54d75077c59acef","date":"2018-06-26T00:00:00.000+00:00","news_url":"https://techcrunch.com/2018/06/26/yc-grad-zenprospect-rebrands-as-apollo-lands-7-m-series-a/","type":"Series A","investors":"Nexus Venture Partners, Social Capital, Y Combinator","amount":"7M","currency":"$"},{"id":"6574c1ff9b797d0001fdab20","date":"2016-10-01T00:00:00.000+00:00","news_url":null,"type":"Other","investors":"Y Combinator, SV Angel, Social Capital, Nexus Venture Partners","amount":"2.2M","currency":"$"}],"technology_names":["AI","Android","Basis","Canva","Circle","CloudFlare Hosting","Cloudflare DNS","Drift","Gmail","Google Apps","Google Tag Manager","Google Workspace","Gravity Forms","Hubspot","Intercom","Mailchimp Mandrill","Marketo","Microsoft Office 365","Mobile Friendly","Python","Rackspace MailGun","Remote","Render","Reviews","Salesforce","Stripe","Typekit","WP Engine","Wistia","WordPress.org","Yandex Metrica","reCAPTCHA"],"current_technologies":[{"uid":"ai","name":"AI","category":"Other"},{"uid":"android","name":"Android","category":"Frameworks and Programming Languages"},{"uid":"basis","name":"Basis","category":"Advertising Networks"},{"uid":"canva","name":"Canva","category":"Content Management Platform"},{"uid":"circle","name":"Circle","category":"Financial Software"},{"uid":"cloudflare_hosting","name":"CloudFlare Hosting","category":"Hosting"},{"uid":"cloudflare_dns","name":"Cloudflare DNS","category":"Domain Name Services"},{"uid":"drift","name":"Drift","category":"Widgets"},{"uid":"gmail","name":"Gmail","category":"Email Providers"},{"uid":"google_apps","name":"Google Apps","category":"Other"},{"uid":"google_tag_manager","name":"Google Tag Manager","category":"Tag Management"},{"uid":"google workspace","name":"Google Workspace","category":"Cloud Services"},{"uid":"gravity_forms","name":"Gravity Forms","category":"Hosted Forms"},{"uid":"hubspot","name":"Hubspot","category":"Marketing Automation"},{"uid":"intercom","name":"Intercom","category":"Support and Feedback"},{"uid":"mailchimp_mandrill","name":"Mailchimp Mandrill","category":"Email Delivery"},{"uid":"marketo","name":"Marketo","category":"Marketing Automation"},{"uid":"office_365","name":"Microsoft Office 365","category":"Other"},{"uid":"mobile_friendly","name":"Mobile Friendly","category":"Other"},{"uid":"python","name":"Python","category":"Frameworks and Programming Languages"},{"uid":"rackspace_mailgun","name":"Rackspace MailGun","category":"Email Delivery"},{"uid":"remote","name":"Remote","category":"Other"},{"uid":"render","name":"Render","category":"Other"},{"uid":"reviews","name":"Reviews","category":"Customer Reviews"},{"uid":"salesforce","name":"Salesforce","category":"Customer Relationship Management"},{"uid":"stripe","name":"Stripe","category":"Payments"},{"uid":"typekit","name":"Typekit","category":"Fonts"},{"uid":"wp_engine","name":"WP Engine","category":"CMS"},{"uid":"wistia","name":"Wistia","category":"Online Video Platforms"},{"uid":"wordpress_org","name":"WordPress.org","category":"CMS"},{"uid":"yandex_metrika","name":"Yandex Metrica","category":"Analytics and Tracking"},{"uid":"recaptcha","name":"reCAPTCHA","category":"Captcha"}],"org_chart_root_people_ids":["652fc57e2802bf00010c52f8"],"org_chart_sector":"OrgChart::SectorHierarchy::Rules::IT","org_chart_removed":false,"org_chart_show_department_filter":true,"account_id":"63f53afe4ceeca00016bdd37","account":{"id":"63f53afe4ceeca00016bdd37","domain":"apollo.io","name":"Apollo","team_id":"6095a710bd01d100a506d4ac","organization_id":"5e66b6381e05b4008c8331b8","account_stage_id":null,"source":"salesforce","original_source":"salesforce","creator_id":null,"owner_id":"60affe7d6e270a00f5db6fe4","created_at":"2023-02-21T21:43:26.351Z","phone":"+1(202) 374-1312","phone_status":"no_status","hubspot_id":null,"salesforce_id":null,"crm_owner_id":null,"parent_account_id":null,"linkedin_url":null,"sanitized_phone":"+12023741312","account_playbook_statuses":[],"account_rule_config_statuses":[],"existence_level":"full","label_ids":["6504905b21ba8e00a334eb0f"],"typed_custom_fields":{},"custom_field_errors":{},"modality":"account","source_display_name":"Imported from Salesforce","crm_record_url":null,"intent_strength":null,"show_intent":false,"has_intent_signal_account":false,"intent_signal_account":null},"departmental_head_count":{"engineering":228,"operations":28,"support":30,"marketing":36,"human_resources":29,"sales":177,"finance":8,"consulting":8,"legal":5,"arts_and_design":27,"accounting":3,"business_development":14,"information_technology":8,"education":6,"media_and_commmunication":3,"product_management":16,"entrepreneurship":3,"data_science":6,"administrative":3}}}
   */
  async enrichOrganization(domain) {
    return await this.#apiRequest({
      logTag: 'enrichOrganization',
      method: 'get',
      headers: { 'X-API-Key': this.masterAPIKey },
      url: `${ API_BASE_URL }/organizations/enrich`,
      query: { domain },
    })
  }

  /**
   * @operationName People Search
   * @category People Search
   * @route POST /apollopeoplesearch
   * @appearanceColor #196fe3 #00b5ad
   * @description Search and filter people using Apollo's advanced search for AI-driven prospecting and lead generation. Perfect for AI agents building targeted prospect lists, researching potential customers by job title/seniority/location, or finding decision-makers within specific companies and industries.
   * @paramDef {"type":"String","label":"Person Name","name":"person_name","description":"The full name of the person to search for. Example: 'John Smith'. Use for targeted person searches when you know the name."}
   * @paramDef {"type":"Array<String>","label":"Job Titles","name":"person_titles","description":"Target job titles for prospect search. Examples: ['Marketing Manager', 'VP of Sales', 'Chief Technology Officer']. Use specific titles for better targeting."}
   * @paramDef {"type":"Array<String>","label":"Person Locations","name":"person_locations","description":"Geographic locations where prospects live. Examples: ['San Francisco, CA', 'New York', 'United Kingdom']. Use for location-based targeting."}
   * @paramDef {"type":"Array<String>","label":"Organization Locations","name":"organization_locations","description":"Company headquarters locations for targeting employees. Examples: ['San Francisco, CA', 'London, UK']. Filter by where companies are based."}
   * @paramDef {"type":"Array<String>","label":"Organization Domains","name":"q_organization_domains_list","description":"Company domains to target employees from specific organizations. Examples: ['google.com', 'microsoft.com']. Use for account-based prospecting."}
   * @paramDef {"type":"Array<String>","label":"Organization IDs","name":"organization_ids","description":"Apollo organization IDs to restrict the search to.'"}
   * @paramDef {"type":"Array<String>","label":"Organization Employee Ranges","name":"organization_num_employees_ranges","description":"Employee count ranges in the format 'min,max'. e.g., '10,50'. '"}
   * @paramDef {"type":"String","label":"Keyword Filter","name":"q_keywords","description":"String of words to filter the results."}
   * @paramDef {"type":"Number","label":"Page","name":"page","description":"Page number for pagination."}
   * @paramDef {"type":"Number","label":"Results per Page","name":"per_page","description":"Number of results per page."}
   *
   * @sampleResult {"pagination":{"page":1,"per_page":10,"total_entries":157,"total_pages":16},"contacts":[{"id":"6462b961ad39c900a3070207","first_name":"Michael","last_name":"Chen","name":"Michael Chen","title":"Director of Engineering","organization_name":"StartupCo","email":"m.chen@startupco.com","linkedin_url":"https://www.linkedin.com/in/michaelchen"},{"id":"6596ea42d05a3e00014cf630","first_name":"Lisa","last_name":"Rodriguez","name":"Lisa Rodriguez","title":"VP of Product","organization_name":"GrowthTech","email":"lisa@growthtech.com","linkedin_url":"https://www.linkedin.com/in/lisarodriguez"}]}
   */  
  async peopleSearch(
    person_name,
    person_titles,
    include_similar_titles,
    person_seniorities,
    person_locations,
    organization_locations,
    q_organization_domains_list,
    contact_email_status,
    organization_ids,
    organization_num_employees_ranges,
    q_keywords,
    page,
    per_page
  ) {
    const body = {
      ...(person_name && { person_name }),
      ...(person_titles && { 'person_titles[]': person_titles }),
      ...(include_similar_titles !== undefined && { include_similar_titles }),
      ...(person_seniorities && { 'person_seniorities[]': person_seniorities }),
      ...(person_locations && { 'person_locations[]': person_locations }),
      ...(organization_locations && { 'organization_locations[]': organization_locations }),
      ...(q_organization_domains_list && { 'q_organization_domains_list[]': q_organization_domains_list }),
      ...(contact_email_status && { 'contact_email_status[]': contact_email_status }),
      ...(organization_ids && { 'organization_ids[]': organization_ids }),
      ...(organization_num_employees_ranges && { 'organization_num_employees_ranges[]': organization_num_employees_ranges }),
      ...(q_keywords && { q_keywords }),
      ...(page && { page }),
      ...(per_page && { per_page }),
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/mixed_people/search`,
      method: 'post',
      body,
      logTag: 'ApolloPeopleSearch',
    })
  }

  /**
   * @operationName Search Organizations
   * @category Company Research
   * @description Search and filter companies using Apollo's comprehensive database for AI-powered market research and account-based marketing. Ideal for AI agents identifying target companies by size/revenue/technology stack, building account lists for outreach campaigns, or researching market segments and competitor landscapes.
   *
   * @route POST /searchOrganizations
   *
   * @appearanceColor #FFB400 #000000
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<String>","label":"Company Size Ranges","name":"organization_num_employees_ranges[]","required":false,"description":"Employee count ranges to target companies by size. Format: 'min,max'. Examples: ['1,10'] for startups, ['100,500'] for mid-size, ['1000,5000'] for enterprise. Use for account-based targeting.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"Array<String>","label":"Include Locations","name":"organization_locations[]","required":false,"description":"Target companies by headquarters location. Examples: ['San Francisco, CA', 'New York', 'London, UK']. Useful for geographic market expansion or local partnership targeting.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"Array","label":"Exclude Locations","name":"organization_not_locations[]","required":false,"description":"Exclude companies from search results based on the location of the company headquarters. You can use cities, US states, and countries as locations to exclude. This parameter is useful for ensuring you do not prospect in an undesirable territory. For example, if you use 'ireland' as a value, no Ireland-based companies will appear in your search results."}
   * @paramDef {"type":"Number","label":"Revenue Min","name":"revenue_range[min]","required":false,"description":"Search for organizations based on their revenue. Use this parameter to set the lower range of organization revenue. Use the 'revenue_range[max]' parameter to set the upper range of revenue. Do not enter currency symbols, commas, or decimal points in the figure.", "uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Revenue Max","name":"revenue_range[max]","required":false,"description":"Search for organizations based on their revenue. Use this parameter to set the upper range of organization revenue. Use the 'revenue_range[min]' parameter to set the lower range of revenue. Do not enter currency symbols, commas, or decimal points in the figure.", "uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Array<String>","label":"Technology UIDs","name":"currently_using_any_of_technology_uids[]","required":false,"description":"Target companies using specific technologies. Examples: ['salesforce', 'hubspot', 'aws']. Perfect for finding prospects who use complementary or competing tools.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"Array","label":"Keyword Tags","name":"q_organization_keyword_tags[]","required":false,"description":"Filter search results based on keywords associated with companies. For example, you can enter 'mining' as a value to return only companies that have an association with the mining industry."}
   * @paramDef {"type":"String","label":"Organization Name","name":"q_organization_name","required":false,"description":"Search for specific companies by name. Supports partial matches. Example: 'Tech' matches 'TechCorp', 'FinTech Solutions'. Use for targeted account research."}
   * @paramDef {"type":"Array","label":"Organization IDs","name":"organization_ids[]","required":false,"description":"The Apollo IDs for the companies you want to include in your search results. Each company in the Apollo database is assigned a unique ID."}
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"description":"The page number of the Apollo data that you want to retrieve. Use this parameter in combination with the 'per_page' parameter to make search results navigable and improve performance.", "uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"per_page","required":false,"description":"The number of search results that should be returned for each page. Limited the number of results per page improves the endpoint's performance. Use the 'page' parameter to search the different pages of data.", "uiComponent":{"type":"NUMERIC_STEPPER"}}
   *
   * @returns {Object} Paginated search results for matching organizations.
   * @sampleResult {"pagination":{"page":1,"per_page":10,"total_entries":2847,"total_pages":285},"organizations":[{"id":"615d029256de500001bdb460","name":"TechCorp Solutions","website_url":"https://www.techcorp.com","linkedin_url":"https://www.linkedin.com/company/techcorp","primary_domain":"techcorp.com","estimated_num_employees":450,"annual_revenue":25000000,"founded_year":2015,"industry":"Software Development","location":"San Francisco, CA"},{"id":"55f1fcddf3e5bb0be2000a92","name":"GrowthStart Inc","website_url":"https://www.growthstart.io","linkedin_url":"https://www.linkedin.com/company/growthstart","primary_domain":"growthstart.io","estimated_num_employees":85,"annual_revenue":8500000,"founded_year":2020,"industry":"Marketing Technology","location":"Austin, TX"}]}
   */
  async searchOrganizations(
    organization_num_employees_ranges,
    organization_locations,
    organization_not_locations,
    revenueRangeMin,
    revenueRangeMax,
    currently_using_any_of_technology_uids,
    q_organization_keyword_tags,
    q_organization_name,
    organization_ids,
    page,
    per_page
  ) {
    const query = {
      ...(organization_num_employees_ranges && {
        'organization_num_employees_ranges[]': organization_num_employees_ranges,
      }),
      ...(organization_locations && { 'organization_locations[]': organization_locations }),
      ...(organization_not_locations && { 'organization_not_locations[]': organization_not_locations }),
      ...(revenueRangeMin !== undefined && { 'revenue_range[min]': revenueRangeMin }),
      ...(revenueRangeMax !== undefined && { 'revenue_range[max]': revenueRangeMax }),
      ...(currently_using_any_of_technology_uids && {
        'currently_using_any_of_technology_uids[]': currently_using_any_of_technology_uids.map(t =>
          t.replace(/\s+/g, '_')
        ),
      }),
      ...(q_organization_keyword_tags && { 'q_organization_keyword_tags[]': q_organization_keyword_tags }),
      ...(q_organization_name && { q_organization_name }),
      ...(organization_ids && { 'organization_ids[]': organization_ids }),
      ...(page && { page }),
      ...(per_page && { per_page }),
    }

    return await this.#apiRequest({
      logTag: 'searchOrganizations',
      method: 'post',
      url: `${ API_BASE_URL }/mixed_companies/search`,
      query: query,
    })
  }

  /**
   * @operationName Get Organization Job Postings
   * @category Company Research
   * @description Retrieve public job postings for a specific organization using its Apollo ID.
   *
   * @route POST /getOrganizationJobPostings
   *
   * @appearanceColor #FFB400 #000000
   *
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Organization ID","name":"organization_id","required":true,"description":"The unique Apollo ID of the organization whose job postings you want to retrieve."}
   *
   * @returns {Object} Public job postings from the specified organization.
   * @sampleResult {"pagination":{"per_page":10000,"page":1,"total_pages":1,"total_entries":9},"organization_job_postings":[{"country":"United States","city":"Southaven","id":"6823c11f243ff400017a54f6","state":"Mississippi","title":"Program Management Manager - Mastery - PgM (Hybrid)","last_seen_at":"2025-05-13T22:01:03.672+00:00","posted_at":"2025-05-13T21:01:03.672+00:00","url":"https://www.linkedin.com/jobs/view/program-management-manager-mastery-pgm-hybrid-at-google-operations-center-4229173376?position=2&pageNum=12&refId=V04dkab3oK1Hsa810eyA9g%3D%3D&trackingId=tV%2BBnzHZvaCgXFYR05jokw%3D%3D"},{"country":"United States","city":null,"id":"681cfbb37a5a0f000102f908","state":"Illinois","title":"Analytics & Insights Specialist - Ads Campaign Operations - Gamma","last_seen_at":"2025-05-08T18:45:07.837+00:00","posted_at":"2025-05-08T18:34:07.837+00:00","url":"https://www.linkedin.com/jobs/view/analytics-insights-specialist-ads-campaign-operations-gamma-at-google-operations-center-4223770186?position=3&pageNum=40&refId=FW6zpXhSg%2F0hRKgOmCS78g%3D%3D&trackingId=9nLfvkHIjozaEka3YP1Q7w%3D%3D"},{"country":"United States","city":null,"id":"681935a1b054d200014bf749","state":"Illinois","title":"Program Management Manger - Mastery - PgM","last_seen_at":"2025-05-05T22:03:13.581+00:00","posted_at":"2025-05-05T19:03:13.581+00:00","url":"https://www.linkedin.com/jobs/view/program-management-manger-mastery-pgm-at-google-operations-center-4222357861?position=8&pageNum=25&refId=a5Siqi6evugu4aCzw2eXCQ%3D%3D&trackingId=vA2qX8bCq4iSQmNJoqYNvQ%3D%3D"},{"country":"United States","city":null,"id":"6807cae6e1f5120001d3dc2a","state":"Georgia","title":"Marketing - Tech Process Specialist - DOME - Activation (Remote)","last_seen_at":"2025-04-22T16:59:18.012+00:00","posted_at":"2025-04-22T12:59:18.012+00:00","url":"https://www.linkedin.com/jobs/view/marketing-tech-process-specialist-dome-activation-remote-at-google-operations-center-4193225463?position=5&pageNum=0&refId=3DVM%2FmVy5dVTBsq0Jb5JeQ%3D%3D&trackingId=YyKqybQGzYLukb0RUU6MAA%3D%3D"},{"country":"United States","city":null,"id":"6801549b9aab1900010eab83","state":"Illinois","title":"Program Management Team Lead - DOME - Activation","last_seen_at":"2025-04-17T19:20:59.919+00:00","posted_at":"2025-04-17T18:57:59.919+00:00","url":"https://www.linkedin.com/jobs/view/program-management-team-lead-dome-activation-at-google-operations-center-4211112881?position=6&pageNum=67&refId=tuFH1hYZyw8f3HzCSJAPWg%3D%3D&trackingId=vgK4hng47HrnCNfyHhyQAA%3D%3D"},{"country":"United States","city":null,"id":"67f811e2c517490001a5eb2e","state":"Illinois","title":"GBO - Program Management Senior Specialist - Mastery - PgM","last_seen_at":"2025-04-10T18:45:54.563+00:00","posted_at":"2025-04-10T07:45:54.562+00:00","url":"https://www.linkedin.com/jobs/view/gbo-program-management-senior-specialist-mastery-pgm-at-google-operations-center-4205785327?position=10&pageNum=97&refId=afGMgo6Hf4pS9Irxcr22Tg%3D%3D&trackingId=ha4UVPPc0UtgHuS%2FRhyheQ%3D%3D"},{"country":"United States","city":"Southaven","id":"67f83e3a6acbeb000111f530","state":"Mississippi","title":"GBO - Program Management Senior Specialist - Mastery - PgM","last_seen_at":"2025-04-10T21:55:06.532+00:00","posted_at":"2025-04-10T06:55:06.532+00:00","url":"https://www.linkedin.com/jobs/view/gbo-program-management-senior-specialist-mastery-pgm-at-google-operations-center-4205783461?position=7&pageNum=27&refId=857hYADIo%2BUB6SxOM9QESg%3D%3D&trackingId=%2F1eaIz6DimKAIzjveZbcqw%3D%3D"},{"country":"United States","city":null,"id":"67eb1b738e6565000135b0a6","state":"Illinois","title":"Marketing - Tech Process Specialist - DOME - Activation","last_seen_at":"2025-03-31T22:47:15.926+00:00","posted_at":"2025-03-31T15:47:15.926+00:00","url":"https://www.linkedin.com/jobs/view/marketing-tech-process-specialist-dome-activation-at-google-operations-center-4193222543?position=7&pageNum=15&refId=ey3nxrkRbfWvb27YEBFYyg%3D%3D&trackingId=T1KDFiSHcckyvK%2F%2FYusphg%3D%3D"},{"country":"United States","city":"Southaven","id":"67e66d7c8993e6000195165b","state":"Mississippi","title":"Marketing - Analytics & Insights Specialist - DOME - Shared (Hybrid)","last_seen_at":"2025-03-28T09:35:55.933+00:00","posted_at":"2025-03-27T21:35:55.933+00:00","url":"https://www.linkedin.com/jobs/view/marketing-analytics-insights-specialist-dome-shared-hybrid-at-google-operations-center-4191841198?position=6&pageNum=5&refId=Lz5ytXM3UEv8h77QSqqyVg%3D%3D&trackingId=R9vs11gNjpbwNZHjtLV%2FDQ%3D%3D"}]}
   */
  async getOrganizationJobPostings(organization_id) {
    return await this.#apiRequest({
      logTag: 'getOrganizationJobPostings',
      method: 'get',
      url: `${ API_BASE_URL }/organizations/${ organization_id }/job_postings`,
      headers: { 'X-API-Key': this.masterAPIKey },
    })
  }

  /**
   * @operationName Create Task
   * @category Task Management
   * @description Creates task assignments for Apollo contacts, enabling AI agents to automate follow-up workflows and schedule outreach activities. Perfect for building systematic engagement processes, assigning manual review tasks, or triggering human touchpoints in automated sequences.
   *
   * @route POST /createTask
   *
   * @appearanceColor #FFB400 #000000
   *
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"User ID","name":"user_id","required":true,"dictionary":"getUsersDictionary", "description":"Apollo user ID who will be assigned the task. Select the team member responsible for executing the follow-up action on the contact."}
   * @paramDef {"type":"Array<String>","label":"Contact IDs","name":"contact_ids","required":true, "dictionary":"getContactsDictionary","description":"Apollo contact IDs to create tasks for. Individual tasks will be created for each contact with the same parameters. Use for batch task assignment."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","required":true,"description":"Assign a priority to the task you are creating.","uiComponent":{"type":"DROPDOWN","options":{"values":["high","medium","low"]}}}
   * @paramDef {"type":"Number","label":"Due At","name":"due_at","required":true,"description":"The full date and time when the task will be due. Your entry should adhere to the ISO 8601 date-time format. Apollo uses Greenwich Mean Time (GMT) by default. You can either adhere to GMT, or adjust the time manually by specifying in hours and minutes how much you want to offset GMT.","uiComponent":{"type":"DATE_PICKER"}}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"description":"Set the task to be 1 of the following task types. This enables the task owner to know the type of action they need to take.","uiComponent":{"type":"DROPDOWN","options":{"values":["call","outreach_manual_email","linkedin_step_connect","linkedin_step_message","linkedin_step_view_profile","linkedin_step_interact_post","action_item"]}}}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"description":"The status of the task being created. For future-facing tasks, you should use the 'scheduled' status. For tasks that are already completed, you can use 'completed' or 'archived'.","uiComponent":{"type":"DROPDOWN","options":{"values":["scheduled","completed","archived"]}}}
   * @paramDef {"type":"String","label":"Note","name":"note","required":false,"description":"Task description or instructions for the assignee. Example: 'Follow up on pricing discussion from demo call'. Provides context for the required action.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   *
   * @returns {Object} Task creation confirmation object.
   * @sampleResult {"success":true,"tasks_created":2,"message":"Tasks successfully created for 2 contacts"}
   */
  async createTask(user_id, contact_ids, priority, due_at, type, status, note) {
    const query = {
      ...(user_id && { user_id }),
      ...(contact_ids && { 'contact_ids[]': contact_ids }),
      ...(priority && { priority }),
      ...(due_at !== undefined && { due_at: new Date(due_at).toISOString().replace(/\.\d{3}Z$/, 'Z') }),
      ...(type && { type }),
      ...(status && { status }),
      ...(note && { note }),
    }

    console.log(due_at)

    return await this.#apiRequest({
      logTag: 'createTask',
      method: 'post',
      url: `${ API_BASE_URL }/tasks/bulk_create`,
      headers: { 'X-API-Key': this.masterAPIKey },
      query: query,
    })
  }

  /**
   * @operationName Get a List of Users
   * @category Team Management
   * @description Retrieve the IDs and info for all users (teammates) in your Apollo account. These IDs are used in operations like Create Task, Create Deal, and more.
   *
   * @route POST /getUsers
   *
   * @appearanceColor #FFB400 #000000
   *
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"description":"The page number of the Apollo data that you want to retrieve. Use this parameter in combination with the 'per_page' parameter to make search results navigable and improve the performance of the endpoint."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"per_page","required":false,"description":"The number of search results that should be returned for each page. Limiting the number of results per page improves the endpoint's performance. Use the 'page' parameter to search the different pages of data."}
   *
   * @returns {Object} Paginated list of users.
   * @sampleResult {"pagination":{"page":"1","per_page":"3","total_entries":23,"total_pages":8},"users":[{"id":"66c8db577ed7f201b25c0eef","team_id":"6095a710bd01d100a506d4ac","first_name":null,"last_name":null,"title":null,"email":"neha.mehra@apollomail.io","created_at":"2024-08-23T18:56:24.067Z","credit_limit":null,"direct_dial_credit_limit":null,"export_credit_limit":null,"ai_credit_limit":null,"salesforce_account":null,"deleted":false,"opt_out_html_template":"No longer interested in these messages? <%Unsubscribe%>","name":"","referral_code":"_A13QNgQWRMzI4xUofOLsg","password_needs_reset":false,"salesforce_id":null,"default_cockpit_layout":null,"default_account_overview_layout_id":null,"default_contact_overview_layout_id":null,"default_person_overview_layout_id":null,"default_organization_overview_layout_id":null,"default_opportunity_overview_layout_id":null,"default_home_overview_layout_id":null,"bridge_calls":false,"bridge_phone_number":null,"bridge_incoming_calls":false,"bridge_incoming_phone_number":null,"current_email_verified":true,"record_calls":true,"salesforce_instance_url":null,"permission_set_id":"6170904d46a82c00c227b744","default_use_local_numbers":false,"disable_email_linking":null,"sync_salesforce_id":null,"sync_crm_id":null,"zp_contact_id":"66ca3f1309358c0001ea6d9b","chrome_extension_downloaded":false,"zp_is_super_analytics_user":null,"email_oauth_signin_only":false,"notification_last_created_at":null,"crm_requested_to_integrate":null,"has_invited_user":false,"has_used_enrichment":false,"has_uploaded_csv":false,"has_hidden_onboarding":false,"notification_last_read_at":null,"daily_data_request_email":false,"data_request_emails":true,"daily_task_email":true,"free_data_credits_email":true,"dismiss_new_team_suggestion":true,"request_email_change_to":null,"self_identified_persona":null,"territory_is_active":true,"conversation_is_private":null,"show_deals_detail_page_updates_modal":true,"assistant_setting":{"_id":"66c8db587ed7f201b25c0ef0","deal_size_metric":"amount","inactive_account_stage_ids":[],"inactive_contact_stage_ids":[],"insight_deal_size_signals":{},"insight_sale_cycle_signals":{},"insight_win_rate_signals":{},"is_persona_recommendation_requested":false,"job_posting_locations":[],"job_posting_titles":[],"latest_funding_days":90,"max_num_active_accounts":100,"max_people_in_sequence_per_account":5,"num_inactive_days_to_re_engage":180,"persona_ids":["65d829661453d30300a0c9e3","65e76d7f00d9c601aed49f6c","65e8bf1f1132a70579a84d61","65eb62d262c9dc01c66b2675","66200c046194fa01c707b520","662057f7d9db7a01c7ba9960"],"should_show_persona_banner":true,"success_case_account_stage_ids":[],"team_id":"6095a710bd01d100a506d4ac","technology_uids":[],"territory_company_size_ranges":[],"territory_location_override":false,"territory_locations":["United States"],"territory_person_locations":["United States"],"user_id":"66c8db577ed7f201b25c0eef","id":"66c8db587ed7f201b25c0ef0","key":"66c8db587ed7f201b25c0ef0"},"fields_fully_loaded":true,"typed_custom_fields":null,"connected_to_slack":false,"crm_email":null,"triggered_referral_campaigns":[],"enable_click_tracking":false,"enable_open_tracking":true,"should_include_unsubscribe_link":false,"enable_one_click_unsubscribe":null,"subteam_ids":[],"prospect_territory_ids":[],"toggled_on_territory_ids":[],"linked_salesforce":null,"linked_zoom_conference_account":false,"linked_bot_conference_account":true,"linked_bot_conference_account_platforms":["google_meet","ms_teams"],"has_conference_account":true,"linked_hubspot":false,"linked_salesloft":false,"linked_crm_name":null,"chrome_extension_enabled_features":["apollo_everywhere","gmail","linkedin","salesforce","hubspot","google_calendar"],"chrome_extension_exclude_from_websites":["facebook.com","youtube.com","instagram.com","google.com","live.com","yahoo.com","notion.so","atlassian.net","asana.com","typeform.com","figma.com"],"chrome_extension_everywhere_icon_horizontal_position":"right","chrome_extension_everywhere_icon_vertical_position_in_vh":10,"default_chrome_extension_log_email_send_to_salesforce":true,"default_chrome_extension_log_email_send_to_hubspot":true,"chrome_extension_auto_match_salesforce_opportunity":true,"chrome_extension_gmail_enable_email_tools":true,"enable_desktop_notifications":false,"enable_gmail_desktop_notifications":null,"default_chrome_extension_enable_reminders":false,"chrome_extension_gmail_enable_crm_sidebar":true,"show_chrome_extension_buying_intent_promo":true,"apollo_everywhere_search_count":0},{"id":"66aaac5a0e951f01b37012bd","team_id":"6095a710bd01d100a506d4ac","first_name":"","last_name":null,"title":"","email":"paige.york@apollomail.io","created_at":"2024-07-31T21:27:54.929Z","credit_limit":null,"direct_dial_credit_limit":null,"export_credit_limit":null,"ai_credit_limit":null,"salesforce_account":null,"deleted":false,"opt_out_html_template":"No longer interested in these messages? <%Unsubscribe%>","name":"","referral_code":"vi9DHS7ZC7GcLFDh_m5onw","password_needs_reset":false,"salesforce_id":null,"default_cockpit_layout":null,"default_account_overview_layout_id":null,"default_contact_overview_layout_id":null,"default_person_overview_layout_id":null,"default_organization_overview_layout_id":null,"default_opportunity_overview_layout_id":null,"default_home_overview_layout_id":null,"bridge_calls":false,"bridge_phone_number":null,"bridge_incoming_calls":false,"bridge_incoming_phone_number":null,"current_email_verified":true,"record_calls":true,"salesforce_instance_url":null,"permission_set_id":"6095a711bd01d100a506d4d7","default_use_local_numbers":false,"disable_email_linking":null,"sync_salesforce_id":null,"sync_crm_id":null,"zp_contact_id":"66abff979b4ed70001424e87","chrome_extension_downloaded":false,"zp_is_super_analytics_user":null,"email_oauth_signin_only":true,"notification_last_created_at":null,"crm_requested_to_integrate":null,"has_invited_user":false,"has_used_enrichment":false,"has_uploaded_csv":false,"has_hidden_onboarding":false,"notification_last_read_at":null,"daily_data_request_email":false,"data_request_emails":true,"daily_task_email":true,"free_data_credits_email":true,"dismiss_new_team_suggestion":true,"request_email_change_to":null,"self_identified_persona":null,"territory_is_active":false,"conversation_is_private":null,"show_deals_detail_page_updates_modal":true,"assistant_setting":{"_id":"66aaac5a0e951f01b37012be","deal_size_metric":"amount","inactive_account_stage_ids":[],"inactive_contact_stage_ids":[],"insight_deal_size_signals":{},"insight_sale_cycle_signals":{},"insight_win_rate_signals":{},"is_persona_recommendation_requested":false,"job_posting_locations":[],"job_posting_titles":[],"latest_funding_days":90,"max_num_active_accounts":100,"max_people_in_sequence_per_account":5,"num_inactive_days_to_re_engage":180,"persona_ids":["65d829661453d30300a0c9e3","65e76d7f00d9c601aed49f6c","65e8bf1f1132a70579a84d61","65eb62d262c9dc01c66b2675","66200c046194fa01c707b520","662057f7d9db7a01c7ba9960"],"should_show_persona_banner":true,"success_case_account_stage_ids":[],"team_id":"6095a710bd01d100a506d4ac","technology_uids":[],"territory_company_size_ranges":[],"territory_location_override":false,"territory_locations":["United States"],"territory_person_locations":["United States"],"user_id":"66aaac5a0e951f01b37012bd","id":"66aaac5a0e951f01b37012be","key":"66aaac5a0e951f01b37012be"},"fields_fully_loaded":true,"typed_custom_fields":null,"connected_to_slack":false,"crm_email":null,"triggered_referral_campaigns":[],"enable_click_tracking":false,"enable_open_tracking":true,"should_include_unsubscribe_link":false,"enable_one_click_unsubscribe":null,"subteam_ids":[],"prospect_territory_ids":[],"toggled_on_territory_ids":[],"linked_salesforce":null,"linked_zoom_conference_account":false,"linked_bot_conference_account":true,"linked_bot_conference_account_platforms":["google_meet","ms_teams"],"has_conference_account":true,"linked_hubspot":false,"linked_salesloft":false,"linked_crm_name":null,"chrome_extension_enabled_features":["apollo_everywhere","gmail","linkedin","salesforce","hubspot","google_calendar"],"chrome_extension_exclude_from_websites":["facebook.com","youtube.com","instagram.com","google.com","live.com","yahoo.com","notion.so","atlassian.net","asana.com","typeform.com","figma.com"],"chrome_extension_everywhere_icon_horizontal_position":"right","chrome_extension_everywhere_icon_vertical_position_in_vh":10,"default_chrome_extension_log_email_send_to_salesforce":true,"default_chrome_extension_log_email_send_to_hubspot":true,"chrome_extension_auto_match_salesforce_opportunity":true,"chrome_extension_gmail_enable_email_tools":true,"enable_desktop_notifications":false,"enable_gmail_desktop_notifications":null,"default_chrome_extension_enable_reminders":false,"chrome_extension_gmail_enable_crm_sidebar":true,"show_chrome_extension_buying_intent_promo":true,"apollo_everywhere_search_count":0},{"id":"66a3d80d4238fe02d2baaaaf","team_id":"6095a710bd01d100a506d4ac","first_name":"Sunny","last_name":"Sehmar","title":null,"email":"sunny.sehmar@apollomail.io","created_at":"2024-07-26T17:08:29.611Z","credit_limit":null,"direct_dial_credit_limit":null,"export_credit_limit":null,"ai_credit_limit":null,"salesforce_account":null,"deleted":false,"opt_out_html_template":"If you don't want to hear from me again, please <%let me know%>.","name":"Sunny Sehmar","referral_code":"tal6vVSCy95yHaH9NRQMdA","password_needs_reset":false,"salesforce_id":null,"default_cockpit_layout":null,"default_account_overview_layout_id":null,"default_contact_overview_layout_id":null,"default_person_overview_layout_id":null,"default_organization_overview_layout_id":null,"default_opportunity_overview_layout_id":null,"default_home_overview_layout_id":null,"bridge_calls":false,"bridge_phone_number":null,"bridge_incoming_calls":false,"bridge_incoming_phone_number":null,"current_email_verified":true,"record_calls":true,"salesforce_instance_url":null,"permission_set_id":"6095a711bd01d100a506d4d7","default_use_local_numbers":false,"disable_email_linking":null,"sync_salesforce_id":null,"sync_crm_id":null,"zp_contact_id":"66a4b080cf1ffb000132b9bc","chrome_extension_downloaded":true,"zp_is_super_analytics_user":null,"email_oauth_signin_only":false,"notification_last_created_at":"2024-08-02T15:07:37.836+00:00","crm_requested_to_integrate":null,"has_invited_user":false,"has_used_enrichment":false,"has_uploaded_csv":false,"has_hidden_onboarding":false,"notification_last_read_at":"2024-07-30T23:08:32.175+00:00","daily_data_request_email":false,"data_request_emails":true,"daily_task_email":true,"free_data_credits_email":true,"dismiss_new_team_suggestion":true,"request_email_change_to":null,"self_identified_persona":null,"territory_is_active":false,"conversation_is_private":null,"show_deals_detail_page_updates_modal":false,"assistant_setting":{"_id":"66a3d80d4238fe02d2baaab0","deal_size_metric":"amount","inactive_account_stage_ids":[],"inactive_contact_stage_ids":[],"insight_deal_size_signals":{},"insight_sale_cycle_signals":{},"insight_win_rate_signals":{},"is_persona_recommendation_requested":false,"job_posting_locations":[],"job_posting_titles":[],"latest_funding_days":90,"max_num_active_accounts":100,"max_people_in_sequence_per_account":5,"num_inactive_days_to_re_engage":180,"persona_ids":["65d829661453d30300a0c9e3","65e76d7f00d9c601aed49f6c","65e8bf1f1132a70579a84d61","65eb62d262c9dc01c66b2675","66200c046194fa01c707b520","662057f7d9db7a01c7ba9960"],"should_show_persona_banner":true,"success_case_account_stage_ids":[],"team_id":"6095a710bd01d100a506d4ac","technology_uids":[],"territory_company_size_ranges":[],"territory_location_override":false,"territory_locations":["United States"],"territory_person_locations":["United States"],"user_id":"66a3d80d4238fe02d2baaaaf","id":"66a3d80d4238fe02d2baaab0","key":"66a3d80d4238fe02d2baaab0"},"fields_fully_loaded":true,"typed_custom_fields":null,"connected_to_slack":false,"crm_email":null,"triggered_referral_campaigns":[],"enable_click_tracking":true,"enable_open_tracking":true,"should_include_unsubscribe_link":true,"enable_one_click_unsubscribe":null,"subteam_ids":[],"prospect_territory_ids":[],"toggled_on_territory_ids":[],"linked_salesforce":null,"linked_zoom_conference_account":false,"linked_bot_conference_account":true,"linked_bot_conference_account_platforms":["google_meet","ms_teams"],"has_conference_account":true,"linked_hubspot":false,"linked_salesloft":false,"linked_crm_name":null,"chrome_extension_enabled_features":["apollo_everywhere","gmail","linkedin","salesforce","hubspot","google_calendar"],"chrome_extension_exclude_from_websites":["facebook.com","youtube.com","instagram.com","google.com","live.com","yahoo.com","notion.so","atlassian.net","asana.com","typeform.com","figma.com"],"chrome_extension_everywhere_icon_horizontal_position":"right","chrome_extension_everywhere_icon_vertical_position_in_vh":10,"default_chrome_extension_log_email_send_to_salesforce":true,"default_chrome_extension_log_email_send_to_hubspot":true,"chrome_extension_auto_match_salesforce_opportunity":true,"chrome_extension_gmail_enable_email_tools":true,"enable_desktop_notifications":false,"enable_gmail_desktop_notifications":null,"default_chrome_extension_enable_reminders":false,"chrome_extension_gmail_enable_crm_sidebar":true,"show_chrome_extension_buying_intent_promo":true,"apollo_everywhere_search_count":0}],"num_fetch_result":null}
   */
  async getUsers(page, per_page) {
    const query = {
      ...(page && { page }),
      ...(per_page && { per_page }),
    }

    return await this.#apiRequest({
      logTag: 'getUsers',
      method: 'get',
      url: `${ API_BASE_URL }/users/search`,
      headers: { 'X-API-Key': this.masterAPIKey },
      query: query,
    })
  }

  /**
   * @operationName Search Sequences
   * @category Sequences
   * @description Search for Apollo sequences using a text query and pagination options.
   *
   * @route POST /searchSequences
   *
   * @appearanceColor #FFB400 #000000
   *
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Sequence Name","name":"q_name","required":false,"description":"A text query to search for sequences by name."}
   * @paramDef {"type":"Number","label":"Page Number","name":"page","required":false,"description":"The page number of the results to retrieve.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"per_page","required":false,"description":"The number of results to return per page.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   *
   * @returns {Object} A paginated list of sequences matching the query.
   * @sampleResult {"pagination":{"page":1,"per_page":5,"total_entries":1,"total_pages":1},"breadcrumbs":[{"label":"Name","signal_field_name":"q_name","value":"Copywriting Dublin","display_name":"Copywriting Dublin"}],"emailer_campaigns":[{"id":"66e9e215ece19801b219997f","name":"Target Copywriting Clients in Dublin","archived":false,"created_at":"2024-09-17T20:09:57.837Z","emailer_schedule_id":"6095a711bd01d100a506d52a","user_id":"66302798d03b9601c7934ebf","active":false,"days_to_wait_before_mark_as_response":5,"mark_finished_if_reply":true,"mark_finished_if_interested":true,"mark_paused_if_ooo":true,"permissions":"team_can_use","sequence_ruleset_id":"6095a711bd01d100a506d4e0","same_account_reply_delay_days":30,"is_performing_poorly":false,"num_steps":3,"unique_scheduled":0,"unique_delivered":0,"unique_bounced":0,"unique_opened":0,"unique_hard_bounced":0,"unique_spam_blocked":0,"unique_replied":0,"unique_demoed":0,"unique_clicked":0,"unique_unsubscribed":0,"bounce_rate":0,"hard_bounce_rate":0,"open_rate":0,"click_rate":0,"reply_rate":0,"spam_block_rate":0,"opt_out_rate":0,"demo_rate":0,"loaded_stats":true,"cc_emails":"","bcc_emails":"","underperforming_touches_count":0}]}
   */
  async searchSequences(q_name, page, per_page) {
    const query = {
      ...(q_name && { q_name }),
      ...(page && { page }),
      ...(per_page && { per_page }),
    }

    return await this.#apiRequest({
      logTag: 'searchSequences',
      method: 'post',
      url: `${ API_BASE_URL }/emailer_campaigns/search`,
      headers: { 'X-API-Key': this.masterAPIKey },
      query: query,
    })
  }

  /**
   * @operationName Add Contacts to Sequence
   * @category Sequences
   * @description Add one or more contacts to an Apollo sequence using their IDs.
   *
   * @route POST /addContactsToSequence
   *
   * @appearanceColor #FF8C00 #C45500
   *
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Sequence ID","name":"sequence_id","required":true,"description":"The Apollo ID for the sequence to which you want to add contacts.", "dictionary":"getSequencesDictionary"}
   * @paramDef {"type":"Array","label":"Contact IDs","name":"contact_ids[]","required":true, "dictionary":"getContactsDictionary", "description":"The Apollo IDs for the contacts that you want to add to the sequence."}
   * @paramDef {"type":"String","label":"Email Account ID","name":"send_email_from_email_account_id","required":true,"description":"The Apollo ID for the email account that you want to use to send emails to the contacts you are adding to the sequence.", "dictionary":"getEmailAccountsDictionary"}
   * @paramDef {"type":"Boolean","label":"Allow No Email","name":"sequence_no_email","required":false,"description":"Set to true if you want to add contacts to the sequence even if they do not have an email address.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"Boolean","label":"Allow Unverified Email","name":"sequence_unverified_email","required":false,"description":"Set to true if you want to add contacts to the sequence if they have an unverified email address.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"Boolean","label":"Allow Job Change","name":"sequence_job_change","required":false,"description":"Set to true if you want to add contacts to the sequence even if they have recently changed jobs.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"Boolean","label":"Allow Active in Other Campaigns","name":"sequence_active_in_other_campaigns","required":false,"description":"Set to true if you want to add contacts to the sequence even if they have been added to other sequences.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"Boolean","label":"Allow Finished in Other Campaigns","name":"sequence_finished_in_other_campaigns","required":false,"description":"Set to true if you want to add contacts to the sequence if they have been marked as finished in another sequence.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"String","label":"User ID","name":"user_id","required":false,"description":"The ID for the user in your team's Apollo account who is taking the action to add contacts to the sequence.", "dictionary":"getUsersDictionary"}
   *
   * @returns {Object} A background job that will process the contact addition.
   * @sampleResult {"entity_progress_job":{"id":"66e9f09ddefa5701b2ba51e5","user_id":"66302798d03b9601c7934ebf","job_type":"sequence_add_contact","entity_ids":["66e9e98a39650502d2416b80","66e9e9cee71811019bdf764f","66e9e9e21fbdad01b2b33bbd"],"params":{"sequence_id":"66e9e215ece19801b219997f","send_email_from_email_account_id":["6633baaece5fbd01c791d7ca"],"source":"add_to_sequence_api","safety_check_filter_options":{"sequence_active_in_other_campaigns":"false","sequence_no_email":"true","sequence_unverified_email":"true","sequence_same_company_in_same_campaign":"false","sequence_finished_in_other_campaigns":"false","sequence_job_change":"false"}},"progress":0,"batch_size":999},"signals_hash":null}
   */
  async addContactsToSequence(
    sequence_id,
    contact_ids,
    send_email_from_email_account_id,
    sequence_no_email,
    sequence_unverified_email,
    sequence_job_change,
    sequence_active_in_other_campaigns,
    sequence_finished_in_other_campaigns,
    user_id
  ) {
    const query = {
      ...(contact_ids && { 'contact_ids[]': contact_ids }),
      ...(send_email_from_email_account_id && { send_email_from_email_account_id }),
      ...(sequence_no_email !== undefined && { sequence_no_email }),
      ...(sequence_unverified_email !== undefined && { sequence_unverified_email }),
      ...(sequence_job_change !== undefined && { sequence_job_change }),
      ...(sequence_active_in_other_campaigns !== undefined && { sequence_active_in_other_campaigns }),
      ...(sequence_finished_in_other_campaigns !== undefined && { sequence_finished_in_other_campaigns }),
      ...(user_id && { user_id }),
      emailer_campaign_id: sequence_id, // always same as sequence_id
    }

    return await this.#apiRequest({
      logTag: 'addContactsToSequence',
      method: 'post',
      url: `${ API_BASE_URL }/emailer_campaigns/${ sequence_id }/add_contact_ids`,
      headers: { 'X-API-Key': this.masterAPIKey },
      query: query,
    })
  }

  /**
   * @operationName Search Contacts
   * @category Contact Management
   * @description Search for contacts that have been added to your Apollo account, using filters like keyword, stage, and sort order.
   *
   * @route POST /searchContacts
   *
   * @appearanceColor #FFB400 #000000
   *
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Keywords","name":"q_keywords","required":false,"description":"Add keywords to narrow the search of the contacts in your team's Apollo account. Keywords can include combinations of names, job titles, employers (company names), and email addresses."}
   * @paramDef {"type":"Array","label":"Contact Stages","name":"contact_stage_ids","required":false,"description":"Filter contacts by one or more stage IDs.","dictionary":"getContactStagesDictionary", "uiComponent":{"type":"MULTI_SELECT_DROPDOWN"}}
   * @paramDef {"type":"String","label":"Sort By","name":"sort_by_field","required":false,"description":"Sort the matching contacts by one of the following options: contact_last_activity_date, contact_email_last_opened_at, contact_email_last_clicked_at, contact_created_at, contact_updated_at.","uiComponent":{"type":"DROPDOWN","options":{"values":["contact_last_activity_date","contact_email_last_opened_at","contact_email_last_clicked_at","contact_created_at","contact_updated_at"]}}}
   * @paramDef {"type":"Boolean","label":"Sort Ascending","name":"sort_ascending","required":false,"description":"Set to true to sort the matching contacts in ascending order. This parameter must be used with sort_by_field. Otherwise, the sorting logic is not applied.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"Number","label":"Page Number","name":"page","required":false,"description":"The page number of the Apollo data that you want to retrieve. Use this parameter in combination with the per_page parameter to make search results navigable and improve the performance of the endpoint.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"per_page","required":false,"description":"The number of search results that should be returned for each page. Limiting the number of results per page improves the endpoint's performance. Use the page parameter to search the different pages of data.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   *
   * @returns {Object} A paginated list of contacts matching the search criteria.
   * @sampleResult {"contacts":[{"id":"66e3726977d36c03f2c30afc","first_name":"Walt","last_name":"Whitman","title":"Associate Writer","email":"wwhitman@apollo.io","organization_name":"Apollo.io"}],"pagination":{"page":1,"per_page":2,"total_entries":178,"total_pages":89}}
   */
  async searchContacts(q_keywords, contact_stage_ids, sort_by_field, sort_ascending, page, per_page) {
    const query = {
      ...(q_keywords && { q_keywords }),
      ...(contact_stage_ids && { 'contact_stage_ids[]': contact_stage_ids }),
      ...(sort_by_field && { sort_by_field }),
      ...(sort_ascending !== undefined && { sort_ascending }),
      ...(page && { page }),
      ...(per_page && { per_page }),
    }

    return await this.#apiRequest({
      logTag: 'searchContacts',
      method: 'post',
      url: `${ API_BASE_URL }/contacts/search`,
      query: query,
    })
  }

  async #apiRequest({ url, method, body, query, headers, logTag }) {
    this.#resolveAccessToken()
    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)
      logger.debug(`${ logTag } - api request body: [${ JSON.stringify(body) }]`)

      const request = Flowrunner.Request[method](url)

      // Conditionally set access token header only if X-API-Key is not in headers
      if (!headers || !Object.keys(headers).some(k => k.toLowerCase() === 'x-api-key')) {
        request.set(this.#getAccessTokenHeader(this.userAccessToken))
      }

      return await request.set(headers).query(query).send(body)
    } catch (error) {
      logger.error(`${ logTag } - api request error: ${ JSON.stringify(error) }`)
      throw error
    }
  }

  #resolveAccessToken() {
    if (this.accessTokenResolved) {
      return
    }

    this.userAccessToken = this.request.headers['oauth-access-token']
    this.accessTokenResolved = true
  }

  #getAccessTokenHeader(accessToken) {
    logger.debug(`[#getAccessTokenHeader] accessToken=${ accessToken }`)

    return {
      Authorization: `Bearer ${ accessToken }`,
    }
  }

  // ======================================= DICTIONARIES =======================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
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
   * @typedef {Object} getContactStagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter contact stages by their name. Filtering is performed locally on retrieved results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contact Stages
   * @category Contact Management
   * @description Returns contact stages for AI-powered lead qualification and pipeline management. Enables AI agents to categorize prospects by engagement level, qualification status, and sales readiness for automated workflow triggers.
   *
   * @route POST /get-contact-stages
   *
   * @paramDef {"type":"getContactStagesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for retrieving and filtering contact stages."}
   *
   * @sampleResult {"items":[{"label":"Qualified Lead","value":"stage_001","note":"High-intent prospects ready for outreach"},{"label":"Nurture","value":"stage_002","note":"Contacts requiring relationship building"}]}
   * @returns {DictionaryResponse}
   */
  async getContactStagesDictionary({ search }) {
    const result = await this.#apiRequest({
      logTag: 'getContactStagesDictionary',
      method: 'get',
      headers: { 'X-API-Key': this.masterAPIKey },
      url: `${ API_BASE_URL }/account_stages`,
    })

    logger.debug(`getContactStagesDictionary - result: [${ JSON.stringify(result) }]`)

    const allStages = result?.account_stages || []
    const filtered = search
      ? allStages.filter(stage => stage.name.toLowerCase().includes(search.toLowerCase()))
      : allStages

    return {
      items: filtered.map(stage => ({
        label: stage.name,
        value: stage.id,
        // note: stage.display_name || '',
      })),
    }
  }

  /**
   * @typedef {Object} getSequencesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter sequences by their name. Filtering is performed on the server side."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor indicating the current page (1-based). Use the returned cursor to fetch the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sequences
   * @category Sequences
   * @description Returns a paginated list of sequences (emailer campaigns) from Apollo.io. Note: search functionality is performed on the server side. Use the cursor to paginate through all results.
   *
   * @route POST /get-sequences
   *
   * @paramDef {"type":"getSequencesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering sequences."}
   *
   * @sampleResult {"cursor":"2","items":[{"label":"Welcome Series","value":"123"},{"label":"Product Launch","value":"124"}]}
   * @returns {DictionaryResponse}
   */
  async getSequencesDictionary({ search, cursor }) {
    const page = parseInt(cursor || '1', 10)
    const per_page = 10

    const result = await this.#apiRequest({
      logTag: 'getSequencesDictionary',
      method: 'post',
      url: `${ API_BASE_URL }/emailer_campaigns/search`,
      headers: { 'X-API-Key': this.masterAPIKey },
      query: {
        ...(search && { q_name: search }),
        page,
        per_page,
      },
    })

    const campaigns = result?.emailer_campaigns || []
    const current = result?.pagination?.page || page
    const total = result?.pagination?.total_pages || 1
    const nextCursor = current < total ? String(current + 1) : null

    return {
      items: campaigns.map(seq => ({
        label: seq.name,
        value: seq.id,
      })),
      cursor: nextCursor,
    }
  }

  /**
   * @typedef {Object} getEmailAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter email accounts by their name or email address. Filtering is performed locally on retrieved results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Email Accounts
   * @category Team Management
   * @description Returns a list of email accounts from Apollo.io. Note: search functionality filters accounts only within the current page of results.
   *
   * @route POST /get-email-accounts
   *
   * @paramDef {"type":"getEmailAccountsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for retrieving and filtering email accounts."}
   *
   * @sampleResult {"items":[{"label":"John Doe","value":"acc_123"}]}
   * @returns {DictionaryResponse}
   */
  async getEmailAccountsDictionary({ search }) {
    const response = await this.#apiRequest({
      logTag: 'getEmailAccountsDictionary',
      method: 'get',
      headers: { 'X-API-Key': this.masterAPIKey },
      url: `${ API_BASE_URL }/email_accounts`,
    })

    const accounts = response?.email_accounts || []

    const filtered = search
      ? accounts.filter(
        acc =>
          (acc.name || '').toLowerCase().includes(search.toLowerCase()) ||
          (acc.email || '').toLowerCase().includes(search.toLowerCase())
      )
      : accounts

    return {
      items: filtered.map(acc => ({
        label: acc.name || acc.email,
        value: acc.id,
      })),
    }
  }

  /**
   * @typedef {Object} getContactsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter contacts by keywords (name, email, etc.). Filtering is performed on the server side."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor indicating the current page (1-based). Use the returned cursor to fetch the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contacts
   * @category Contact Management
   * @description Returns a paginated list of contacts from Apollo.io. Note: search functionality is performed on the server side. Use the cursor to paginate through all results.
   *
   * @route POST /get-contacts
   *
   * @paramDef {"type":"getContactsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering contacts."}
   *
   * @sampleResult {"cursor":"2","items":[{"label":"Jane Doe","value":"con_123","note":"jane@company.com"}]}
   * @returns {DictionaryResponse}
   */
  async getContactsDictionary({ search, cursor }) {
    const page = parseInt(cursor || '1', 10)
    const per_page = 20

    const query = { page, per_page }
    if (search) query.q_keywords = search

    const response = await this.#apiRequest({
      logTag: 'getContactsDictionary',
      method: 'post',
      url: `${ API_BASE_URL }/contacts/search`,
      query,
    })

    const contacts = response?.contacts || []
    const current = response?.pagination?.page || page
    const total = response?.pagination?.total_pages || 1
    const nextCursor = current < total ? String(current + 1) : null

    return {
      items: contacts.map(c => ({
        label: `${ c.first_name || '' } ${ c.last_name || '' }`.trim() || c.email,
        value: c.id,
        note: c.email || c.organization_name || '',
      })),
      cursor: nextCursor,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @category Team Management
   *
   * @param {DictionaryPayload} payload
   * @returns {DictionaryResponse}
   */
  async getUsersDictionary({ search, cursor }) {
    const page = parseInt(cursor || '1', 10)
    const per_page = 20

    const response = await this.#apiRequest({
      logTag: 'getUsersDictionary',
      method: 'get',
      url: `${ API_BASE_URL }/users/search`,
      headers: { 'X-API-Key': this.masterAPIKey },
      query: { page, per_page },
    })

    const users = response?.users || []
    const current = response?.pagination?.page || page
    const total = response?.pagination?.total_pages || 1
    const nextCursor = current < total ? String(current + 1) : null

    const filtered = search
      ? users.filter(
        user =>
          `${ user.first_name } ${ user.last_name }`.toLowerCase().includes(search.toLowerCase()) ||
          (user.email || '').toLowerCase().includes(search.toLowerCase())
      )
      : users

    return {
      items: filtered.map(user => ({
        label: `${ user.first_name || '' } ${ user.last_name || '' }`.trim() || user.email,
        value: user.id,
        note: user.email || '',
      })),
      cursor: nextCursor,
    }
  }
}

Flowrunner.ServerCode.addService(Apollo, [
  {
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientId',
    hint: 'Your OAuth 2.0 Client ID from your Apollo.io account (navigate to Admin Settings > Integrations > API > OAuth registration).',
  },
  {
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientSecret',
    hint: 'Your OAuth 2.0 Client Secret from your Apollo.io account (navigate to Admin Settings > Integrations > API > OAuth registration).',
  },
  {
    displayName: 'Master API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    name: 'masterAPIKey',
    hint: 'Your Apollo.io account Master API Key. To create the key, navigate to Admin Settings > Integrations > API > API Keys.',
  },
])
