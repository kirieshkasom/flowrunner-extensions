'use strict'

const API_BASE_URL = 'https://api.brevo.com/v3'

const logger = {
  info: (...args) => console.log('[Brevo Service] info:', ...args),
  debug: (...args) => console.log('[Brevo Service] debug:', ...args),
  error: (...args) => console.log('[Brevo Service] error:', ...args),
  warn: (...args) => console.log('[Brevo Service] warn:', ...args),
}

/**
 * @integrationName Brevo
 * @integrationIcon /icon.png
 **/
class Brevo {
  constructor({ apiKey }) {
    this.apiKey = apiKey
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(
        `${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`
      )

      const request = Flowrunner.Request[method](url)
        .set({
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(query)

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      logger.error(`${ logTag } - API request failed:`, error.message)
      throw error
    }
  }

  // ─── Dictionary Typedefs ───────────────────────────────────────────────

  /**
   * @typedef {Object} getSendersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter senders by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter templates by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getListsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter lists by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getPipelinesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter pipelines by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getDealStagesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Pipeline ID","name":"pipelineId","required":true,"description":"The pipeline ID to retrieve stages for."}
   */

  /**
   * @typedef {Object} getDealStagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter deal stages by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   * @paramDef {"type":"getDealStagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters including the pipeline ID to retrieve stages for."}
   */

  /**
   * @typedef {Object} getContactsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter contacts by email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getDealsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter deals by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getCompaniesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter companies by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getTaskTypesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter task types by name."}
   */

  /**
   * @typedef {Object} getTasksDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tasks by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getNotesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter notes by text."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  // ─── Dictionary Methods ────────────────────────────────────────────────

  /**
   * @operationName Get Senders Dictionary
   * @description Retrieves available verified email senders for use in transactional and campaign emails.
   * @route POST /get-senders-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getSendersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering senders."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Doe <john@example.com>","value":"john@example.com","note":"ID: 1"}]}
   */
  async getSendersDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/senders`,
        logTag: 'getSendersDictionary',
      })

      let items = (response.senders || []).map(sender => ({
        label: `${ sender.name } <${ sender.email }>`,
        value: sender.email,
        note: `ID: ${ sender.id }`,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      return { items }
    } catch (error) {
      logger.error('[getSendersDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Templates Dictionary
   * @description Retrieves available email templates for use in template-based email sending.
   * @route POST /get-templates-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering templates."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome Email","value":1,"note":"ID: 1"}]}
   */
  async getTemplatesDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/smtp/templates`,
        query: { limit: 100, offset: 0 },
        logTag: 'getTemplatesDictionary',
      })

      let items = (response.templates || []).map(template => ({
        label: template.name,
        value: template.id,
        note: `ID: ${ template.id }`,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      return { items }
    } catch (error) {
      logger.error('[getTemplatesDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Lists Dictionary
   * @description Retrieves available contact lists for use in contact management operations.
   * @route POST /get-lists-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getListsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering contact lists."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter Subscribers","value":1,"note":"Subscribers: 250"}]}
   */
  async getListsDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts/lists`,
        query: { limit: 50, offset: 0 },
        logTag: 'getListsDictionary',
      })

      let items = (response.lists || []).map(list => ({
        label: list.name,
        value: list.id,
        note: `Subscribers: ${ list.uniqueSubscribers || 0 }`,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      return { items }
    } catch (error) {
      logger.error('[getListsDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Pipelines Dictionary
   * @description Retrieves available CRM pipelines for use in deal management operations.
   * @route POST /get-pipelines-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getPipelinesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering pipelines."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Pipeline","value":"abc123","note":"Stages: 5"}]}
   */
  async getPipelinesDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/pipeline/details/all`,
        logTag: 'getPipelinesDictionary',
      })

      const pipelines = Array.isArray(response) ? response : []

      let items = pipelines.map(pipeline => ({
        label: pipeline.pipeline_name,
        value: pipeline.pipeline,
        note: `Stages: ${ (pipeline.stages || []).length }`,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      return { items }
    } catch (error) {
      logger.error('[getPipelinesDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Deal Stages Dictionary
   * @description Retrieves available deal stages for a specific CRM pipeline.
   * @route POST /get-deal-stages-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getDealStagesDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria with the pipeline ID to retrieve stages for."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Qualification","value":"stage_1"}]}
   */
  async getDealStagesDictionary(payload) {
    const { search, criteria } = payload || {}
    const pipelineId = criteria?.pipelineId

    if (!pipelineId) {
      return { items: [] }
    }

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/pipeline/details/${ pipelineId }`,
        logTag: 'getDealStagesDictionary',
      })

      const stages = response.stages || []

      let items = stages.map(stage => ({
        label: stage.name,
        value: stage.id,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      return { items }
    } catch (error) {
      logger.error('[getDealStagesDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Contacts Dictionary
   * @description Retrieves contacts for use in dynamic selection fields with search and pagination support.
   * @route POST /get-contacts-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getContactsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering contacts."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"john@example.com","value":1,"note":"John Doe"}],"cursor":"50"}
   */
  async getContactsDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = cursor ? parseInt(cursor, 10) : 0

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts`,
        query: { limit: 50, offset },
        logTag: 'getContactsDictionary',
      })

      let items = (response.contacts || []).map(contact => {
        const firstName = contact.attributes?.FIRSTNAME || ''
        const lastName = contact.attributes?.LASTNAME || ''
        const name = `${ firstName } ${ lastName }`.trim()

        return {
          label: contact.email,
          value: contact.id,
          note: name || 'No name',
        }
      })

      if (search) {
        const term = search.toLowerCase()

        items = items.filter(
          item =>
            item.label.toLowerCase().includes(term) ||
            item.note.toLowerCase().includes(term)
        )
      }

      const totalContacts = response.count || 0
      const nextOffset = offset + 50
      const nextCursor = nextOffset < totalContacts ? String(nextOffset) : null

      return { items, cursor: nextCursor }
    } catch (error) {
      logger.error('[getContactsDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Deals Dictionary
   * @description Retrieves CRM deals for dynamic selection fields with search and pagination support.
   * @route POST /get-deals-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getDealsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering deals."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Enterprise License","value":"64a5f3c2e1b9d8a7b6c5d4e3"}],"cursor":null}
   */
  async getDealsDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = cursor ? parseInt(cursor, 10) : 0

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/deals`,
        query: { limit: 50, offset },
        logTag: 'getDealsDictionary',
      })

      const deals = response.items || []

      let items = deals.map(deal => ({
        label: deal.attributes?.deal_name || deal.id,
        value: deal.id,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      const nextCursor = deals.length === 50 ? String(offset + 50) : null

      return { items, cursor: nextCursor }
    } catch (error) {
      logger.error('[getDealsDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Companies Dictionary
   * @description Retrieves CRM companies for dynamic selection fields with search and pagination support.
   * @route POST /get-companies-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getCompaniesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering companies."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Corp","value":"64a5f3c2e1b9d8a7b6c5d4e3"}],"cursor":null}
   */
  async getCompaniesDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = cursor ? parseInt(cursor, 10) : 0

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/companies`,
        query: { limit: 50, offset },
        logTag: 'getCompaniesDictionary',
      })

      const companies = response.items || []

      let items = companies.map(company => ({
        label: company.attributes?.name || company.id,
        value: company.id,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      const nextCursor = companies.length === 50 ? String(offset + 50) : null

      return { items, cursor: nextCursor }
    } catch (error) {
      logger.error('[getCompaniesDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Task Types Dictionary
   * @description Retrieves available CRM task types for use when creating tasks.
   * @route POST /get-task-types-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getTaskTypesDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string for filtering task types."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Call","value":"61a5ce58c5d4795761045990"}]}
   */
  async getTaskTypesDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/tasktypes`,
        logTag: 'getTaskTypesDictionary',
      })

      const taskTypes = Array.isArray(response) ? response : []

      let items = taskTypes.map(taskType => ({
        label: taskType.title || taskType.id,
        value: taskType.id,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      return { items }
    } catch (error) {
      logger.error('[getTaskTypesDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Tasks Dictionary
   * @description Retrieves CRM tasks for dynamic selection fields with search and pagination support.
   * @route POST /get-tasks-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getTasksDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering tasks."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Follow up with client","value":"64a5f3c2e1b9d8a7b6c5d4e3"}],"cursor":null}
   */
  async getTasksDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = cursor ? parseInt(cursor, 10) : 0

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/tasks`,
        query: { limit: 50, offset },
        logTag: 'getTasksDictionary',
      })

      const tasks = response.items || []

      let items = tasks.map(task => ({
        label: task.name || task.id,
        value: task.id,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      const nextCursor = tasks.length === 50 ? String(offset + 50) : null

      return { items, cursor: nextCursor }
    } catch (error) {
      logger.error('[getTasksDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Notes Dictionary
   * @description Retrieves CRM notes for dynamic selection fields with search and pagination support.
   * @route POST /get-notes-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getNotesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering notes."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Client requested a demo session next week.","value":"64a5f3c2e1b9d8a7b6c5d4e3"}],"cursor":null}
   */
  async getNotesDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = cursor ? parseInt(cursor, 10) : 0

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/notes`,
        query: { limit: 50, offset },
        logTag: 'getNotesDictionary',
      })

      const notes = Array.isArray(response) ? response : response.items || []

      let items = notes.map(note => {
        const text = note.text || ''
        const label =
          text.length > 60 ? `${ text.slice(0, 57) }...` : text || note.id

        return { label, value: note.id }
      })

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      const nextCursor = notes.length === 50 ? String(offset + 50) : null

      return { items, cursor: nextCursor }
    } catch (error) {
      logger.error('[getNotesDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  // ─── Email Sending ─────────────────────────────────────────────────────

  /**
   * @description Send a transactional email to a single recipient with full customization of sender, content, and scheduling options.
   * @route POST /send-transactional-email
   *
   * @operationName Send Transactional Email
   * @category Email Sending
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Sender Email","name":"senderEmail","required":true,"description":"Email address of the sender. Must be a verified sender in your Brevo account."}
   * @paramDef {"type":"String","label":"Sender Name","name":"senderName","description":"Display name of the sender shown in the recipient's inbox."}
   * @paramDef {"type":"String","label":"To Email","name":"toEmail","required":true,"description":"Email address of the recipient."}
   * @paramDef {"type":"String","label":"To Name","name":"toName","description":"Display name of the recipient."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Subject line of the email."}
   * @paramDef {"type":"String","label":"HTML Content","name":"htmlContent","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML body content of the email. Either HTML or text content must be provided."}
   * @paramDef {"type":"String","label":"Text Content","name":"textContent","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain text body content of the email. Used as fallback when HTML is not supported."}
   * @paramDef {"type":"String","label":"CC Email","name":"ccEmail","description":"Email address of the CC recipient."}
   * @paramDef {"type":"String","label":"BCC Email","name":"bccEmail","description":"Email address of the BCC recipient."}
   * @paramDef {"type":"String","label":"Reply-To Email","name":"replyToEmail","description":"Email address that replies will be directed to."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","description":"Comma-separated tags to categorize and track the email (e.g. 'welcome,onboarding')."}
   * @paramDef {"type":"String","label":"Scheduled At","name":"scheduledAt","description":"ISO 8601 datetime to schedule the email for future delivery (e.g. '2025-01-15T10:00:00Z')."}
   *
   * @returns {Object}
   * @sampleResult {"messageId":"<202501150900.abc123@smtp-relay.brevo.com>"}
   */
  async sendTransactionalEmail(
    senderEmail,
    senderName,
    toEmail,
    toName,
    subject,
    htmlContent,
    textContent,
    ccEmail,
    bccEmail,
    replyToEmail,
    tags,
    scheduledAt
  ) {
    const logTag = 'sendTransactionalEmail'

    const payload = {
      sender: { email: senderEmail },
      to: [{ email: toEmail }],
      subject,
    }

    if (senderName) {
      payload.sender.name = senderName
    }

    if (toName) {
      payload.to[0].name = toName
    }

    if (htmlContent) {
      payload.htmlContent = htmlContent
    }

    if (textContent) {
      payload.textContent = textContent
    }

    if (ccEmail) {
      payload.cc = [{ email: ccEmail }]
    }

    if (bccEmail) {
      payload.bcc = [{ email: bccEmail }]
    }

    if (replyToEmail) {
      payload.replyTo = { email: replyToEmail }
    }

    if (tags) {
      payload.tags = tags.split(',').map(t => t.trim())
    }

    if (scheduledAt) {
      payload.scheduledAt = scheduledAt
    }

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/smtp/email`,
        method: 'post',
        body: payload,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to send transactional email: ${ error.message }`)
    }
  }

  /**
   * @description Send an email using a pre-built Brevo template with dynamic variables and recipient customization.
   * @route POST /send-template-email
   *
   * @operationName Send Template Email
   * @category Email Sending
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The ID of the Brevo email template to use."}
   * @paramDef {"type":"String","label":"To Email","name":"toEmail","required":true,"description":"Email address of the recipient."}
   * @paramDef {"type":"String","label":"To Name","name":"toName","description":"Display name of the recipient."}
   * @paramDef {"type":"String","label":"Sender Email","name":"senderEmail","description":"Override the template's default sender email address. Must be a verified sender."}
   * @paramDef {"type":"String","label":"Sender Name","name":"senderName","description":"Override the template's default sender display name."}
   * @paramDef {"type":"String","label":"Template Parameters","name":"params","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON object with key-value pairs for template variables (e.g. '{\"firstName\":\"John\",\"orderNumber\":\"12345\"}')."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","description":"Comma-separated tags to categorize and track the email."}
   * @paramDef {"type":"String","label":"Scheduled At","name":"scheduledAt","description":"ISO 8601 datetime to schedule the email for future delivery (e.g. '2025-01-15T10:00:00Z')."}
   *
   * @returns {Object}
   * @sampleResult {"messageId":"<202501150900.abc123@smtp-relay.brevo.com>"}
   */
  async sendTemplateEmail(
    templateId,
    toEmail,
    toName,
    senderEmail,
    senderName,
    params,
    tags,
    scheduledAt
  ) {
    const logTag = 'sendTemplateEmail'

    const payload = {
      templateId,
      to: [{ email: toEmail }],
    }

    if (toName) {
      payload.to[0].name = toName
    }

    if (senderEmail) {
      payload.sender = { email: senderEmail }

      if (senderName) {
        payload.sender.name = senderName
      }
    }

    if (params) {
      try {
        payload.params =
          typeof params === 'string' ? JSON.parse(params) : params
      } catch (e) {
        throw new Error('Template Parameters must be a valid JSON object.')
      }
    }

    if (tags) {
      payload.tags = tags.split(',').map(t => t.trim())
    }

    if (scheduledAt) {
      payload.scheduledAt = scheduledAt
    }

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/smtp/email`,
        method: 'post',
        body: payload,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to send template email: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve a list of available email templates from your Brevo account with pagination support.
   * @route POST /get-email-templates
   *
   * @operationName Get Email Templates
   * @category Email Sending
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Maximum number of templates to return per page (1-1000). Default: 50.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Index of the first template to return for pagination. Default: 0.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   *
   * @returns {Object}
   * @sampleResult {"count":2,"templates":[{"id":1,"name":"Welcome Email","subject":"Welcome!","isActive":true,"createdAt":"2025-01-10T08:00:00.000Z","modifiedAt":"2025-01-12T10:30:00.000Z"}]}
   */
  async getEmailTemplates(limit, offset) {
    const logTag = 'getEmailTemplates'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/smtp/templates`,
        query: { limit: limit || 50, offset: offset || 0 },
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get email templates: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve a list of transactional emails with filtering by recipient, event type, and date range.
   * @route POST /get-transactional-emails
   *
   * @operationName Get Transactional Emails
   * @category Email Sending
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Filter results by recipient email address."}
   * @paramDef {"type":"String","label":"Event","name":"event","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"sent","label":"Sent"},{"value":"delivered","label":"Delivered"},{"value":"opened","label":"Opened"},{"value":"clicked","label":"Clicked"},{"value":"bounced","label":"Bounced"},{"value":"blocked","label":"Blocked"}]}},"description":"Filter results by email event type."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Maximum number of records to return per page (1-500). Default: 50.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Index of the first record to return for pagination. Default: 0.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","description":"Start date for filtering results in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","description":"End date for filtering results in YYYY-MM-DD format."}
   *
   * @returns {Object}
   * @sampleResult {"transactionalEmails":[{"email":"john@example.com","subject":"Welcome!","messageId":"<abc123@smtp-relay.brevo.com>","event":"delivered","date":"2025-01-15T10:00:00.000Z"}]}
   */
  async getTransactionalEmails(
    email,
    event,
    limit,
    offset,
    startDate,
    endDate
  ) {
    const logTag = 'getTransactionalEmails'

    const query = {
      limit: limit || 50,
      offset: offset || 0,
    }

    if (email) query.email = email
    if (event) query.event = event
    if (startDate) query.startDate = startDate
    if (endDate) query.endDate = endDate

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/smtp/emails`,
        query,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get transactional emails: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve aggregated email statistics for transactional emails with optional date range and tag filtering.
   * @route POST /get-email-statistics
   *
   * @operationName Get Email Statistics
   * @category Email Sending
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","description":"Start date for the statistics period in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","description":"End date for the statistics period in YYYY-MM-DD format."}
   * @paramDef {"type":"Number","label":"Days","name":"days","description":"Number of days to retrieve statistics for (overrides start/end date if provided).","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Filter statistics by a specific email tag."}
   *
   * @returns {Object}
   * @sampleResult {"range":"2025-01-01 to 2025-01-15","requests":1500,"delivered":1450,"opens":800,"clicks":200,"bounces":30,"hardBounces":5,"softBounces":25,"blocked":20,"invalid":0,"unsubscribed":10}
   */
  async getEmailStatistics(startDate, endDate, days, tag) {
    const logTag = 'getEmailStatistics'

    const query = {}

    if (startDate) query.startDate = startDate
    if (endDate) query.endDate = endDate
    if (days) query.days = days
    if (tag) query.tag = tag

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/smtp/statistics/aggregatedReport`,
        query,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get email statistics: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve all verified email senders configured in your Brevo account.
   * @route POST /get-senders
   *
   * @operationName Get Senders
   * @category Email Sending
   * @appearanceColor #0B996E #0FD191
   *
   * @returns {Object}
   * @sampleResult {"senders":[{"id":1,"name":"John Doe","email":"john@example.com","active":true}]}
   */
  async getSenders() {
    const logTag = 'getSenders'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/senders`,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get senders: ${ error.message }`)
    }
  }

  // ─── Contacts ──────────────────────────────────────────────────────────

  /**
   * @description Create a new contact in Brevo with email, personal details, list assignments, and custom attributes.
   * @route POST /create-contact
   *
   * @operationName Create Contact
   * @category Contacts
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the contact to create."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"First name of the contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Last name of the contact."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number of the contact in international format (e.g. '+14155552671')."}
   * @paramDef {"type":"String","label":"List IDs","name":"listIds","description":"Comma-separated list of contact list IDs to add the contact to (e.g. '1,5,12')."}
   * @paramDef {"type":"String","label":"Attributes","name":"attributes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON object with additional contact attributes (e.g. '{\"COMPANY\":\"Acme\",\"CITY\":\"Paris\"}')."}
   * @paramDef {"type":"Boolean","label":"Update Enabled","name":"updateEnabled","uiComponent":{"type":"TOGGLE"},"description":"Enable to update the contact if it already exists instead of returning an error."}
   *
   * @returns {Object}
   * @sampleResult {"id":123}
   */
  async createContact(
    email,
    firstName,
    lastName,
    phone,
    listIds,
    attributes,
    updateEnabled
  ) {
    const logTag = 'createContact'

    const payload = {
      email,
      updateEnabled: updateEnabled || false,
    }

    const attrs = {}

    if (firstName) attrs.FIRSTNAME = firstName
    if (lastName) attrs.LASTNAME = lastName
    if (phone) attrs.SMS = phone

    if (attributes) {
      try {
        const extraAttrs =
          typeof attributes === 'string' ? JSON.parse(attributes) : attributes
        Object.assign(attrs, extraAttrs)
      } catch (e) {
        throw new Error('Attributes must be a valid JSON object.')
      }
    }

    if (Object.keys(attrs).length > 0) {
      payload.attributes = attrs
    }

    if (listIds) {
      payload.listIds = listIds.split(',').map(id => parseInt(id.trim(), 10))
    }

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts`,
        method: 'post',
        body: payload,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create contact: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve detailed information about a specific contact by email address, ID, or external ID.
   * @route POST /get-contact
   *
   * @operationName Get Contact
   * @category Contacts
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Identifier","name":"identifier","required":true,"description":"The contact identifier. Can be an email address, numeric ID, or external ID (prefixed with 'ext_id:')."}
   *
   * @returns {Object}
   * @sampleResult {"id":123,"email":"john@example.com","emailBlacklisted":false,"smsBlacklisted":false,"createdAt":"2025-01-10T08:00:00.000Z","modifiedAt":"2025-01-12T10:30:00.000Z","attributes":{"FIRSTNAME":"John","LASTNAME":"Doe","SMS":"+14155552671"},"listIds":[1,5],"statistics":{"messagesSent":[{"campaignId":1,"eventTime":"2025-01-12T10:30:00.000Z"}]}}
   */
  async getContact(identifier) {
    const logTag = 'getContact'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(identifier) }`,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get contact: ${ error.message }`)
    }
  }

  /**
   * @description Update an existing contact's information including email, personal details, list memberships, and attributes.
   * @route POST /update-contact
   *
   * @operationName Update Contact
   * @category Contacts
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Identifier","name":"identifier","required":true,"description":"The contact identifier to update. Can be an email address, numeric ID, or external ID."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address for the contact."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Updated first name of the contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Updated last name of the contact."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number in international format (e.g. '+14155552671')."}
   * @paramDef {"type":"String","label":"List IDs","name":"listIds","description":"Comma-separated list IDs to add the contact to (e.g. '1,5,12')."}
   * @paramDef {"type":"String","label":"Unlink List IDs","name":"unlinkListIds","description":"Comma-separated list IDs to remove the contact from (e.g. '3,7')."}
   * @paramDef {"type":"String","label":"Attributes","name":"attributes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON object with contact attributes to update (e.g. '{\"COMPANY\":\"Acme\"}')."}
   * @paramDef {"type":"Boolean","label":"Email Blacklisted","name":"emailBlacklisted","uiComponent":{"type":"TOGGLE"},"description":"Set to true to blacklist the contact's email address."}
   * @paramDef {"type":"Boolean","label":"SMS Blacklisted","name":"smsBlacklisted","uiComponent":{"type":"TOGGLE"},"description":"Set to true to blacklist the contact's phone number for SMS."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateContact(
    identifier,
    email,
    firstName,
    lastName,
    phone,
    listIds,
    unlinkListIds,
    attributes,
    emailBlacklisted,
    smsBlacklisted
  ) {
    const logTag = 'updateContact'

    const payload = {}

    if (email) {
      payload.email = email
    }

    const attrs = {}

    if (firstName) attrs.FIRSTNAME = firstName
    if (lastName) attrs.LASTNAME = lastName
    if (phone) attrs.SMS = phone

    if (attributes) {
      try {
        const extraAttrs =
          typeof attributes === 'string' ? JSON.parse(attributes) : attributes
        Object.assign(attrs, extraAttrs)
      } catch (e) {
        throw new Error('Attributes must be a valid JSON object.')
      }
    }

    if (Object.keys(attrs).length > 0) {
      payload.attributes = attrs
    }

    if (listIds) {
      payload.listIds = listIds.split(',').map(id => parseInt(id.trim(), 10))
    }

    if (unlinkListIds) {
      payload.unlinkListIds = unlinkListIds
        .split(',')
        .map(id => parseInt(id.trim(), 10))
    }

    if (emailBlacklisted !== undefined && emailBlacklisted !== null) {
      payload.emailBlacklisted = emailBlacklisted
    }

    if (smsBlacklisted !== undefined && smsBlacklisted !== null) {
      payload.smsBlacklisted = smsBlacklisted
    }

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(identifier) }`,
        method: 'put',
        body: payload,
        logTag,
      })

      return { success: true }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to update contact: ${ error.message }`)
    }
  }

  /**
   * @description Permanently delete a contact from your Brevo account by email address, ID, or external ID.
   * @route POST /delete-contact
   *
   * @operationName Delete Contact
   * @category Contacts
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Identifier","name":"identifier","required":true,"description":"The contact identifier to delete. Can be an email address, numeric ID, or external ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteContact(identifier) {
    const logTag = 'deleteContact'

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(identifier) }`,
        method: 'delete',
        logTag,
      })

      return { success: true }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to delete contact: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve a paginated list of all contacts in your Brevo account.
   * @route POST /get-contacts
   *
   * @operationName Get Contacts
   * @category Contacts
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Maximum number of contacts to return per page (1-1000). Default: 50.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Index of the first contact to return for pagination. Default: 0.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   *
   * @returns {Object}
   * @sampleResult {"contacts":[{"id":123,"email":"john@example.com","emailBlacklisted":false,"smsBlacklisted":false,"attributes":{"FIRSTNAME":"John","LASTNAME":"Doe"},"listIds":[1,5]}],"count":150}
   */
  async getContacts(limit, offset) {
    const logTag = 'getContacts'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts`,
        query: { limit: limit || 50, offset: offset || 0 },
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get contacts: ${ error.message }`)
    }
  }

  // ─── Contact Lists ─────────────────────────────────────────────────────

  /**
   * @description Create a new contact list in a specified folder for organizing and managing your contacts.
   * @route POST /create-list
   *
   * @operationName Create List
   * @category Contact Lists
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the new contact list."}
   * @paramDef {"type":"Number","label":"Folder ID","name":"folderId","description":"ID of the folder where the list will be created. Default: 1 (root folder).","uiComponent":{"type":"NUMERIC_STEPPER"}}
   *
   * @returns {Object}
   * @sampleResult {"id":123}
   */
  async createList(name, folderId) {
    const logTag = 'createList'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts/lists`,
        method: 'post',
        body: { name, folderId: folderId || 1 },
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create list: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve a paginated list of all contact lists in your Brevo account.
   * @route POST /get-lists
   *
   * @operationName Get Lists
   * @category Contact Lists
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Maximum number of lists to return per page (1-50). Default: 50.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Index of the first list to return for pagination. Default: 0.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   *
   * @returns {Object}
   * @sampleResult {"lists":[{"id":1,"name":"Newsletter Subscribers","totalSubscribers":250,"totalBlacklisted":3,"folderId":1,"createdAt":"2025-01-10T08:00:00.000Z"}],"count":5}
   */
  async getLists(limit, offset) {
    const logTag = 'getLists'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts/lists`,
        query: { limit: limit || 50, offset: offset || 0 },
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get lists: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve a paginated list of contacts belonging to a specific contact list.
   * @route POST /get-list-contacts
   *
   * @operationName Get List Contacts
   * @category Contact Lists
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The ID of the contact list to retrieve contacts from."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Maximum number of contacts to return per page (1-500). Default: 50.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Index of the first contact to return for pagination. Default: 0.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   *
   * @returns {Object}
   * @sampleResult {"contacts":[{"id":123,"email":"john@example.com","emailBlacklisted":false,"smsBlacklisted":false,"attributes":{"FIRSTNAME":"John","LASTNAME":"Doe"}}],"count":250}
   */
  async getListContacts(listId, limit, offset) {
    const logTag = 'getListContacts'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts/lists/${ listId }/contacts`,
        query: { limit: limit || 50, offset: offset || 0 },
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get list contacts: ${ error.message }`)
    }
  }

  /**
   * @description Add one or more contacts to a specific contact list by their email addresses.
   * @route POST /add-contacts-to-list
   *
   * @operationName Add Contacts to List
   * @category Contact Lists
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The ID of the contact list to add contacts to."}
   * @paramDef {"type":"String","label":"Emails","name":"emails","required":true,"description":"Comma-separated email addresses to add to the list (e.g. 'john@example.com,jane@example.com')."}
   *
   * @returns {Object}
   * @sampleResult {"contacts":{"success":["john@example.com","jane@example.com"],"failure":[]}}
   */
  async addContactsToList(listId, emails) {
    const logTag = 'addContactsToList'

    const emailList = emails.split(',').map(e => e.trim())

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts/lists/${ listId }/contacts/add`,
        method: 'post',
        body: { emails: emailList },
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to add contacts to list: ${ error.message }`)
    }
  }

  /**
   * @description Remove one or more contacts from a specific contact list by their email addresses.
   * @route POST /remove-contacts-from-list
   *
   * @operationName Remove Contacts from List
   * @category Contact Lists
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The ID of the contact list to remove contacts from."}
   * @paramDef {"type":"String","label":"Emails","name":"emails","required":true,"description":"Comma-separated email addresses to remove from the list (e.g. 'john@example.com,jane@example.com')."}
   *
   * @returns {Object}
   * @sampleResult {"contacts":{"success":["john@example.com","jane@example.com"],"failure":[]}}
   */
  async removeContactsFromList(listId, emails) {
    const logTag = 'removeContactsFromList'

    const emailList = emails.split(',').map(e => e.trim())

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts/lists/${ listId }/contacts/remove`,
        method: 'post',
        body: { emails: emailList },
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to remove contacts from list: ${ error.message }`)
    }
  }

  // ─── SMS ───────────────────────────────────────────────────────────────

  /**
   * @description Send a transactional SMS message to a single recipient with sender customization and tagging.
   * @route POST /send-transactional-sms
   *
   * @operationName Send Transactional SMS
   * @category SMS
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Sender","name":"sender","required":true,"description":"Name or phone number of the SMS sender. Alphanumeric sender names are limited to 11 characters (e.g. 'MyCompany')."}
   * @paramDef {"type":"String","label":"Recipient","name":"recipient","required":true,"description":"Phone number of the recipient in international format with country code (e.g. '+14155552671')."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the SMS message."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"transactional","label":"Transactional"},{"value":"marketing","label":"Marketing"}]}},"description":"Type of SMS message. Default: transactional."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Tag to categorize and track the SMS message."}
   *
   * @returns {Object}
   * @sampleResult {"reference":"ab1cde2fgh3i4jklmno5pqrs6tuv7wx8yz","messageId":1511882900}
   */
  async sendTransactionalSMS(sender, recipient, content, type, tag) {
    const logTag = 'sendTransactionalSMS'

    const payload = {
      sender,
      recipient,
      content,
      type: type || 'transactional',
    }

    if (tag) {
      payload.tag = tag
    }

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/transactionalSMS/send`,
        method: 'post',
        body: payload,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to send transactional SMS: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve aggregated SMS statistics with optional date range and tag filtering.
   * @route POST /get-sms-statistics
   *
   * @operationName Get SMS Statistics
   * @category SMS
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","description":"Start date for the statistics period in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","description":"End date for the statistics period in YYYY-MM-DD format."}
   * @paramDef {"type":"Number","label":"Days","name":"days","description":"Number of days to retrieve statistics for (overrides start/end date if provided).","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Filter statistics by a specific SMS tag."}
   *
   * @returns {Object}
   * @sampleResult {"range":"2025-01-01 to 2025-01-15","requests":500,"delivered":480,"hardBounces":5,"softBounces":10,"blocked":5}
   */
  async getSMSStatistics(startDate, endDate, days, tag) {
    const logTag = 'getSMSStatistics'

    const query = {}

    if (startDate) query.startDate = startDate
    if (endDate) query.endDate = endDate
    if (days) query.days = days
    if (tag) query.tag = tag

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/transactionalSMS/statistics/aggregatedReport`,
        query,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get SMS statistics: ${ error.message }`)
    }
  }

  // ─── CRM - Deals ──────────────────────────────────────────────────────

  /**
   * @description Create a new deal in the Brevo CRM with a name and optional attributes such as pipeline, stage, and owner.
   * @route POST /create-deal
   *
   * @operationName Create Deal
   * @category CRM - Deals
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the deal."}
   * @paramDef {"type":"String","label":"Attributes","name":"attributes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON object with deal attributes (e.g. '{\"deal_stage\":\"stage_1\",\"pipeline\":\"abc123\",\"deal_owner\":\"owner@example.com\",\"amount\":5000}')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64a5f3c2e1b9d8a7b6c5d4e3"}
   */
  async createDeal(name, attributes) {
    const logTag = 'createDeal'

    const payload = { name }

    if (attributes) {
      try {
        payload.attributes =
          typeof attributes === 'string' ? JSON.parse(attributes) : attributes
      } catch (e) {
        throw new Error('Attributes must be a valid JSON object.')
      }
    }

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/deals`,
        method: 'post',
        body: payload,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create deal: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve detailed information about a specific CRM deal by its unique identifier.
   * @route POST /get-deal
   *
   * @operationName Get Deal
   * @category CRM - Deals
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Deal ID","name":"dealId","required":true,"dictionary":"getDealsDictionary","description":"The unique identifier of the deal to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64a5f3c2e1b9d8a7b6c5d4e3","attributes":{"deal_name":"Enterprise License","deal_stage":"Qualification","pipeline":"Sales","amount":15000,"deal_owner":"sales@example.com"},"linkedContactsIds":[123,456],"linkedCompaniesIds":["comp_1"]}
   */
  async getDeal(dealId) {
    const logTag = 'getDeal'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/deals/${ dealId }`,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get deal: ${ error.message }`)
    }
  }

  /**
   * @description Update an existing CRM deal's name and attributes such as stage, pipeline, owner, or amount.
   * @route POST /update-deal
   *
   * @operationName Update Deal
   * @category CRM - Deals
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Deal ID","name":"dealId","required":true,"dictionary":"getDealsDictionary","description":"The unique identifier of the deal to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Updated name of the deal."}
   * @paramDef {"type":"String","label":"Attributes","name":"attributes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON object with deal attributes to update (e.g. '{\"deal_stage\":\"Won\",\"amount\":20000}')."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateDeal(dealId, name, attributes) {
    const logTag = 'updateDeal'

    const payload = {}

    if (name) {
      payload.name = name
    }

    if (attributes) {
      try {
        payload.attributes =
          typeof attributes === 'string' ? JSON.parse(attributes) : attributes
      } catch (e) {
        throw new Error('Attributes must be a valid JSON object.')
      }
    }

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/deals/${ dealId }`,
        method: 'patch',
        body: payload,
        logTag,
      })

      return { success: true }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to update deal: ${ error.message }`)
    }
  }

  /**
   * @description Permanently delete a specific CRM deal by its unique identifier.
   * @route POST /delete-deal
   *
   * @operationName Delete Deal
   * @category CRM - Deals
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Deal ID","name":"dealId","required":true,"dictionary":"getDealsDictionary","description":"The unique identifier of the deal to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteDeal(dealId) {
    const logTag = 'deleteDeal'

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/deals/${ dealId }`,
        method: 'delete',
        logTag,
      })

      return { success: true }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to delete deal: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve a paginated list of all CRM deals in your Brevo account.
   * @route POST /get-deals
   *
   * @operationName Get Deals
   * @category CRM - Deals
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Maximum number of deals to return per page (1-100). Default: 50.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Index of the first deal to return for pagination. Default: 0.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"64a5f3c2e1b9d8a7b6c5d4e3","attributes":{"deal_name":"Enterprise License","deal_stage":"Qualification","amount":15000}}],"count":25}
   */
  async getDeals(limit, offset) {
    const logTag = 'getDeals'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/deals`,
        query: { limit: limit || 50, offset: offset || 0 },
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get deals: ${ error.message }`)
    }
  }

  // ─── CRM - Companies ──────────────────────────────────────────────────

  /**
   * @description Create a new company in the Brevo CRM with a name and optional custom attributes.
   * @route POST /create-company
   *
   * @operationName Create Company
   * @category CRM - Companies
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the company to create."}
   * @paramDef {"type":"String","label":"Attributes","name":"attributes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON object with company attributes (e.g. '{\"industry\":\"Technology\",\"number_of_employees\":500,\"website\":\"https://example.com\"}')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64a5f3c2e1b9d8a7b6c5d4e3"}
   */
  async createCompany(name, attributes) {
    const logTag = 'createCompany'

    const payload = { name }

    if (attributes) {
      try {
        const parsedAttrs =
          typeof attributes === 'string' ? JSON.parse(attributes) : attributes
        payload.attributes = parsedAttrs
      } catch (e) {
        throw new Error('Attributes must be a valid JSON object.')
      }
    }

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/companies`,
        method: 'post',
        body: payload,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create company: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve detailed information about a specific company by its unique identifier.
   * @route POST /get-company
   *
   * @operationName Get Company
   * @category CRM - Companies
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Company ID","name":"companyId","required":true,"dictionary":"getCompaniesDictionary","description":"The unique identifier of the company to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64a5f3c2e1b9d8a7b6c5d4e3","attributes":{"name":"Acme Corp","industry":"Technology","number_of_employees":500,"website":"https://acme.com"},"linkedContactsIds":[123,456],"linkedDealsIds":["deal_1"]}
   */
  async getCompany(companyId) {
    const logTag = 'getCompany'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/companies/${ companyId }`,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get company: ${ error.message }`)
    }
  }

  /**
   * @description Update an existing company's name and attributes in the Brevo CRM.
   * @route POST /update-company
   *
   * @operationName Update Company
   * @category CRM - Companies
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Company ID","name":"companyId","required":true,"dictionary":"getCompaniesDictionary","description":"The unique identifier of the company to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Updated name of the company."}
   * @paramDef {"type":"String","label":"Attributes","name":"attributes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON object with company attributes to update (e.g. '{\"industry\":\"Finance\",\"number_of_employees\":1000}')."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateCompany(companyId, name, attributes) {
    const logTag = 'updateCompany'

    const payload = {}

    if (name) {
      payload.name = name
    }

    if (attributes) {
      try {
        payload.attributes =
          typeof attributes === 'string' ? JSON.parse(attributes) : attributes
      } catch (e) {
        throw new Error('Attributes must be a valid JSON object.')
      }
    }

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/companies/${ companyId }`,
        method: 'patch',
        body: payload,
        logTag,
      })

      return { success: true }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to update company: ${ error.message }`)
    }
  }

  /**
   * @description Permanently delete a specific company from the Brevo CRM by its unique identifier.
   * @route POST /delete-company
   *
   * @operationName Delete Company
   * @category CRM - Companies
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Company ID","name":"companyId","required":true,"dictionary":"getCompaniesDictionary","description":"The unique identifier of the company to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteCompany(companyId) {
    const logTag = 'deleteCompany'

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/companies/${ companyId }`,
        method: 'delete',
        logTag,
      })

      return { success: true }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to delete company: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve a paginated list of all companies in the Brevo CRM.
   * @route POST /get-companies
   *
   * @operationName Get Companies
   * @category CRM - Companies
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Maximum number of companies to return per page (1-100). Default: 50.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Index of the first company to return for pagination. Default: 0.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"64a5f3c2e1b9d8a7b6c5d4e3","attributes":{"name":"Acme Corp","industry":"Technology","number_of_employees":500}}],"count":15}
   */
  async getCompanies(limit, offset) {
    const logTag = 'getCompanies'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/companies`,
        query: { limit: limit || 50, offset: offset || 0 },
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get companies: ${ error.message }`)
    }
  }

  // ─── CRM - Tasks ──────────────────────────────────────────────────────

  /**
   * @description Create a new task in the Brevo CRM with scheduling, notes, and associations to contacts, deals, or companies.
   * @route POST /create-task
   *
   * @operationName Create Task
   * @category CRM - Tasks
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the task."}
   * @paramDef {"type":"String","label":"Task Type ID","name":"taskTypeId","dictionary":"getTaskTypesDictionary","description":"The ID of the task type."}
   * @paramDef {"type":"String","label":"Date","name":"date","description":"Due date of the task in ISO 8601 format (e.g. '2025-01-15T10:00:00Z')."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","description":"Duration of the task in milliseconds.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Additional notes or description for the task."}
   * @paramDef {"type":"Boolean","label":"Done","name":"done","uiComponent":{"type":"TOGGLE"},"description":"Set to true to mark the task as completed. Default: false."}
   * @paramDef {"type":"String","label":"Contact IDs","name":"contactsIds","description":"Comma-separated IDs of contacts to associate with the task (e.g. '123,456')."}
   * @paramDef {"type":"String","label":"Deal IDs","name":"dealsIds","description":"Comma-separated IDs of deals to associate with the task (e.g. 'deal_1,deal_2')."}
   * @paramDef {"type":"String","label":"Company IDs","name":"companiesIds","description":"Comma-separated IDs of companies to associate with the task (e.g. 'comp_1,comp_2')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64a5f3c2e1b9d8a7b6c5d4e3"}
   */
  async createTask(
    name,
    taskTypeId,
    date,
    duration,
    notes,
    done,
    contactsIds,
    dealsIds,
    companiesIds
  ) {
    const logTag = 'createTask'

    const payload = {
      name,
      done: done || false,
    }

    if (taskTypeId) payload.taskTypeId = taskTypeId
    if (date) payload.date = date
    if (duration) payload.duration = duration
    if (notes) payload.notes = notes

    if (contactsIds) {
      payload.contactsIds = contactsIds
        .split(',')
        .map(id => parseInt(id.trim(), 10))
    }

    if (dealsIds) {
      payload.dealsIds = dealsIds.split(',').map(id => id.trim())
    }

    if (companiesIds) {
      payload.companiesIds = companiesIds.split(',').map(id => id.trim())
    }

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/tasks`,
        method: 'post',
        body: payload,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create task: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve detailed information about a specific CRM task by its unique identifier.
   * @route POST /get-task
   *
   * @operationName Get Task
   * @category CRM - Tasks
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","description":"The unique identifier of the task to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64a5f3c2e1b9d8a7b6c5d4e3","name":"Follow up with client","taskTypeId":"task_call","date":"2025-01-15T10:00:00.000Z","duration":1800000,"notes":"Discuss contract renewal","done":false,"contactsIds":[123],"dealsIds":["deal_1"],"companiesIds":["comp_1"],"createdAt":"2025-01-10T08:00:00.000Z"}
   */
  async getTask(taskId) {
    const logTag = 'getTask'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/tasks/${ taskId }`,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get task: ${ error.message }`)
    }
  }

  /**
   * @description Update an existing CRM task's name, status, scheduling, or notes.
   * @route POST /update-task
   *
   * @operationName Update Task
   * @category CRM - Tasks
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","description":"The unique identifier of the task to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Updated name of the task."}
   * @paramDef {"type":"Boolean","label":"Done","name":"done","uiComponent":{"type":"TOGGLE"},"description":"Set to true to mark the task as completed."}
   * @paramDef {"type":"String","label":"Date","name":"date","description":"Updated due date of the task in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated notes or description for the task."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","description":"Updated duration of the task in milliseconds.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateTask(taskId, name, done, date, notes, duration) {
    const logTag = 'updateTask'

    const payload = {}

    if (name) payload.name = name
    if (done !== undefined && done !== null) payload.done = done
    if (date) payload.date = date
    if (notes) payload.notes = notes
    if (duration) payload.duration = duration

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/tasks/${ taskId }`,
        method: 'patch',
        body: payload,
        logTag,
      })

      return { success: true }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to update task: ${ error.message }`)
    }
  }

  /**
   * @description Permanently delete a specific CRM task by its unique identifier.
   * @route POST /delete-task
   *
   * @operationName Delete Task
   * @category CRM - Tasks
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"dictionary":"getTasksDictionary","description":"The unique identifier of the task to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteTask(taskId) {
    const logTag = 'deleteTask'

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/tasks/${ taskId }`,
        method: 'delete',
        logTag,
      })

      return { success: true }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to delete task: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve a paginated list of all CRM tasks in your Brevo account.
   * @route POST /get-tasks
   *
   * @operationName Get Tasks
   * @category CRM - Tasks
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Maximum number of tasks to return per page (1-100). Default: 50.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Index of the first task to return for pagination. Default: 0.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"64a5f3c2e1b9d8a7b6c5d4e3","name":"Follow up with client","done":false,"date":"2025-01-15T10:00:00.000Z","duration":1800000}],"count":12}
   */
  async getTasks(limit, offset) {
    const logTag = 'getTasks'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/tasks`,
        query: { limit: limit || 50, offset: offset || 0 },
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get tasks: ${ error.message }`)
    }
  }

  // ─── CRM - Notes ──────────────────────────────────────────────────────

  /**
   * @description Create a new note in the Brevo CRM and associate it with contacts, deals, or companies.
   * @route POST /create-note
   *
   * @operationName Create Note
   * @category CRM - Notes
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the note."}
   * @paramDef {"type":"String","label":"Contact IDs","name":"contactIds","description":"Comma-separated IDs of contacts to associate with the note (e.g. '123,456')."}
   * @paramDef {"type":"String","label":"Deal IDs","name":"dealIds","description":"Comma-separated IDs of deals to associate with the note (e.g. 'deal_1,deal_2')."}
   * @paramDef {"type":"String","label":"Company IDs","name":"companyIds","description":"Comma-separated IDs of companies to associate with the note (e.g. 'comp_1,comp_2')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64a5f3c2e1b9d8a7b6c5d4e3"}
   */
  async createNote(text, contactIds, dealIds, companyIds) {
    const logTag = 'createNote'

    const payload = { text }

    if (contactIds) {
      payload.contactIds = contactIds
        .split(',')
        .map(id => parseInt(id.trim(), 10))
    }

    if (dealIds) {
      payload.dealIds = dealIds.split(',').map(id => id.trim())
    }

    if (companyIds) {
      payload.companyIds = companyIds.split(',').map(id => id.trim())
    }

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/notes`,
        method: 'post',
        body: payload,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create note: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve detailed information about a specific CRM note by its unique identifier.
   * @route POST /get-note
   *
   * @operationName Get Note
   * @category CRM - Notes
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"dictionary":"getNotesDictionary","description":"The unique identifier of the note to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64a5f3c2e1b9d8a7b6c5d4e3","text":"Client requested a demo session next week.","contactIds":[123],"dealIds":["deal_1"],"companyIds":["comp_1"],"createdAt":"2025-01-10T08:00:00.000Z"}
   */
  async getNote(noteId) {
    const logTag = 'getNote'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/notes/${ noteId }`,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get note: ${ error.message }`)
    }
  }

  /**
   * @description Update an existing CRM note's text content and associated contacts, deals, or companies.
   * @route POST /update-note
   *
   * @operationName Update Note
   * @category CRM - Notes
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"dictionary":"getNotesDictionary","description":"The unique identifier of the note to update."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated text content of the note."}
   * @paramDef {"type":"String","label":"Contact IDs","name":"contactIds","description":"Comma-separated IDs of contacts to associate with the note (e.g. '123,456')."}
   * @paramDef {"type":"String","label":"Deal IDs","name":"dealIds","description":"Comma-separated IDs of deals to associate with the note (e.g. 'deal_1,deal_2')."}
   * @paramDef {"type":"String","label":"Company IDs","name":"companyIds","description":"Comma-separated IDs of companies to associate with the note (e.g. 'comp_1,comp_2')."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateNote(noteId, text, contactIds, dealIds, companyIds) {
    const logTag = 'updateNote'

    const payload = { text }

    if (contactIds) {
      payload.contactIds = contactIds
        .split(',')
        .map(id => parseInt(id.trim(), 10))
    }

    if (dealIds) {
      payload.dealIds = dealIds.split(',').map(id => id.trim())
    }

    if (companyIds) {
      payload.companyIds = companyIds.split(',').map(id => id.trim())
    }

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/notes/${ noteId }`,
        method: 'patch',
        body: payload,
        logTag,
      })

      return { success: true }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to update note: ${ error.message }`)
    }
  }

  /**
   * @description Permanently delete a specific CRM note by its unique identifier.
   * @route POST /delete-note
   *
   * @operationName Delete Note
   * @category CRM - Notes
   * @appearanceColor #0B996E #0FD191
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"dictionary":"getNotesDictionary","description":"The unique identifier of the note to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteNote(noteId) {
    const logTag = 'deleteNote'

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/crm/notes/${ noteId }`,
        method: 'delete',
        logTag,
      })

      return { success: true }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to delete note: ${ error.message }`)
    }
  }

  // ─── Account ───────────────────────────────────────────────────────────

  /**
   * @description Retrieve your Brevo account information including plan details, credits, and relay configuration.
   * @route POST /get-account-info
   *
   * @operationName Get Account Info
   * @category Account
   * @appearanceColor #0B996E #0FD191
   *
   * @returns {Object}
   * @sampleResult {"email":"admin@example.com","firstName":"John","lastName":"Doe","companyName":"Acme Corp","address":{"city":"Paris","country":"France"},"plan":[{"type":"free","credits":300,"creditsType":"sendLimit"}],"relay":{"enabled":true,"data":{"userName":"smtp-user","relay":"smtp-relay.brevo.com","port":587}}}
   */
  async getAccountInfo() {
    const logTag = 'getAccountInfo'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/account`,
        logTag,
      })

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get account info: ${ error.message }`)
    }
  }
}

Flowrunner.ServerCode.addService(Brevo, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Brevo API v3 key. Find it in your Brevo account under SMTP & API > API Keys.',
  },
])
