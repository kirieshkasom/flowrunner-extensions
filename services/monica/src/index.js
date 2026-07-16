const logger = {
  info: (...args) => console.log('[Monica] info:', ...args),
  debug: (...args) => console.log('[Monica] debug:', ...args),
  error: (...args) => console.log('[Monica] error:', ...args),
  warn: (...args) => console.log('[Monica] warn:', ...args),
}

const DEFAULT_BASE_URL = 'https://app.monicahq.com'

const DEFAULT_PAGE_LIMIT = 15

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
 * @integrationName Monica
 * @integrationIcon /icon.png
 */
class MonicaService {
  constructor(config) {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')

    this.apiBaseUrl = `${ baseUrl }/api`
    this.apiToken = config.apiToken
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiToken }`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const errorBody = error.body || {}
      const validationErrors = errorBody.errors ? JSON.stringify(errorBody.errors) : ''
      const message = errorBody.error?.message ||
        errorBody.message ||
        validationErrors ||
        error.message ||
        'Unknown error'
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status || 'n/a' }): ${ message }`)

      throw new Error(`Monica API error${ status ? ` [${ status }]` : '' }: ${ message }`)
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Contacts                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Lists contacts in the Monica account with pagination. Supports full-text search via query (matches first name, last name, food preferences, job, and company) and sorting. Results are wrapped in a data array alongside links and meta pagination info.
   * @route GET /contacts
   * @paramDef {"type":"String","label":"Query","name":"query","dictionary":"getContactsDictionary","description":"Optional search text. Matches first name, last name, food preferences, job, and company."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of contacts per page (default 15)."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Created (Oldest First)","Created (Newest First)","Updated (Oldest First)","Updated (Newest First)"]}},"description":"Sort order for the returned contacts."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":1,"first_name":"John","last_name":"Doe","complete_name":"John Doe","nickname":null,"is_deceased":false}],"links":{"first":"...","last":"...","prev":null,"next":null},"meta":{"current_page":1,"last_page":1,"per_page":15,"total":1}}
   */
  async listContacts(query, page, limit, sort) {
    const logTag = '[listContacts]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/contacts`,
      method: 'get',
      query: {
        query,
        page: page || 1,
        limit: limit || DEFAULT_PAGE_LIMIT,
        sort: this.#resolveChoice(sort, {
          'Created (Oldest First)': 'created_at',
          'Created (Newest First)': '-created_at',
          'Updated (Oldest First)': 'updated_at',
          'Updated (Newest First)': '-updated_at',
        }),
      },
    })
  }

  /**
   * @operationName Search Contacts
   * @category Contacts
   * @description Searches contacts by a query string, matching first name, last name, food preferences, job, and company. Returns a paginated data array. Use this when you only need to find contacts by text rather than page through the full list.
   * @route GET /contacts/search
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search text to match against first name, last name, food preferences, job, and company."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of matches per page (default 15)."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":1,"first_name":"John","last_name":"Doe","complete_name":"John Doe"}],"links":{"prev":null,"next":null},"meta":{"current_page":1,"total":1,"query":"john"}}
   */
  async searchContacts(query, limit) {
    const logTag = '[searchContacts]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/contacts`,
      method: 'get',
      query: {
        query,
        limit: limit || DEFAULT_PAGE_LIMIT,
      },
    })
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact by its numeric ID. The response is wrapped in a data object and includes name fields, birthdate/deceased flags, and related information such as tags and addresses.
   * @route GET /contacts/{contactId}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the contact to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"first_name":"John","last_name":"Doe","complete_name":"John Doe","nickname":null,"is_deceased":false,"information":{"dates":{"birthdate":{"is_known":false}}}}}
   */
  async getContact(contactId) {
    const logTag = '[getContact]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/contacts/${ contactId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new contact. Monica requires the three boolean flags is_birthdate_known, is_deceased, and is_deceased_date_known on every create — they default to false here and are always sent to avoid a 422 validation error. Provide gender_id from Monica's Gender API when known.
   * @route POST /contacts
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"Contact's first name (max 50 characters)."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Contact's last name (max 100 characters)."}
   * @paramDef {"type":"String","label":"Nickname","name":"nickname","description":"Contact's nickname (max 100 characters)."}
   * @paramDef {"type":"Number","label":"Gender ID","name":"genderId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric gender ID from Monica's Gender API. Optional."}
   * @paramDef {"type":"Boolean","label":"Is Birthdate Known","name":"isBirthdateKnown","uiComponent":{"type":"CHECKBOX"},"description":"Whether the contact's birthdate is known. Required by Monica; defaults to false."}
   * @paramDef {"type":"Boolean","label":"Is Deceased","name":"isDeceased","uiComponent":{"type":"CHECKBOX"},"description":"Whether the contact is deceased. Required by Monica; defaults to false."}
   * @paramDef {"type":"Boolean","label":"Is Deceased Date Known","name":"isDeceasedDateKnown","uiComponent":{"type":"CHECKBOX"},"description":"Whether the contact's deceased date is known. Required by Monica; defaults to false."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form description of the contact."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"first_name":"John","last_name":"Doe","complete_name":"John Doe","is_deceased":false}}
   */
  async createContact(firstName, lastName, nickname, genderId, isBirthdateKnown, isDeceased, isDeceasedDateKnown, description) {
    const logTag = '[createContact]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/contacts`,
      method: 'post',
      body: clean({
        first_name: firstName,
        last_name: lastName,
        nickname,
        gender_id: genderId,
        is_birthdate_known: Boolean(isBirthdateKnown),
        is_deceased: Boolean(isDeceased),
        is_deceased_date_known: Boolean(isDeceasedDateKnown),
        description,
      }),
    })
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing contact by ID. Monica's update is a full replace, so the three boolean flags is_birthdate_known, is_deceased, and is_deceased_date_known are always sent (defaulting to false) along with first_name to satisfy validation.
   * @route PUT /contacts/{contactId}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the contact to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"Contact's first name (max 50 characters)."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Contact's last name (max 100 characters)."}
   * @paramDef {"type":"String","label":"Nickname","name":"nickname","description":"Contact's nickname (max 100 characters)."}
   * @paramDef {"type":"Number","label":"Gender ID","name":"genderId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric gender ID from Monica's Gender API. Optional."}
   * @paramDef {"type":"Boolean","label":"Is Birthdate Known","name":"isBirthdateKnown","uiComponent":{"type":"CHECKBOX"},"description":"Whether the contact's birthdate is known. Required by Monica; defaults to false."}
   * @paramDef {"type":"Boolean","label":"Is Deceased","name":"isDeceased","uiComponent":{"type":"CHECKBOX"},"description":"Whether the contact is deceased. Required by Monica; defaults to false."}
   * @paramDef {"type":"Boolean","label":"Is Deceased Date Known","name":"isDeceasedDateKnown","uiComponent":{"type":"CHECKBOX"},"description":"Whether the contact's deceased date is known. Required by Monica; defaults to false."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form description of the contact."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"first_name":"John","last_name":"Doe","complete_name":"John Doe","is_deceased":false}}
   */
  async updateContact(contactId, firstName, lastName, nickname, genderId, isBirthdateKnown, isDeceased, isDeceasedDateKnown, description) {
    const logTag = '[updateContact]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/contacts/${ contactId }`,
      method: 'put',
      body: clean({
        first_name: firstName,
        last_name: lastName,
        nickname,
        gender_id: genderId,
        is_birthdate_known: Boolean(isBirthdateKnown),
        is_deceased: Boolean(isDeceased),
        is_deceased_date_known: Boolean(isDeceasedDateKnown),
        description,
      }),
    })
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently deletes a contact by ID, including all of its associated notes, activities, tasks, reminders, and calls. This cannot be undone.
   * @route DELETE /contacts/{contactId}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the contact to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":1}
   */
  async deleteContact(contactId) {
    const logTag = '[deleteContact]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/contacts/${ contactId }`,
      method: 'delete',
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Notes                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * @operationName List Notes
   * @category Notes
   * @description Lists notes across the account with pagination. Each note is tied to a contact and carries a body and a favorited flag. Results are wrapped in a data array alongside links and meta pagination info.
   * @route GET /notes
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of notes per page (default 15)."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":1,"body":"Loves hiking","is_favorited":false,"contact":{"id":1,"complete_name":"John Doe"}}],"links":{"prev":null,"next":null},"meta":{"current_page":1,"total":1}}
   */
  async listNotes(page, limit) {
    const logTag = '[listNotes]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/notes`,
      method: 'get',
      query: {
        page: page || 1,
        limit: limit || DEFAULT_PAGE_LIMIT,
      },
    })
  }

  /**
   * @operationName Get Note
   * @category Notes
   * @description Retrieves a single note by its numeric ID. The response is wrapped in a data object and includes the body, favorited flag, and the associated contact.
   * @route GET /notes/{noteId}
   * @paramDef {"type":"Number","label":"Note ID","name":"noteId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the note to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"body":"Loves hiking","is_favorited":false,"contact":{"id":1,"complete_name":"John Doe"}}}
   */
  async getNote(noteId) {
    const logTag = '[getNote]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/notes/${ noteId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Note
   * @category Notes
   * @description Creates a note attached to a contact. The body holds the note text (up to 100,000 characters) and can optionally be marked as favorited.
   * @route POST /notes
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the contact the note belongs to."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Note content (max 100,000 characters)."}
   * @paramDef {"type":"Boolean","label":"Is Favorited","name":"isFavorited","uiComponent":{"type":"CHECKBOX"},"description":"Whether to mark the note as favorited. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"body":"Loves hiking","is_favorited":false,"contact":{"id":1,"complete_name":"John Doe"}}}
   */
  async createNote(contactId, body, isFavorited) {
    const logTag = '[createNote]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/notes`,
      method: 'post',
      body: clean({
        contact_id: contactId,
        body,
        is_favorited: isFavorited ? 1 : 0,
      }),
    })
  }

  /**
   * @operationName Update Note
   * @category Notes
   * @description Updates an existing note by ID. Requires the contact ID and note body; the favorited flag can be toggled.
   * @route PUT /notes/{noteId}
   * @paramDef {"type":"Number","label":"Note ID","name":"noteId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the note to update."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the contact the note belongs to."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated note content (max 100,000 characters)."}
   * @paramDef {"type":"Boolean","label":"Is Favorited","name":"isFavorited","uiComponent":{"type":"CHECKBOX"},"description":"Whether the note is favorited. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"body":"Loves hiking and climbing","is_favorited":true,"contact":{"id":1,"complete_name":"John Doe"}}}
   */
  async updateNote(noteId, contactId, body, isFavorited) {
    const logTag = '[updateNote]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/notes/${ noteId }`,
      method: 'put',
      body: clean({
        contact_id: contactId,
        body,
        is_favorited: isFavorited ? 1 : 0,
      }),
    })
  }

  /**
   * @operationName Delete Note
   * @category Notes
   * @description Permanently deletes a note by its numeric ID. This cannot be undone.
   * @route DELETE /notes/{noteId}
   * @paramDef {"type":"Number","label":"Note ID","name":"noteId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the note to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":1}
   */
  async deleteNote(noteId) {
    const logTag = '[deleteNote]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/notes/${ noteId }`,
      method: 'delete',
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Activities                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * @operationName List Activities
   * @category Activities
   * @description Lists activities across the account with pagination. Activities record something you did with one or more contacts, with a summary, description, and the date it happened. Results are wrapped in a data array alongside links and meta pagination info.
   * @route GET /activities
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of activities per page (default 15)."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":1,"summary":"Lunch downtown","happened_at":"2024-01-10","attendees":{"total":1,"contacts":[{"id":1,"complete_name":"John Doe"}]}}],"links":{"prev":null,"next":null},"meta":{"current_page":1,"total":1}}
   */
  async listActivities(page, limit) {
    const logTag = '[listActivities]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/activities`,
      method: 'get',
      query: {
        page: page || 1,
        limit: limit || DEFAULT_PAGE_LIMIT,
      },
    })
  }

  /**
   * @operationName Create Activity
   * @category Activities
   * @description Creates an activity shared with one or more contacts. Supply the activity type ID, a summary, a description, the date it happened (YYYY-MM-DD), and the list of contact IDs who attended.
   * @route POST /activities
   * @paramDef {"type":"Number","label":"Activity Type ID","name":"activityTypeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric activity type ID from Monica's Activity Types API."}
   * @paramDef {"type":"String","label":"Summary","name":"summary","required":true,"description":"Short summary of the activity."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed description of the activity."}
   * @paramDef {"type":"String","label":"Happened At","name":"happenedAt","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the activity happened, in YYYY-MM-DD format."}
   * @paramDef {"type":"Array<Number>","label":"Contact IDs","name":"contacts","required":true,"description":"Numeric IDs of the contacts who attended the activity."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"summary":"Lunch downtown","happened_at":"2024-01-10","attendees":{"total":1,"contacts":[{"id":1,"complete_name":"John Doe"}]}}}
   */
  async createActivity(activityTypeId, summary, description, happenedAt, contacts) {
    const logTag = '[createActivity]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/activities`,
      method: 'post',
      body: clean({
        activity_type_id: activityTypeId,
        summary,
        description,
        happened_at: happenedAt,
        contacts,
      }),
    })
  }

  /**
   * @operationName Update Activity
   * @category Activities
   * @description Updates an existing activity by ID. Requires the activity type ID, summary, happened-at date, and the list of attending contact IDs.
   * @route PUT /activities/{activityId}
   * @paramDef {"type":"Number","label":"Activity ID","name":"activityId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the activity to update."}
   * @paramDef {"type":"Number","label":"Activity Type ID","name":"activityTypeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric activity type ID from Monica's Activity Types API."}
   * @paramDef {"type":"String","label":"Summary","name":"summary","required":true,"description":"Short summary of the activity."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed description of the activity."}
   * @paramDef {"type":"String","label":"Happened At","name":"happenedAt","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the activity happened, in YYYY-MM-DD format."}
   * @paramDef {"type":"Array<Number>","label":"Contact IDs","name":"contacts","required":true,"description":"Numeric IDs of the contacts who attended the activity."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"summary":"Dinner uptown","happened_at":"2024-01-11","attendees":{"total":1,"contacts":[{"id":1,"complete_name":"John Doe"}]}}}
   */
  async updateActivity(activityId, activityTypeId, summary, description, happenedAt, contacts) {
    const logTag = '[updateActivity]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/activities/${ activityId }`,
      method: 'put',
      body: clean({
        activity_type_id: activityTypeId,
        summary,
        description,
        happened_at: happenedAt,
        contacts,
      }),
    })
  }

  /**
   * @operationName Delete Activity
   * @category Activities
   * @description Permanently deletes an activity by its numeric ID. This cannot be undone.
   * @route DELETE /activities/{activityId}
   * @paramDef {"type":"Number","label":"Activity ID","name":"activityId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the activity to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":1}
   */
  async deleteActivity(activityId) {
    const logTag = '[deleteActivity]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/activities/${ activityId }`,
      method: 'delete',
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Tasks                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * @operationName List Tasks
   * @category Tasks
   * @description Lists tasks across the account with pagination. Each task belongs to a contact and has a title, description, and completion status. Results are wrapped in a data array alongside links and meta pagination info.
   * @route GET /tasks
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tasks per page (default 15)."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":1,"title":"Send birthday card","completed":false,"contact":{"id":1,"complete_name":"John Doe"}}],"links":{"prev":null,"next":null},"meta":{"current_page":1,"total":1}}
   */
  async listTasks(page, limit) {
    const logTag = '[listTasks]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/tasks`,
      method: 'get',
      query: {
        page: page || 1,
        limit: limit || DEFAULT_PAGE_LIMIT,
      },
    })
  }

  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a task attached to a contact. Supply a title, an optional description, and whether it is already completed.
   * @route POST /tasks
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the contact the task belongs to."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the task."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed description of the task."}
   * @paramDef {"type":"Boolean","label":"Completed","name":"completed","uiComponent":{"type":"CHECKBOX"},"description":"Whether the task is already completed. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"title":"Send birthday card","completed":false,"contact":{"id":1,"complete_name":"John Doe"}}}
   */
  async createTask(contactId, title, description, completed) {
    const logTag = '[createTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/tasks`,
      method: 'post',
      body: clean({
        contact_id: contactId,
        title,
        description,
        completed: completed ? 1 : 0,
      }),
    })
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Updates an existing task by ID. Requires the contact ID and title; the description and completion status can be changed.
   * @route PUT /tasks/{taskId}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the task to update."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the contact the task belongs to."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the task."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed description of the task."}
   * @paramDef {"type":"Boolean","label":"Completed","name":"completed","uiComponent":{"type":"CHECKBOX"},"description":"Whether the task is completed. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"title":"Send birthday card","completed":true,"contact":{"id":1,"complete_name":"John Doe"}}}
   */
  async updateTask(taskId, contactId, title, description, completed) {
    const logTag = '[updateTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/tasks/${ taskId }`,
      method: 'put',
      body: clean({
        contact_id: contactId,
        title,
        description,
        completed: completed ? 1 : 0,
      }),
    })
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @description Permanently deletes a task by its numeric ID. This cannot be undone.
   * @route DELETE /tasks/{taskId}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the task to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":1}
   */
  async deleteTask(taskId) {
    const logTag = '[deleteTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/tasks/${ taskId }`,
      method: 'delete',
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Reminders                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * @operationName Create Reminder
   * @category Reminders
   * @description Creates a reminder for a contact. Reminders can be one-time or recur weekly, monthly, or yearly. Provide the next expected date (YYYY-MM-DD), the frequency type, and, for recurring reminders, the frequency number (e.g. every 2 weeks).
   * @route POST /reminders
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the contact the reminder belongs to."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Reminder title (max 100,000 characters)."}
   * @paramDef {"type":"String","label":"Next Expected Date","name":"nextExpectedDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the reminder is next expected, in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Frequency Type","name":"frequencyType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["One Time","Weekly","Monthly","Yearly"]}},"description":"How often the reminder recurs."}
   * @paramDef {"type":"Number","label":"Frequency Number","name":"frequencyNumber","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Interval multiplier for recurring reminders (e.g. 2 for every 2 weeks). Ignored for one-time reminders."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"title":"Call about the trip","next_expected_date":"2024-02-01","frequency_type":"week","frequency_number":2,"contact":{"id":1,"complete_name":"John Doe"}}}
   */
  async createReminder(contactId, title, nextExpectedDate, frequencyType, frequencyNumber) {
    const logTag = '[createReminder]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/reminders`,
      method: 'post',
      body: clean({
        contact_id: contactId,
        title,
        next_expected_date: nextExpectedDate,
        frequency_type: this.#resolveChoice(frequencyType, {
          'One Time': 'one_time',
          'Weekly': 'week',
          'Monthly': 'month',
          'Yearly': 'year',
        }),
        frequency_number: frequencyNumber,
      }),
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Calls                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * @operationName Create Call
   * @category Calls
   * @description Logs a phone call with a contact. Provide the contact ID, when the call happened (YYYY-MM-DD), and the call content or notes.
   * @route POST /calls
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the contact who was called."}
   * @paramDef {"type":"String","label":"Called At","name":"calledAt","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the call happened, in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes or content of the call."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"called_at":"2024-01-10","content":"Caught up about the new job","contact":{"id":1,"complete_name":"John Doe"}}}
   */
  async createCall(contactId, calledAt, content) {
    const logTag = '[createCall]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/calls`,
      method: 'post',
      body: clean({
        contact_id: contactId,
        called_at: calledAt,
        content,
      }),
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Tags                                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists all tags in the account with pagination. Tags can be applied to contacts for grouping and filtering. Results are wrapped in a data array alongside links and meta pagination info.
   * @route GET /tags
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tags per page (default 15)."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":1,"name":"Friend","name_slug":"friend"}],"links":{"prev":null,"next":null},"meta":{"current_page":1,"total":1}}
   */
  async listTags(page, limit) {
    const logTag = '[listTags]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/tags`,
      method: 'get',
      query: {
        page: page || 1,
        limit: limit || DEFAULT_PAGE_LIMIT,
      },
    })
  }

  /**
   * @operationName Create Tag
   * @category Tags
   * @description Creates a new tag by name. Tags can then be applied to contacts using Set Contact Tags.
   * @route POST /tags
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the tag to create."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"name":"Friend","name_slug":"friend"}}
   */
  async createTag(name) {
    const logTag = '[createTag]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/tags`,
      method: 'post',
      body: clean({ name }),
    })
  }

  /**
   * @operationName Set Contact Tags
   * @category Tags
   * @description Associates one or more tags with a contact. Supply the contact ID and an array of tag names; tags that do not yet exist are created automatically. This replaces the contact's current tag set with the provided list.
   * @route POST /contacts/{contactId}/setTags
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the contact to tag."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","required":true,"description":"Tag names to associate with the contact. Non-existent tags are created."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"complete_name":"John Doe","tags":[{"id":1,"name":"Friend"}]}}
   */
  async setContactTags(contactId, tags) {
    const logTag = '[setContactTags]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/contacts/${ contactId }/setTags`,
      method: 'post',
      body: clean({ tags }),
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Journal                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * @operationName List Journal Entries
   * @category Journal
   * @description Lists journal entries in the account with pagination. Journal entries are personal notes not tied to a specific contact. Results are wrapped in a data array alongside links and meta pagination info.
   * @route GET /journal
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of journal entries per page (default 15)."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":1,"title":"Great day","post":"Had a wonderful walk in the park.","created_at":"2024-01-10"}],"links":{"prev":null,"next":null},"meta":{"current_page":1,"total":1}}
   */
  async listJournalEntries(page, limit) {
    const logTag = '[listJournalEntries]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/journal`,
      method: 'get',
      query: {
        page: page || 1,
        limit: limit || DEFAULT_PAGE_LIMIT,
      },
    })
  }

  /**
   * @operationName Create Journal Entry
   * @category Journal
   * @description Creates a journal entry with a title and body text. Journal entries are personal and not associated with any contact.
   * @route POST /journal
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the journal entry."}
   * @paramDef {"type":"String","label":"Post","name":"post","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Body text of the journal entry."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"title":"Great day","post":"Had a wonderful walk in the park.","created_at":"2024-01-10"}}
   */
  async createJournalEntry(title, post) {
    const logTag = '[createJournalEntry]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/journal`,
      method: 'post',
      body: clean({ title, post }),
    })
  }

  /* ---------------------------------------------------------------------- */
  /* User                                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * @operationName Get Me
   * @category User
   * @description Retrieves the authenticated user's profile. Useful as a connection check to verify the API token and base URL are correct.
   * @route GET /me
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"first_name":"Jane","last_name":"Smith","email":"jane@example.com","timezone":"UTC"}}
   */
  async getMe() {
    const logTag = '[getMe]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/me`,
      method: 'get',
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Dictionaries                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * @typedef {Object} getContactsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter contacts by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for fetching additional contacts."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contacts Dictionary
   * @description Provides a searchable, paginated list of contacts for selecting one in dependent parameters. The option value is the contact's numeric ID and the label is the complete name.
   * @route POST /get-contacts-dictionary
   * @paramDef {"type":"getContactsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input for listing contacts."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Doe","value":"1","note":"Contact"}],"cursor":"2"}
   */
  async getContactsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getContactsDictionary]'
    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/contacts`,
      method: 'get',
      query: {
        query: search,
        page,
        limit: DEFAULT_PAGE_LIMIT,
      },
    })

    const contacts = response.data || []
    const meta = response.meta || {}
    const hasMore = meta.current_page && meta.last_page && meta.current_page < meta.last_page

    return {
      items: contacts.map(contact => ({
        label: contact.complete_name || `${ contact.first_name || '' } ${ contact.last_name || '' }`.trim() || `Contact ${ contact.id }`,
        value: String(contact.id),
        note: contact.nickname || undefined,
      })),
      cursor: hasMore ? String(meta.current_page + 1) : undefined,
    }
  }
}

Flowrunner.ServerCode.addService(MonicaService, [
  {
    name: 'baseUrl',
    displayName: 'Base URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: 'https://app.monicahq.com',
    hint: 'Monica base URL — https://app.monicahq.com for the hosted app, or your self-hosted URL — strip trailing slash.',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Monica → Settings → API → generate an OAuth/personal access token.',
  },
])
