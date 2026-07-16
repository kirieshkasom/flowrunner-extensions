const logger = {
  info: (...args) => console.log('[Lemlist] info:', ...args),
  debug: (...args) => console.log('[Lemlist] debug:', ...args),
  error: (...args) => console.log('[Lemlist] error:', ...args),
  warn: (...args) => console.log('[Lemlist] warn:', ...args),
}

const API_BASE_URL = 'https://api.lemlist.com/api'

const DEFAULT_LIMIT = 100

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
 * @integrationName Lemlist
 * @integrationIcon /icon.png
 */
class LemlistService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Lemlist uses HTTP Basic auth with an empty username and the API key as the
  // password: base64(':' + apiKey).
  #authHeader() {
    const token = Buffer.from(`:${ this.apiKey }`).toString('base64')

    return `Basic ${ token }`
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': this.#authHeader(),
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.message || error.body?.error || error.message

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`Lemlist API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName List Campaigns
   * @category Campaigns
   * @description Lists the campaigns in your Lemlist team. Supports offset/limit pagination (limit up to 100). Each campaign includes its identifier, name, status, and creation date. Use the returned campaign identifier with Get Campaign, Get Campaign Stats, or Add Lead to Campaign.
   * @route GET /campaigns
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of campaigns to skip for pagination. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of campaigns to return (1-100). Defaults to 100."}
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"cam_aBcD1234","name":"Q3 Outbound","status":"running","createdAt":"2026-01-10T09:00:00.000Z","labels":["outbound"]}]
   */
  async listCampaigns(offset, limit) {
    const logTag = '[listCampaigns]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/campaigns`,
      method: 'get',
      query: {
        offset: offset,
        limit: limit || DEFAULT_LIMIT,
      },
    })
  }

  /**
   * @operationName Get Campaign
   * @category Campaigns
   * @description Retrieves a single campaign by its identifier, including its name, status, sequence configuration, and metadata. Use List Campaigns or the Campaigns dictionary to find the campaign identifier.
   * @route GET /campaigns/{campaignId}
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign to retrieve. Search and select a campaign, or enter its identifier directly."}
   * @returns {Object}
   * @sampleResult {"_id":"cam_aBcD1234","name":"Q3 Outbound","status":"running","createdAt":"2026-01-10T09:00:00.000Z","labels":["outbound"]}
   */
  async getCampaign(campaignId) {
    const logTag = '[getCampaign]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/campaigns/${ encodeURIComponent(campaignId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Campaign Stats
   * @category Campaigns
   * @description Returns aggregate performance statistics for a campaign, such as the number of emails sent, opened, clicked, replied, bounced, and unsubscribed. Use this to monitor campaign engagement over its lifetime.
   * @route GET /campaigns/{campaignId}/stats
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign to get statistics for. Search and select a campaign, or enter its identifier directly."}
   * @returns {Object}
   * @sampleResult {"nbLeads":250,"nbEmailsSent":480,"nbOpen":310,"nbClicked":62,"nbReplied":28,"nbBounced":4,"nbUnsubscribed":3,"nbInterested":15}
   */
  async getCampaignStats(campaignId) {
    const logTag = '[getCampaignStats]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/campaigns/${ encodeURIComponent(campaignId) }/stats`,
      method: 'get',
    })
  }

  /**
   * @operationName Add Lead to Campaign
   * @category Leads
   * @description Adds a lead to a campaign, or updates the lead if the email already exists in it. The email address is required and identifies the lead. First name, last name, company name, phone, LinkedIn URL, and any custom variables you pass are stored on the lead and available as merge variables in the campaign's messages.
   * @route POST /campaigns/{campaignId}/leads/{email}
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign to add the lead to. Search and select a campaign, or enter its identifier directly."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The lead's email address. Identifies the lead within the campaign."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The lead's first name. Available as the {{firstName}} merge variable."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The lead's last name. Available as the {{lastName}} merge variable."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"The lead's company name. Available as the {{companyName}} merge variable."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The lead's phone number."}
   * @paramDef {"type":"String","label":"LinkedIn URL","name":"linkedinUrl","description":"The lead's LinkedIn profile URL."}
   * @paramDef {"type":"Object","label":"Custom Variables","name":"customFields","description":"Additional custom merge variables to store on the lead, as key/value pairs (e.g. {\"icebreaker\":\"Loved your talk\"})."}
   * @paramDef {"type":"Boolean","label":"Deduplicate","name":"deduplicate","uiComponent":{"type":"CHECKBOX"},"description":"When true, skips the lead if the email already exists in any campaign. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"_id":"lea_9ZyX8765","email":"jane@acme.com","firstName":"Jane","lastName":"Doe","companyName":"Acme","campaignId":"cam_aBcD1234","isPaused":false}
   */
  async addLeadToCampaign(campaignId, email, firstName, lastName, companyName, phone, linkedinUrl, customFields, deduplicate) {
    const logTag = '[addLeadToCampaign]'

    const body = clean({
      firstName,
      lastName,
      companyName,
      phone,
      linkedinUrl,
      ...(customFields || {}),
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/campaigns/${ encodeURIComponent(campaignId) }/leads/${ encodeURIComponent(email) }`,
      method: 'post',
      query: {
        deduplicate: deduplicate ? 'true' : undefined,
      },
      body,
    })
  }

  /**
   * @operationName Get Lead
   * @category Leads
   * @description Retrieves a lead by email address, including its stored variables, campaign association, and current sequence state. Returns the lead as it exists across your team.
   * @route GET /leads/{email}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address of the lead to retrieve."}
   * @returns {Object}
   * @sampleResult {"_id":"lea_9ZyX8765","email":"jane@acme.com","firstName":"Jane","lastName":"Doe","companyName":"Acme","campaignId":"cam_aBcD1234","isPaused":false}
   */
  async getLead(email) {
    const logTag = '[getLead]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/leads/${ encodeURIComponent(email) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Lead
   * @category Leads
   * @description Updates an existing lead in a campaign, identified by email. Only the fields you provide are changed; omitted fields are left as-is. Use this to correct lead details or refresh custom merge variables before or during a sequence.
   * @route PATCH /campaigns/{campaignId}/leads/{email}
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign that contains the lead. Search and select a campaign, or enter its identifier directly."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address identifying the lead to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Updated first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Updated last name."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Updated company name."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number."}
   * @paramDef {"type":"String","label":"LinkedIn URL","name":"linkedinUrl","description":"Updated LinkedIn profile URL."}
   * @paramDef {"type":"Object","label":"Custom Variables","name":"customFields","description":"Custom merge variables to set or overwrite, as key/value pairs."}
   * @returns {Object}
   * @sampleResult {"_id":"lea_9ZyX8765","email":"jane@acme.com","firstName":"Jane","lastName":"Smith","companyName":"Acme","campaignId":"cam_aBcD1234"}
   */
  async updateLead(campaignId, email, firstName, lastName, companyName, phone, linkedinUrl, customFields) {
    const logTag = '[updateLead]'

    const body = clean({
      firstName,
      lastName,
      companyName,
      phone,
      linkedinUrl,
      ...(customFields || {}),
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/campaigns/${ encodeURIComponent(campaignId) }/leads/${ encodeURIComponent(email) }`,
      method: 'patch',
      body,
    })
  }

  /**
   * @operationName Delete Lead from Campaign
   * @category Leads
   * @description Removes a lead from a campaign by email address. The lead stops receiving that campaign's sequence. This does not add the address to your unsubscribe list; use Add to Unsubscribes for that.
   * @route DELETE /campaigns/{campaignId}/leads/{email}
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign to remove the lead from. Search and select a campaign, or enter its identifier directly."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address of the lead to remove."}
   * @returns {Object}
   * @sampleResult {"_id":"lea_9ZyX8765","email":"jane@acme.com","campaignId":"cam_aBcD1234","deleted":true}
   */
  async deleteLeadFromCampaign(campaignId, email) {
    const logTag = '[deleteLeadFromCampaign]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/campaigns/${ encodeURIComponent(campaignId) }/leads/${ encodeURIComponent(email) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Unsubscribe Lead
   * @category Leads
   * @description Marks a lead as unsubscribed within a specific campaign, stopping further messages to that lead in that campaign. To block an address across all campaigns, use Add to Unsubscribes instead.
   * @route POST /campaigns/{campaignId}/leads/{email}/unsubscribe
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign containing the lead. Search and select a campaign, or enter its identifier directly."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address of the lead to unsubscribe."}
   * @returns {Object}
   * @sampleResult {"_id":"lea_9ZyX8765","email":"jane@acme.com","campaignId":"cam_aBcD1234","unsubscribed":true}
   */
  async unsubscribeLead(campaignId, email) {
    const logTag = '[unsubscribeLead]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/campaigns/${ encodeURIComponent(campaignId) }/leads/${ encodeURIComponent(email) }/unsubscribe`,
      method: 'post',
    })
  }

  /**
   * @operationName Mark Lead as Interested
   * @category Leads
   * @description Marks a lead in a campaign as interested. This updates the lead's status for reporting and can pause automated follow-ups so you can take over the conversation manually.
   * @route POST /campaigns/{campaignId}/leads/{email}/interested
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign containing the lead. Search and select a campaign, or enter its identifier directly."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address of the lead to mark as interested."}
   * @returns {Object}
   * @sampleResult {"_id":"lea_9ZyX8765","email":"jane@acme.com","campaignId":"cam_aBcD1234","interested":true}
   */
  async markLeadInterested(campaignId, email) {
    const logTag = '[markLeadInterested]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/campaigns/${ encodeURIComponent(campaignId) }/leads/${ encodeURIComponent(email) }/interested`,
      method: 'post',
    })
  }

  /**
   * @operationName Mark Lead as Not Interested
   * @category Leads
   * @description Marks a lead in a campaign as not interested. This updates the lead's status for reporting and typically stops further automated messages to that lead in the campaign.
   * @route POST /campaigns/{campaignId}/leads/{email}/notinterested
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign containing the lead. Search and select a campaign, or enter its identifier directly."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address of the lead to mark as not interested."}
   * @returns {Object}
   * @sampleResult {"_id":"lea_9ZyX8765","email":"jane@acme.com","campaignId":"cam_aBcD1234","interested":false}
   */
  async markLeadNotInterested(campaignId, email) {
    const logTag = '[markLeadNotInterested]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/campaigns/${ encodeURIComponent(campaignId) }/leads/${ encodeURIComponent(email) }/notinterested`,
      method: 'post',
    })
  }

  /**
   * @operationName Get Activities
   * @category Activities
   * @description Retrieves activity events from your Lemlist team, such as emails sent, opened, clicked, replied, bounced, and unsubscribes. Filter by activity type and/or campaign, and page through results with limit and offset. Use this to build engagement timelines or sync events into other systems.
   * @route GET /activities
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Email Sent","Email Opened","Email Clicked","Email Replied","Email Bounced","Email Send Failed","Email Unsubscribed","Email Interested","Email Not Interested","LinkedIn Sent","Aircall Ended"]}},"description":"Filter activities by type. Leave empty to return all activity types."}
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","dictionary":"getCampaignsDictionary","description":"Optional campaign to filter activities by. Search and select a campaign, or enter its identifier directly."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of activities to return (1-100). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of activities to skip for pagination. Defaults to 0."}
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"act_112233","type":"emailsOpened","campaignId":"cam_aBcD1234","leadEmail":"jane@acme.com","createdAt":"2026-02-01T14:22:00.000Z"}]
   */
  async getActivities(type, campaignId, limit, offset) {
    const logTag = '[getActivities]'

    const resolvedType = this.#resolveChoice(type, {
      'Email Sent': 'emailsSent',
      'Email Opened': 'emailsOpened',
      'Email Clicked': 'emailsClicked',
      'Email Replied': 'emailsReplied',
      'Email Bounced': 'emailsBounced',
      'Email Send Failed': 'emailsSendFailed',
      'Email Unsubscribed': 'emailsUnsubscribed',
      'Email Interested': 'emailsInterested',
      'Email Not Interested': 'emailsNotInterested',
      'LinkedIn Sent': 'linkedinSent',
      'Aircall Ended': 'aircallEnded',
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/activities`,
      method: 'get',
      query: {
        type: resolvedType,
        campaignId,
        limit: limit || DEFAULT_LIMIT,
        offset,
      },
    })
  }

  /**
   * @operationName List Unsubscribes
   * @category Unsubscribes
   * @description Lists the email addresses on your team's unsubscribe (blocklist) list. Addresses on this list are excluded from all campaigns. Supports limit/offset pagination.
   * @route GET /unsubscribes
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return (1-100). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination. Defaults to 0."}
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"uns_445566","email":"optout@example.com","createdAt":"2026-01-20T08:00:00.000Z"}]
   */
  async listUnsubscribes(limit, offset) {
    const logTag = '[listUnsubscribes]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/unsubscribes`,
      method: 'get',
      query: {
        limit: limit || DEFAULT_LIMIT,
        offset,
      },
    })
  }

  /**
   * @operationName Add to Unsubscribes
   * @category Unsubscribes
   * @description Adds an email address to your team's unsubscribe (blocklist) list. The address is excluded from all current and future campaigns across the team. Use this to honor opt-out requests globally.
   * @route POST /unsubscribes/{email}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address to add to the unsubscribe list."}
   * @returns {Object}
   * @sampleResult {"_id":"uns_445566","email":"optout@example.com","createdAt":"2026-02-01T08:00:00.000Z"}
   */
  async addUnsubscribe(email) {
    const logTag = '[addUnsubscribe]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/unsubscribes/${ encodeURIComponent(email) }`,
      method: 'post',
    })
  }

  /**
   * @operationName Delete from Unsubscribes
   * @category Unsubscribes
   * @description Removes an email address from your team's unsubscribe (blocklist) list, allowing it to be contacted by campaigns again. Use with care and only when you have a valid basis to re-engage the address.
   * @route DELETE /unsubscribes/{email}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address to remove from the unsubscribe list."}
   * @returns {Object}
   * @sampleResult {"_id":"uns_445566","email":"optout@example.com","deleted":true}
   */
  async deleteUnsubscribe(email) {
    const logTag = '[deleteUnsubscribe]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/unsubscribes/${ encodeURIComponent(email) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Get Team
   * @category Team
   * @description Retrieves your Lemlist team information, including team name, plan, sending limits, connected senders, and remaining credits. Useful as a connection check to confirm the API key is valid and to inspect available sending capacity.
   * @route GET /team
   * @returns {Object}
   * @sampleResult {"_id":"tea_778899","name":"Acme Growth","userIds":["usr_1","usr_2"],"beginningOfMonth":"2026-02-01","emailsSentCount":420,"maxEmailsPerDay":300}
   */
  async getTeam() {
    const logTag = '[getTeam]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/team`,
      method: 'get',
    })
  }

  // Maps a friendly dropdown label to its API value. Returns the input unchanged
  // when it is not a known label (so free-typed values still pass through).
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @typedef {Object} getCampaignsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter campaigns by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Campaigns Dictionary
   * @description Provides a searchable, paginated list of campaigns for selecting a campaign in dependent parameters. The option value is the campaign identifier expected by campaign and lead operations.
   * @route POST /get-campaigns-dictionary
   * @paramDef {"type":"getCampaignsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor used to list campaigns."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Q3 Outbound","value":"cam_aBcD1234","note":"running"}],"cursor":"100"}
   */
  async getCampaignsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getCampaignsDictionary]'

    const offset = cursor ? parseInt(cursor, 10) || 0 : 0
    const limit = DEFAULT_LIMIT

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/campaigns`,
      method: 'get',
      query: { offset, limit },
    })

    const campaigns = Array.isArray(response) ? response : (response?.campaigns || [])

    const term = (search || '').trim().toLowerCase()
    const filtered = term
      ? campaigns.filter(campaign => (campaign.name || '').toLowerCase().includes(term))
      : campaigns

    const items = filtered.map(campaign => ({
      label: campaign.name || campaign._id,
      value: campaign._id,
      note: campaign.status || undefined,
    }))

    const nextCursor = campaigns.length === limit ? String(offset + limit) : undefined

    return { items, cursor: nextCursor }
  }
}

Flowrunner.ServerCode.addService(LemlistService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Lemlist API key. Generate it in Lemlist under Settings > Integrations > API > generate an API key.',
  },
])
