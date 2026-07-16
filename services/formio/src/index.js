const logger = {
  info: (...args) => console.log('[Form.io] info:', ...args),
  debug: (...args) => console.log('[Form.io] debug:', ...args),
  error: (...args) => console.log('[Form.io] error:', ...args),
  warn: (...args) => console.log('[Form.io] warn:', ...args),
}

const DEFAULT_LIMIT = 25

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
 * @integrationName Form.io
 * @integrationIcon /icon.png
 */
class FormioService {
  constructor(config) {
    this.projectUrl = (config.projectUrl || '').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  // All external calls flow through here. Form.io authenticates with the x-token header,
  // and returns the response body directly (list endpoints put totals in Content-Range).
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.projectUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'x-token': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const body = error.body
      const detail = body && (body.message || body.name || (typeof body === 'string' ? body : JSON.stringify(body)))
      const message = detail || error.message || 'Unknown error'
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status || 'n/a' }): ${ message }`)

      throw new Error(`Form.io API error${ status ? ` [${ status }]` : '' }: ${ message }`)
    }
  }

  // Form.io accepts either a Mongo _id or a form path in the /form/{id} URL segment.
  // Both resolve server-side, so callers may pass whichever they have.
  #formSegment(formIdOrPath) {
    if (!formIdOrPath) {
      throw new Error('Form.io API error: a form id or path is required')
    }

    return `/form/${ encodeURIComponent(String(formIdOrPath).trim()) }`
  }

  /**
   * @operationName List Forms
   * @category Forms
   * @description Lists forms in the Form.io project. Returns an array of form objects, each with its _id, title, name, path, type, display and components. Use limit/skip to paginate; the total count is returned by Form.io in the Content-Range response header. Filter to a single form type (form or resource) via the Type parameter.
   * @route GET /forms
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Form","Resource","All"]}},"description":"Which kind of form to list. Form is a standard form, Resource is a data resource. Defaults to Form."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of forms to return (default 25)."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of forms to skip for pagination (default 0)."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","description":"Field to sort by, e.g. title or -created (prefix with - for descending)."}
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"5f8d0d55b54764421b7156c9","title":"Contact Us","name":"contactUs","path":"contact","type":"form","display":"form","components":[{"type":"textfield","key":"firstName","label":"First Name"}],"created":"2020-10-19T12:00:00.000Z","modified":"2020-10-19T12:00:00.000Z"}]
   */
  async listForms(type, limit, skip, sort) {
    const resolvedType = this.#resolveChoice(type, { Form: 'form', Resource: 'resource', All: undefined })

    return await this.#apiRequest({
      logTag: '[listForms]',
      path: '/form',
      method: 'get',
      query: {
        type: resolvedType === undefined ? (type === 'All' ? undefined : 'form') : resolvedType,
        limit: limit || DEFAULT_LIMIT,
        skip: skip || 0,
        sort,
      },
    })
  }

  /**
   * @operationName Get Form
   * @category Forms
   * @description Retrieves a single form definition by its id or path. The returned components array reveals each field's key, which is the property name used inside a submission's data object. Inspect this before creating or reading submissions so you know the exact data keys to populate or read.
   * @route GET /form
   * @paramDef {"type":"String","label":"Form","name":"formIdOrPath","required":true,"dictionary":"getFormsDictionary","description":"The form id (_id) or form path. Select a form or enter an id/path directly."}
   * @returns {Object}
   * @sampleResult {"_id":"5f8d0d55b54764421b7156c9","title":"Contact Us","name":"contactUs","path":"contact","type":"form","display":"form","components":[{"type":"textfield","key":"firstName","label":"First Name","input":true},{"type":"email","key":"email","label":"Email","input":true}],"created":"2020-10-19T12:00:00.000Z","modified":"2020-10-19T12:00:00.000Z"}
   */
  async getForm(formIdOrPath) {
    return await this.#apiRequest({
      logTag: '[getForm]',
      path: this.#formSegment(formIdOrPath),
      method: 'get',
    })
  }

  /**
   * @operationName Create Form
   * @category Forms
   * @description Creates a new form or resource in the project. Provide a human-readable title, a machine name, a unique URL path, the form type, and the components array that defines the fields. Each component's key becomes a property in submission data objects. Returns the created form including its generated _id.
   * @route POST /forms
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Human-readable form title shown in the Form.io UI, e.g. Contact Us."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Machine name for the form, e.g. contactUs. Used internally by Form.io."}
   * @paramDef {"type":"String","label":"Path","name":"path","required":true,"description":"Unique URL path for the form, e.g. contact. Submissions live at {projectUrl}/{path}/submission."}
   * @paramDef {"type":"Array<Object>","label":"Components","name":"components","required":true,"description":"Array of Form.io component definitions (fields). Each object needs at least type, key and label, e.g. {\"type\":\"textfield\",\"key\":\"firstName\",\"label\":\"First Name\",\"input\":true}."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Form","Resource"]}},"description":"Whether to create a standard Form or a data Resource. Defaults to Form."}
   * @paramDef {"type":"String","label":"Display","name":"display","uiComponent":{"type":"DROPDOWN","options":{"values":["Form","Wizard","PDF"]}},"description":"How the form is rendered. Defaults to Form."}
   * @returns {Object}
   * @sampleResult {"_id":"5f8d0d55b54764421b7156c9","title":"Contact Us","name":"contactUs","path":"contact","type":"form","display":"form","components":[{"type":"textfield","key":"firstName","label":"First Name","input":true}],"created":"2020-10-19T12:00:00.000Z","modified":"2020-10-19T12:00:00.000Z"}
   */
  async createForm(title, name, path, components, type, display) {
    const body = clean({
      title,
      name,
      path,
      type: this.#resolveChoice(type, { Form: 'form', Resource: 'resource' }) || 'form',
      display: this.#resolveChoice(display, { Form: 'form', Wizard: 'wizard', PDF: 'pdf' }) || 'form',
      components: components || [],
    })

    return await this.#apiRequest({
      logTag: '[createForm]',
      path: '/form',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Form
   * @category Forms
   * @description Updates an existing form identified by its id or path. Send only the fields you want to change (title, name, path, components, type, display); omitted fields are left as-is. Note that replacing the components array replaces the whole field definition. Returns the updated form.
   * @route PUT /forms
   * @paramDef {"type":"String","label":"Form","name":"formIdOrPath","required":true,"dictionary":"getFormsDictionary","description":"The form id (_id) or path to update. Select a form or enter an id/path directly."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New human-readable title. Leave empty to keep the current title."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New machine name. Leave empty to keep the current name."}
   * @paramDef {"type":"String","label":"Path","name":"path","description":"New unique URL path. Leave empty to keep the current path."}
   * @paramDef {"type":"Array<Object>","label":"Components","name":"components","description":"Replacement components array (full field definition). Leave empty to keep the current components."}
   * @paramDef {"type":"String","label":"Display","name":"display","uiComponent":{"type":"DROPDOWN","options":{"values":["Form","Wizard","PDF"]}},"description":"New render mode. Leave empty to keep the current display."}
   * @returns {Object}
   * @sampleResult {"_id":"5f8d0d55b54764421b7156c9","title":"Contact Us Updated","name":"contactUs","path":"contact","type":"form","display":"form","components":[{"type":"textfield","key":"firstName","label":"First Name","input":true}],"modified":"2020-10-20T12:00:00.000Z"}
   */
  async updateForm(formIdOrPath, title, name, path, components, display) {
    const body = clean({
      title,
      name,
      path,
      components: components && components.length ? components : undefined,
      display: this.#resolveChoice(display, { Form: 'form', Wizard: 'wizard', PDF: 'pdf' }),
    })

    return await this.#apiRequest({
      logTag: '[updateForm]',
      path: this.#formSegment(formIdOrPath),
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete Form
   * @category Forms
   * @description Permanently deletes a form (or resource) identified by its id or path. This is irreversible and also removes access to the form's submissions endpoint. Returns an empty result on success.
   * @route DELETE /forms
   * @paramDef {"type":"String","label":"Form","name":"formIdOrPath","required":true,"dictionary":"getFormsDictionary","description":"The form id (_id) or path to delete. Select a form or enter an id/path directly."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteForm(formIdOrPath) {
    await this.#apiRequest({
      logTag: '[deleteForm]',
      path: this.#formSegment(formIdOrPath),
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName List Submissions
   * @category Submissions
   * @description Lists submissions for a form. Each submission has an _id and a data object whose keys match the form's component keys (see Get Form to discover them). Supports pagination via limit/skip and sorting via a field name (prefix with - for descending). Optionally pass a raw filter query string in Form.io's query syntax (e.g. data.email=jane@example.com&created__gt=2020-01-01) to narrow results server-side.
   * @route GET /submissions
   * @paramDef {"type":"String","label":"Form","name":"formIdOrPath","required":true,"dictionary":"getFormsDictionary","description":"The form id (_id) or path whose submissions to list. Select a form or enter an id/path directly."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of submissions to return (default 25)."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of submissions to skip for pagination (default 0)."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","description":"Field to sort by, e.g. created or -created (prefix with - for descending)."}
   * @paramDef {"type":"String","label":"Filter Query","name":"filter","description":"Optional raw Form.io filter query string, e.g. data.email=jane@example.com&created__gt=2020-01-01. Field operators include __gt, __lt, __gte, __lte, __ne, __regex."}
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"5f8d0e12b54764421b7156d1","form":"5f8d0d55b54764421b7156c9","data":{"firstName":"Jane","email":"jane@example.com"},"owner":"5f8d0d00b54764421b7156a0","created":"2020-10-19T12:05:00.000Z","modified":"2020-10-19T12:05:00.000Z"}]
   */
  async listSubmissions(formIdOrPath, limit, skip, sort, filter) {
    const query = {
      limit: limit || DEFAULT_LIMIT,
      skip: skip || 0,
      sort,
    }

    // Merge a raw Form.io filter query string (a=b&c=d) onto the structured query.
    if (filter) {
      for (const pair of String(filter).split('&')) {
        const idx = pair.indexOf('=')

        if (idx > 0) {
          query[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
        }
      }
    }

    return await this.#apiRequest({
      logTag: '[listSubmissions]',
      path: `${ this.#formSegment(formIdOrPath) }/submission`,
      method: 'get',
      query,
    })
  }

  /**
   * @operationName Get Submission
   * @category Submissions
   * @description Retrieves a single submission by its id within a form. The returned data object holds the submitted values keyed by the form's component keys (use Get Form to discover those keys). Returns the full submission including owner, roles and timestamps.
   * @route GET /submission
   * @paramDef {"type":"String","label":"Form","name":"formIdOrPath","required":true,"dictionary":"getFormsDictionary","description":"The form id (_id) or path the submission belongs to. Select a form or enter an id/path directly."}
   * @paramDef {"type":"String","label":"Submission ID","name":"submissionId","required":true,"description":"The submission _id to retrieve."}
   * @returns {Object}
   * @sampleResult {"_id":"5f8d0e12b54764421b7156d1","form":"5f8d0d55b54764421b7156c9","data":{"firstName":"Jane","email":"jane@example.com"},"owner":"5f8d0d00b54764421b7156a0","roles":[],"created":"2020-10-19T12:05:00.000Z","modified":"2020-10-19T12:05:00.000Z"}
   */
  async getSubmission(formIdOrPath, submissionId) {
    return await this.#apiRequest({
      logTag: '[getSubmission]',
      path: `${ this.#formSegment(formIdOrPath) }/submission/${ encodeURIComponent(submissionId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Submission
   * @category Submissions
   * @description Creates a new submission against a form. Provide a data object whose keys match the form's component keys (use Get Form to discover them), e.g. {"firstName":"Jane","email":"jane@example.com"}. Form.io validates the data against the form definition and returns the created submission with its generated _id.
   * @route POST /submissions
   * @paramDef {"type":"String","label":"Form","name":"formIdOrPath","required":true,"dictionary":"getFormsDictionary","description":"The form id (_id) or path to submit to. Select a form or enter an id/path directly."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"The submission data keyed by component key, e.g. {\"firstName\":\"Jane\",\"email\":\"jane@example.com\"}. Use Get Form to see the available keys."}
   * @returns {Object}
   * @sampleResult {"_id":"5f8d0e12b54764421b7156d1","form":"5f8d0d55b54764421b7156c9","data":{"firstName":"Jane","email":"jane@example.com"},"owner":null,"created":"2020-10-19T12:05:00.000Z","modified":"2020-10-19T12:05:00.000Z"}
   */
  async createSubmission(formIdOrPath, data) {
    return await this.#apiRequest({
      logTag: '[createSubmission]',
      path: `${ this.#formSegment(formIdOrPath) }/submission`,
      method: 'post',
      body: { data: data || {} },
    })
  }

  /**
   * @operationName Update Submission
   * @category Submissions
   * @description Updates an existing submission by id. Provide a data object with the full set of values keyed by component key (use Get Form to discover the keys); Form.io replaces the submission data with what you send. Returns the updated submission.
   * @route PUT /submissions
   * @paramDef {"type":"String","label":"Form","name":"formIdOrPath","required":true,"dictionary":"getFormsDictionary","description":"The form id (_id) or path the submission belongs to. Select a form or enter an id/path directly."}
   * @paramDef {"type":"String","label":"Submission ID","name":"submissionId","required":true,"description":"The submission _id to update."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"The updated submission data keyed by component key, e.g. {\"firstName\":\"Janet\",\"email\":\"janet@example.com\"}. Use Get Form to see the available keys."}
   * @returns {Object}
   * @sampleResult {"_id":"5f8d0e12b54764421b7156d1","form":"5f8d0d55b54764421b7156c9","data":{"firstName":"Janet","email":"janet@example.com"},"modified":"2020-10-20T09:00:00.000Z"}
   */
  async updateSubmission(formIdOrPath, submissionId, data) {
    return await this.#apiRequest({
      logTag: '[updateSubmission]',
      path: `${ this.#formSegment(formIdOrPath) }/submission/${ encodeURIComponent(submissionId) }`,
      method: 'put',
      body: { data: data || {} },
    })
  }

  /**
   * @operationName Delete Submission
   * @category Submissions
   * @description Permanently deletes a submission by id within a form. This is irreversible. Returns an empty result on success.
   * @route DELETE /submissions
   * @paramDef {"type":"String","label":"Form","name":"formIdOrPath","required":true,"dictionary":"getFormsDictionary","description":"The form id (_id) or path the submission belongs to. Select a form or enter an id/path directly."}
   * @paramDef {"type":"String","label":"Submission ID","name":"submissionId","required":true,"description":"The submission _id to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteSubmission(formIdOrPath, submissionId) {
    await this.#apiRequest({
      logTag: '[deleteSubmission]',
      path: `${ this.#formSegment(formIdOrPath) }/submission/${ encodeURIComponent(submissionId) }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName List Form Actions
   * @category Forms
   * @description Lists the actions configured on a form (e.g. save submission, email, webhook, role assignment). Each action defines behavior that runs when the form is submitted. Returns an array of action objects with their _id, name, title, handler and method.
   * @route GET /actions
   * @paramDef {"type":"String","label":"Form","name":"formIdOrPath","required":true,"dictionary":"getFormsDictionary","description":"The form id (_id) or path whose actions to list. Select a form or enter an id/path directly."}
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"5f8d0f00b54764421b7156e0","name":"save","title":"Save Submission","form":"5f8d0d55b54764421b7156c9","handler":["before"],"method":["create","update"],"priority":10}]
   */
  async listFormActions(formIdOrPath) {
    return await this.#apiRequest({
      logTag: '[listFormActions]',
      path: `${ this.#formSegment(formIdOrPath) }/action`,
      method: 'get',
    })
  }

  /**
   * @operationName List Roles
   * @category Roles
   * @description Lists the roles defined in the Form.io project (e.g. Administrator, Authenticated, Anonymous). Role ids are used when assigning permissions to submissions and forms. Returns an array of role objects with their _id, title and machineName.
   * @route GET /roles
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"5f8d0d00b54764421b7156a1","title":"Administrator","machineName":"project:administrator","admin":true,"default":false},{"_id":"5f8d0d00b54764421b7156a2","title":"Authenticated","machineName":"project:authenticated","admin":false,"default":false}]
   */
  async listRoles() {
    return await this.#apiRequest({
      logTag: '[listRoles]',
      path: '/role',
      method: 'get',
    })
  }

  /**
   * @operationName Get Current User
   * @category Connection
   * @description Returns the current authenticated user/token context for the project. Use this as a connection and credential check: a successful response confirms the project URL and API key (x-token) are valid. Returns the current submission/user object, or null when the token is a project-level API key with no bound user.
   * @route GET /current
   * @returns {Object}
   * @sampleResult {"_id":"5f8d0d00b54764421b7156a0","form":"5f8d0d00b54764421b7156b0","data":{"email":"admin@example.com","name":"Administrator"},"roles":["5f8d0d00b54764421b7156a1"],"created":"2020-10-19T11:00:00.000Z"}
   */
  async getCurrentUser() {
    return await this.#apiRequest({
      logTag: '[getCurrentUser]',
      path: '/current',
      method: 'get',
    })
  }

  /**
   * @typedef {Object} getFormsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter forms by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric skip offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Forms Dictionary
   * @description Provides a searchable list of the project's forms for selecting a form in operations that take a form id or path. The option value is the form _id, and the note shows the form path.
   * @route POST /get-forms-dictionary
   * @paramDef {"type":"getFormsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing forms."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Contact Us","value":"5f8d0d55b54764421b7156c9","note":"path: contact"}],"cursor":"25"}
   */
  async getFormsDictionary(payload) {
    const { search, cursor } = payload || {}
    const skip = cursor ? parseInt(cursor, 10) || 0 : 0

    const query = {
      type: 'form',
      limit: DEFAULT_LIMIT,
      skip,
      sort: 'title',
    }

    if (search) {
      query['title__regex'] = `/${ String(search).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') }/i`
    }

    const response = await this.#apiRequest({
      logTag: '[getFormsDictionary]',
      path: '/form',
      method: 'get',
      query,
    })

    const forms = Array.isArray(response) ? response : []

    return {
      items: forms.map(form => ({
        label: form.title || form.name || form.path || form._id,
        value: form._id,
        note: form.path ? `path: ${ form.path }` : undefined,
      })),
      cursor: forms.length === DEFAULT_LIMIT ? String(skip + DEFAULT_LIMIT) : undefined,
    }
  }

  // Maps a friendly dropdown label to the API value; passes through unknown values unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }
}

Flowrunner.ServerCode.addService(FormioService, [
  {
    name: 'projectUrl',
    displayName: 'Project URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Form.io project URL, e.g. https://examplxyz.form.io (strip any trailing slash).',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Form.io API key, sent as the x-token header. Create one in Form.io under Project Settings > API Keys.',
  },
])
