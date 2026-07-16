const logger = {
  info: (...args) => console.log('[SurveyMonkey] info:', ...args),
  debug: (...args) => console.log('[SurveyMonkey] debug:', ...args),
  error: (...args) => console.log('[SurveyMonkey] error:', ...args),
  warn: (...args) => console.log('[SurveyMonkey] warn:', ...args),
}

const API_BASE_URL = 'https://api.surveymonkey.com/v3'

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
 * @integrationName SurveyMonkey
 * @integrationIcon /icon.png
 */
class SurveyMonkeyService {
  constructor(config) {
    this.accessToken = config.accessToken
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const apiError = error.body?.error
      const message = apiError?.message || error.message
      const errorId = apiError?.id ? ` (error ${ apiError.id })` : ''

      logger.error(`${ logTag } - failed: ${ message }${ errorId }`)

      throw new Error(`SurveyMonkey API error: ${ message }${ errorId }`)
    }
  }

  // ----------------------------------------------------------------------------
  // Surveys
  // ----------------------------------------------------------------------------

  /**
   * @operationName List Surveys
   * @category Surveys
   * @description Retrieves a paginated list of surveys owned by or shared with the authenticated account. Supports filtering by title and sorting. Results are wrapped in a standard envelope with data, page, per_page, total, and links for navigating pages.
   * @route GET /surveys
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page of results to return (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of surveys per page (max 1000). Defaults to 50."}
   * @paramDef {"type":"String","label":"Title Filter","name":"title","description":"Optional. Return only surveys whose title contains this text."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Title","Date Modified","Number of Responses"]}},"description":"Field to sort surveys by. Defaults to Date Modified."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. Defaults to Descending."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"123456789","title":"Customer Feedback","nickname":"","href":"https://api.surveymonkey.com/v3/surveys/123456789"}],"per_page":50,"page":1,"total":1,"links":{"self":"https://api.surveymonkey.com/v3/surveys?page=1&per_page=50"}}
   */
  async listSurveys(page, perPage, title, sortBy, sortOrder) {
    const logTag = '[listSurveys]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys`,
      method: 'get',
      query: {
        page,
        per_page: perPage,
        title,
        sort_by: this.#resolveChoice(sortBy, {
          'Title': 'title',
          'Date Modified': 'date_modified',
          'Number of Responses': 'num_responses',
        }),
        sort_order: this.#resolveChoice(sortOrder, {
          'Ascending': 'ASC',
          'Descending': 'DESC',
        }),
      },
    })
  }

  /**
   * @operationName Get Survey
   * @category Surveys
   * @description Retrieves basic details for a single survey by its ID, including title, category, question and page counts, response counts, and timestamps. Does not include the full page/question structure - use Get Survey Details for that.
   * @route GET /surveys/{survey_id}
   * @paramDef {"type":"String","label":"Survey ID","name":"surveyId","required":true,"dictionary":"getSurveysDictionary","description":"ID of the survey to retrieve. Search and select a survey, or enter an ID directly."}
   * @returns {Object}
   * @sampleResult {"id":"123456789","title":"Customer Feedback","category":"","question_count":10,"page_count":2,"response_count":42,"date_created":"2026-01-01T10:00:00","date_modified":"2026-01-05T12:00:00"}
   */
  async getSurvey(surveyId) {
    const logTag = '[getSurvey]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys/${ encodeURIComponent(surveyId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Survey Details
   * @category Surveys
   * @description Retrieves the full expanded structure of a survey, including all pages and their questions with question headings, families, subtypes, and answer choice definitions (choice IDs and text). This is the mapping you need to translate response answer choice IDs into human-readable question and answer text.
   * @route GET /surveys/{survey_id}/details
   * @paramDef {"type":"String","label":"Survey ID","name":"surveyId","required":true,"dictionary":"getSurveysDictionary","description":"ID of the survey whose full details to retrieve. Search and select a survey, or enter an ID directly."}
   * @returns {Object}
   * @sampleResult {"id":"123456789","title":"Customer Feedback","pages":[{"id":"111","title":"Page 1","questions":[{"id":"q1","heading":"How satisfied are you?","family":"single_choice","answers":{"choices":[{"id":"c1","text":"Very satisfied"}]}}]}]}
   */
  async getSurveyDetails(surveyId) {
    const logTag = '[getSurveyDetails]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys/${ encodeURIComponent(surveyId) }/details`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Survey
   * @category Surveys
   * @description Creates a new survey. Provide a title to create a blank survey, or supply a template ID or an existing survey ID to copy its structure. If a source is supplied the new title overrides the copied title.
   * @route POST /surveys
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the new survey."}
   * @paramDef {"type":"String","label":"From Template ID","name":"fromTemplateId","description":"Optional. ID of a SurveyMonkey template to base the survey on. See the /survey_templates endpoint for available templates."}
   * @paramDef {"type":"String","label":"From Survey ID","name":"fromSurveyId","dictionary":"getSurveysDictionary","description":"Optional. ID of an existing survey to copy. Mutually exclusive with From Template ID."}
   * @paramDef {"type":"String","label":"Nickname","name":"nickname","description":"Optional internal nickname for the survey (not shown to respondents)."}
   * @returns {Object}
   * @sampleResult {"id":"987654321","title":"New Survey","nickname":"","href":"https://api.surveymonkey.com/v3/surveys/987654321"}
   */
  async createSurvey(title, fromTemplateId, fromSurveyId, nickname) {
    const logTag = '[createSurvey]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys`,
      method: 'post',
      body: clean({
        title,
        from_template_id: fromTemplateId,
        from_survey_id: fromSurveyId,
        nickname,
      }),
    })
  }

  /**
   * @operationName Delete Survey
   * @category Surveys
   * @description Permanently deletes a survey by its ID. This also removes the survey's collectors and responses. This action cannot be undone.
   * @route DELETE /surveys/{survey_id}
   * @paramDef {"type":"String","label":"Survey ID","name":"surveyId","required":true,"dictionary":"getSurveysDictionary","description":"ID of the survey to delete."}
   * @returns {Object}
   * @sampleResult {"id":"123456789","title":"Customer Feedback"}
   */
  async deleteSurvey(surveyId) {
    const logTag = '[deleteSurvey]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys/${ encodeURIComponent(surveyId) }`,
      method: 'delete',
    })
  }

  // ----------------------------------------------------------------------------
  // Responses
  // ----------------------------------------------------------------------------

  /**
   * @operationName List Survey Responses
   * @category Responses
   * @description Retrieves a paginated list of response summaries for a survey (without the answer content). Supports filtering by response status and by the date the response was created. Use Get Response Details or List All Responses Bulk to obtain answer content.
   * @route GET /surveys/{survey_id}/responses
   * @paramDef {"type":"String","label":"Survey ID","name":"surveyId","required":true,"dictionary":"getSurveysDictionary","description":"ID of the survey whose responses to list."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page of results to return (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of responses per page (max 100). Defaults to 50."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Completed","Partial","Over Quota","Disqualified"]}},"description":"Optional. Return only responses with this status."}
   * @paramDef {"type":"String","label":"Start Created At","name":"startCreatedAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional. Return only responses created at or after this date/time (ISO 8601)."}
   * @paramDef {"type":"String","label":"End Created At","name":"endCreatedAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional. Return only responses created at or before this date/time (ISO 8601)."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"100001","recipient_id":"","collection_mode":"default","response_status":"completed","date_created":"2026-01-03T09:00:00","date_modified":"2026-01-03T09:05:00","href":"https://api.surveymonkey.com/v3/surveys/123456789/responses/100001"}],"per_page":50,"page":1,"total":1,"links":{"self":"https://api.surveymonkey.com/v3/surveys/123456789/responses?page=1&per_page=50"}}
   */
  async listSurveyResponses(surveyId, page, perPage, status, startCreatedAt, endCreatedAt) {
    const logTag = '[listSurveyResponses]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys/${ encodeURIComponent(surveyId) }/responses`,
      method: 'get',
      query: {
        page,
        per_page: perPage,
        status: this.#resolveChoice(status, {
          'Completed': 'completed',
          'Partial': 'partial',
          'Over Quota': 'overquota',
          'Disqualified': 'disqualified',
        }),
        start_created_at: startCreatedAt,
        end_created_at: endCreatedAt,
      },
    })
  }

  /**
   * @operationName Get Response Details
   * @category Responses
   * @description Retrieves the full answer content for a single response, structured as pages -> questions -> answers. IMPORTANT: answers reference question and answer-choice IDs (choice_id, row_id, col_id) rather than human-readable text. To translate them into question headings and choice labels, fetch Get Survey Details for the same survey and map the IDs. Set Include Survey Mapping to have this operation fetch the survey structure and attach a readable answer summary automatically.
   * @route GET /surveys/{survey_id}/responses/{response_id}/details
   * @paramDef {"type":"String","label":"Survey ID","name":"surveyId","required":true,"dictionary":"getSurveysDictionary","description":"ID of the survey the response belongs to."}
   * @paramDef {"type":"String","label":"Response ID","name":"responseId","required":true,"description":"ID of the response whose answers to retrieve."}
   * @paramDef {"type":"Boolean","label":"Include Survey Mapping","name":"includeMapping","uiComponent":{"type":"CHECKBOX"},"description":"Optional. When true, fetch the survey structure and attach a human-readable 'mapped_answers' array (question heading + answer text) alongside the raw response. Adds one extra API call."}
   * @returns {Object}
   * @sampleResult {"id":"100001","response_status":"completed","pages":[{"id":"111","questions":[{"id":"q1","answers":[{"choice_id":"c1"}]}]}],"mapping_note":"Answer choice IDs map to text via Get Survey Details. Enable Include Survey Mapping for a readable summary.","mapped_answers":[{"question":"How satisfied are you?","answers":["Very satisfied"]}]}
   */
  async getResponseDetails(surveyId, responseId, includeMapping) {
    const logTag = '[getResponseDetails]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys/${ encodeURIComponent(surveyId) }/responses/${ encodeURIComponent(responseId) }/details`,
      method: 'get',
    })

    response.mapping_note = 'Answer choice IDs map to text via Get Survey Details. Enable Include Survey Mapping for a readable summary.'

    if (includeMapping) {
      try {
        const details = await this.#apiRequest({
          logTag,
          url: `${ API_BASE_URL }/surveys/${ encodeURIComponent(surveyId) }/details`,
          method: 'get',
        })

        response.mapped_answers = this.#mapAnswers(response, details)
      } catch (error) {
        logger.warn(`${ logTag } - could not build mapped_answers: ${ error.message }`)
        response.mapped_answers = null
      }
    }

    return response
  }

  // Builds a readable [{ question, answers[] }] summary by resolving answer
  // choice/row/col IDs against the survey structure returned by /details.
  #mapAnswers(response, surveyDetails) {
    const questionIndex = {}

    for (const page of surveyDetails.pages || []) {
      for (const question of page.questions || []) {
        const choices = {}
        const rows = {}
        const cols = {}
        const answers = question.answers || {}

        for (const choice of answers.choices || []) {
          choices[choice.id] = choice.text
        }

        for (const row of answers.rows || []) {
          rows[row.id] = row.text
        }

        for (const col of answers.cols || []) {
          cols[col.id] = col.text
        }

        questionIndex[question.id] = { heading: question.headings?.[0]?.heading || '', choices, rows, cols }
      }
    }

    const mapped = []

    for (const page of response.pages || []) {
      for (const question of page.questions || []) {
        const meta = questionIndex[question.id]

        if (!meta) {
          continue
        }

        const values = []

        for (const answer of question.answers || []) {
          if (answer.text !== undefined) {
            values.push(answer.text)
          } else if (answer.choice_id !== undefined) {
            values.push(meta.choices[answer.choice_id] || answer.choice_id)
          } else if (answer.row_id !== undefined) {
            const rowText = meta.rows[answer.row_id] || answer.row_id
            const colText = answer.col_id ? meta.cols[answer.col_id] || answer.col_id : undefined

            values.push(colText ? `${ rowText }: ${ colText }` : rowText)
          } else if (answer.other_id !== undefined) {
            values.push(answer.text || answer.other_id)
          }
        }

        mapped.push({ question: meta.heading, answers: values })
      }
    }

    return mapped
  }

  /**
   * @operationName List All Responses Bulk
   * @category Responses
   * @description Retrieves a paginated list of responses for a survey with full answer content included inline for each response (pages -> questions -> answers). Answers still reference question and choice IDs; combine with Get Survey Details to translate them to readable text. Prefer this over calling Get Response Details per response when exporting many responses.
   * @route GET /surveys/{survey_id}/responses/bulk
   * @paramDef {"type":"String","label":"Survey ID","name":"surveyId","required":true,"dictionary":"getSurveysDictionary","description":"ID of the survey whose responses to export."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page of results to return (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of responses per page (max 100). Defaults to 50."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Completed","Partial","Over Quota","Disqualified"]}},"description":"Optional. Return only responses with this status."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"100001","response_status":"completed","pages":[{"id":"111","questions":[{"id":"q1","answers":[{"choice_id":"c1"}]}]}]}],"per_page":50,"page":1,"total":1,"links":{"self":"https://api.surveymonkey.com/v3/surveys/123456789/responses/bulk?page=1&per_page=50"}}
   */
  async listAllResponsesBulk(surveyId, page, perPage, status) {
    const logTag = '[listAllResponsesBulk]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys/${ encodeURIComponent(surveyId) }/responses/bulk`,
      method: 'get',
      query: {
        page,
        per_page: perPage,
        status: this.#resolveChoice(status, {
          'Completed': 'completed',
          'Partial': 'partial',
          'Over Quota': 'overquota',
          'Disqualified': 'disqualified',
        }),
      },
    })
  }

  // ----------------------------------------------------------------------------
  // Collectors
  // ----------------------------------------------------------------------------

  /**
   * @operationName List Collectors
   * @category Collectors
   * @description Retrieves a paginated list of collectors for a survey. A collector is a channel through which responses are gathered (for example a web link or an email invitation). Results are wrapped in the standard envelope.
   * @route GET /surveys/{survey_id}/collectors
   * @paramDef {"type":"String","label":"Survey ID","name":"surveyId","required":true,"dictionary":"getSurveysDictionary","description":"ID of the survey whose collectors to list."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page of results to return (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of collectors per page (max 1000). Defaults to 50."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"200001","name":"Web Link 1","href":"https://api.surveymonkey.com/v3/collectors/200001"}],"per_page":50,"page":1,"total":1,"links":{"self":"https://api.surveymonkey.com/v3/surveys/123456789/collectors?page=1&per_page=50"}}
   */
  async listCollectors(surveyId, page, perPage) {
    const logTag = '[listCollectors]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys/${ encodeURIComponent(surveyId) }/collectors`,
      method: 'get',
      query: {
        page,
        per_page: perPage,
      },
    })
  }

  /**
   * @operationName Get Collector
   * @category Collectors
   * @description Retrieves details for a single collector by its ID, including its type, name, status, response count, and (for web link collectors) the shareable URL.
   * @route GET /collectors/{collector_id}
   * @paramDef {"type":"String","label":"Collector ID","name":"collectorId","required":true,"dictionary":"getCollectorsDictionary","description":"ID of the collector to retrieve. Select a survey, then choose a collector."}
   * @returns {Object}
   * @sampleResult {"id":"200001","name":"Web Link 1","type":"weblink","status":"open","url":"https://www.surveymonkey.com/r/ABC123","response_count":42,"date_created":"2026-01-01T10:00:00"}
   */
  async getCollector(collectorId) {
    const logTag = '[getCollector]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/collectors/${ encodeURIComponent(collectorId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Collector
   * @category Collectors
   * @description Creates a new collector for a survey. Choose Web Link to generate a shareable survey URL or Email to create an email invitation collector. Returns the created collector; for web link collectors the response includes the shareable URL.
   * @route POST /surveys/{survey_id}/collectors
   * @paramDef {"type":"String","label":"Survey ID","name":"surveyId","required":true,"dictionary":"getSurveysDictionary","description":"ID of the survey to attach the collector to."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Web Link","Email"]}},"description":"Type of collector to create."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional display name for the collector. Defaults to a name assigned by SurveyMonkey."}
   * @returns {Object}
   * @sampleResult {"id":"200002","name":"Web Link 2","type":"weblink","status":"open","url":"https://www.surveymonkey.com/r/XYZ789","date_created":"2026-01-06T11:00:00"}
   */
  async createCollector(surveyId, type, name) {
    const logTag = '[createCollector]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys/${ encodeURIComponent(surveyId) }/collectors`,
      method: 'post',
      body: clean({
        type: this.#resolveChoice(type, {
          'Web Link': 'weblink',
          'Email': 'email',
        }),
        name,
      }),
    })
  }

  /**
   * @operationName Get Collector Responses
   * @category Collectors
   * @description Retrieves a paginated list of response summaries gathered by a specific collector. Use this to review responses scoped to one channel (for example a single web link or email campaign) rather than the whole survey.
   * @route GET /collectors/{collector_id}/responses
   * @paramDef {"type":"String","label":"Collector ID","name":"collectorId","required":true,"dictionary":"getCollectorsDictionary","description":"ID of the collector whose responses to list. Select a survey, then choose a collector."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page of results to return (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of responses per page (max 100). Defaults to 50."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Completed","Partial","Over Quota","Disqualified"]}},"description":"Optional. Return only responses with this status."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"100001","response_status":"completed","date_created":"2026-01-03T09:00:00","href":"https://api.surveymonkey.com/v3/collectors/200001/responses/100001"}],"per_page":50,"page":1,"total":1,"links":{"self":"https://api.surveymonkey.com/v3/collectors/200001/responses?page=1&per_page=50"}}
   */
  async getCollectorResponses(collectorId, page, perPage, status) {
    const logTag = '[getCollectorResponses]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/collectors/${ encodeURIComponent(collectorId) }/responses`,
      method: 'get',
      query: {
        page,
        per_page: perPage,
        status: this.#resolveChoice(status, {
          'Completed': 'completed',
          'Partial': 'partial',
          'Over Quota': 'overquota',
          'Disqualified': 'disqualified',
        }),
      },
    })
  }

  // ----------------------------------------------------------------------------
  // Pages & Questions
  // ----------------------------------------------------------------------------

  /**
   * @operationName List Survey Pages
   * @category Pages & Questions
   * @description Retrieves a paginated list of pages within a survey, including each page's title, description, and question count. Use Get Page or List Page Questions to drill into a specific page.
   * @route GET /surveys/{survey_id}/pages
   * @paramDef {"type":"String","label":"Survey ID","name":"surveyId","required":true,"dictionary":"getSurveysDictionary","description":"ID of the survey whose pages to list."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page of results to return (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of pages per page of results (max 1000). Defaults to 50."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"111","title":"Page 1","description":"","question_count":5,"href":"https://api.surveymonkey.com/v3/surveys/123456789/pages/111"}],"per_page":50,"page":1,"total":1,"links":{"self":"https://api.surveymonkey.com/v3/surveys/123456789/pages?page=1&per_page=50"}}
   */
  async listSurveyPages(surveyId, page, perPage) {
    const logTag = '[listSurveyPages]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys/${ encodeURIComponent(surveyId) }/pages`,
      method: 'get',
      query: {
        page,
        per_page: perPage,
      },
    })
  }

  /**
   * @operationName Get Page
   * @category Pages & Questions
   * @description Retrieves details for a single page within a survey by its page ID, including title, description, and question count.
   * @route GET /surveys/{survey_id}/pages/{page_id}
   * @paramDef {"type":"String","label":"Survey ID","name":"surveyId","required":true,"dictionary":"getSurveysDictionary","description":"ID of the survey the page belongs to."}
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"description":"ID of the page to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"111","title":"Page 1","description":"","position":1,"question_count":5,"href":"https://api.surveymonkey.com/v3/surveys/123456789/pages/111"}
   */
  async getPage(surveyId, pageId) {
    const logTag = '[getPage]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys/${ encodeURIComponent(surveyId) }/pages/${ encodeURIComponent(pageId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Page Questions
   * @category Pages & Questions
   * @description Retrieves a paginated list of questions on a specific survey page, including each question's heading, family (question type), subtype, and answer choice definitions. Combine with response data to interpret answers.
   * @route GET /surveys/{survey_id}/pages/{page_id}/questions
   * @paramDef {"type":"String","label":"Survey ID","name":"surveyId","required":true,"dictionary":"getSurveysDictionary","description":"ID of the survey the page belongs to."}
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"description":"ID of the page whose questions to list."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page of results to return (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of questions per page (max 1000). Defaults to 50."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"q1","position":1,"family":"single_choice","subtype":"vertical","headings":[{"heading":"How satisfied are you?"}],"answers":{"choices":[{"id":"c1","text":"Very satisfied"}]}}],"per_page":50,"page":1,"total":1,"links":{"self":"https://api.surveymonkey.com/v3/surveys/123456789/pages/111/questions?page=1&per_page=50"}}
   */
  async listPageQuestions(surveyId, pageId, page, perPage) {
    const logTag = '[listPageQuestions]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys/${ encodeURIComponent(surveyId) }/pages/${ encodeURIComponent(pageId) }/questions`,
      method: 'get',
      query: {
        page,
        per_page: perPage,
      },
    })
  }

  // ----------------------------------------------------------------------------
  // Account
  // ----------------------------------------------------------------------------

  /**
   * @operationName Get Me
   * @category Account
   * @description Retrieves the account details of the authenticated user, including user ID, username, email, account type, and language. Useful as a connection check to verify the access token is valid.
   * @route GET /users/me
   * @returns {Object}
   * @sampleResult {"id":"999","username":"jane.doe","first_name":"Jane","last_name":"Doe","email":"jane@example.com","account_type":"enterprise_platform","language":"en","date_created":"2025-01-01T00:00:00"}
   */
  async getMe() {
    const logTag = '[getMe]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/me`,
      method: 'get',
    })
  }

  // ----------------------------------------------------------------------------
  // Dictionaries
  // ----------------------------------------------------------------------------

  /**
   * @typedef {Object} getSurveysDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter surveys by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Holds the next page number returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Surveys Dictionary
   * @description Provides a searchable, paginated list of surveys for selecting a survey ID in dependent parameters. The option value is the survey ID.
   * @route POST /get-surveys-dictionary
   * @paramDef {"type":"getSurveysDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing surveys."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Customer Feedback","value":"123456789","note":"42 responses"}],"cursor":"2"}
   */
  async getSurveysDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getSurveysDictionary]'
    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys`,
      method: 'get',
      query: {
        title: search,
        page,
        per_page: 50,
        sort_by: 'date_modified',
        sort_order: 'DESC',
      },
    })

    const surveys = response.data || []
    const hasNext = Boolean(response.links && response.links.next)

    return {
      items: surveys.map(survey => ({
        label: survey.title || survey.nickname || survey.id,
        value: survey.id,
        note: survey.response_count !== undefined ? `${ survey.response_count } responses` : undefined,
      })),
      cursor: hasNext ? String(page + 1) : undefined,
    }
  }

  /**
   * @typedef {Object} getCollectorsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Survey ID","name":"survey_id","required":true,"dictionary":"getSurveysDictionary","description":"Survey whose collectors to list."}
   */

  /**
   * @typedef {Object} getCollectorsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter collectors by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Holds the next page number returned by a previous call."}
   * @paramDef {"type":"getCollectorsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent selection criteria; requires a survey ID."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Collectors Dictionary
   * @description Provides a searchable, paginated list of collectors for a selected survey, for choosing a collector ID in dependent parameters. Requires a survey ID in the criteria. The option value is the collector ID.
   * @route POST /get-collectors-dictionary
   * @paramDef {"type":"getCollectorsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and criteria (survey ID) for listing collectors."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Web Link 1","value":"200001","note":"weblink"}],"cursor":"2"}
   */
  async getCollectorsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const logTag = '[getCollectorsDictionary]'
    const surveyId = criteria && criteria.survey_id

    if (!surveyId) {
      return { items: [], cursor: undefined }
    }

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/surveys/${ encodeURIComponent(surveyId) }/collectors`,
      method: 'get',
      query: {
        name: search,
        page,
        per_page: 50,
      },
    })

    const collectors = response.data || []
    const hasNext = Boolean(response.links && response.links.next)

    return {
      items: collectors.map(collector => ({
        label: collector.name || collector.id,
        value: collector.id,
        note: collector.type || undefined,
      })),
      cursor: hasNext ? String(page + 1) : undefined,
    }
  }
}

Flowrunner.ServerCode.addService(SurveyMonkeyService, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your SurveyMonkey API access token. Create a private app in the developer portal (developer.surveymonkey.com) and use its access token.',
  },
])
