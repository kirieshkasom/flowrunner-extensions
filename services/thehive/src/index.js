const logger = {
  info: (...args) => console.log('[TheHive] info:', ...args),
  debug: (...args) => console.log('[TheHive] debug:', ...args),
  error: (...args) => console.log('[TheHive] error:', ...args),
  warn: (...args) => console.log('[TheHive] warn:', ...args),
}

const SEVERITY_MAP = { Low: 1, Medium: 2, High: 3, Critical: 4 }
const TLP_MAP = { WHITE: 0, GREEN: 1, AMBER: 2, RED: 3 }
const PAP_MAP = { WHITE: 0, GREEN: 1, AMBER: 2, RED: 3 }

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
 * @integrationName TheHive
 * @integrationIcon /icon.png
 */
class TheHiveService {
  constructor(config) {
    // Normalize the instance URL: strip any trailing slash so we can safely append /api/v1.
    this.baseUrl = (config.url || '').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  #apiBase() {
    return `${ this.baseUrl }/api/v1`
  }

  // Map a friendly DROPDOWN label to the API value; pass through anything not in the map.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      // TheHive returns either { type, message } or an array of such objects, plus an HTTP status.
      const rawBody = error.body
      let apiMessage

      if (Array.isArray(rawBody)) {
        apiMessage = rawBody.map(item => item?.message || item?.type).filter(Boolean).join('; ')
      } else if (rawBody && typeof rawBody === 'object') {
        apiMessage = rawBody.message || rawBody.type
      }

      const status = error.status || error.statusCode
      const message = apiMessage || (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - failed (${ status || 'no status' }): ${ message }`)

      throw new Error(`TheHive API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /* ---------------------------------------------------------------------------
   * Cases
   * ------------------------------------------------------------------------- */

  /**
   * @operationName Create Case
   * @category Cases
   * @description Creates a new case in TheHive. A case is the central container for a security investigation and groups tasks, observables, and analyst notes. Provide at minimum a title and description. Severity, TLP (Traffic Light Protocol sharing level), and PAP (Permissible Actions Protocol) accept friendly labels that are translated to TheHive's numeric codes. Returns the created case including its generated id and number.
   * @route POST /case
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Short, descriptive case title."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full case description, supports Markdown."}
   * @paramDef {"type":"String","label":"Severity","name":"severity","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Critical"]}},"defaultValue":"Medium","description":"Impact of the case. Maps to TheHive severity 1-4."}
   * @paramDef {"type":"String","label":"TLP","name":"tlp","uiComponent":{"type":"DROPDOWN","options":{"values":["WHITE","GREEN","AMBER","RED"]}},"defaultValue":"AMBER","description":"Traffic Light Protocol sharing level. Maps to TheHive tlp 0-3."}
   * @paramDef {"type":"String","label":"PAP","name":"pap","uiComponent":{"type":"DROPDOWN","options":{"values":["WHITE","GREEN","AMBER","RED"]}},"defaultValue":"AMBER","description":"Permissible Actions Protocol level. Maps to TheHive pap 0-3."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Optional list of tags to categorize the case."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"Optional custom case status (e.g. New, InProgress). Depends on your organisation's workflow configuration."}
   * @paramDef {"type":"Boolean","label":"Flag","name":"flag","uiComponent":{"type":"CHECKBOX"},"description":"Whether the case is flagged as important."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"~8200","_type":"Case","number":42,"title":"Suspicious login","description":"Multiple failed logins","severity":2,"tlp":2,"pap":2,"status":"New","stage":"New","tags":["bruteforce"],"flag":false,"_createdAt":1689350400000}
   */
  async createCase(title, description, severity, tlp, pap, tags, status, flag) {
    const logTag = '[createCase]'

    const body = clean({
      title,
      description,
      severity: this.#resolveChoice(severity, SEVERITY_MAP),
      tlp: this.#resolveChoice(tlp, TLP_MAP),
      pap: this.#resolveChoice(pap, PAP_MAP),
      tags: tags && tags.length ? tags : undefined,
      status,
      flag: typeof flag === 'boolean' ? flag : undefined,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/case`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Case
   * @category Cases
   * @description Retrieves a single case by its id (e.g. "~8200"). Returns the full case object including severity, TLP/PAP, status, tags, assignee, and timestamps.
   * @route GET /case/{id}
   *
   * @paramDef {"type":"String","label":"Case ID","name":"id","required":true,"description":"The case id (the _id value, e.g. ~8200)."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"~8200","_type":"Case","number":42,"title":"Suspicious login","description":"Multiple failed logins","severity":2,"tlp":2,"pap":2,"status":"New","tags":["bruteforce"],"flag":false,"_createdAt":1689350400000}
   */
  async getCase(id) {
    const logTag = '[getCase]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/case/${ encodeURIComponent(id) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Case
   * @category Cases
   * @description Updates fields on an existing case. Only the fields you provide are changed; omitted fields are left untouched. Severity, TLP, and PAP accept friendly labels that map to TheHive's numeric codes. Returns no content on success.
   * @route PATCH /case/{id}
   *
   * @paramDef {"type":"String","label":"Case ID","name":"id","required":true,"description":"The case id to update (e.g. ~8200)."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New case title."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New case description (Markdown)."}
   * @paramDef {"type":"String","label":"Severity","name":"severity","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Critical"]}},"description":"New severity. Maps to TheHive severity 1-4."}
   * @paramDef {"type":"String","label":"TLP","name":"tlp","uiComponent":{"type":"DROPDOWN","options":{"values":["WHITE","GREEN","AMBER","RED"]}},"description":"New TLP sharing level. Maps to TheHive tlp 0-3."}
   * @paramDef {"type":"String","label":"PAP","name":"pap","uiComponent":{"type":"DROPDOWN","options":{"values":["WHITE","GREEN","AMBER","RED"]}},"description":"New PAP level. Maps to TheHive pap 0-3."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Replacement list of tags for the case."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"New case status (e.g. New, InProgress, Closed). Depends on your workflow configuration."}
   * @paramDef {"type":"Boolean","label":"Flag","name":"flag","uiComponent":{"type":"CHECKBOX"},"description":"Whether the case is flagged as important."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateCase(id, title, description, severity, tlp, pap, tags, status, flag) {
    const logTag = '[updateCase]'

    const body = clean({
      title,
      description,
      severity: this.#resolveChoice(severity, SEVERITY_MAP),
      tlp: this.#resolveChoice(tlp, TLP_MAP),
      pap: this.#resolveChoice(pap, PAP_MAP),
      tags: tags && tags.length ? tags : undefined,
      status,
      flag: typeof flag === 'boolean' ? flag : undefined,
    })

    const result = await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/case/${ encodeURIComponent(id) }`,
      method: 'patch',
      body,
    })

    // TheHive returns 204 No Content on a successful update.
    return result || { success: true }
  }

  /**
   * @operationName Delete Case
   * @category Cases
   * @description Permanently deletes a case by id, along with its tasks and observables. This action cannot be undone. Returns a success indicator.
   * @route DELETE /case/{id}
   *
   * @paramDef {"type":"String","label":"Case ID","name":"id","required":true,"description":"The case id to delete (e.g. ~8200)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteCase(id) {
    const logTag = '[deleteCase]'

    const result = await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/case/${ encodeURIComponent(id) }`,
      method: 'delete',
    })

    return result || { success: true }
  }

  /**
   * @operationName List Cases
   * @category Cases
   * @description Lists cases using TheHive's query API, with optional keyword filtering and pagination. Internally posts a query pipeline to /query: [{ "_name": "listCase" }, (optional keyword filter), { "_name": "page", "from": ..., "to": ... }]. For advanced filtering use the Run Query operation. Returns an array of case objects.
   * @route POST /list-cases
   *
   * @paramDef {"type":"String","label":"Keyword","name":"keyword","description":"Optional free-text keyword to filter cases (matches title, description, and tags)."}
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based index of the first result to return (default 0)."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Exclusive index of the last result (default 25, i.e. first 25 cases)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"~8200","_type":"Case","number":42,"title":"Suspicious login","severity":2,"tlp":2,"status":"New","tags":["bruteforce"],"_createdAt":1689350400000}]
   */
  async listCases(keyword, from, to) {
    const logTag = '[listCases]'

    const query = [{ _name: 'listCase' }]

    if (keyword) {
      query.push({ _name: 'filter', _like: { _field: 'keyword', _value: keyword } })
    }

    query.push({ _name: 'page', from: from || 0, to: to || 25 })

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/query`,
      method: 'post',
      body: { query },
    })
  }

  /* ---------------------------------------------------------------------------
   * Tasks
   * ------------------------------------------------------------------------- */

  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a task within a case. Tasks track investigation steps and can be grouped and assigned. Provide the parent case id and a task title; group, status, and description are optional. Returns the created task.
   * @route POST /case/{caseId}/task
   *
   * @paramDef {"type":"String","label":"Case ID","name":"caseId","required":true,"description":"The id of the case to add the task to (e.g. ~8200)."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Task title."}
   * @paramDef {"type":"String","label":"Group","name":"group","description":"Optional group name used to organize related tasks (e.g. \"identification\")."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Waiting","InProgress","Completed","Cancel"]}},"description":"Initial task status. Defaults to Waiting."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional task description (Markdown)."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"~9300","_type":"Task","title":"Collect logs","group":"identification","status":"Waiting","flag":false,"_createdAt":1689350400000}
   */
  async createTask(caseId, title, group, status, description) {
    const logTag = '[createTask]'

    const body = clean({
      title,
      group,
      status,
      description,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/case/${ encodeURIComponent(caseId) }/task`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Task
   * @category Tasks
   * @description Retrieves a single task by its id. Returns the task object including title, group, status, assignee, and timestamps.
   * @route GET /task/{id}
   *
   * @paramDef {"type":"String","label":"Task ID","name":"id","required":true,"description":"The task id (e.g. ~9300)."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"~9300","_type":"Task","title":"Collect logs","group":"identification","status":"InProgress","flag":false,"_createdAt":1689350400000}
   */
  async getTask(id) {
    const logTag = '[getTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/task/${ encodeURIComponent(id) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Updates fields on an existing task. Only the fields you provide are changed. Commonly used to advance a task's status. Returns a success indicator.
   * @route PATCH /task/{id}
   *
   * @paramDef {"type":"String","label":"Task ID","name":"id","required":true,"description":"The task id to update (e.g. ~9300)."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New task title."}
   * @paramDef {"type":"String","label":"Group","name":"group","description":"New group name."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Waiting","InProgress","Completed","Cancel"]}},"description":"New task status."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New task description (Markdown)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateTask(id, title, group, status, description) {
    const logTag = '[updateTask]'

    const body = clean({
      title,
      group,
      status,
      description,
    })

    const result = await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/task/${ encodeURIComponent(id) }`,
      method: 'patch',
      body,
    })

    return result || { success: true }
  }

  /**
   * @operationName List Case Tasks
   * @category Tasks
   * @description Lists the tasks belonging to a case using TheHive's query API. Internally posts [{ "_name": "getCase", "idOrName": caseId }, { "_name": "tasks" }, { "_name": "page", "from": ..., "to": ... }] to /query. Returns an array of task objects.
   * @route POST /list-case-tasks
   *
   * @paramDef {"type":"String","label":"Case ID","name":"caseId","required":true,"description":"The id of the case whose tasks to list (e.g. ~8200)."}
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based index of the first result (default 0)."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Exclusive index of the last result (default 50)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"~9300","_type":"Task","title":"Collect logs","group":"identification","status":"Waiting","_createdAt":1689350400000}]
   */
  async listCaseTasks(caseId, from, to) {
    const logTag = '[listCaseTasks]'

    const query = [
      { _name: 'getCase', idOrName: caseId },
      { _name: 'tasks' },
      { _name: 'page', from: from || 0, to: to || 50 },
    ]

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/query`,
      method: 'post',
      body: { query },
    })
  }

  /* ---------------------------------------------------------------------------
   * Observables
   * ------------------------------------------------------------------------- */

  /**
   * @operationName Create Observable
   * @category Observables
   * @description Adds an observable (a piece of technical evidence such as an IP, domain, URL, hash, or email) to a case. Set "ioc" to mark it as an Indicator of Compromise and "sighted" if it has been seen in your environment. Returns an array containing the created observable(s).
   * @route POST /case/{caseId}/observable
   *
   * @paramDef {"type":"String","label":"Case ID","name":"caseId","required":true,"description":"The id of the case to add the observable to (e.g. ~8200)."}
   * @paramDef {"type":"String","label":"Data Type","name":"dataType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["ip","domain","fqdn","url","uri_path","user-agent","mail","mail_subject","hash","filename","registry","regexp","other","autonomous-system"]}},"description":"The type of observable being recorded."}
   * @paramDef {"type":"String","label":"Data","name":"data","required":true,"description":"The observable value itself (e.g. 8.8.8.8, evil.com, the hash string)."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional context or analyst note about this observable."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Optional list of tags for the observable."}
   * @paramDef {"type":"Boolean","label":"Is IOC","name":"ioc","uiComponent":{"type":"CHECKBOX"},"description":"Mark this observable as an Indicator of Compromise."}
   * @paramDef {"type":"Boolean","label":"Sighted","name":"sighted","uiComponent":{"type":"CHECKBOX"},"description":"Mark this observable as having been sighted in your environment."}
   * @paramDef {"type":"String","label":"TLP","name":"tlp","uiComponent":{"type":"DROPDOWN","options":{"values":["WHITE","GREEN","AMBER","RED"]}},"description":"Traffic Light Protocol sharing level for this observable. Maps to tlp 0-3."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"~10400","_type":"Observable","dataType":"ip","data":"8.8.8.8","message":"C2 server","tlp":2,"ioc":true,"sighted":false,"tags":["c2"],"_createdAt":1689350400000}]
   */
  async createObservable(caseId, dataType, data, message, tags, ioc, sighted, tlp) {
    const logTag = '[createObservable]'

    const body = clean({
      dataType,
      data,
      message,
      tags: tags && tags.length ? tags : undefined,
      ioc: typeof ioc === 'boolean' ? ioc : undefined,
      sighted: typeof sighted === 'boolean' ? sighted : undefined,
      tlp: this.#resolveChoice(tlp, TLP_MAP),
    })

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/case/${ encodeURIComponent(caseId) }/observable`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Observable
   * @category Observables
   * @description Retrieves a single observable by its id. Returns the observable object including its data type, value, IOC/sighted flags, TLP, and timestamps.
   * @route GET /observable/{id}
   *
   * @paramDef {"type":"String","label":"Observable ID","name":"id","required":true,"description":"The observable id (e.g. ~10400)."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"~10400","_type":"Observable","dataType":"ip","data":"8.8.8.8","message":"C2 server","tlp":2,"ioc":true,"sighted":false,"tags":["c2"],"_createdAt":1689350400000}
   */
  async getObservable(id) {
    const logTag = '[getObservable]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/observable/${ encodeURIComponent(id) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Case Observables
   * @category Observables
   * @description Lists the observables belonging to a case using TheHive's query API. Internally posts [{ "_name": "getCase", "idOrName": caseId }, { "_name": "observables" }, { "_name": "page", "from": ..., "to": ... }] to /query. Returns an array of observable objects.
   * @route POST /list-case-observables
   *
   * @paramDef {"type":"String","label":"Case ID","name":"caseId","required":true,"description":"The id of the case whose observables to list (e.g. ~8200)."}
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based index of the first result (default 0)."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Exclusive index of the last result (default 50)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"~10400","_type":"Observable","dataType":"ip","data":"8.8.8.8","ioc":true,"sighted":false,"tlp":2,"_createdAt":1689350400000}]
   */
  async listCaseObservables(caseId, from, to) {
    const logTag = '[listCaseObservables]'

    const query = [
      { _name: 'getCase', idOrName: caseId },
      { _name: 'observables' },
      { _name: 'page', from: from || 0, to: to || 50 },
    ]

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/query`,
      method: 'post',
      body: { query },
    })
  }

  /* ---------------------------------------------------------------------------
   * Alerts
   * ------------------------------------------------------------------------- */

  /**
   * @operationName Create Alert
   * @category Alerts
   * @description Creates an alert in TheHive. Alerts are notifications from external sources (SIEM, email, threat feeds) that analysts triage and optionally promote to cases. The combination of type, source, and sourceRef uniquely identifies an alert. Observables can be attached inline as an array of { dataType, data } objects. Returns the created alert.
   * @route POST /alert
   *
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"description":"Alert type, a free-text category (e.g. \"intrusion\", \"phishing\")."}
   * @paramDef {"type":"String","label":"Source","name":"source","required":true,"description":"Name of the system that generated the alert (e.g. \"SIEM\", \"Email Gateway\")."}
   * @paramDef {"type":"String","label":"Source Reference","name":"sourceRef","required":true,"description":"Unique reference for this alert within the source. Together with type and source it must be unique."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Short alert title."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full alert description (Markdown)."}
   * @paramDef {"type":"String","label":"Severity","name":"severity","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Critical"]}},"defaultValue":"Medium","description":"Alert severity. Maps to TheHive severity 1-4."}
   * @paramDef {"type":"String","label":"TLP","name":"tlp","uiComponent":{"type":"DROPDOWN","options":{"values":["WHITE","GREEN","AMBER","RED"]}},"defaultValue":"AMBER","description":"Traffic Light Protocol sharing level. Maps to tlp 0-3."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Optional list of tags for the alert."}
   * @paramDef {"type":"Array<Object>","label":"Observables","name":"observables","description":"Optional array of observables to attach, each an object like {\"dataType\":\"ip\",\"data\":\"8.8.8.8\"}."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"~12500","_type":"Alert","type":"phishing","source":"Email Gateway","sourceRef":"EG-2024-001","title":"Phishing email reported","severity":2,"tlp":2,"status":"New","tags":["phishing"],"_createdAt":1689350400000}
   */
  async createAlert(type, source, sourceRef, title, description, severity, tlp, tags, observables) {
    const logTag = '[createAlert]'

    const body = clean({
      type,
      source,
      sourceRef,
      title,
      description,
      severity: this.#resolveChoice(severity, SEVERITY_MAP),
      tlp: this.#resolveChoice(tlp, TLP_MAP),
      tags: tags && tags.length ? tags : undefined,
      observables: observables && observables.length ? observables : undefined,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/alert`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Alert
   * @category Alerts
   * @description Retrieves a single alert by its id. Returns the full alert object including type, source, sourceRef, severity, TLP, status, and timestamps.
   * @route GET /alert/{id}
   *
   * @paramDef {"type":"String","label":"Alert ID","name":"id","required":true,"description":"The alert id (e.g. ~12500)."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"~12500","_type":"Alert","type":"phishing","source":"Email Gateway","sourceRef":"EG-2024-001","title":"Phishing email reported","severity":2,"tlp":2,"status":"New","tags":["phishing"],"_createdAt":1689350400000}
   */
  async getAlert(id) {
    const logTag = '[getAlert]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/alert/${ encodeURIComponent(id) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Alert
   * @category Alerts
   * @description Updates fields on an existing alert. Only the fields you provide are changed. Useful for re-triaging (changing severity, TLP, tags, or status) before promoting to a case. Returns a success indicator.
   * @route PATCH /alert/{id}
   *
   * @paramDef {"type":"String","label":"Alert ID","name":"id","required":true,"description":"The alert id to update (e.g. ~12500)."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New alert title."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New alert description (Markdown)."}
   * @paramDef {"type":"String","label":"Severity","name":"severity","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Critical"]}},"description":"New severity. Maps to TheHive severity 1-4."}
   * @paramDef {"type":"String","label":"TLP","name":"tlp","uiComponent":{"type":"DROPDOWN","options":{"values":["WHITE","GREEN","AMBER","RED"]}},"description":"New TLP sharing level. Maps to tlp 0-3."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Replacement list of tags for the alert."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"New alert status (e.g. New, Ignored, Imported). Depends on your workflow configuration."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateAlert(id, title, description, severity, tlp, tags, status) {
    const logTag = '[updateAlert]'

    const body = clean({
      title,
      description,
      severity: this.#resolveChoice(severity, SEVERITY_MAP),
      tlp: this.#resolveChoice(tlp, TLP_MAP),
      tags: tags && tags.length ? tags : undefined,
      status,
    })

    const result = await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/alert/${ encodeURIComponent(id) }`,
      method: 'patch',
      body,
    })

    return result || { success: true }
  }

  /**
   * @operationName Promote Alert to Case
   * @category Alerts
   * @description Promotes an alert into a new case, copying its details and observables. Optionally supply a case template name and field overrides (any Create Case fields) to apply during promotion. Returns the newly created case.
   * @route POST /alert/{id}/case
   *
   * @paramDef {"type":"String","label":"Alert ID","name":"id","required":true,"description":"The alert id to promote (e.g. ~12500)."}
   * @paramDef {"type":"String","label":"Case Template","name":"caseTemplate","description":"Optional name of a case template to apply when creating the case."}
   * @paramDef {"type":"Object","label":"Case Field Overrides","name":"fields","description":"Optional object of case fields to override on the new case, e.g. {\"title\":\"Escalated\",\"severity\":3}. Uses TheHive numeric codes for severity/tlp/pap."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"~8300","_type":"Case","number":43,"title":"Phishing email reported","severity":2,"tlp":2,"status":"New","tags":["phishing"],"_createdAt":1689350400000}
   */
  async promoteAlertToCase(id, caseTemplate, fields) {
    const logTag = '[promoteAlertToCase]'

    const body = clean({
      caseTemplate,
      ...(fields && typeof fields === 'object' ? { fields } : {}),
    })

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/alert/${ encodeURIComponent(id) }/case`,
      method: 'post',
      body: Object.keys(body).length ? body : {},
    })
  }

  /**
   * @operationName Merge Alert into Case
   * @category Alerts
   * @description Merges an existing alert into an existing case, adding the alert's observables and details to that case instead of creating a new one. Returns the updated case.
   * @route POST /alert/{alertId}/merge/{caseId}
   *
   * @paramDef {"type":"String","label":"Alert ID","name":"alertId","required":true,"description":"The alert id to merge (e.g. ~12500)."}
   * @paramDef {"type":"String","label":"Case ID","name":"caseId","required":true,"description":"The id of the case to merge the alert into (e.g. ~8200)."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"~8200","_type":"Case","number":42,"title":"Suspicious login","severity":2,"tlp":2,"status":"New","_createdAt":1689350400000}
   */
  async mergeAlertIntoCase(alertId, caseId) {
    const logTag = '[mergeAlertIntoCase]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/alert/${ encodeURIComponent(alertId) }/merge/${ encodeURIComponent(caseId) }`,
      method: 'post',
    })
  }

  /**
   * @operationName List Alerts
   * @category Alerts
   * @description Lists alerts using TheHive's query API, with optional keyword filtering and pagination. Internally posts [{ "_name": "listAlert" }, (optional keyword filter), { "_name": "page", "from": ..., "to": ... }] to /query. For advanced filtering use the Run Query operation. Returns an array of alert objects.
   * @route POST /list-alerts
   *
   * @paramDef {"type":"String","label":"Keyword","name":"keyword","description":"Optional free-text keyword to filter alerts (matches title, description, and tags)."}
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based index of the first result (default 0)."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Exclusive index of the last result (default 25)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"~12500","_type":"Alert","type":"phishing","source":"Email Gateway","sourceRef":"EG-2024-001","title":"Phishing email reported","severity":2,"tlp":2,"status":"New","_createdAt":1689350400000}]
   */
  async listAlerts(keyword, from, to) {
    const logTag = '[listAlerts]'

    const query = [{ _name: 'listAlert' }]

    if (keyword) {
      query.push({ _name: 'filter', _like: { _field: 'keyword', _value: keyword } })
    }

    query.push({ _name: 'page', from: from || 0, to: to || 25 })

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/query`,
      method: 'post',
      body: { query },
    })
  }

  /* ---------------------------------------------------------------------------
   * Query (escape hatch)
   * ------------------------------------------------------------------------- */

  /**
   * @operationName Run Query
   * @category Query
   * @description Runs a raw TheHive query using its query DSL against the /query endpoint. This is the escape hatch for advanced search and reporting not covered by the dedicated operations. Provide the "query" as an array of pipeline stages, each an object with a "_name" (e.g. listCase, listAlert, filter, sort, page). Example: [{"_name":"listCase"},{"_name":"filter","_field":"status","_value":"New"},{"_name":"page","from":0,"to":25}]. Returns whatever the query produces (usually an array).
   * @route POST /query
   *
   * @paramDef {"type":"Array<Object>","label":"Query Pipeline","name":"query","required":true,"description":"Array of TheHive query DSL stages. Each stage is an object with a \"_name\" plus stage-specific properties (filter, sort, page, etc.)."}
   *
   * @returns {Object}
   * @sampleResult [{"_id":"~8200","_type":"Case","number":42,"title":"Suspicious login","severity":2,"status":"New","_createdAt":1689350400000}]
   */
  async runQuery(query) {
    const logTag = '[runQuery]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/query`,
      method: 'post',
      body: { query: query || [] },
    })
  }
}

Flowrunner.ServerCode.addService(TheHiveService, [
  {
    name: 'url',
    displayName: 'Instance URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your TheHive URL, e.g. https://thehive.example.com (any trailing slash is stripped automatically). The API is called at {url}/api/v1.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A TheHive API key sent as a Bearer token. Create one under TheHive -> your profile -> API keys -> create a key.',
  },
])
