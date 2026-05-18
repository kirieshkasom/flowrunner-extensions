const API_BASE_URL = 'https://api.instantly.ai/api/v2'

const logger = {
  info: (...args) => console.log('[Instantly Service] info:', ...args),
  debug: (...args) => console.log('[Instantly Service] debug:', ...args),
  error: (...args) => console.log('[Instantly Service] error:', ...args),
  warn: (...args) => console.log('[Instantly Service] warn:', ...args),
}

/**
 * @integrationName Instantly
 * @integrationIcon /icon.png
 * @integrationTriggersScope ALL_APPS
 */
class Instantly {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  /**
   * @param {Object} obj - Object to clean
   * @returns {Object}
   */
  #clean(obj) {
    if (!obj) return undefined
    const newObj = {}

    for (const propName in obj) {
      if (obj[propName] !== null && obj[propName] !== undefined) {
        newObj[propName] = obj[propName]
      }
    }

    return Object.keys(newObj).length > 0 ? newObj : undefined
  }

  /**
   * Map between plain English event types (UI) and snake_case (API)
   * @param {String} eventType - Event type in either format
   * @param {String} direction - 'toApi' or 'toUi'
   * @returns {String}
   */
  #mapEventType(eventType, direction = 'toApi') {
    const eventMap = {
      'Account Error': 'account_error',
      'Auto Reply Received': 'auto_reply_received',
      'Campaign Completed': 'campaign_completed',
      'Email Bounced': 'email_bounced',
      'Email Opened': 'email_opened',
      'Email Sent': 'email_sent',
      'Lead Closed': 'lead_closed',
      'Lead Interested': 'lead_interested',
      'Lead Meeting Booked': 'lead_meeting_booked',
      'Lead Meeting Completed': 'lead_meeting_completed',
      'Lead Neutral': 'lead_neutral',
      'Lead Not Interested': 'lead_not_interested',
      'Lead Out Of Office': 'lead_out_of_office',
      'Lead Unsubscribed': 'lead_unsubscribed',
      'Lead Wrong Person': 'lead_wrong_person',
      'Link Clicked': 'link_clicked',
      'Reply Received': 'reply_received',
    }

    if (direction === 'toApi') {
      return eventMap[eventType] || eventType
    } else {
      // toUi - reverse lookup
      const entry = Object.entries(eventMap).find(([, val]) => val === eventType)

      return entry ? entry[0] : eventType
    }
  }

  /**
   * @param {Array} list - List to filter
   * @param {Array} props - Properties to search in
   * @param {String} searchString - Search term
   * @returns {Array}
   */
  #searchFilter(list, props, searchString) {
    if (!searchString) return list

    return list.filter(item =>
      props.some(prop => {
        const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

        return value && String(value).toLowerCase().includes(searchString.toLowerCase())
      })
    )
  }

  /**
   * @param {Number} cursor - Current cursor
   * @param {Number} total - Total items
   * @param {Number} limit - Items per page
   * @returns {Number|null}
   */
  #getCursor(cursor = 0, total, limit) {
    return cursor < total - limit ? cursor + limit : null
  }

  /**
   * @param {Object} params - Request parameters
   * @param {String} params.url - Request URL
   * @param {String} [params.method='get'] - HTTP method
   * @param {Object} [params.body] - Request body
   * @param {Object} [params.query] - Query parameters
   * @param {String} params.logTag - Log tag for debugging
   * @returns {Object}
   */
  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = this.#clean(query)
    body = this.#clean(body)

    try {
      logger.debug(`[${ logTag }] API Request: [${ method.toUpperCase() }::${ url }]`)

      // For POST/PATCH/PUT, send {} if body is undefined (Instantly API requires object)
      // For GET, send undefined (no body)
      const requestBody = (method === 'post' || method === 'patch' || method === 'put') && !body ? {} : body

      return await Flowrunner.Request[method](url)
        .set({ Authorization: `Bearer ${ this.apiKey }` })
        .query(query)
        .send(requestBody)

    } catch (error) {
      logger.error(`[${ logTag }] API Error: ${ error.message }`)
      throw error
    }
  }

  /**
   * Special DELETE request handler for Instantly API
   * Instantly's API rejects DELETE requests with body ("body must be null")
   * This is non-standard behavior - most APIs accept body in DELETE requests
   * @param {Object} params - Request parameters
   * @param {String} params.url - Request URL
   * @param {Object} [params.query] - Query parameters
   * @param {String} params.logTag - Log tag for debugging
   * @returns {Object}
   */
  async #apiRequestDelete({ url, query, logTag }) {
    query = this.#clean(query)

    try {
      logger.debug(`[${ logTag }] API Request: [DELETE::${ url }]`)

      return await Flowrunner.Request.delete(url)
        .set({
          Authorization: `Bearer ${ this.apiKey }`,
        })
        .query(query)

    } catch (error) {
      logger.error(`[${ logTag }] API Error: ${ error.message }`)

      throw error
    }
  }

  /**
   * @operationName Add Tags to Campaigns
   * @category Tags
   * @description Add tags to one or more campaigns in your Instantly workspace. Tags help organize and categorize campaigns for better filtering and management.
   * @route POST /add-tags-to-campaigns
   *
   * @paramDef {"type":"Array<String>","label":"Campaigns","name":"campaignIds","required":true,"description":"List of campaign IDs to add tags to.","dictionary":"getCampaignsDict"}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tagIds","required":true,"description":"List of tag IDs to assign to the campaigns.","dictionary":"getTagsDict"}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Tags added to campaigns successfully"}
   */
  async addTagsToCampaigns(campaignIds, tagIds) {
    try {
      logger.debug('[addTagsToCampaigns] Starting with campaignIds:', campaignIds, 'tagIds:', tagIds)

      if (!campaignIds || campaignIds.length === 0) {
        throw new Error('Campaign IDs are required')
      }

      if (!tagIds || tagIds.length === 0) {
        throw new Error('Tag IDs are required')
      }

      const response = await this.#apiRequest({
        logTag: 'addTagsToCampaigns',
        method: 'post',
        url: `${ API_BASE_URL }/custom-tags/toggle-resource`,
        body: {
          resource_type: 2, // 2 = campaign
          resource_ids: campaignIds,
          tag_ids: tagIds,
          assign: true,
        },
      })

      logger.debug('[addTagsToCampaigns] Tags added successfully')

      return { success: true, message: 'Tags added to campaigns successfully', data: response }

    } catch (error) {
      logger.error('[addTagsToCampaigns] Error:', error.message)
      throw new Error(`Failed to add tags to campaigns: ${ error.message }`)
    }
  }

  /**
   * @operationName Remove Tags From Campaigns
   * @category Tags
   * @description Remove tags from one or more campaigns in your Instantly workspace. This helps maintain clean campaign organization by removing outdated or unnecessary tags.
   * @route POST /remove-tags-from"type":"Array<String>","label":"Campaigns","name":"campaignIds","required":true,"description":"List of campaign IDs to remove tags from.","dictionary":"getCampaignsDict"}paign IDs to remove tags from."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tagIds","required":true,"description":"List of tag IDs to remove from the campaigns.","dictionary":"getTagsDict"}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Tags removed from campaigns successfully"}
   */
  async removeTagsFromCampaigns(campaignIds, tagIds) {
    try {
      logger.debug('[removeTagsFromCampaigns] Starting with campaignIds:', campaignIds, 'tagIds:', tagIds)

      if (!campaignIds || campaignIds.length === 0) {
        throw new Error('Campaign IDs are required')
      }

      if (!tagIds || tagIds.length === 0) {
        throw new Error('Tag IDs are required')
      }

      const response = await this.#apiRequest({
        logTag: 'removeTagsFromCampaigns',
        method: 'post',
        url: `${ API_BASE_URL }/custom-tags/toggle-resource`,
        body: {
          resource_type: 2, // 2 = campaign
          resource_ids: campaignIds,
          tag_ids: tagIds,
          assign: false,
        },
      })

      logger.debug('[removeTagsFromCampaigns] Tags removed successfully')

      return { success: true, message: 'Tags removed from campaigns successfully', data: response }

    } catch (error) {
      logger.error('[removeTagsFromCampaigns] Error:', error.message)
      throw new Error(`Failed to remove tags from campaigns: ${ error.message }`)
    }
  }

  /**
   * @operationName Add Lead to Campaign
   * @category Campaigns
   * @description Add a lead to a campaign in your Instantly workspace. This moves or adds a lead to the specified campaign for outreach sequences. Lead IDs must be in UUID format (e.g., "01996da2-2642-7217-9b78-c20b687ade51"). Use the Find Lead action to retrieve proper lead IDs.
   * @route POST /add-lead-to-campaign
   *
   * @paramDef {"type":"Array<String>","label":"Leads","name":"leadIds","required":true,"description":"List of lead UUIDs to add to the campaign. Use Find Lead action to get valid lead IDs (format: 01996da2-2642-7217-9b78-c20b687ade51).","dictionary":"getLeadsDict"}
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDict","description":"The campaign where leads will be added."}
   * @paramDef {"type":"Boolean","label":"Check Duplicates","name":"checkDuplicates","uiComponent":{"type":"TOGGLE"},"description":"Skip leads if they already exist in the campaign."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Leads added to campaign successfully","added_count":5}
   */
  async addLeadToCampaign(leadIds, campaignId, checkDuplicates) {
    try {
      logger.debug('[addLeadToCampaign] Starting with leadIds:', leadIds, 'campaignId:', campaignId)

      if (!leadIds || leadIds.length === 0) {
        throw new Error('Lead IDs are required')
      }

      if (!campaignId) {
        throw new Error('Campaign ID is required')
      }

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

      for (const leadId of leadIds) {
        if (!uuidRegex.test(leadId)) {
          throw new Error(`Invalid lead ID format: "${ leadId }". Lead IDs must be UUIDs (e.g., "01996da2-2642-7217-9b78-c20b687ade51"). Use the Find Lead action to get valid lead IDs.`)
        }
      }

      if (!uuidRegex.test(campaignId)) {
        throw new Error(`Invalid campaign ID format: "${ campaignId }". Campaign ID must be a UUID.`)
      }

      const response = await this.#apiRequest({
        logTag: 'addLeadToCampaign',
        method: 'post',
        url: `${ API_BASE_URL }/leads/move`,
        body: {
          ids: leadIds,
          to_campaign_id: campaignId,
          check_duplicates_in_campaigns: checkDuplicates || false,
        },
      })

      logger.debug('[addLeadToCampaign] Leads added successfully')

      return { success: true, message: 'Leads added to campaign successfully', data: response }

    } catch (error) {
      logger.error('[addLeadToCampaign] Error:', error.message)
      throw new Error(`Failed to add leads to campaign: ${ error.message }`)
    }
  }

  /**
   * @operationName Delete Leads
   * @category Leads
   * @description Permanently delete leads from your Instantly workspace. This removes the lead records entirely, not just from a specific campaign. Use with caution as this action cannot be undone.
   * @route POST /delete-leads
   *
   * @paramDef {"type":"Array<String>","label":"Leads","name":"leadIds","required":true,"description":"List of lead UUIDs to delete permanently."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Leads deleted successfully","count":3}
   */
  async deleteLeads(leadIds) {
    try {
      logger.debug('[deleteLeads] Starting with leadIds:', leadIds)

      if (!leadIds || leadIds.length === 0) {
        throw new Error('Lead IDs are required')
      }

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

      for (const leadId of leadIds) {
        if (!uuidRegex.test(leadId)) {
          throw new Error(`Invalid lead ID format: "${ leadId }". Lead IDs must be UUIDs.`)
        }
      }

      // Delete each lead
      const results = []

      for (const leadId of leadIds) {
        const response = await this.#apiRequestDelete({
          logTag: 'deleteLeads',
          url: `${ API_BASE_URL }/leads/${ leadId }`,
        })

        results.push(response)
      }

      logger.debug('[deleteLeads] Leads deleted successfully')

      return { success: true, message: 'Leads deleted successfully', count: results.length, data: results }

    } catch (error) {
      logger.error('[deleteLeads] Error:', error.message)
      throw new Error(`Failed to delete leads: ${ error.message }`)
    }
  }

  /**
   * @operationName List Leads
   * @category Leads
   * @description Retrieve a paginated list of leads from your Instantly workspace with optional filtering. Returns detailed lead data including status, campaign associations, and contact information.
   * @route POST /list-leads
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","default":50,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of leads to return per page (1-100)."}
   * @paramDef {"type":"String","label":"Starting After","name":"startingAfter","description":"Pagination cursor - ID of the last lead from the previous page. Leave empty for the first page."}
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","dictionary":"getCampaignsDict","description":"Filter leads by campaign UUID."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["active","paused","completed","bounced","unsubscribed"]}},"description":"Filter leads by status."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"01996da2-2642-7217-9b78-c20b687ade51","email":"john@example.com","first_name":"John","last_name":"Doe","company_name":"Example Corp","status":"active"}],"next_starting_after":"01996da2-2642-7217-9b78-c20b687ade51"}
   */
  async listLeads(limit, startingAfter, campaignId, status) {
    try {
      logger.debug('[listLeads] Starting with limit:', limit, 'startingAfter:', startingAfter)

      const body = {}

      if (limit) {
        body.limit = Math.min(Math.max(limit, 1), 100) // Clamp between 1 and 100
      }

      if (startingAfter) {
        body.starting_after = startingAfter
      }

      const filters = {}

      if (campaignId) {
        filters.campaign_id = campaignId
      }

      if (status) {
        filters.status = status
      }

      if (Object.keys(filters).length > 0) {
        body.filters = filters
      }

      const response = await this.#apiRequest({
        logTag: 'listLeads',
        method: 'post',
        url: `${ API_BASE_URL }/leads/list`,
        body,
      })

      logger.debug('[listLeads] Leads retrieved successfully')

      return response

    } catch (error) {
      logger.error('[listLeads] Error:', error.message)
      throw new Error(`Failed to list leads: ${ error.message }`)
    }
  }

  /**
   * @operationName Find Lead
   * @category Leads
   * @description Find and retrieve lead information from your Instantly workspace by searching for email address or other criteria. Returns detailed lead data including status and campaign associations.
   * @route POST /find-lead
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address of the lead to find."}
   *
   * @returns {Object}
   * @sampleResult {"id":"01234567-89ab-cdef-0123-456789abcdef","email":"lead@example.com","first_name":"John","last_name":"Doe","company_name":"Example Corp","status":"active"}
   */
  async findLead(email) {
    try {
      logger.debug('[findLead] Starting with email:', email)

      if (!email) {
        throw new Error('Email is required')
      }

      const response = await this.#apiRequest({
        logTag: 'findLead',
        method: 'post',
        url: `${ API_BASE_URL }/leads/list`,
        body: {
          filters: {
            email: email,
          },
        },
      })

      logger.debug('[findLead] Lead search completed')

      // Instantly API returns {items: [...], next_starting_after: "..."}
      if (response.items && Array.isArray(response.items) && response.items.length > 0) {
        return response.items[0]
      }

      throw new Error(`No lead found with email: ${ email }`)

    } catch (error) {
      logger.error('[findLead] Error:', error.message)

      // Don't double-wrap the error message
      if (error.message.includes('No lead found')) {
        throw error
      }

      throw new Error(`Failed to find lead: ${ error.message }`)
    }
  }

  /**
   * @operationName Add Tags to Accounts
   * @category Tags
   * @description Add tags to one or more email accounts in your Instantly workspace. Tags help organize and categorize accounts for better filtering and management.
   * @route POST /add-tags-to-accounts
   *
   * @paramDef {"type":"Array<String>","label":"Account IDs","name":"accountIds","required":true,"description":"List of email account IDs to add tags to.","dictionary":"getAccountsDict"}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tagIds","required":true,"description":"List of tag IDs to assign to the accounts.","dictionary":"getTagsDict"}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Tags added to accounts successfully"}
   */
  async addTagsToAccounts(accountIds, tagIds) {
    try {
      logger.debug('[addTagsToAccounts] Starting with accountIds:', accountIds, 'tagIds:', tagIds)

      if (!accountIds || accountIds.length === 0) {
        throw new Error('Account IDs are required')
      }

      if (!tagIds || tagIds.length === 0) {
        throw new Error('Tag IDs are required')
      }

      const response = await this.#apiRequest({
        logTag: 'addTagsToAccounts',
        method: 'post',
        url: `${ API_BASE_URL }/custom-tags/toggle-resource`,
        body: {
          resource_type: 1, // 1 = account
          resource_ids: accountIds,
          tag_ids: tagIds,
          assign: true,
        },
      })

      logger.debug('[addTagsToAccounts] Tags added successfully')

      return { success: true, message: 'Tags added to accounts successfully', data: response }

    } catch (error) {
      logger.error('[addTagsToAccounts] Error:', error.message)
      throw new Error(`Failed to add tags to accounts: ${ error.message }`)
    }
  }

  /**
   * @operationName Remove Tags From Accounts
   * @category Tags
   * @description Remove tags from one or more email accounts in your Instantly workspace. This helps maintain clean account organization by removing outdated or unnecessary tags.
   * @route POST /remove-tags-from-accounts
   *
   * @paramDef {"type":"Array<String>","label":"Account IDs","name":"accountIds","required":true,"description":"List of email account IDs to remove tags from.","dictionary":"getAccountsDict"}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tagIds","required":true,"description":"List of tag IDs to remove from the accounts.","dictionary":"getTagsDict"}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Tags removed from accounts successfully"}
   */
  async removeTagsFromAccounts(accountIds, tagIds) {
    try {
      logger.debug('[removeTagsFromAccounts] Starting with accountIds:', accountIds, 'tagIds:', tagIds)

      if (!accountIds || accountIds.length === 0) {
        throw new Error('Account IDs are required')
      }

      if (!tagIds || tagIds.length === 0) {
        throw new Error('Tag IDs are required')
      }

      const response = await this.#apiRequest({
        logTag: 'removeTagsFromAccounts',
        method: 'post',
        url: `${ API_BASE_URL }/custom-tags/toggle-resource`,
        body: {
          resource_type: 1, // 1 = account
          resource_ids: accountIds,
          tag_ids: tagIds,
          assign: false,
        },
      })

      logger.debug('[removeTagsFromAccounts] Tags removed successfully')

      return { success: true, message: 'Tags removed from accounts successfully', data: response }

    } catch (error) {
      logger.error('[removeTagsFromAccounts] Error:', error.message)
      throw new Error(`Failed to remove tags from accounts: ${ error.message }`)
    }
  }

  /**
   * @operationName Add to Blocklist
   * @category Blocklist
   * @description Add email addresses or domains to the global blocklist in your Instantly workspace. Blocked emails will not receive any outreach and will be automatically filtered from campaigns.
   * @route POST /add-to-blocklist
   *
   * @paramDef {"type":"Array<String>","label":"Emails or Domains","name":"emailsOrDomains","required":true,"description":"List of email addresses or domains to add to the blocklist (e.g., 'spam@example.com' or 'example.com' to block entire domain)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Entries added to blocklist successfully","added_count":2}
   */
  async addToBlocklist(emailsOrDomains) {
    try {
      logger.debug('[addToBlocklist] Starting with emailsOrDomains:', emailsOrDomains)

      if (!emailsOrDomains || emailsOrDomains.length === 0) {
        throw new Error('At least one email or domain is required')
      }

      const results = []

      for (const entry of emailsOrDomains) {
        const response = await this.#apiRequest({
          logTag: 'addToBlocklist',
          method: 'post',
          url: `${ API_BASE_URL }/block-lists-entries`,
          body: {
            bl_value: entry,
          },
        })

        results.push(response)
      }

      logger.debug('[addToBlocklist] Entries added successfully')

      return {
        success: true,
        message: 'Entries added to blocklist successfully',
        added_count: results.length,
        data: results,
      }

    } catch (error) {
      logger.error('[addToBlocklist] Error:', error.message)
      throw new Error(`Failed to add to blocklist: ${ error.message }`)
    }
  }

  /**
   * @operationName Create a New Tag
   * @category Tags
   * @description Create a new custom tag in your Instantly workspace. Tags can be used to organize and categorize campaigns, accounts, and other resources for better filtering and management.
   * @route POST /create-tag
   *
   * @paramDef {"type":"String","label":"Tag Name","name":"tagName","required":true,"description":"The name/label of the new tag to create."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description explaining the purpose or usage of this tag."}
   *
   * @returns {Object}
   * @sampleResult {"id":"0199edb7-e363-7042-89c2-dc9adc8e54b3","label":"Important","description":"Used for marking important items","timestamp_created":"2025-10-16T15:51:15.555Z"}
   */
  async createTag(tagName, description) {
    try {
      logger.debug('[createTag] Starting with tagName:', tagName)

      if (!tagName) {
        throw new Error('Tag name is required')
      }

      const body = {
        label: tagName,
      }

      if (description) {
        body.description = description
      }

      const response = await this.#apiRequest({
        logTag: 'createTag',
        method: 'post',
        url: `${ API_BASE_URL }/custom-tags`,
        body,
      })

      logger.debug('[createTag] Tag created successfully')

      return response

    } catch (error) {
      logger.error('[createTag] Error:', error.message)
      throw new Error(`Failed to create tag: ${ error.message }`)
    }
  }

  /**
   * @operationName List Tags
   * @category Tags
   * @description List custom tags in your Instantly workspace with optional filtering and pagination.
   * @route POST /list-tags
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Maximum number of tags to return (default: 10, max: 100).","uiComponent":{"type":"NUMERIC"}}
   * @paramDef {"type":"String","label":"Starting After","name":"startingAfter","description":"Cursor for pagination. Use the next_starting_after value from the previous response."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search term for filtering tags by label."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"tag-123","label":"VIP","description":"VIP contacts","created_at":"2025-10-19T12:00:00Z"}],"next_starting_after":"cursor-abc"}
   */
  async listTags(limit, startingAfter, search) {
    try {
      logger.debug('[listTags] Starting')

      const query = {}

      if (limit) query.limit = limit
      if (startingAfter) query.starting_after = startingAfter
      if (search) query.search = search

      const response = await this.#apiRequest({
        logTag: 'listTags',
        method: 'get',
        url: `${ API_BASE_URL }/custom-tags`,
        query,
      })

      logger.debug('[listTags] Tags retrieved successfully')

      return {
        items: response.items || [],
        next_starting_after: response.next_starting_after || undefined,
      }

    } catch (error) {
      logger.error('[listTags] Error:', error.message)
      throw new Error(`Failed to list tags: ${ error.message }`)
    }
  }

  /**
 * @operationName Update Lead Status
 * @category Leads
 * @description Update the status of a lead in your Instantly workspace. This allows you to track the progress of leads through your outreach workflow and maintain accurate lead states.
 * @route POST /update-lead-status
 *
 * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"description":"The UUID of the lead to update."}
 * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["active","paused","completed","bounced","unsubscribed"]}},"description":"The new status for the lead."}
 *
 * @returns {Object}
 * @sampleResult {"success":true,"message":"Lead status updated successfully","lead_id":"01234567-89ab-cdef-0123-456789abcdef","status":"completed"}
 */
  async updateLeadStatus(leadId, status) {
    try {
      logger.debug('[updateLeadStatus] Starting with leadId:', leadId, 'status:', status)

      if (!leadId) {
        throw new Error('Lead ID is required')
      }

      if (!status) {
        throw new Error('Status is required')
      }

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

      if (!uuidRegex.test(leadId)) {
        throw new Error(`Invalid lead ID format: "${ leadId }". Lead ID must be a UUID.`)
      }

      const response = await this.#apiRequest({
        logTag: 'updateLeadStatus',
        method: 'patch',
        url: `${ API_BASE_URL }/leads/${ leadId }`,
        body: {
          status: status,
        },
      })

      logger.debug('[updateLeadStatus] Lead status updated successfully')

      return {
        success: true,
        message: 'Lead status updated successfully',
        lead_id: leadId,
        status: status,
        data: response,
      }

    } catch (error) {
      logger.error('[updateLeadStatus] Error:', error.message)
      throw new Error(`Failed to update lead status: ${ error.message }`)
    }
  }

  /**
   * @operationName List Accounts
   * @category Accounts
   * @description Retrieve a paginated list of email accounts from your Instantly workspace. Filter by status, provider, tags, or search for specific accounts.
   * @route POST /list-accounts
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","default":50,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of accounts to return per page (1-100)."}
   * @paramDef {"type":"String","label":"Starting After","name":"startingAfter","description":"Pagination cursor - ID of the last account from the previous page."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search term to filter accounts by email or name."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Paused","Connection Error","Soft Bounce Error","Sending Error"]}},"description":"Filter accounts by status."}
   * @paramDef {"type":"String","label":"Provider","name":"provider","uiComponent":{"type":"DROPDOWN","options":{"values":["Custom IMAP/SMTP","Google","Microsoft","AWS"]}},"description":"Filter by email provider."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Filter by tags. Returns accounts with any of the specified tags.","dictionary":"getTagsDict"}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"email":"sender@example.com","first_name":"John","last_name":"Doe","status":1,"provider_code":2,"daily_limit":50}],"next_starting_after":"abc123"}
   */
  async listAccounts(limit, startingAfter, search, status, provider, tags) {
    try {
      logger.debug('[listAccounts] Starting with limit:', limit)

      const query = {}

      if (limit) {
        query.limit = Math.min(Math.max(limit, 1), 100)
      }

      if (startingAfter) {
        query.starting_after = startingAfter
      }

      if (search) {
        query.search = search
      }

      // Map status string to number
      if (status) {
        const statusMap = {
          'Active': 1,
          'Paused': 2,
          'Connection Error': -1,
          'Soft Bounce Error': -2,
          'Sending Error': -3,
        }
        query.status = statusMap[status]
      }

      // Map provider string to number
      if (provider) {
        const providerMap = {
          'Custom IMAP/SMTP': 1,
          'Google': 2,
          'Microsoft': 3,
          'AWS': 4,
        }
        query.provider_code = providerMap[provider]
      }

      // Convert tags array to comma-separated string
      if (tags && tags.length > 0) {
        query.tag_ids = tags.join(',')
      }

      const response = await this.#apiRequest({
        logTag: 'listAccounts',
        method: 'get',
        url: `${ API_BASE_URL }/accounts`,
        query,
      })

      logger.debug('[listAccounts] Accounts retrieved successfully')

      return response

    } catch (error) {
      logger.error('[listAccounts] Error:', error.message)
      throw new Error(`Failed to list accounts: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Account
   * @category Accounts
   * @description Retrieve detailed information about a specific email account in your Instantly workspace by its email address.
   * @route POST /get-account
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"dictionary":"getAccountsDict","description":"The email address of the account to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"email":"sender@example.com","first_name":"John","last_name":"Doe","status":1,"provider_code":1,"daily_limit":50,"warmup":{"enabled":true,"limit":30}}
   */
  async getAccount(email) {
    try {
      logger.debug('[getAccount] Starting with email:', email)

      if (!email) {
        throw new Error('Email is required')
      }

      const response = await this.#apiRequest({
        logTag: 'getAccount',
        method: 'get',
        url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(email) }`,
      })

      logger.debug('[getAccount] Account retrieved successfully')

      return response

    } catch (error) {
      logger.error('[getAccount] Error:', error.message)
      throw new Error(`Failed to get account: ${ error.message }`)
    }
  }

  /**
   * @operationName Pause Account
   * @category Accounts
   * @description Pause an email account to temporarily stop all sending activity. The account will not send any emails until resumed.
   * @route POST /pause-account
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"dictionary":"getAccountsDict","description":"The email address of the account to pause."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Account paused successfully"}
   */
  async pauseAccount(email) {
    try {
      logger.debug('[pauseAccount] Pausing account:', email)

      if (!email) {
        throw new Error('Email is required')
      }

      const response = await this.#apiRequest({
        logTag: 'pauseAccount',
        method: 'post',
        url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(email) }/pause`,
      })

      logger.debug('[pauseAccount] Account paused successfully')

      return { success: true, message: 'Account paused successfully', data: response }

    } catch (error) {
      logger.error('[pauseAccount] Error:', error.message)
      throw new Error(`Failed to pause account: ${ error.message }`)
    }
  }

  /**
   * @operationName Resume Account
   * @category Accounts
   * @description Resume a paused email account to restart sending activity. The account will resume normal operations.
   * @route POST /resume-account
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"dictionary":"getAccountsDict","description":"The email address of the account to resume."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Account resumed successfully"}
   */
  async resumeAccount(email) {
    try {
      logger.debug('[resumeAccount] Resuming account:', email)

      if (!email) {
        throw new Error('Email is required')
      }

      const response = await this.#apiRequest({
        logTag: 'resumeAccount',
        method: 'post',
        url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(email) }/resume`,
      })

      logger.debug('[resumeAccount] Account resumed successfully')

      return { success: true, message: 'Account resumed successfully', data: response }

    } catch (error) {
      logger.error('[resumeAccount] Error:', error.message)
      throw new Error(`Failed to resume account: ${ error.message }`)
    }
  }

  /**
   * @operationName Mark Account Fixed
   * @category Accounts
   * @description Mark an email account as fixed after resolving issues. This updates the account status to indicate problems have been resolved.
   * @route POST /mark-account-fixed
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"dictionary":"getAccountsDict","description":"The email address of the account to mark as fixed."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Account marked as fixed successfully"}
   */
  async markAccountFixed(email) {
    try {
      logger.debug('[markAccountFixed] Marking account as fixed:', email)

      if (!email) {
        throw new Error('Email is required')
      }

      const response = await this.#apiRequest({
        logTag: 'markAccountFixed',
        method: 'post',
        url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(email) }/mark-fixed`,
      })

      logger.debug('[markAccountFixed] Account marked as fixed successfully')

      return { success: true, message: 'Account marked as fixed successfully', data: response }

    } catch (error) {
      logger.error('[markAccountFixed] Error:', error.message)
      throw new Error(`Failed to mark account as fixed: ${ error.message }`)
    }
  }

  /**
   * @operationName Create Account
   * @category Accounts
   * @description Create a new email account in your Instantly workspace with SMTP/IMAP settings. Configure warmup, daily limits, and tracking domains.
   * @route POST /create-account
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the account."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"First name associated with the account."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Last name associated with the account."}
   * @paramDef {"type":"String","label":"Provider","name":"provider","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Custom IMAP/SMTP","Google","Microsoft","AWS"]}},"description":"Email provider for the account."}
   * @paramDef {"type":"Object","label":"IMAP Settings","name":"imapSettings","required":true,"schemaLoader":"createImapSettingsSchemaLoader","description":"IMAP configuration for receiving emails."}
   * @paramDef {"type":"Object","label":"SMTP Settings","name":"smtpSettings","required":true,"schemaLoader":"createSmtpSettingsSchemaLoader","description":"SMTP configuration for sending emails."}
   * @paramDef {"type":"Number","label":"Daily Sending Limit","name":"dailyLimit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Daily email sending limit for this account."}
   * @paramDef {"type":"Number","label":"Sending Gap (minutes)","name":"sendingGap","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Gap between emails in minutes (minimum wait time with multiple campaigns)."}
   * @paramDef {"type":"String","label":"Reply-To Email","name":"replyTo","description":"Reply-to email address if different from sender."}
   * @paramDef {"type":"Boolean","label":"Enable Slow Ramp","name":"enableSlowRamp","uiComponent":{"type":"TOGGLE"},"description":"Enable slow ramp up for sending limits."}
   * @paramDef {"type":"Number","label":"Inbox Placement Test Limit","name":"inboxPlacementTestLimit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limit for inbox placement tests."}
   * @paramDef {"type":"Boolean","label":"Skip CNAME Check","name":"skipCnameCheck","uiComponent":{"type":"TOGGLE"},"description":"Skip CNAME verification for tracking domain."}
   * @paramDef {"type":"String","label":"Tracking Domain Name","name":"trackingDomainName","description":"Custom tracking domain for this account."}
   * @paramDef {"type":"Object","label":"Warmup Settings","name":"warmupSettings","schemaLoader":"createWarmupSettingsSchemaLoader","description":"Warmup configuration for gradually increasing sending volume."}
   *
   * @returns {Object}
   * @sampleResult {"email":"sender@example.com","first_name":"John","last_name":"Doe","status":1,"provider_code":2}
   */
  async createAccount(email, firstName, lastName, provider, imapSettings, smtpSettings, dailyLimit, sendingGap, replyTo, enableSlowRamp, inboxPlacementTestLimit, skipCnameCheck, trackingDomainName, warmupSettings) {
    try {
      logger.debug('[createAccount] Creating account:', email)

      if (!email || !firstName || !lastName || !provider) {
        throw new Error('Email, first name, last name, and provider are required')
      }

      if (!imapSettings || !imapSettings.imapUsername || !imapSettings.imapPassword || !imapSettings.imapHost || !imapSettings.imapPort) {
        throw new Error('IMAP settings are required (username, password, host, port)')
      }

      if (!smtpSettings || !smtpSettings.smtpUsername || !smtpSettings.smtpPassword || !smtpSettings.smtpHost || !smtpSettings.smtpPort) {
        throw new Error('SMTP settings are required (username, password, host, port)')
      }

      // Map provider string to provider_code number
      const providerMap = {
        'Custom IMAP/SMTP': 1,
        'Google': 2,
        'Microsoft': 3,
        'AWS': 4,
      }
      const providerCode = providerMap[provider]

      if (!providerCode) {
        throw new Error(`Invalid provider: ${ provider }. Must be one of: Custom IMAP/SMTP, Google, Microsoft, AWS`)
      }

      const body = {
        email,
        first_name: firstName,
        last_name: lastName,
        provider_code: providerCode,
        imap_username: imapSettings.imapUsername,
        imap_password: imapSettings.imapPassword,
        imap_host: imapSettings.imapHost,
        imap_port: imapSettings.imapPort,
        smtp_username: smtpSettings.smtpUsername,
        smtp_password: smtpSettings.smtpPassword,
        smtp_host: smtpSettings.smtpHost,
        smtp_port: smtpSettings.smtpPort,
      }

      // Add optional fields
      if (dailyLimit !== null && dailyLimit !== undefined) {
        body.daily_limit = dailyLimit
      }

      if (sendingGap !== null && sendingGap !== undefined) {
        body.sending_gap = sendingGap
      }

      if (replyTo) {
        body.reply_to = replyTo
      }

      if (enableSlowRamp !== null && enableSlowRamp !== undefined) {
        body.enable_slow_ramp = enableSlowRamp
      }

      if (inboxPlacementTestLimit !== null && inboxPlacementTestLimit !== undefined) {
        body.inbox_placement_test_limit = inboxPlacementTestLimit
      }

      if (skipCnameCheck !== null && skipCnameCheck !== undefined) {
        body.skip_cname_check = skipCnameCheck
      }

      if (trackingDomainName) {
        body.tracking_domain_name = trackingDomainName
      }

      // Add warmup settings if provided
      if (warmupSettings && Object.keys(warmupSettings).length > 0) {
        body.warmup = { ...warmupSettings }
      }

      const response = await this.#apiRequest({
        logTag: 'createAccount',
        method: 'post',
        url: `${ API_BASE_URL }/accounts`,
        body,
      })

      logger.debug('[createAccount] Account created successfully')

      return response

    } catch (error) {
      logger.error('[createAccount] Error:', error.message)
      throw new Error(`Failed to create account: ${ error.message }`)
    }
  }

  /**
   * @operationName Update Account
   * @category Accounts
   * @description Update an existing email account's settings including name, limits, warmup configuration, and tracking domains.
   * @route POST /update-account
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"dictionary":"getAccountsDict","description":"The email address of the account to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"First name associated with the account."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Last name associated with the account."}
   * @paramDef {"type":"Number","label":"Daily Sending Limit","name":"dailyLimit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Daily email sending limit for this account."}
   * @paramDef {"type":"Number","label":"Sending Gap (minutes)","name":"sendingGap","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Gap between emails in minutes (minimum wait time with multiple campaigns)."}
   * @paramDef {"type":"Boolean","label":"Enable Slow Ramp","name":"enableSlowRamp","uiComponent":{"type":"TOGGLE"},"description":"Enable slow ramp up for sending limits."}
   * @paramDef {"type":"Number","label":"Inbox Placement Test Limit","name":"inboxPlacementTestLimit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limit for inbox placement tests."}
   * @paramDef {"type":"Boolean","label":"Skip CNAME Check","name":"skipCnameCheck","uiComponent":{"type":"TOGGLE"},"description":"Skip CNAME verification for tracking domain."}
   * @paramDef {"type":"String","label":"Tracking Domain Name","name":"trackingDomainName","description":"Custom tracking domain for this account."}
   * @paramDef {"type":"Boolean","label":"Remove Tracking Domain","name":"removeTrackingDomain","uiComponent":{"type":"TOGGLE"},"description":"Remove the tracking domain from this account."}
   * @paramDef {"type":"Object","label":"Warmup Settings","name":"warmupSettings","schemaLoader":"createWarmupSettingsSchemaLoader","description":"Warmup configuration for gradually increasing sending volume."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Account updated successfully"}
   */
  async updateAccount(email, firstName, lastName, dailyLimit, sendingGap, enableSlowRamp, inboxPlacementTestLimit, skipCnameCheck, trackingDomainName, removeTrackingDomain, warmupSettings) {
    try {
      logger.debug('[updateAccount] Updating account:', email)

      if (!email) {
        throw new Error('Email is required')
      }

      const body = {}

      if (firstName) {
        body.first_name = firstName
      }

      if (lastName) {
        body.last_name = lastName
      }

      if (dailyLimit !== null && dailyLimit !== undefined) {
        body.daily_limit = dailyLimit
      }

      if (sendingGap !== null && sendingGap !== undefined) {
        body.sending_gap = sendingGap
      }

      if (enableSlowRamp !== null && enableSlowRamp !== undefined) {
        body.enable_slow_ramp = enableSlowRamp
      }

      if (inboxPlacementTestLimit !== null && inboxPlacementTestLimit !== undefined) {
        body.inbox_placement_test_limit = inboxPlacementTestLimit
      }

      if (skipCnameCheck !== null && skipCnameCheck !== undefined) {
        body.skip_cname_check = skipCnameCheck
      }

      if (trackingDomainName) {
        body.tracking_domain_name = trackingDomainName
      }

      if (removeTrackingDomain !== null && removeTrackingDomain !== undefined) {
        body.remove_tracking_domain = removeTrackingDomain
      }

      // Add warmup settings if provided
      if (warmupSettings && Object.keys(warmupSettings).length > 0) {
        body.warmup = { ...warmupSettings }
      }

      const response = await this.#apiRequest({
        logTag: 'updateAccount',
        method: 'patch',
        url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(email) }`,
        body,
      })

      logger.debug('[updateAccount] Account updated successfully')

      return { success: true, message: 'Account updated successfully', data: response }

    } catch (error) {
      logger.error('[updateAccount] Error:', error.message)
      throw new Error(`Failed to update account: ${ error.message }`)
    }
  }

  /**
   * @operationName Delete Account
   * @category Accounts
   * @description Permanently delete an email account from your Instantly workspace. This action cannot be undone. Use with caution.
   * @route DELETE /delete-account
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"dictionary":"getAccountsDict","description":"The email address of the account to delete permanently."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Account deleted successfully"}
   */
  async deleteAccount(email) {
    try {
      logger.debug('[deleteAccount] Deleting account:', email)

      if (!email) {
        throw new Error('Email is required')
      }

      const response = await this.#apiRequestDelete({
        logTag: 'deleteAccount',
        url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(email) }`,
      })

      logger.debug('[deleteAccount] Account deleted successfully')

      return { success: true, message: 'Account deleted successfully', data: response }

    } catch (error) {
      logger.error('[deleteAccount] Error:', error.message)
      throw new Error(`Failed to delete account: ${ error.message }`)
    }
  }

  /**
   * @operationName Enable Warmup
   * @category Accounts
   * @description Enable email warmup for one or more accounts. Warmup gradually increases sending volume to build sender reputation.
   * @route POST /enable-warmup
   *
   * @paramDef {"type":"Array<String>","label":"Emails","name":"emails","description":"List of account email addresses to enable warmup for. Leave empty if using Include All Emails option.","dictionary":"getAccountsDict"}
   * @paramDef {"type":"Boolean","label":"Include All Emails","name":"includeAllEmails","uiComponent":{"type":"TOGGLE"},"description":"Enable warmup for all accounts in the workspace."}
   * @paramDef {"type":"Array<String>","label":"Excluded Emails","name":"excludedEmails","description":"List of account emails to exclude when Include All Emails is enabled.","dictionary":"getAccountsDict"}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Warmup enabled successfully"}
   */
  async enableWarmup(emails, includeAllEmails, excludedEmails) {
    try {
      logger.debug('[enableWarmup] Enabling warmup')

      const body = {}

      if (emails && emails.length > 0) {
        body.emails = emails
      }

      if (includeAllEmails) {
        body.include_all_emails = includeAllEmails
      }

      if (excludedEmails && excludedEmails.length > 0) {
        body.excluded_emails = excludedEmails
      }

      const response = await this.#apiRequest({
        logTag: 'enableWarmup',
        method: 'post',
        url: `${ API_BASE_URL }/accounts/warmup/enable`,
        body,
      })

      logger.debug('[enableWarmup] Warmup enabled successfully')

      return { success: true, message: 'Warmup enabled successfully', data: response }

    } catch (error) {
      logger.error('[enableWarmup] Error:', error.message)
      throw new Error(`Failed to enable warmup: ${ error.message }`)
    }
  }

  /**
   * @operationName Disable Warmup
   * @category Accounts
   * @description Disable email warmup for one or more accounts. Stops the gradual warmup process.
   * @route POST /disable-warmup
   *
   * @paramDef {"type":"Array<String>","label":"Emails","name":"emails","description":"List of account email addresses to disable warmup for. Leave empty if using Include All Emails option.","dictionary":"getAccountsDict"}
   * @paramDef {"type":"Boolean","label":"Include All Emails","name":"includeAllEmails","uiComponent":{"type":"TOGGLE"},"description":"Disable warmup for all accounts in the workspace."}
   * @paramDef {"type":"Array<String>","label":"Excluded Emails","name":"excludedEmails","description":"List of account emails to exclude when Include All Emails is enabled.","dictionary":"getAccountsDict"}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Warmup disabled successfully"}
   */
  async disableWarmup(emails, includeAllEmails, excludedEmails) {
    try {
      logger.debug('[disableWarmup] Disabling warmup')

      const body = {}

      if (emails && emails.length > 0) {
        body.emails = emails
      }

      if (includeAllEmails) {
        body.include_all_emails = includeAllEmails
      }

      if (excludedEmails && excludedEmails.length > 0) {
        body.excluded_emails = excludedEmails
      }

      const response = await this.#apiRequest({
        logTag: 'disableWarmup',
        method: 'post',
        url: `${ API_BASE_URL }/accounts/warmup/disable`,
        body,
      })

      logger.debug('[disableWarmup] Warmup disabled successfully')

      return { success: true, message: 'Warmup disabled successfully', data: response }

    } catch (error) {
      logger.error('[disableWarmup] Error:', error.message)
      throw new Error(`Failed to disable warmup: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Warmup Analytics
   * @category Accounts
   * @description Retrieve warmup analytics and statistics for specified email accounts. Shows warmup progress, email volumes, and performance metrics.
   * @route POST /get-warmup-analytics
   *
   * @paramDef {"type":"Array<String>","label":"Emails","name":"emails","required":true,"description":"List of account email addresses to get warmup analytics for.","dictionary":"getAccountsDict"}
   *
   * @returns {Object}
   * @sampleResult {"analytics":[{"email":"sender@example.com","warmup_stage":"building","emails_sent":45,"open_rate":0.78,"reply_rate":0.12}]}
   */
  async getWarmupAnalytics(emails) {
    try {
      logger.debug('[getWarmupAnalytics] Getting warmup analytics')

      if (!emails || emails.length === 0) {
        throw new Error('At least one email is required')
      }

      const response = await this.#apiRequest({
        logTag: 'getWarmupAnalytics',
        method: 'post',
        url: `${ API_BASE_URL }/accounts/warmup-analytics`,
        body: { emails },
      })

      logger.debug('[getWarmupAnalytics] Warmup analytics retrieved successfully')

      return response

    } catch (error) {
      logger.error('[getWarmupAnalytics] Error:', error.message)
      throw new Error(`Failed to get warmup analytics: ${ error.message }`)
    }
  }

  /**
   * @operationName Test Account Vitals
   * @category Accounts
   * @description Test the health and connection status of email accounts. Validates SMTP/IMAP settings and checks account vitals.
   * @route POST /test-account-vitals
   *
   * @paramDef {"type":"Array<String>","label":"Accounts","name":"accounts","required":true,"description":"List of account email addresses to test connection and vitals.","dictionary":"getAccountsDict"}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"email":"sender@example.com","status":"healthy","smtp_valid":true,"imap_valid":true}]}
   */
  async testAccountVitals(accounts) {
    try {
      logger.debug('[testAccountVitals] Testing account vitals')

      if (!accounts || accounts.length === 0) {
        throw new Error('At least one account is required')
      }

      const response = await this.#apiRequest({
        logTag: 'testAccountVitals',
        method: 'post',
        url: `${ API_BASE_URL }/accounts/test/vitals`,
        body: { accounts },
      })

      logger.debug('[testAccountVitals] Account vitals tested successfully')

      return response

    } catch (error) {
      logger.error('[testAccountVitals] Error:', error.message)
      throw new Error(`Failed to test account vitals: ${ error.message }`)
    }
  }

  /**
   * @operationName Create Lead List
   * @category Lead Lists
   * @description Create a new lead list in your Instantly workspace to organize and manage your leads.
   * @route POST /create-lead-list
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the lead list."}
   * @paramDef {"type":"Boolean","label":"Has Enrichment Task","name":"hasEnrichmentTask","uiComponent":{"type":"TOGGLE"},"description":"Whether this list runs the enrichment process on every added lead."}
   * @paramDef {"type":"String","label":"Owned By","name":"ownedBy","description":"User ID of the owner of this lead list. Defaults to the user that created the list."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123","name":"My Lead List","has_enrichment_task":false}
   */
  async createLeadList(name, hasEnrichmentTask, ownedBy) {
    try {
      logger.debug('[createLeadList] Creating lead list:', name)

      if (!name) {
        throw new Error('Name is required')
      }

      const body = { name }

      if (hasEnrichmentTask !== null && hasEnrichmentTask !== undefined) {
        body.has_enrichment_task = hasEnrichmentTask
      }

      if (ownedBy) {
        body.owned_by = ownedBy
      }

      const response = await this.#apiRequest({
        logTag: 'createLeadList',
        method: 'post',
        url: `${ API_BASE_URL }/lead-lists`,
        body,
      })

      logger.debug('[createLeadList] Lead list created successfully')

      return response

    } catch (error) {
      logger.error('[createLeadList] Error:', error.message)
      throw new Error(`Failed to create lead list: ${ error.message }`)
    }
  }

  /**
   * @operationName List Lead Lists
   * @category Lead Lists
   * @description Retrieve a paginated list of lead lists from your Instantly workspace.
   * @route POST /list-lead-lists
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","default":50,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of lead lists to return per page."}
   * @paramDef {"type":"String","label":"Starting After","name":"startingAfter","description":"Pagination cursor - timestamp to start after."}
   * @paramDef {"type":"Boolean","label":"Has Enrichment Task","name":"hasEnrichmentTask","uiComponent":{"type":"TOGGLE"},"description":"Filter by whether the list has an enrichment task."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search query to filter lead lists."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"abc123","name":"My Lead List","has_enrichment_task":false}],"next_starting_after":"2023-01-01T00:00:00Z"}
   */
  async listLeadLists(limit, startingAfter, hasEnrichmentTask, search) {
    try {
      logger.debug('[listLeadLists] Starting')

      const query = {}

      if (limit) {
        query.limit = limit
      }

      if (startingAfter) {
        query.starting_after = startingAfter
      }

      if (hasEnrichmentTask !== null && hasEnrichmentTask !== undefined) {
        query.has_enrichment_task = hasEnrichmentTask
      }

      if (search) {
        query.search = search
      }

      const response = await this.#apiRequest({
        logTag: 'listLeadLists',
        method: 'get',
        url: `${ API_BASE_URL }/lead-lists`,
        query,
      })

      logger.debug('[listLeadLists] Lead lists retrieved successfully')

      return response

    } catch (error) {
      logger.error('[listLeadLists] Error:', error.message)
      throw new Error(`Failed to list lead lists: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Lead List
   * @category Lead Lists
   * @description Retrieve detailed information about a specific lead list by its ID.
   * @route POST /get-lead-list
   *
   * @paramDef {"type":"String","label":"Lead List","name":"id","required":true,"dictionary":"getLeadListsDict","description":"The lead list to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123","name":"My Lead List","has_enrichment_task":false,"owned_by":"user123"}
   */
  async getLeadList(id) {
    try {
      logger.debug('[getLeadList] Getting lead list:', id)

      if (!id) {
        throw new Error('ID is required')
      }

      const response = await this.#apiRequest({
        logTag: 'getLeadList',
        method: 'get',
        url: `${ API_BASE_URL }/lead-lists/${ id }`,
      })

      logger.debug('[getLeadList] Lead list retrieved successfully')

      return response

    } catch (error) {
      logger.error('[getLeadList] Error:', error.message)
      throw new Error(`Failed to get lead list: ${ error.message }`)
    }
  }

  /**
 * @operationName Update Lead List
 * @category Lead Lists
 * @description Update an existing lead list's properties such as name, enrichment settings, or owner.
 * @route POST /update-lead-list
 *
 * @paramDef {"type":"String","label":"Lead List","name":"id","required":true,"dictionary":"getLeadListsDict","description":"The lead list to update."}
 * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the lead list."}
 * @paramDef {"type":"Boolean","label":"Has Enrichment Task","name":"hasEnrichmentTask","uiComponent":{"type":"TOGGLE"},"description":"Whether this list runs the enrichment process on every added lead."}
 * @paramDef {"type":"String","label":"Owned By","name":"ownedBy","description":"User ID of the owner of this lead list."}
 *
 * @returns {Object}
 * @sampleResult {"success":true,"message":"Lead list updated successfully"}
 */
  async updateLeadList(id, name, hasEnrichmentTask, ownedBy) {
    try {
      logger.debug('[updateLeadList] Updating lead list:', id)

      if (!id) {
        throw new Error('ID is required')
      }

      const body = {}

      if (name) {
        body.name = name
      }

      if (hasEnrichmentTask !== null && hasEnrichmentTask !== undefined) {
        body.has_enrichment_task = hasEnrichmentTask
      }

      if (ownedBy) {
        body.owned_by = ownedBy
      }

      const response = await this.#apiRequest({
        logTag: 'updateLeadList',
        method: 'patch',
        url: `${ API_BASE_URL }/lead-lists/${ id }`,
        body,
      })

      logger.debug('[updateLeadList] Lead list updated successfully')

      return { success: true, message: 'Lead list updated successfully', data: response }

    } catch (error) {
      logger.error('[updateLeadList] Error:', error.message)
      throw new Error(`Failed to update lead list: ${ error.message }`)
    }
  }

  /**
   * @operationName Delete Lead List
   * @category Lead Lists
   * @description Permanently delete a lead list from your Instantly workspace. This action cannot be undone.
   * @route DELETE /delete-lead-list
   *
   * @paramDef {"type":"String","label":"Lead List","name":"id","required":true,"dictionary":"getLeadListsDict","description":"The lead list to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Lead list deleted successfully"}
   */
  async deleteLeadList(id) {
    try {
      logger.debug('[deleteLeadList] Deleting lead list:', id)

      if (!id) {
        throw new Error('ID is required')
      }

      const response = await this.#apiRequestDelete({
        logTag: 'deleteLeadList',
        url: `${ API_BASE_URL }/lead-lists/${ id }`,
      })

      logger.debug('[deleteLeadList] Lead list deleted successfully')

      return { success: true, message: 'Lead list deleted successfully', data: response }

    } catch (error) {
      logger.error('[deleteLeadList] Error:', error.message)
      throw new Error(`Failed to delete lead list: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Lead List Verification Stats
   * @category Lead Lists
   * @description Retrieve email verification statistics for a specific lead list, including valid, invalid, and risky email counts.
   * @route POST /get-lead-list-verification-stats
   *
   * @paramDef {"type":"String","label":"Lead List","name":"id","required":true,"dictionary":"getLeadListsDict","description":"The lead list to get verification stats for."}
   *
   * @returns {Object}
   * @sampleResult {"total":1000,"valid":850,"invalid":100,"risky":50,"unknown":0}
   */
  async getLeadListVerificationStats(id) {
    try {
      logger.debug('[getLeadListVerificationStats] Getting verification stats:', id)

      if (!id) {
        throw new Error('ID is required')
      }

      const response = await this.#apiRequest({
        logTag: 'getLeadListVerificationStats',
        method: 'get',
        url: `${ API_BASE_URL }/lead-lists/${ id }/verification-stats`,
      })

      logger.debug('[getLeadListVerificationStats] Verification stats retrieved successfully')

      return response

    } catch (error) {
      logger.error('[getLeadListVerificationStats] Error:', error.message)
      throw new Error(`Failed to get verification stats: ${ error.message }`)
    }
  }

  /**
   * @operationName Create Lead Label
   * @category Lead Lists
   * @description Create a custom lead label to categorize and track lead interest levels (positive, negative, neutral).
   * @route POST /create-lead-label
   *
   * @paramDef {"type":"String","label":"Label","name":"label","required":true,"description":"Display label for the custom lead label."}
   * @paramDef {"type":"String","label":"Interest Status","name":"interestStatusLabel","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["positive","negative","neutral"]}},"description":"Interest status: positive, negative, or neutral."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed description of the custom lead label purpose."}
   * @paramDef {"type":"Boolean","label":"Use With AI","name":"useWithAi","uiComponent":{"type":"TOGGLE"},"description":"Whether this label should be used with AI features."}
   *
   * @returns {Object}
   * @sampleResult {"id":"label123","label":"Hot Lead","interest_status_label":"positive","description":"Highly interested prospects"}
   */
  async createLeadLabel(label, interestStatusLabel, description, useWithAi) {
    try {
      logger.debug('[createLeadLabel] Creating lead label:', label)

      if (!label || !interestStatusLabel) {
        throw new Error('Label and interest status are required')
      }

      const body = {
        label,
        interest_status_label: interestStatusLabel,
      }

      if (description) {
        body.description = description
      }

      if (useWithAi !== null && useWithAi !== undefined) {
        body.use_with_ai = useWithAi
      }

      const response = await this.#apiRequest({
        logTag: 'createLeadLabel',
        method: 'post',
        url: `${ API_BASE_URL }/lead-labels`,
        body,
      })

      logger.debug('[createLeadLabel] Lead label created successfully')

      return response

    } catch (error) {
      logger.error('[createLeadLabel] Error:', error.message)
      throw new Error(`Failed to create lead label: ${ error.message }`)
    }
  }

  /**
   * @operationName List Lead Labels
   * @category Lead Lists
   * @description Retrieve a paginated list of custom lead labels from your Instantly workspace.
   * @route POST /list-lead-labels
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","default":50,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of lead labels to return per page."}
   * @paramDef {"type":"String","label":"Starting After","name":"startingAfter","description":"Pagination cursor - timestamp to start after."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search query to filter lead labels."}
   * @paramDef {"type":"String","label":"Interest Status","name":"interestStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["positive","negative","neutral"]}},"description":"Filter by interest status."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"label123","label":"Hot Lead","interest_status_label":"positive"}],"next_starting_after":"2023-01-01T00:00:00Z"}
   */
  async listLeadLabels(limit, startingAfter, search, interestStatus) {
    try {
      logger.debug('[listLeadLabels] Starting')

      const query = {}

      if (limit) {
        query.limit = limit
      }

      if (startingAfter) {
        query.starting_after = startingAfter
      }

      if (search) {
        query.search = search
      }

      if (interestStatus) {
        query.interest_status = interestStatus
      }

      const response = await this.#apiRequest({
        logTag: 'listLeadLabels',
        method: 'get',
        url: `${ API_BASE_URL }/lead-labels`,
        query,
      })

      logger.debug('[listLeadLabels] Lead labels retrieved successfully')

      return response

    } catch (error) {
      logger.error('[listLeadLabels] Error:', error.message)
      throw new Error(`Failed to list lead labels: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Lead Label
   * @category Lead Lists
   * @description Retrieve detailed information about a specific lead label by its ID.
   * @route POST /get-lead-label
   *
   * @paramDef {"type":"String","label":"Lead Label","name":"id","required":true,"dictionary":"getLeadLabelsDict","description":"The lead label to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"label123","label":"Hot Lead","interest_status_label":"positive","description":"Highly interested prospects","use_with_ai":true}
   */
  async getLeadLabel(id) {
    try {
      logger.debug('[getLeadLabel] Getting lead label:', id)

      if (!id) {
        throw new Error('ID is required')
      }

      const response = await this.#apiRequest({
        logTag: 'getLeadLabel',
        method: 'get',
        url: `${ API_BASE_URL }/lead-labels/${ id }`,
      })

      logger.debug('[getLeadLabel] Lead label retrieved successfully')

      return response

    } catch (error) {
      logger.error('[getLeadLabel] Error:', error.message)
      throw new Error(`Failed to get lead label: ${ error.message }`)
    }
  }

  /**
 * @operationName Update Lead Label
 * @category Lead Lists
 * @description Update an existing lead label's properties such as name, interest status, or AI settings.
 * @route POST /update-lead-label
 *
 * @paramDef {"type":"String","label":"Lead Label","name":"id","required":true,"dictionary":"getLeadLabelsDict","description":"The lead label to update."}
 * @paramDef {"type":"String","label":"Label","name":"label","description":"New display label."}
 * @paramDef {"type":"String","label":"Interest Status","name":"interestStatusLabel","uiComponent":{"type":"DROPDOWN","options":{"values":["positive","negative","neutral"]}},"description":"New interest status."}
 * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
 * @paramDef {"type":"Boolean","label":"Use With AI","name":"useWithAi","uiComponent":{"type":"TOGGLE"},"description":"Whether this label should be used with AI features."}
 *
 * @returns {Object}
 * @sampleResult {"success":true,"message":"Lead label updated successfully"}
 */
  async updateLeadLabel(id, label, interestStatusLabel, description, useWithAi) {
    try {
      logger.debug('[updateLeadLabel] Updating lead label:', id)

      if (!id) {
        throw new Error('ID is required')
      }

      const body = {}

      if (label) {
        body.label = label
      }

      if (interestStatusLabel) {
        body.interest_status_label = interestStatusLabel
      }

      if (description) {
        body.description = description
      }

      if (useWithAi !== null && useWithAi !== undefined) {
        body.use_with_ai = useWithAi
      }

      const response = await this.#apiRequest({
        logTag: 'updateLeadLabel',
        method: 'patch',
        url: `${ API_BASE_URL }/lead-labels/${ id }`,
        body,
      })

      logger.debug('[updateLeadLabel] Lead label updated successfully')

      return { success: true, message: 'Lead label updated successfully', data: response }

    } catch (error) {
      logger.error('[updateLeadLabel] Error:', error.message)
      throw new Error(`Failed to update lead label: ${ error.message }`)
    }
  }

  /**
   * @operationName Delete Lead Label
   * @category Lead Lists
   * @description Permanently delete a lead label. Leads and emails with this label will be reassigned to the specified status.
   * @route DELETE /delete-lead-label
   *
   * @paramDef {"type":"String","label":"Lead Label","name":"id","required":true,"dictionary":"getLeadLabelsDict","description":"The lead label to delete."}
   * @paramDef {"type":"Number","label":"Reassigned Status","name":"reassignedStatus","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The interest status to reassign leads and emails to."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Lead label deleted successfully"}
   */
  async deleteLeadLabel(id, reassignedStatus) {
    try {
      logger.debug('[deleteLeadLabel] Deleting lead label:', id)

      if (!id) {
        throw new Error('ID is required')
      }

      if (reassignedStatus === null || reassignedStatus === undefined) {
        throw new Error('Reassigned status is required')
      }

      // DELETE with body requires special handling
      const response = await this.#apiRequest({
        logTag: 'deleteLeadLabel',
        method: 'delete',
        url: `${ API_BASE_URL }/lead-labels/${ id }`,
        body: { reassigned_status: reassignedStatus },
      })

      logger.debug('[deleteLeadLabel] Lead label deleted successfully')

      return { success: true, message: 'Lead label deleted successfully', data: response }

    } catch (error) {
      logger.error('[deleteLeadLabel] Error:', error.message)
      throw new Error(`Failed to delete lead label: ${ error.message }`)
    }
  }

  /**
   * @operationName List Emails
   * @category Emails
   * @description Retrieve a paginated list of emails from your Instantly workspace with powerful filtering options.
   * @route POST /list-emails
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","default":50,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of emails to return per page."}
   * @paramDef {"type":"String","label":"Starting After","name":"startingAfter","description":"Email ID to start from for pagination."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search by email address or thread (use 'thread:' prefix + thread ID)."}
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","dictionary":"getCampaignsDict","description":"Filter by campaign."}
   * @paramDef {"type":"String","label":"Email Account","name":"eaccount","description":"Filter by email account (comma-separated for multiple).","dictionary":"getAccountsDict"}
   * @paramDef {"type":"Boolean","label":"Is Unread","name":"isUnread","uiComponent":{"type":"TOGGLE"},"description":"Filter by unread status."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort order by creation date (default: desc)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"email123","subject":"Meeting Follow-up","from":"john@example.com","is_unread":true}],"next_starting_after":"email456"}
   */
  async listEmails(limit, startingAfter, search, campaignId, eaccount, isUnread, sortOrder) {
    try {
      logger.debug('[listEmails] Starting')

      const query = {}

      if (limit) query.limit = limit
      if (startingAfter) query.starting_after = startingAfter
      if (search) query.search = search
      if (campaignId) query.campaign_id = campaignId
      if (eaccount) query.eaccount = eaccount
      if (isUnread !== null && isUnread !== undefined) query.is_unread = isUnread
      if (sortOrder) query.sort_order = sortOrder

      const response = await this.#apiRequest({
        logTag: 'listEmails',
        method: 'get',
        url: `${ API_BASE_URL }/emails`,
        query,
      })

      logger.debug('[listEmails] Emails retrieved successfully')

      return response

    } catch (error) {
      logger.error('[listEmails] Error:', error.message)
      throw new Error(`Failed to list emails: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Email
   * @category Emails
   * @description Retrieve detailed information about a specific email by its ID.
   * @route POST /get-email
   *
   * @paramDef {"type":"String","label":"Email","name":"id","required":true,"description":"The ID of the email to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"email123","subject":"Meeting Follow-up","from":"john@example.com","body":{"html":"<p>Hello...</p>"},"is_unread":true}
   */
  async getEmail(id) {
    try {
      logger.debug('[getEmail] Getting email:', id)

      if (!id) throw new Error('ID is required')

      const response = await this.#apiRequest({
        logTag: 'getEmail',
        method: 'get',
        url: `${ API_BASE_URL }/emails/${ id }`,
      })

      logger.debug('[getEmail] Email retrieved successfully')

      return response

    } catch (error) {
      logger.error('[getEmail] Error:', error.message)
      throw new Error(`Failed to get email: ${ error.message }`)
    }
  }

  /**
   * @operationName Update Email
   * @category Emails
   * @description Update an email's properties such as read status or reminder timestamp.
   * @route POST /update-email
   *
   * @paramDef {"type":"String","label":"Email","name":"id","required":true,"description":"The ID of the email to update."}
   * @paramDef {"type":"Boolean","label":"Is Unread","name":"isUnread","uiComponent":{"type":"TOGGLE"},"description":"Set unread status (0 or 1)."}
   * @paramDef {"type":"String","label":"Reminder Timestamp","name":"reminderTs","description":"ISO timestamp for reminder."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Email updated successfully"}
   */
  async updateEmail(id, isUnread, reminderTs) {
    try {
      logger.debug('[updateEmail] Updating email:', id)

      if (!id) throw new Error('ID is required')

      const body = {}
      if (isUnread !== null && isUnread !== undefined) body.is_unread = isUnread
      if (reminderTs) body.reminder_ts = reminderTs

      const response = await this.#apiRequest({
        logTag: 'updateEmail',
        method: 'patch',
        url: `${ API_BASE_URL }/emails/${ id }`,
        body,
      })

      logger.debug('[updateEmail] Email updated successfully')

      return { success: true, message: 'Email updated successfully', data: response }

    } catch (error) {
      logger.error('[updateEmail] Error:', error.message)
      throw new Error(`Failed to update email: ${ error.message }`)
    }
  }

  /**
   * @operationName Delete Email
   * @category Emails
   * @description Permanently delete an email from your Instantly workspace. This action cannot be undone.
   * @route DELETE /delete-email
   *
   * @paramDef {"type":"String","label":"Email","name":"id","required":true,"description":"The ID of the email to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Email deleted successfully"}
   */
  async deleteEmail(id) {
    try {
      logger.debug('[deleteEmail] Deleting email:', id)

      if (!id) throw new Error('ID is required')

      const response = await this.#apiRequestDelete({
        logTag: 'deleteEmail',
        url: `${ API_BASE_URL }/emails/${ id }`,
      })

      logger.debug('[deleteEmail] Email deleted successfully')

      return { success: true, message: 'Email deleted successfully', data: response }

    } catch (error) {
      logger.error('[deleteEmail] Error:', error.message)
      throw new Error(`Failed to delete email: ${ error.message }`)
    }
  }

  /**
   * @operationName Reply to Email
   * @category Emails
   * @description Send a reply to an existing email in your Instantly workspace.
   * @route POST /reply-to-email
   *
   * @paramDef {"type":"String","label":"Email Account","name":"eaccount","required":true,"description":"The email account to send from (must be connected to your workspace).","dictionary":"getAccountsDict"}
   * @paramDef {"type":"String","label":"Reply To UUID","name":"replyToUuid","required":true,"description":"The ID of the email to reply to."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Subject line of the reply."}
   * @paramDef {"type":"Object","label":"Body","name":"body","required":true,"description":"Email body object with 'html' and/or 'text' fields."}
   * @paramDef {"type":"String","label":"CC Addresses","name":"ccAddressEmailList","description":"Comma-separated list of CC email addresses."}
   * @paramDef {"type":"String","label":"BCC Addresses","name":"bccAddressEmailList","description":"Comma-separated list of BCC email addresses."}
   * @paramDef {"type":"String","label":"Reminder Timestamp","name":"reminderTs","description":"Schedule email for later (ISO timestamp)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Reply sent successfully","email_id":"reply123"}
   */
  async replyToEmail(eaccount, replyToUuid, subject, body, ccAddressEmailList, bccAddressEmailList, reminderTs) {
    try {
      logger.debug('[replyToEmail] Sending reply')

      if (!eaccount || !replyToUuid || !subject || !body) {
        throw new Error('Email account, reply UUID, subject, and body are required')
      }

      const requestBody = {
        eaccount,
        reply_to_uuid: replyToUuid,
        subject,
        body,
      }

      if (ccAddressEmailList) requestBody.cc_address_email_list = ccAddressEmailList
      if (bccAddressEmailList) requestBody.bcc_address_email_list = bccAddressEmailList
      if (reminderTs) requestBody.reminder_ts = reminderTs

      const response = await this.#apiRequest({
        logTag: 'replyToEmail',
        method: 'post',
        url: `${ API_BASE_URL }/emails/reply`,
        body: requestBody,
      })

      logger.debug('[replyToEmail] Reply sent successfully')

      return response

    } catch (error) {
      logger.error('[replyToEmail] Error:', error.message)
      throw new Error(`Failed to send reply: ${ error.message }`)
    }
  }

  /**
   * @operationName Count Unread Emails
   * @category Emails
   * @description Get the total count of unread emails in your Instantly workspace.
   * @route POST /count-unread-emails
   *
   * @returns {Object}
   * @sampleResult {"count":42}
   */
  async countUnreadEmails() {
    try {
      logger.debug('[countUnreadEmails] Counting unread emails')

      const response = await this.#apiRequest({
        logTag: 'countUnreadEmails',
        method: 'get',
        url: `${ API_BASE_URL }/emails/unread/count`,
      })

      logger.debug('[countUnreadEmails] Unread count retrieved successfully')

      return response

    } catch (error) {
      logger.error('[countUnreadEmails] Error:', error.message)
      throw new Error(`Failed to count unread emails: ${ error.message }`)
    }
  }

  /**
   * @operationName Mark Thread as Read
   * @category Emails
   * @description Mark all emails in a specific thread as read.
   * @route POST /mark-thread-as-read
   *
   * @paramDef {"type":"String","label":"Thread ID","name":"threadId","required":true,"description":"The ID of the email thread to mark as read."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Thread marked as read"}
   */
  async markThreadAsRead(threadId) {
    try {
      logger.debug('[markThreadAsRead] Marking thread as read:', threadId)

      if (!threadId) throw new Error('Thread ID is required')

      const response = await this.#apiRequest({
        logTag: 'markThreadAsRead',
        method: 'post',
        url: `${ API_BASE_URL }/emails/threads/${ threadId }/mark-as-read`,
      })

      logger.debug('[markThreadAsRead] Thread marked as read successfully')

      return { success: true, message: 'Thread marked as read', data: response }

    } catch (error) {
      logger.error('[markThreadAsRead] Error:', error.message)
      throw new Error(`Failed to mark thread as read: ${ error.message }`)
    }
  }

  /**
   * @operationName Verify Email
   * @category Emails
   * @description Verify an email address to check if it's valid, risky, or invalid.
   * @route POST /verify-email
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address to verify."}
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","description":"Webhook URL to receive results if verification takes >10 seconds."}
   *
   * @returns {Object}
   * @sampleResult {"email":"john@example.com","status":"valid","result":"deliverable"}
   */
  async verifyEmail(email, webhookUrl) {
    try {
      logger.debug('[verifyEmail] Verifying email:', email)

      if (!email) throw new Error('Email is required')

      const body = { email }
      if (webhookUrl) body.webhook_url = webhookUrl

      const response = await this.#apiRequest({
        logTag: 'verifyEmail',
        method: 'post',
        url: `${ API_BASE_URL }/email-verification`,
        body,
      })

      logger.debug('[verifyEmail] Email verification completed')

      return response

    } catch (error) {
      logger.error('[verifyEmail] Error:', error.message)
      throw new Error(`Failed to verify email: ${ error.message }`)
    }
  }

  /**
   * @operationName Check Email Verification Status
   * @category Emails
   * @description Check the verification status of a previously submitted email address.
   * @route POST /check-email-verification
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address to check verification status for."}
   *
   * @returns {Object}
   * @sampleResult {"email":"john@example.com","status":"valid","result":"deliverable","verified_at":"2024-01-01T00:00:00Z"}
   */
  async checkEmailVerification(email) {
    try {
      logger.debug('[checkEmailVerification] Checking verification status:', email)

      if (!email) throw new Error('Email is required')

      const response = await this.#apiRequest({
        logTag: 'checkEmailVerification',
        method: 'get',
        url: `${ API_BASE_URL }/email-verification/${ encodeURIComponent(email) }`,
      })

      logger.debug('[checkEmailVerification] Verification status retrieved')

      return response

    } catch (error) {
      logger.error('[checkEmailVerification] Error:', error.message)
      throw new Error(`Failed to check email verification: ${ error.message }`)
    }
  }

  /**
   * @operationName List Campaigns
   * @category Campaigns
   * @description Retrieve a paginated list of campaigns from your Instantly workspace with filtering options.
   * @route POST /list-campaigns
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","default":50,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of campaigns to return per page."}
   * @paramDef {"type":"String","label":"Starting After","name":"startingAfter","description":"Campaign ID to start from for pagination."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search by campaign name."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Filter by tags. Returns campaigns with any of the specified tags.","dictionary":"getTagsDict"}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"campaign123","name":"Outreach Q1","status":1}],"next_starting_after":"campaign456"}
   */
  async listCampaigns(limit, startingAfter, search, tags) {
    try {
      logger.debug('[listCampaigns] Starting')

      const query = {}
      if (limit) query.limit = limit
      if (startingAfter) query.starting_after = startingAfter
      if (search) query.search = search

      // Convert tags array to comma-separated string
      if (tags && tags.length > 0) {
        query.tag_ids = tags.join(',')
      }

      const response = await this.#apiRequest({
        logTag: 'listCampaigns',
        method: 'get',
        url: `${ API_BASE_URL }/campaigns`,
        query,
      })

      logger.debug('[listCampaigns] Campaigns retrieved successfully')

      return response

    } catch (error) {
      logger.error('[listCampaigns] Error:', error.message)
      throw new Error(`Failed to list campaigns: ${ error.message }`)
    }
  }

  /**
   * @operationName Create Campaign
   * @category Campaigns
   * @description Create a new email outreach campaign with full configuration options including scheduling, sequences, tracking, and account settings.
   * @route POST /create-campaign
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the campaign."}
   * @paramDef {"type":"Object","label":"Campaign Schedule","name":"campaignSchedule","required":true,"schemaLoader":"createCampaignScheduleSchemaLoader","description":"Campaign schedule configuration including timezone, days of week, and time slots."}
   * @paramDef {"type":"Number","label":"Positive Lead Value","name":"plValue","uiComponent":{"type":"NUMERIC"},"description":"Value of every positive lead."}
   * @paramDef {"type":"Boolean","label":"Is Evergreen","name":"isEvergreen","uiComponent":{"type":"TOGGLE"},"description":"Whether the campaign is evergreen."}
   * @paramDef {"type":"Array<Object>","label":"Sequences","name":"sequences","description":"List of sequences (the actual email copy). Only the first element is used, so provide one array item with steps."}
   * @paramDef {"type":"Number","label":"Email Gap (minutes)","name":"emailGap","uiComponent":{"type":"NUMERIC"},"description":"The gap between emails in minutes."}
   * @paramDef {"type":"Number","label":"Random Wait Max (minutes)","name":"randomWaitMax","uiComponent":{"type":"NUMERIC"},"description":"The maximum random wait time in minutes."}
   * @paramDef {"type":"Boolean","label":"Text Only","name":"textOnly","uiComponent":{"type":"TOGGLE"},"description":"Whether the campaign emails are text only."}
   * @paramDef {"type":"Boolean","label":"First Email Text Only","name":"firstEmailTextOnly","uiComponent":{"type":"TOGGLE"},"description":"Whether to send the first email as text only."}
   * @paramDef {"type":"Array<String>","label":"Email List","name":"emailList","description":"List of account emails to use for sending.","dictionary":"getAccountsDict"}
   * @paramDef {"type":"Number","label":"Daily Limit","name":"dailyLimit","uiComponent":{"type":"NUMERIC"},"description":"The daily limit for sending emails."}
   * @paramDef {"type":"Boolean","label":"Stop On Reply","name":"stopOnReply","uiComponent":{"type":"TOGGLE"},"description":"Whether to stop the campaign on reply."}
   * @paramDef {"type":"Array<String>","label":"Email Tag List","name":"emailTagList","description":"List of tags to use for sending emails.","dictionary":"getTagsDict"}
   * @paramDef {"type":"Boolean","label":"Link Tracking","name":"linkTracking","uiComponent":{"type":"TOGGLE"},"description":"Whether to track links in emails."}
   * @paramDef {"type":"Boolean","label":"Open Tracking","name":"openTracking","uiComponent":{"type":"TOGGLE"},"description":"Whether to track opens in emails."}
   * @paramDef {"type":"Boolean","label":"Stop On Auto Reply","name":"stopOnAutoReply","uiComponent":{"type":"TOGGLE"},"description":"Whether to stop the campaign on auto reply."}
   * @paramDef {"type":"Number","label":"Daily Max Leads","name":"dailyMaxLeads","uiComponent":{"type":"NUMERIC"},"description":"The daily maximum new leads to contact."}
   * @paramDef {"type":"Boolean","label":"Prioritize New Leads","name":"prioritizeNewLeads","uiComponent":{"type":"TOGGLE"},"description":"Whether to prioritize new leads."}
   * @paramDef {"type":"Object","label":"Auto Variant Select","name":"autoVariantSelect","description":"Auto variant select settings."}
   * @paramDef {"type":"Boolean","label":"Match Lead ESP","name":"matchLeadEsp","uiComponent":{"type":"TOGGLE"},"description":"Whether to match leads by ESP."}
   * @paramDef {"type":"Boolean","label":"Stop For Company","name":"stopForCompany","uiComponent":{"type":"TOGGLE"},"description":"Whether to stop the campaign for the entire company (domain) when a lead replies."}
   * @paramDef {"type":"Boolean","label":"Insert Unsubscribe Header","name":"insertUnsubscribeHeader","uiComponent":{"type":"TOGGLE"},"description":"Whether to insert an unsubscribe header in emails."}
   * @paramDef {"type":"Boolean","label":"Allow Risky Contacts","name":"allowRiskyContacts","uiComponent":{"type":"TOGGLE"},"description":"Whether to allow risky contacts."}
   * @paramDef {"type":"Boolean","label":"Disable Bounce Protect","name":"disableBounceProtect","uiComponent":{"type":"TOGGLE"},"description":"Whether to disable bounce protection."}
   * @paramDef {"type":"Object","label":"Limit Emails Per Company Override","name":"limitEmailsPerCompanyOverride","description":"Overrides the workspace-wide limit emails per company setting for this campaign."}
   * @paramDef {"type":"Array<String>","label":"CC List","name":"ccList","description":"List of accounts to CC on emails.","dictionary":"getAccountsDict"}
   * @paramDef {"type":"Array<String>","label":"BCC List","name":"bccList","description":"List of accounts to BCC on emails.","dictionary":"getAccountsDict"}
   * @paramDef {"type":"String","label":"Owner ID","name":"ownedBy","description":"Owner ID."}
   * @paramDef {"type":"Array<Object>","label":"Provider Routing Rules","name":"providerRoutingRules","description":"Provider routing rules for campaign."}
   *
   * @returns {Object}
   * @sampleResult {"id":"new-campaign-123","name":"My First Campaign","status":0,"created_at":"2024-01-01T00:00:00Z"}
   */
  async createCampaign(name, campaignSchedule, plValue, isEvergreen, sequences, emailGap, randomWaitMax, textOnly, firstEmailTextOnly, emailList, dailyLimit, stopOnReply, emailTagList, linkTracking, openTracking, stopOnAutoReply, dailyMaxLeads, prioritizeNewLeads, autoVariantSelect, matchLeadEsp, stopForCompany, insertUnsubscribeHeader, allowRiskyContacts, disableBounceProtect, limitEmailsPerCompanyOverride, ccList, bccList, ownedBy, providerRoutingRules) {
    try {
      logger.debug('[createCampaign] Creating campaign:', name)

      if (!name) throw new Error('Campaign name is required')
      if (!campaignSchedule) throw new Error('Campaign schedule is required')

      const body = {
        name,
        campaign_schedule: campaignSchedule,
      }

      // Add optional parameters
      if (plValue !== null && plValue !== undefined) body.pl_value = plValue
      if (isEvergreen !== null && isEvergreen !== undefined) body.is_evergreen = isEvergreen
      if (sequences) body.sequences = sequences
      if (emailGap !== null && emailGap !== undefined) body.email_gap = emailGap
      if (randomWaitMax !== null && randomWaitMax !== undefined) body.random_wait_max = randomWaitMax
      if (textOnly !== null && textOnly !== undefined) body.text_only = textOnly
      if (firstEmailTextOnly !== null && firstEmailTextOnly !== undefined) body.first_email_text_only = firstEmailTextOnly
      if (emailList) body.email_list = emailList
      if (dailyLimit !== null && dailyLimit !== undefined) body.daily_limit = dailyLimit
      if (stopOnReply !== null && stopOnReply !== undefined) body.stop_on_reply = stopOnReply
      if (emailTagList) body.email_tag_list = emailTagList
      if (linkTracking !== null && linkTracking !== undefined) body.link_tracking = linkTracking
      if (openTracking !== null && openTracking !== undefined) body.open_tracking = openTracking
      if (stopOnAutoReply !== null && stopOnAutoReply !== undefined) body.stop_on_auto_reply = stopOnAutoReply
      if (dailyMaxLeads !== null && dailyMaxLeads !== undefined) body.daily_max_leads = dailyMaxLeads
      if (prioritizeNewLeads !== null && prioritizeNewLeads !== undefined) body.prioritize_new_leads = prioritizeNewLeads
      if (autoVariantSelect) body.auto_variant_select = autoVariantSelect
      if (matchLeadEsp !== null && matchLeadEsp !== undefined) body.match_lead_esp = matchLeadEsp
      if (stopForCompany !== null && stopForCompany !== undefined) body.stop_for_company = stopForCompany
      if (insertUnsubscribeHeader !== null && insertUnsubscribeHeader !== undefined) body.insert_unsubscribe_header = insertUnsubscribeHeader
      if (allowRiskyContacts !== null && allowRiskyContacts !== undefined) body.allow_risky_contacts = allowRiskyContacts
      if (disableBounceProtect !== null && disableBounceProtect !== undefined) body.disable_bounce_protect = disableBounceProtect
      if (limitEmailsPerCompanyOverride) body.limit_emails_per_company_override = limitEmailsPerCompanyOverride
      if (ccList) body.cc_list = ccList
      if (bccList) body.bcc_list = bccList
      if (ownedBy) body.owned_by = ownedBy
      if (providerRoutingRules) body.provider_routing_rules = providerRoutingRules

      const response = await this.#apiRequest({
        logTag: 'createCampaign',
        method: 'post',
        url: `${ API_BASE_URL }/campaigns`,
        body,
      })

      logger.debug('[createCampaign] Campaign created successfully')

      return response

    } catch (error) {
      logger.error('[createCampaign] Error:', error.message)
      throw new Error(`Failed to create campaign: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Campaign
   * @category Campaigns
   * @description Retrieve detailed information about a specific campaign by its ID.
   * @route POST /get-campaign
   *
   * @paramDef {"type":"String","label":"Campaign","name":"id","required":true,"dictionary":"getCampaignsDict","description":"The campaign to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"campaign123","name":"Outreach Q1","status":1,"created_at":"2024-01-01T00:00:00Z"}
   */
  async getCampaign(id) {
    try {
      logger.debug('[getCampaign] Getting campaign:', id)

      if (!id) throw new Error('ID is required')

      const response = await this.#apiRequest({
        logTag: 'getCampaign',
        method: 'get',
        url: `${ API_BASE_URL }/campaigns/${ id }`,
      })

      logger.debug('[getCampaign] Campaign retrieved successfully')

      return response

    } catch (error) {
      logger.error('[getCampaign] Error:', error.message)
      throw new Error(`Failed to get campaign: ${ error.message }`)
    }
  }

  /**
   * @operationName Delete Campaign
   * @category Campaigns
   * @description Permanently delete a campaign from your Instantly workspace. This action cannot be undone.
   * @route DELETE /delete-campaign
   *
   * @paramDef {"type":"String","label":"Campaign","name":"id","required":true,"dictionary":"getCampaignsDict","description":"The campaign to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Campaign deleted successfully"}
   */
  async deleteCampaign(id) {
    try {
      logger.debug('[deleteCampaign] Deleting campaign:', id)

      if (!id) throw new Error('ID is required')

      const response = await this.#apiRequestDelete({
        logTag: 'deleteCampaign',
        url: `${ API_BASE_URL }/campaigns/${ id }`,
      })

      logger.debug('[deleteCampaign] Campaign deleted successfully')

      return { success: true, message: 'Campaign deleted successfully', data: response }

    } catch (error) {
      logger.error('[deleteCampaign] Error:', error.message)
      throw new Error(`Failed to delete campaign: ${ error.message }`)
    }
  }

  /**
   * @operationName Update Campaign
   * @category Campaigns
   * @description Update an existing campaign's configuration including name, scheduling, sequences, tracking, and account settings. All parameters are optional.
   * @route POST /update-campaign
   *
   * @paramDef {"type":"String","label":"Campaign","name":"id","required":true,"dictionary":"getCampaignsDict","description":"The campaign to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Name of the campaign."}
   * @paramDef {"type":"Number","label":"Positive Lead Value","name":"plValue","uiComponent":{"type":"NUMERIC"},"description":"Value of every positive lead."}
   * @paramDef {"type":"Boolean","label":"Is Evergreen","name":"isEvergreen","uiComponent":{"type":"TOGGLE"},"description":"Whether the campaign is evergreen."}
   * @paramDef {"type":"Object","label":"Campaign Schedule","name":"campaignSchedule","schemaLoader":"createCampaignScheduleSchemaLoader","description":"Campaign schedule configuration including timezone, days of week, and time slots."}
   * @paramDef {"type":"Array<Object>","label":"Sequences","name":"sequences","description":"List of sequences (the actual email copy). Only the first element is used, so provide one array item with steps."}
   * @paramDef {"type":"Number","label":"Email Gap (minutes)","name":"emailGap","uiComponent":{"type":"NUMERIC"},"description":"The gap between emails in minutes."}
   * @paramDef {"type":"Number","label":"Random Wait Max (minutes)","name":"randomWaitMax","uiComponent":{"type":"NUMERIC"},"description":"The maximum random wait time in minutes."}
   * @paramDef {"type":"Boolean","label":"Text Only","name":"textOnly","uiComponent":{"type":"TOGGLE"},"description":"Whether the campaign emails are text only."}
   * @paramDef {"type":"Boolean","label":"First Email Text Only","name":"firstEmailTextOnly","uiComponent":{"type":"TOGGLE"},"description":"Whether to send the first email as text only."}
   * @paramDef {"type":"Array<String>","label":"Email List","name":"emailList","description":"List of account emails to use for sending.","dictionary":"getAccountsDict"}
   * @paramDef {"type":"Number","label":"Daily Limit","name":"dailyLimit","uiComponent":{"type":"NUMERIC"},"description":"The daily limit for sending emails."}
   * @paramDef {"type":"Boolean","label":"Stop On Reply","name":"stopOnReply","uiComponent":{"type":"TOGGLE"},"description":"Whether to stop the campaign on reply."}
   * @paramDef {"type":"Array<String>","label":"Email Tag List","name":"emailTagList","description":"List of tags to use for sending emails.","dictionary":"getTagsDict"}
   * @paramDef {"type":"Boolean","label":"Link Tracking","name":"linkTracking","uiComponent":{"type":"TOGGLE"},"description":"Whether to track links in emails."}
   * @paramDef {"type":"Boolean","label":"Open Tracking","name":"openTracking","uiComponent":{"type":"TOGGLE"},"description":"Whether to track opens in emails."}
   * @paramDef {"type":"Boolean","label":"Stop On Auto Reply","name":"stopOnAutoReply","uiComponent":{"type":"TOGGLE"},"description":"Whether to stop the campaign on auto reply."}
   * @paramDef {"type":"Number","label":"Daily Max Leads","name":"dailyMaxLeads","uiComponent":{"type":"NUMERIC"},"description":"The daily maximum new leads to contact."}
   * @paramDef {"type":"Boolean","label":"Prioritize New Leads","name":"prioritizeNewLeads","uiComponent":{"type":"TOGGLE"},"description":"Whether to prioritize new leads."}
   * @paramDef {"type":"Object","label":"Auto Variant Select","name":"autoVariantSelect","description":"Auto variant select settings."}
   * @paramDef {"type":"Boolean","label":"Match Lead ESP","name":"matchLeadEsp","uiComponent":{"type":"TOGGLE"},"description":"Whether to match leads by ESP."}
   * @paramDef {"type":"Boolean","label":"Stop For Company","name":"stopForCompany","uiComponent":{"type":"TOGGLE"},"description":"Whether to stop the campaign for the entire company (domain) when a lead replies."}
   * @paramDef {"type":"Boolean","label":"Insert Unsubscribe Header","name":"insertUnsubscribeHeader","uiComponent":{"type":"TOGGLE"},"description":"Whether to insert an unsubscribe header in emails."}
   * @paramDef {"type":"Boolean","label":"Allow Risky Contacts","name":"allowRiskyContacts","uiComponent":{"type":"TOGGLE"},"description":"Whether to allow risky contacts."}
   * @paramDef {"type":"Boolean","label":"Disable Bounce Protect","name":"disableBounceProtect","uiComponent":{"type":"TOGGLE"},"description":"Whether to disable bounce protection."}
   * @paramDef {"type":"Object","label":"Limit Emails Per Company Override","name":"limitEmailsPerCompanyOverride","description":"Overrides the workspace-wide limit emails per company setting for this campaign."}
   * @paramDef {"type":"Array<String>","label":"CC List","name":"ccList","description":"List of accounts to CC on emails.","dictionary":"getAccountsDict"}
   * @paramDef {"type":"Array<String>","label":"BCC List","name":"bccList","description":"List of accounts to BCC on emails.","dictionary":"getAccountsDict"}
   * @paramDef {"type":"String","label":"Owner ID","name":"ownedBy","description":"Owner ID."}
   * @paramDef {"type":"Array<Object>","label":"Provider Routing Rules","name":"providerRoutingRules","description":"Provider routing rules for campaign."}
   *
   * @returns {Object}
   * @sampleResult {"id":"campaign-123","name":"Updated Campaign Name","status":1,"updated_at":"2024-01-01T00:00:00Z"}
   */
  async updateCampaign(id, name, plValue, isEvergreen, campaignSchedule, sequences, emailGap, randomWaitMax, textOnly, firstEmailTextOnly, emailList, dailyLimit, stopOnReply, emailTagList, linkTracking, openTracking, stopOnAutoReply, dailyMaxLeads, prioritizeNewLeads, autoVariantSelect, matchLeadEsp, stopForCompany, insertUnsubscribeHeader, allowRiskyContacts, disableBounceProtect, limitEmailsPerCompanyOverride, ccList, bccList, ownedBy, providerRoutingRules) {
    try {
      logger.debug('[updateCampaign] Updating campaign:', id)

      if (!id) throw new Error('Campaign ID is required')

      const body = {}

      // Add all optional parameters
      if (name) body.name = name
      if (plValue !== null && plValue !== undefined) body.pl_value = plValue
      if (isEvergreen !== null && isEvergreen !== undefined) body.is_evergreen = isEvergreen
      if (campaignSchedule) body.campaign_schedule = campaignSchedule
      if (sequences) body.sequences = sequences
      if (emailGap !== null && emailGap !== undefined) body.email_gap = emailGap
      if (randomWaitMax !== null && randomWaitMax !== undefined) body.random_wait_max = randomWaitMax
      if (textOnly !== null && textOnly !== undefined) body.text_only = textOnly
      if (firstEmailTextOnly !== null && firstEmailTextOnly !== undefined) body.first_email_text_only = firstEmailTextOnly
      if (emailList) body.email_list = emailList
      if (dailyLimit !== null && dailyLimit !== undefined) body.daily_limit = dailyLimit
      if (stopOnReply !== null && stopOnReply !== undefined) body.stop_on_reply = stopOnReply
      if (emailTagList) body.email_tag_list = emailTagList
      if (linkTracking !== null && linkTracking !== undefined) body.link_tracking = linkTracking
      if (openTracking !== null && openTracking !== undefined) body.open_tracking = openTracking
      if (stopOnAutoReply !== null && stopOnAutoReply !== undefined) body.stop_on_auto_reply = stopOnAutoReply
      if (dailyMaxLeads !== null && dailyMaxLeads !== undefined) body.daily_max_leads = dailyMaxLeads
      if (prioritizeNewLeads !== null && prioritizeNewLeads !== undefined) body.prioritize_new_leads = prioritizeNewLeads
      if (autoVariantSelect) body.auto_variant_select = autoVariantSelect
      if (matchLeadEsp !== null && matchLeadEsp !== undefined) body.match_lead_esp = matchLeadEsp
      if (stopForCompany !== null && stopForCompany !== undefined) body.stop_for_company = stopForCompany
      if (insertUnsubscribeHeader !== null && insertUnsubscribeHeader !== undefined) body.insert_unsubscribe_header = insertUnsubscribeHeader
      if (allowRiskyContacts !== null && allowRiskyContacts !== undefined) body.allow_risky_contacts = allowRiskyContacts
      if (disableBounceProtect !== null && disableBounceProtect !== undefined) body.disable_bounce_protect = disableBounceProtect
      if (limitEmailsPerCompanyOverride) body.limit_emails_per_company_override = limitEmailsPerCompanyOverride
      if (ccList) body.cc_list = ccList
      if (bccList) body.bcc_list = bccList
      if (ownedBy) body.owned_by = ownedBy
      if (providerRoutingRules) body.provider_routing_rules = providerRoutingRules

      const response = await this.#apiRequest({
        logTag: 'updateCampaign',
        method: 'patch',
        url: `${ API_BASE_URL }/campaigns/${ id }`,
        body,
      })

      logger.debug('[updateCampaign] Campaign updated successfully')

      return response

    } catch (error) {
      logger.error('[updateCampaign] Error:', error.message)
      throw new Error(`Failed to update campaign: ${ error.message }`)
    }
  }

  /**
   * @operationName Activate Campaign
   * @category Campaigns
   * @description Start or resume a campaign to begin sending emails to leads.
   * @route POST /activate-campaign
   *
   * @paramDef {"type":"String","label":"Campaign","name":"id","required":true,"dictionary":"getCampaignsDict","description":"The ID of the campaign to activate."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Campaign activated successfully"}
   */
  async activateCampaign(id) {
    try {
      logger.debug('[activateCampaign] Activating campaign:', id)

      if (!id) throw new Error('Campaign ID is required')

      const response = await this.#apiRequest({
        logTag: 'activateCampaign',
        method: 'post',
        url: `${ API_BASE_URL }/campaigns/${ id }/activate`,
      })

      logger.debug('[activateCampaign] Campaign activated successfully')

      return { success: true, message: 'Campaign activated successfully', data: response }

    } catch (error) {
      logger.error('[activateCampaign] Error:', error.message)
      throw new Error(`Failed to activate campaign: ${ error.message }`)
    }
  }

  /**
   * @operationName Pause Campaign
   * @category Campaigns
   * @description Stop or pause a campaign to temporarily halt email sending.
   * @route POST /pause-campaign
   *
   * @paramDef {"type":"String","label":"Campaign","name":"id","required":true,"dictionary":"getCampaignsDict","description":"The ID of the campaign to pause."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Campaign paused successfully"}
   */
  async pauseCampaign(id) {
    try {
      logger.debug('[pauseCampaign] Pausing campaign:', id)

      if (!id) throw new Error('Campaign ID is required')

      const response = await this.#apiRequest({
        logTag: 'pauseCampaign',
        method: 'post',
        url: `${ API_BASE_URL }/campaigns/${ id }/pause`,
      })

      logger.debug('[pauseCampaign] Campaign paused successfully')

      return { success: true, message: 'Campaign paused successfully', data: response }

    } catch (error) {
      logger.error('[pauseCampaign] Error:', error.message)
      throw new Error(`Failed to pause campaign: ${ error.message }`)
    }
  }

  /**
   * @operationName Duplicate Campaign
   * @category Campaigns
   * @description Create a duplicate copy of an existing campaign with all its settings and sequences.
   * @route POST /duplicate-campaign
   *
   * @paramDef {"type":"String","label":"Campaign","name":"id","required":true,"dictionary":"getCampaignsDict","description":"The ID of the campaign to duplicate."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Campaign duplicated successfully","campaign_id":"new-campaign-id"}
   */
  async duplicateCampaign(id) {
    try {
      logger.debug('[duplicateCampaign] Duplicating campaign:', id)

      if (!id) throw new Error('Campaign ID is required')

      const response = await this.#apiRequest({
        logTag: 'duplicateCampaign',
        method: 'post',
        url: `${ API_BASE_URL }/campaigns/${ id }/duplicate`,
      })

      logger.debug('[duplicateCampaign] Campaign duplicated successfully')

      return response

    } catch (error) {
      logger.error('[duplicateCampaign] Error:', error.message)
      throw new Error(`Failed to duplicate campaign: ${ error.message }`)
    }
  }

  /**
   * @operationName Search Campaigns by Contact
   * @category Campaigns
   * @description Search for campaigns that contain a specific lead email address.
   * @route POST /search-campaigns-by-contact
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Lead email address to search for.","dictionary":"getLeadsDict"}
   * @paramDef {"type":"String","label":"Sort Column","name":"sortColumn","description":"Column name to sort by."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction."}
   *
   * @returns {Object}
   * @sampleResult {"campaigns":[{"id":"campaign123","name":"Outreach Q1","has_contact":true}]}
   */
  async searchCampaignsByContact(search, sortColumn, sortOrder) {
    try {
      logger.debug('[searchCampaignsByContact] Searching campaigns')

      const query = {}
      if (search) query.search = search
      if (sortColumn) query.sort_column = sortColumn
      if (sortOrder) query.sort_order = sortOrder

      const response = await this.#apiRequest({
        logTag: 'searchCampaignsByContact',
        method: 'get',
        url: `${ API_BASE_URL }/campaigns/search-by-contact`,
        query,
      })

      logger.debug('[searchCampaignsByContact] Search completed successfully')

      return response

    } catch (error) {
      logger.error('[searchCampaignsByContact] Error:', error.message)
      throw new Error(`Failed to search campaigns by contact: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Campaign Analytics
   * @category Campaigns
   * @description Retrieve analytics and performance metrics for one or more campaigns.
   * @route POST /get-campaign-analytics
   *
   * @paramDef {"type":"String","label":"Campaign","name":"id","dictionary":"getCampaignsDict","description":"Campaign ID (leave empty for all campaigns)."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Start date for analytics range."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"End date for analytics range."}
   * @paramDef {"type":"Boolean","label":"Exclude Total Leads","name":"excludeTotalLeadsCount","uiComponent":{"type":"TOGGLE"},"description":"Exclude total leads count for faster response."}
   *
   * @returns {Object}
   * @sampleResult {"sent":1000,"opened":450,"replied":120,"bounced":25,"clicked":200}
   */
  async getCampaignAnalytics(id, startDate, endDate, excludeTotalLeadsCount) {
    try {
      logger.debug('[getCampaignAnalytics] Getting analytics')

      const query = {}

      if (id) query.id = id
      if (startDate) query.start_date = startDate
      if (endDate) query.end_date = endDate

      if (excludeTotalLeadsCount !== null && excludeTotalLeadsCount !== undefined) {
        query.exclude_total_leads_count = excludeTotalLeadsCount
      }

      const response = await this.#apiRequest({
        logTag: 'getCampaignAnalytics',
        method: 'get',
        url: `${ API_BASE_URL }/campaigns/analytics`,
        query,
      })

      logger.debug('[getCampaignAnalytics] Analytics retrieved successfully')

      return response

    } catch (error) {
      logger.error('[getCampaignAnalytics] Error:', error.message)
      throw new Error(`Failed to get campaign analytics: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Campaign Analytics Overview
   * @category Campaigns
   * @description Retrieve a high-level overview of campaign analytics and performance metrics.
   * @route POST /get-campaign-analytics-overview
   *
   * @paramDef {"type":"String","label":"Campaign","name":"id","dictionary":"getCampaignsDict","description":"Campaign ID (leave empty for all campaigns)."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Start date for analytics range."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"End date for analytics range."}
   * @paramDef {"type":"Number","label":"Campaign Status","name":"campaignStatus","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Filter by campaign status."}
   *
   * @returns {Object}
   * @sampleResult {"total_sent":5000,"total_opened":2250,"total_replied":600,"open_rate":0.45,"reply_rate":0.12}
   */
  async getCampaignAnalyticsOverview(id, startDate, endDate, campaignStatus) {
    try {
      logger.debug('[getCampaignAnalyticsOverview] Getting analytics overview')

      const query = {}
      if (id) query.id = id
      if (startDate) query.start_date = startDate
      if (endDate) query.end_date = endDate
      if (campaignStatus !== null && campaignStatus !== undefined) query.campaign_status = campaignStatus

      const response = await this.#apiRequest({
        logTag: 'getCampaignAnalyticsOverview',
        method: 'get',
        url: `${ API_BASE_URL }/campaigns/analytics/overview`,
        query,
      })

      logger.debug('[getCampaignAnalyticsOverview] Analytics overview retrieved successfully')

      return response

    } catch (error) {
      logger.error('[getCampaignAnalyticsOverview] Error:', error.message)
      throw new Error(`Failed to get campaign analytics overview: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Daily Campaign Analytics
   * @category Campaigns
   * @description Retrieve day-by-day breakdown of campaign analytics and performance metrics.
   * @route POST /get-daily-campaign-analytics
   *
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","dictionary":"getCampaignsDict","description":"Campaign ID (leave empty for all campaigns)."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","description":"Start date for analytics range (ISO format)."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","description":"End date for analytics range (ISO format)."}
   * @paramDef {"type":"Number","label":"Campaign Status","name":"campaignStatus","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Filter by campaign status."}
   *
   * @returns {Object}
   * @sampleResult {"daily_stats":[{"date":"2024-01-01","sent":100,"opened":45,"replied":12}]}
   */
  async getDailyCampaignAnalytics(campaignId, startDate, endDate, campaignStatus) {
    try {
      logger.debug('[getDailyCampaignAnalytics] Getting daily analytics')

      const query = {}
      if (campaignId) query.campaign_id = campaignId
      if (startDate) query.start_date = startDate
      if (endDate) query.end_date = endDate
      if (campaignStatus !== null && campaignStatus !== undefined) query.campaign_status = campaignStatus

      const response = await this.#apiRequest({
        logTag: 'getDailyCampaignAnalytics',
        method: 'get',
        url: `${ API_BASE_URL }/campaigns/analytics/daily`,
        query,
      })

      logger.debug('[getDailyCampaignAnalytics] Daily analytics retrieved successfully')

      return response

    } catch (error) {
      logger.error('[getDailyCampaignAnalytics] Error:', error.message)
      throw new Error(`Failed to get daily campaign analytics: ${ error.message }`)
    }
  }

  // ============================================================================
  // TRIGGERS
  // ============================================================================

  /**
   * Helper method to fetch available event types from Instantly API
   * @returns {Promise<Array>} Array of event type objects with id and label
   */
  async #getEventTypes() {
    try {
      const response = await this.#apiRequest({
        logTag: 'getEventTypes',
        method: 'get',
        url: `${ API_BASE_URL }/webhooks/event-types`,
      })

      return response.event_types || []
    } catch (error) {
      logger.error('[getEventTypes] Error fetching event types:', error.message)

      // Return empty array on error - dictionary will handle gracefully
      return []
    }
  }

  /**
   * @operationName Activity Event
   * @category Triggers
   * @description Triggers when activity occurs in your Instantly workspace. This could be an email being sent, a new reply or bounce being detected, or a lead unsubscribing or opening your emails.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-activity-event
   *
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","required":true,"dictionary":"getEventTypesDict","description":"The type of event to listen for in your Instantly workspace."}
   *
   * @returns {Object}
   * @sampleResult {"timestamp":"2025-10-19T12:00:00Z","event_type":"Email Sent","workspace":"0199edb7-e363-7042-89c2-dc9b72cd03b3","campaign_id":"0199edb7-e363-7042-89c2-dc9adc8e54b3","campaign_name":"Outreach Campaign","lead_email":"john.doe@example.com","email_account":"sender@company.com"}
   */
  async onActivityEvent() {}

  // ============================================================================
  // DICTIONARY METHODS - For dynamic dropdown options
  // ============================================================================

  /**
   * @typedef {Object} getCampaignsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search term for filtering campaigns by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Campaigns Dictionary
   * @description Provides a searchable list of campaigns for dynamic parameter selection.
   * @route POST /get-campaigns-dict
   * @paramDef {"type":"getCampaignsDict__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering campaigns."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome Campaign","value":"campaign-123","note":"Status: Active"}],"cursor":"next-page-cursor"}
   */
  async getCampaignsDict(payload) {
    try {
      const { search, cursor } = payload || {}
      const response = await this.listCampaigns(100, cursor, search)

      const items = (response.items || []).map(campaign => ({
        label: campaign.name,
        value: campaign.id,
        note: `Status: ${ campaign.status === 1 ? 'Active' : campaign.status === 0 ? 'Paused' : 'Unknown' }`,
      }))

      return {
        items,
        cursor: response.next_starting_after || undefined,
      }
    } catch (error) {
      logger.error('[getCampaignsDict] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @typedef {Object} getAccountsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search term for filtering accounts by email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Accounts Dictionary
   * @description Provides a searchable list of email accounts for dynamic parameter selection.
   * @route POST /get-accounts-dict
   * @paramDef {"type":"getAccountsDict__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering accounts."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"sender@example.com","value":"sender@example.com","note":"John Doe"}],"cursor":"next-page-cursor"}
   */
  async getAccountsDict(payload) {
    try {
      const { search, cursor } = payload || {}
      const response = await this.listAccounts(100, cursor, search)

      const items = (response.items || []).map(account => ({
        label: account.email,
        value: account.email,
        note: `${ account.first_name || '' } ${ account.last_name || '' }`.trim() || 'No name',
      }))

      return {
        items,
        cursor: response.next_starting_after || undefined,
      }
    } catch (error) {
      logger.error('[getAccountsDict] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @typedef {Object} getLeadListsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search term for filtering lead lists by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lead Lists Dictionary
   * @description Provides a searchable list of lead lists for dynamic parameter selection.
   * @route POST /get-lead-lists-dict
   * @paramDef {"type":"getLeadListsDict__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering lead lists."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"VIP Leads","value":"list-123","note":"Leads: 250"}],"cursor":"next-page-cursor"}
   */
  async getLeadListsDict(payload) {
    try {
      const { search, cursor } = payload || {}
      const response = await this.listLeadLists(100, cursor, search)

      const items = (response.items || []).map(list => ({
        label: list.name,
        value: list.id,
        note: `Leads: ${ list.lead_count || 0 }`,
      }))

      return {
        items,
        cursor: response.next_starting_after || undefined,
      }
    } catch (error) {
      logger.error('[getLeadListsDict] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @typedef {Object} getTagsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search term for filtering tags by label."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Provides a searchable list of custom tags for dynamic parameter selection.
   * @route POST /get-tags-dict
   * @paramDef {"type":"getTagsDict__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering tags."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"VIP","value":"tag-123","note":"For important contacts"}],"cursor":"next-page-cursor"}
   */
  async getTagsDict(payload) {
    try {
      const { search, cursor } = payload || {}
      const response = await this.listTags(100, cursor, search)

      const items = (response.items || []).map(tag => ({
        label: tag.label,
        value: tag.id,
        note: tag.description || 'No description',
      }))

      return {
        items,
        cursor: response.next_starting_after || undefined,
      }
    } catch (error) {
      logger.error('[getTagsDict] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @typedef {Object} getLeadLabelsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search term for filtering lead labels by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lead Labels Dictionary
   * @description Provides a searchable list of lead labels for dynamic parameter selection.
   * @route POST /get-lead-labels-dict
   * @paramDef {"type":"getLeadLabelsDict__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering lead labels."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Interested","value":"label-123","note":"Status: positive"}],"cursor":"next-page-cursor"}
   */
  async getLeadLabelsDict(payload) {
    try {
      const { search, cursor } = payload || {}
      const response = await this.listLeadLabels(100, cursor, search)

      const items = (response.items || []).map(label => ({
        label: label.label,
        value: label.id,
        note: `Status: ${ label.interest_status_label || 'None' }`,
      }))

      return {
        items,
        cursor: response.next_starting_after || undefined,
      }
    } catch (error) {
      logger.error('[getLeadLabelsDict] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @typedef {Object} getLeadsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search term for filtering leads by email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */
  /**
   * @registerAs DICTIONARY
   * @operationName Get Leads Dictionary
   * @description Provides a searchable list of leads for dynamic parameter selection.
   * @route POST /get-leads-dict
   * @paramDef {"type":"getLeadsDict__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering leads."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"john@example.com - John Doe","value":"01996da2-2642-7217-9b78-c20b687ade51","note":"Status: active"}],"cursor":"next-page-cursor"}
   */
  async getLeadsDict(payload) {
    try {
      const { search, cursor } = payload || {}
      const response = await this.listLeads(100, cursor, null, null)

      const items = (response.items || []).map(lead => ({
        label: `${ lead.email }${ lead.first_name || lead.last_name ? ` - ${ lead.first_name || '' } ${ lead.last_name || '' }`.trim() : '' }`,
        value: lead.id,
        note: `Status: ${ lead.status || 'unknown' }`,
      }))

      // Filter by search if provided
      const filteredItems = search
        ? items.filter(item => item.label.toLowerCase().includes(search.toLowerCase()))
        : items

      return {
        items: filteredItems,
        cursor: response.next_starting_after || undefined,
      }
    } catch (error) {
      logger.error('[getLeadsDict] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Event Types Dictionary
   * @description Provides a list of available Instantly activity event types for trigger configuration. Fetches the latest event types dynamically from the Instantly API.
   * @route POST /get-event-types-dict
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Empty payload for event types dictionary."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Email Sent","value":"email_sent"},{"label":"Reply Received","value":"reply_received"}]}
   */
  async getEventTypesDict(payload) {
    try {
      // Fetch event types dynamically from Instantly API
      const eventTypes = await this.#getEventTypes()

      // Transform to dictionary format
      const items = eventTypes.map(eventType => ({
        label: eventType.label,
        value: eventType.id,
        note: eventType.type === 'custom' ? 'Custom Event' : undefined,
      }))

      return { items }
    } catch (error) {
      logger.error('[getEventTypesDict] Error:', error.message)

      return { items: [] }
    }
  }

  // ============================================================================
  // PARAM SCHEMA LOADERS
  // ============================================================================

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object", "name":"payload", "required":true}
   * @returns {Object}
   * */
  async createImapSettingsSchemaLoader() {
    return [
      {
        type: 'String',
        label: 'IMAP Username',
        name: 'imapUsername',
        required: true,
        description: 'IMAP username for receiving emails.',
      },
      {
        type: 'String',
        label: 'IMAP Password',
        name: 'imapPassword',
        required: true,
        description: 'IMAP password for authentication.',
      },
      {
        type: 'String',
        label: 'IMAP Host',
        name: 'imapHost',
        required: true,
        description: 'IMAP server hostname (e.g., imap.gmail.com).',
      },
      {
        type: 'Number',
        label: 'IMAP Port',
        name: 'imapPort',
        required: true,
        description: 'IMAP server port (usually 993 for SSL/TLS).',
        uiComponent: { type: 'NUMERIC_STEPPER' },
      },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object", "name":"payload", "required":true}
   * @returns {Object}
   * */
  async createSmtpSettingsSchemaLoader() {
    return [
      {
        type: 'String',
        label: 'SMTP Username',
        name: 'smtpUsername',
        required: true,
        description: 'SMTP username for sending emails.',
      },
      {
        type: 'String',
        label: 'SMTP Password',
        name: 'smtpPassword',
        required: true,
        description: 'SMTP password for authentication.',
      },
      {
        type: 'String',
        label: 'SMTP Host',
        name: 'smtpHost',
        required: true,
        description: 'SMTP server hostname (e.g., smtp.gmail.com).',
      },
      {
        type: 'Number',
        label: 'SMTP Port',
        name: 'smtpPort',
        required: true,
        description: 'SMTP server port (usually 587 for TLS or 465 for SSL).',
        uiComponent: { type: 'NUMERIC_STEPPER' },
      },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object", "name":"payload", "required":true}
   * @returns {Object}
   * */
  async createWarmupSettingsSchemaLoader() {
    return [
      {
        type: 'Number',
        label: 'Email Limit',
        name: 'limit',
        required: false,
        description: 'Email sending limit during warmup phase.',
        uiComponent: { type: 'NUMERIC_STEPPER' },
      },
      {
        type: 'String',
        label: 'Daily Increment',
        name: 'increment',
        required: false,
        description: 'Daily increment for email sending limits during warmup (e.g., \'5\' to increase by 5 emails per day).',
      },
      {
        type: 'Number',
        label: 'Reply Rate',
        name: 'reply_rate',
        required: false,
        description: 'Expected reply rate during warmup (0-100).',
        uiComponent: { type: 'NUMERIC' },
      },
      {
        type: 'String',
        label: 'Custom Tag',
        name: 'warmup_custom_ftag',
        required: false,
        description: 'Custom tag for warmup emails.',
      },
      {
        type: 'Object',
        label: 'Advanced Settings',
        name: 'advanced',
        required: false,
        description: 'Advanced warmup configuration options.',
        schemaLoader: 'createWarmupAdvancedSchemaLoader',
      },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object", "name":"payload", "required":true}
   * @returns {Object}
   * */
  async createWarmupAdvancedSchemaLoader() {
    return [
      {
        type: 'Boolean',
        label: 'Warm Custom Tracking Domain',
        name: 'warm_ctd',
        required: false,
        description: 'Enable warmup for custom tracking domain.',
        uiComponent: { type: 'TOGGLE' },
      },
      {
        type: 'Number',
        label: 'Open Rate',
        name: 'open_rate',
        required: false,
        description: 'Target open rate during warmup (0-100).',
        uiComponent: { type: 'NUMERIC' },
      },
      {
        type: 'Number',
        label: 'Important Rate',
        name: 'important_rate',
        required: false,
        description: 'Target important email rate during warmup (0-100).',
        uiComponent: { type: 'NUMERIC' },
      },
      {
        type: 'Boolean',
        label: 'Read Emulation',
        name: 'read_emulation',
        required: false,
        description: 'Enable read emulation during warmup.',
        uiComponent: { type: 'TOGGLE' },
      },
      {
        type: 'Number',
        label: 'Spam Save Rate',
        name: 'spam_save_rate',
        required: false,
        description: 'Target spam save rate during warmup (0-100).',
        uiComponent: { type: 'NUMERIC' },
      },
      {
        type: 'Boolean',
        label: 'Weekdays Only',
        name: 'weekday_only',
        required: false,
        description: 'Send warmup emails only on weekdays.',
        uiComponent: { type: 'TOGGLE' },
      },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object", "name":"payload", "required":true}
   * @returns {Object}
   * */
  async createCampaignScheduleSchemaLoader() {
    return [
      {
        type: 'String',
        label: 'Timezone',
        name: 'timezone',
        required: false,
        description: 'Timezone for campaign scheduling (e.g., "America/New_York").',
      },
      {
        type: 'Array<Number>',
        label: 'Days of Week',
        name: 'days',
        required: false,
        description: 'Days of the week to send emails (0=Sunday, 6=Saturday).',
      },
      {
        type: 'Object',
        label: 'Time Slots',
        name: 'time_slots',
        required: false,
        description: 'Time slots for sending emails with start and end times.',
      },
      {
        type: 'Number',
        label: 'Min Time Between Emails',
        name: 'min_time_btw_emails',
        required: false,
        description: 'Minimum time between emails in minutes.',
        uiComponent: { type: 'NUMERIC_STEPPER' },
      },
      {
        type: 'Number',
        label: 'Max New Leads Per Day',
        name: 'max_new_leads_per_day',
        required: false,
        description: 'Maximum number of new leads to contact per day.',
        uiComponent: { type: 'NUMERIC_STEPPER' },
      },
    ]
  }

  // ============================================================================
  // TRIGGER SYSTEM
  // ============================================================================

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug('[handleTriggerResolveEvents] Processing webhook event:', JSON.stringify(invocation.body))

    return {
      events: [
        {
          name: 'onActivityEvent',
          data: invocation.body,
        },
      ],
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug('[handleTriggerUpsertWebhook] Upserting webhook:', JSON.stringify(invocation.events))

    const webhookData = invocation.webhookData || {}
    const existingWebhooks = webhookData.webhooks || []

    // Get the callback URL for ALL_APPS scope
    const callbackUrl = invocation.callbackUrl

    // Check if webhook already exists for this event
    const triggerData = invocation.events[0]?.data
    const eventTypeUi = triggerData?.eventType

    if (!eventTypeUi) {
      logger.error('[handleTriggerUpsertWebhook] No event type found in trigger data')

      return { webhookData: { webhooks: existingWebhooks } }
    }

    // Convert plain English to API format (snake_case)
    const eventType = this.#mapEventType(eventTypeUi, 'toApi')

    // Check if we already have a webhook for this event type
    const existingWebhook = existingWebhooks.find(w => w.event_type === eventType)

    if (existingWebhook) {
      logger.debug('[handleTriggerUpsertWebhook] Webhook already exists for event type:', eventType)

      return { webhookData: { webhooks: existingWebhooks } }
    }

    // Create new webhook in Instantly
    try {
      const createdWebhook = await this.#apiRequest({
        logTag: 'createWebhook',
        method: 'post',
        url: `${ API_BASE_URL }/webhooks`,
        body: {
          target_hook_url: callbackUrl,
          event_type: eventType,
        },
      })

      logger.debug('[handleTriggerUpsertWebhook] Webhook created:', JSON.stringify(createdWebhook))

      // Store the webhook info
      const newWebhooks = [
        ...existingWebhooks,
        {
          id: createdWebhook.id,
          event_type: eventType,
          target_hook_url: callbackUrl,
        },
      ]

      return {
        webhookData: { webhooks: newWebhooks },
        eventScopeId: eventType,
      }
    } catch (error) {
      logger.error('[handleTriggerUpsertWebhook] Error creating webhook:', error.message)
      throw error
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug('[handleTriggerSelectMatched] Selecting matched triggers')

    const eventData = invocation.eventData
    const triggers = invocation.triggers

    // Match triggers based on event type
    const matchedTriggerIds = triggers
      .filter(trigger => {
        const triggerEventTypeUi = trigger.data?.eventType
        // Convert plain English to API format for comparison
        const triggerEventType = this.#mapEventType(triggerEventTypeUi, 'toApi')

        return triggerEventType === eventData.event_type
      })
      .map(trigger => trigger.id)

    logger.debug('[handleTriggerSelectMatched] Matched triggers:', matchedTriggerIds)

    return { ids: matchedTriggerIds }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug('[handleTriggerDeleteWebhook] Deleting webhooks')

    const webhookData = invocation.webhookData || {}
    const webhooks = webhookData.webhooks || []

    // Delete all webhooks
    for (const webhook of webhooks) {
      try {
        await this.#apiRequestDelete({
          logTag: 'deleteWebhook',
          url: `${ API_BASE_URL }/webhooks/${ webhook.id }`,
        })

        logger.debug('[handleTriggerDeleteWebhook] Deleted webhook:', webhook.id)
      } catch (error) {
        logger.error('[handleTriggerDeleteWebhook] Error deleting webhook:', webhook.id, error.message)
      }
    }

    return { webhookData: { webhooks: [] } }
  }
}

Flowrunner.ServerCode.addService(Instantly, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your Instantly API key. You can find it in your Instantly workspace settings under API Keys. Get it at: https://app.instantly.ai/app/settings/integrations',
  },
])
