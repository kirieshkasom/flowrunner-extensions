const logger = {
  info: (...args) => console.log('[Grafana] info:', ...args),
  debug: (...args) => console.log('[Grafana] debug:', ...args),
  error: (...args) => console.log('[Grafana] error:', ...args),
  warn: (...args) => console.log('[Grafana] warn:', ...args),
}

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
 * @integrationName Grafana
 * @integrationIcon /icon.svg
 */
class GrafanaService {
  constructor(config) {
    this.serverUrl = (config.serverUrl || '').replace(/\/+$/, '')
    this.apiToken = config.apiToken
    this.baseUrl = `${ this.serverUrl }/api`
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiToken }`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.message || error.message
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`Grafana API error${ status ? ` [${ status }]` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Search Dashboards
   * @category Dashboards
   * @description Searches dashboards and folders in the current organization. Filter by a free-text query, one or more tags, and a type (dashboards or folders). Returns lightweight items with uid, title, folder, tags and url that can be used with Get Dashboard by UID.
   * @route GET /search
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Free-text search matched against dashboard and folder titles. Leave empty to list everything."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Dashboards","Folders"]}},"description":"Restrict results to dashboards or folders. Defaults to Dashboards."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Only return items tagged with all of these tags."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results (1-5000). Defaults to server behavior (1000)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":163,"uid":"cIBgcSjkk","title":"Production Overview","uri":"db/production-overview","url":"/d/cIBgcSjkk/production-overview","type":"dash-db","tags":["prod"],"isStarred":false,"folderUid":"nErXDvCkzz","folderTitle":"Ops"}]
   */
  async searchDashboards(query, type, tags, limit) {
    const logTag = '[searchDashboards]'
    const resolvedType = this.#resolveChoice(type, { Dashboards: 'dash-db', Folders: 'dash-folder' }) || 'dash-db'

    return await this.#apiRequest({
      logTag,
      path: '/search',
      method: 'get',
      query: {
        query,
        type: resolvedType,
        tag: Array.isArray(tags) && tags.length ? tags : undefined,
        limit,
      },
    })
  }

  /**
   * @operationName Get Dashboard by UID
   * @category Dashboards
   * @description Retrieves the full dashboard definition and metadata for a given dashboard UID. Returns the complete dashboard JSON model along with metadata such as the containing folder, version, and permissions.
   * @route GET /dashboards/uid/{uid}
   * @paramDef {"type":"String","label":"Dashboard UID","name":"uid","required":true,"description":"Unique identifier of the dashboard. Find it via Search Dashboards."}
   * @returns {Object}
   * @sampleResult {"meta":{"type":"db","canSave":true,"canEdit":true,"slug":"production-overview","url":"/d/cIBgcSjkk/production-overview","folderUid":"nErXDvCkzz","folderTitle":"Ops","version":12},"dashboard":{"uid":"cIBgcSjkk","title":"Production Overview","tags":["prod"],"schemaVersion":39,"version":12,"panels":[]}}
   */
  async getDashboardByUid(uid) {
    const logTag = '[getDashboardByUid]'

    return await this.#apiRequest({
      logTag,
      path: `/dashboards/uid/${ encodeURIComponent(uid) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create or Update Dashboard
   * @category Dashboards
   * @description Creates a new dashboard or updates an existing one. Provide the dashboard model as a JSON object (omit its id to create a new dashboard; include the existing uid to update). Optionally place it in a folder by folderUid, enable overwrite to replace an existing dashboard with the same uid/title, and attach a change message for the version history.
   * @route POST /dashboards/db
   * @paramDef {"type":"Object","label":"Dashboard","name":"dashboard","required":true,"description":"The dashboard JSON model. Set uid to update an existing dashboard, or omit id/uid to create a new one. Must include a title."}
   * @paramDef {"type":"String","label":"Folder UID","name":"folderUid","description":"UID of the folder to save the dashboard in. Leave empty for the General (root) folder."}
   * @paramDef {"type":"Boolean","label":"Overwrite","name":"overwrite","uiComponent":{"type":"CHECKBOX"},"description":"Overwrite an existing dashboard with the same uid or title. Defaults to false."}
   * @paramDef {"type":"String","label":"Message","name":"message","description":"Optional commit message stored in the dashboard version history."}
   * @returns {Object}
   * @sampleResult {"id":1,"uid":"cIBgcSjkk","slug":"production-overview","status":"success","version":2,"url":"/d/cIBgcSjkk/production-overview"}
   */
  async createOrUpdateDashboard(dashboard, folderUid, overwrite, message) {
    const logTag = '[createOrUpdateDashboard]'

    return await this.#apiRequest({
      logTag,
      path: '/dashboards/db',
      method: 'post',
      body: clean({
        dashboard,
        folderUid,
        overwrite: overwrite === true,
        message,
      }),
    })
  }

  /**
   * @operationName Delete Dashboard
   * @category Dashboards
   * @description Permanently deletes the dashboard identified by its UID. This action cannot be undone.
   * @route DELETE /dashboards/uid/{uid}
   * @paramDef {"type":"String","label":"Dashboard UID","name":"uid","required":true,"description":"Unique identifier of the dashboard to delete. Find it via Search Dashboards."}
   * @returns {Object}
   * @sampleResult {"title":"Production Overview","message":"Dashboard Production Overview deleted","id":2}
   */
  async deleteDashboard(uid) {
    const logTag = '[deleteDashboard]'

    return await this.#apiRequest({
      logTag,
      path: `/dashboards/uid/${ encodeURIComponent(uid) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Get Home Dashboard
   * @category Dashboards
   * @description Returns the home dashboard for the current organization or user. If a custom home dashboard is configured its full JSON model is returned; otherwise the default built-in home dashboard is returned.
   * @route GET /dashboards/home
   * @returns {Object}
   * @sampleResult {"meta":{"isHome":true,"canEdit":false},"dashboard":{"title":"Home","panels":[],"schemaVersion":39,"editable":false}}
   */
  async getHomeDashboard() {
    const logTag = '[getHomeDashboard]'

    return await this.#apiRequest({
      logTag,
      path: '/dashboards/home',
      method: 'get',
    })
  }

  /**
   * @operationName List Folders
   * @category Folders
   * @description Lists all folders the authenticated identity has access to in the current organization. Returns each folder's uid, title and url.
   * @route GET /folders
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of folders to return (default 1000, max 5000)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"uid":"nErXDvCkzz","title":"Ops","url":"/dashboards/f/nErXDvCkzz/ops"}]
   */
  async listFolders(limit) {
    const logTag = '[listFolders]'

    return await this.#apiRequest({
      logTag,
      path: '/folders',
      method: 'get',
      query: { limit },
    })
  }

  /**
   * @operationName Get Folder
   * @category Folders
   * @description Retrieves a single folder by its UID, including its title, url, version and permission flags.
   * @route GET /folders/{uid}
   * @paramDef {"type":"String","label":"Folder UID","name":"uid","required":true,"dictionary":"getFoldersDictionary","description":"UID of the folder. Search and select a folder, or type a UID directly."}
   * @returns {Object}
   * @sampleResult {"id":1,"uid":"nErXDvCkzz","title":"Ops","url":"/dashboards/f/nErXDvCkzz/ops","hasAcl":false,"canSave":true,"canEdit":true,"canAdmin":true,"version":1}
   */
  async getFolder(uid) {
    const logTag = '[getFolder]'

    return await this.#apiRequest({
      logTag,
      path: `/folders/${ encodeURIComponent(uid) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Folder
   * @category Folders
   * @description Creates a new folder in the current organization. A title is required; you may supply a custom uid, otherwise Grafana generates one automatically.
   * @route POST /folders
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Display title of the new folder."}
   * @paramDef {"type":"String","label":"UID","name":"uid","description":"Optional custom UID for the folder. Must be unique. Leave empty to let Grafana generate one."}
   * @returns {Object}
   * @sampleResult {"id":1,"uid":"nErXDvCkzz","title":"Ops","url":"/dashboards/f/nErXDvCkzz/ops","hasAcl":false,"canSave":true,"version":1}
   */
  async createFolder(title, uid) {
    const logTag = '[createFolder]'

    return await this.#apiRequest({
      logTag,
      path: '/folders',
      method: 'post',
      body: clean({ title, uid }),
    })
  }

  /**
   * @operationName Delete Folder
   * @category Folders
   * @description Permanently deletes a folder by its UID along with all dashboards it contains. This action cannot be undone.
   * @route DELETE /folders/{uid}
   * @paramDef {"type":"String","label":"Folder UID","name":"uid","required":true,"dictionary":"getFoldersDictionary","description":"UID of the folder to delete. Search and select a folder, or type a UID directly."}
   * @returns {Object}
   * @sampleResult {"message":"Folder deleted","id":1,"title":"Ops"}
   */
  async deleteFolder(uid) {
    const logTag = '[deleteFolder]'

    return await this.#apiRequest({
      logTag,
      path: `/folders/${ encodeURIComponent(uid) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Data Sources
   * @category Data Sources
   * @description Lists all data sources configured in the current organization. Returns each data source's id, uid, name, type, url and whether it is the default.
   * @route GET /datasources
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"orgId":1,"uid":"H8joYFVGz","name":"Prometheus","type":"prometheus","typeLogoUrl":"public/app/plugins/datasource/prometheus/img/prometheus_logo.svg","access":"proxy","url":"http://localhost:9090","isDefault":true,"readOnly":false}]
   */
  async listDataSources() {
    const logTag = '[listDataSources]'

    return await this.#apiRequest({
      logTag,
      path: '/datasources',
      method: 'get',
    })
  }

  /**
   * @operationName Get Data Source
   * @category Data Sources
   * @description Retrieves a single data source by its UID, including connection settings and jsonData. Secret fields are never returned.
   * @route GET /datasources/uid/{uid}
   * @paramDef {"type":"String","label":"Data Source UID","name":"uid","required":true,"dictionary":"getDataSourcesDictionary","description":"UID of the data source. Search and select a data source, or type a UID directly."}
   * @returns {Object}
   * @sampleResult {"id":1,"uid":"H8joYFVGz","orgId":1,"name":"Prometheus","type":"prometheus","access":"proxy","url":"http://localhost:9090","basicAuth":false,"isDefault":true,"jsonData":{"httpMethod":"POST"},"secureJsonFields":{},"version":1,"readOnly":false}
   */
  async getDataSource(uid) {
    const logTag = '[getDataSource]'

    return await this.#apiRequest({
      logTag,
      path: `/datasources/uid/${ encodeURIComponent(uid) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Data Source
   * @category Data Sources
   * @description Creates a new data source in the current organization. Provide a unique name, the plugin type (e.g. prometheus, loki, mysql), and the backend url. Use the access mode to control whether Grafana proxies requests (server) or the browser connects directly. jsonData and secureJsonData accept plugin-specific settings and secrets.
   * @route POST /datasources
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Unique display name for the data source."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"description":"Data source plugin type, e.g. prometheus, loki, mysql, influxdb, elasticsearch, graphite."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"Backend URL of the data source, e.g. http://localhost:9090."}
   * @paramDef {"type":"String","label":"Access Mode","name":"access","uiComponent":{"type":"DROPDOWN","options":{"values":["Server (proxy)","Browser (direct)"]}},"description":"How Grafana connects to the data source. Server proxies requests through Grafana; Browser connects directly from the user's browser. Defaults to Server (proxy)."}
   * @paramDef {"type":"Boolean","label":"Is Default","name":"isDefault","uiComponent":{"type":"CHECKBOX"},"description":"Make this the default data source for the organization. Defaults to false."}
   * @paramDef {"type":"Object","label":"JSON Data","name":"jsonData","description":"Optional plugin-specific non-secret settings, e.g. {\"httpMethod\":\"POST\"}."}
   * @paramDef {"type":"Object","label":"Secure JSON Data","name":"secureJsonData","description":"Optional plugin-specific secret settings such as API keys or passwords. Stored encrypted and never returned."}
   * @returns {Object}
   * @sampleResult {"datasource":{"id":1,"uid":"H8joYFVGz","orgId":1,"name":"Prometheus","type":"prometheus","access":"proxy","url":"http://localhost:9090","isDefault":false,"jsonData":{},"version":1,"readOnly":false},"id":1,"message":"Datasource added","name":"Prometheus"}
   */
  async createDataSource(name, type, url, access, isDefault, jsonData, secureJsonData) {
    const logTag = '[createDataSource]'
    const resolvedAccess = this.#resolveChoice(access, { 'Server (proxy)': 'proxy', 'Browser (direct)': 'direct' }) || 'proxy'

    return await this.#apiRequest({
      logTag,
      path: '/datasources',
      method: 'post',
      body: clean({
        name,
        type,
        url,
        access: resolvedAccess,
        isDefault: isDefault === true,
        jsonData,
        secureJsonData,
      }),
    })
  }

  /**
   * @operationName Query Data Source
   * @category Data Sources
   * @description Runs one or more queries against data sources and returns the resulting data frames. Each query object must reference its data source and include the plugin-specific model (e.g. a Prometheus expr). Supports a shared time range via from/to (relative like now-6h or epoch milliseconds).
   * @route POST /ds/query
   * @paramDef {"type":"Array<Object>","label":"Queries","name":"queries","required":true,"description":"Array of query objects. Each needs a refId, a datasource ({\"uid\":\"...\"}), and plugin-specific fields such as expr for Prometheus."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Start of the time range: relative (e.g. now-6h) or epoch milliseconds. Defaults to now-1h."}
   * @paramDef {"type":"String","label":"To","name":"to","description":"End of the time range: relative (e.g. now) or epoch milliseconds. Defaults to now."}
   * @returns {Object}
   * @sampleResult {"results":{"A":{"frames":[{"schema":{"refId":"A","fields":[{"name":"time","type":"time"},{"name":"A-series","type":"number"}]},"data":{"values":[[1644488152084,1644488212084],[1,20]]}}]}}}
   */
  async queryDataSource(queries, from, to) {
    const logTag = '[queryDataSource]'

    return await this.#apiRequest({
      logTag,
      path: '/ds/query',
      method: 'post',
      body: clean({
        queries,
        from: from || 'now-1h',
        to: to || 'now',
      }),
    })
  }

  /**
   * @operationName Create Annotation
   * @category Annotations
   * @description Creates an annotation. Supply the time as epoch milliseconds; include timeEnd to create a region annotation. Optionally attach it to a specific dashboard (dashboardUID) and panel (panelId) and add tags for filtering. Global annotations (no dashboard) show across all dashboards matching their tags.
   * @route POST /annotations
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"description":"Annotation description/body text."}
   * @paramDef {"type":"Number","label":"Time","name":"time","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Start time as epoch milliseconds (UTC)."}
   * @paramDef {"type":"Number","label":"Time End","name":"timeEnd","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional end time as epoch milliseconds for a region annotation."}
   * @paramDef {"type":"String","label":"Dashboard UID","name":"dashboardUID","description":"Optional dashboard UID to attach the annotation to. Leave empty for a global annotation."}
   * @paramDef {"type":"Number","label":"Panel ID","name":"panelId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional panel id within the dashboard to attach the annotation to."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Optional tags for filtering and matching global annotations."}
   * @returns {Object}
   * @sampleResult {"message":"Annotation added","id":1}
   */
  async createAnnotation(text, time, timeEnd, dashboardUID, panelId, tags) {
    const logTag = '[createAnnotation]'

    return await this.#apiRequest({
      logTag,
      path: '/annotations',
      method: 'post',
      body: clean({
        text,
        time,
        timeEnd,
        dashboardUID,
        panelId,
        tags: Array.isArray(tags) && tags.length ? tags : undefined,
      }),
    })
  }

  /**
   * @operationName List Annotations
   * @category Annotations
   * @description Finds annotations matching the given filters. Filter by time range (from/to as epoch milliseconds), tags, a specific dashboard, and limit the number of results. Returns matching annotation objects.
   * @route GET /annotations
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Start of range as epoch milliseconds. Only annotations at or after this time are returned."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"End of range as epoch milliseconds. Only annotations at or before this time are returned."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Only return annotations that have all of these tags."}
   * @paramDef {"type":"String","label":"Dashboard UID","name":"dashboardUID","description":"Only return annotations for this dashboard UID."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of annotations to return (default 100)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":1124,"dashboardUID":"uGlb_lG7z","panelId":2,"time":1507266395000,"timeEnd":1507266395000,"text":"Deploy v2.1","tags":["deploy"]}]
   */
  async listAnnotations(from, to, tags, dashboardUID, limit) {
    const logTag = '[listAnnotations]'

    return await this.#apiRequest({
      logTag,
      path: '/annotations',
      method: 'get',
      query: {
        from,
        to,
        tags: Array.isArray(tags) && tags.length ? tags : undefined,
        dashboardUID,
        limit,
      },
    })
  }

  /**
   * @operationName Delete Annotation
   * @category Annotations
   * @description Permanently deletes an annotation by its numeric id.
   * @route DELETE /annotations/{id}
   * @paramDef {"type":"Number","label":"Annotation ID","name":"id","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the annotation to delete."}
   * @returns {Object}
   * @sampleResult {"message":"Annotation deleted"}
   */
  async deleteAnnotation(id) {
    const logTag = '[deleteAnnotation]'

    return await this.#apiRequest({
      logTag,
      path: `/annotations/${ encodeURIComponent(id) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Alert Rules
   * @category Alerting
   * @description Lists all Grafana-managed alert rules in the organization via the provisioning API. Returns each rule's uid, title, folderUID, ruleGroup, condition, evaluation state settings and labels.
   * @route GET /v1/provisioning/alert-rules
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"uid":"alert-rule-uid-123","orgID":1,"folderUID":"folder-uid-456","ruleGroup":"evaluation_group_1","title":"High CPU Usage Alert","condition":"B","noDataState":"NoData","execErrState":"Alerting","for":"5m","labels":{"severity":"critical"},"isPaused":false}]
   */
  async listAlertRules() {
    const logTag = '[listAlertRules]'

    return await this.#apiRequest({
      logTag,
      path: '/v1/provisioning/alert-rules',
      method: 'get',
    })
  }

  /**
   * @operationName Get Alert Rule
   * @category Alerting
   * @description Retrieves a single Grafana-managed alert rule by its UID, including its full query data model, condition, evaluation settings, annotations and labels.
   * @route GET /v1/provisioning/alert-rules/{uid}
   * @paramDef {"type":"String","label":"Alert Rule UID","name":"uid","required":true,"description":"UID of the alert rule. Find it via List Alert Rules."}
   * @returns {Object}
   * @sampleResult {"id":1,"uid":"alert-rule-uid-123","orgID":1,"folderUID":"folder-uid-456","ruleGroup":"evaluation_group_1","title":"High CPU Usage Alert","condition":"B","data":[{"refId":"A","datasourceUid":"prometheus-uid","model":{"expr":"node_cpu_seconds_total","refId":"A"}}],"noDataState":"NoData","execErrState":"Alerting","for":"5m","isPaused":false}
   */
  async getAlertRule(uid) {
    const logTag = '[getAlertRule]'

    return await this.#apiRequest({
      logTag,
      path: `/v1/provisioning/alert-rules/${ encodeURIComponent(uid) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Contact Points
   * @category Alerting
   * @description Lists all notification contact points configured for alerting via the provisioning API. Returns each contact point's uid, name, type (e.g. email, slack) and non-secret settings.
   * @route GET /v1/provisioning/contact-points
   * @returns {Array<Object>}
   * @sampleResult [{"uid":"contact-point-uid-001","name":"email_notifications","type":"email","settings":{"addresses":"alerts@example.com"},"disableResolveMessage":false,"provenance":"api"}]
   */
  async listContactPoints() {
    const logTag = '[listContactPoints]'

    return await this.#apiRequest({
      logTag,
      path: '/v1/provisioning/contact-points',
      method: 'get',
    })
  }

  /**
   * @operationName Get Organization
   * @category Organization & Users
   * @description Returns details of the current organization associated with the API token, including its id and name.
   * @route GET /org
   * @returns {Object}
   * @sampleResult {"id":1,"name":"Main Org."}
   */
  async getOrg() {
    const logTag = '[getOrg]'

    return await this.#apiRequest({
      logTag,
      path: '/org',
      method: 'get',
    })
  }

  /**
   * @operationName List Organization Users
   * @category Organization & Users
   * @description Lists all users that belong to the current organization, including their login, email and role.
   * @route GET /org/users
   * @returns {Array<Object>}
   * @sampleResult [{"orgId":1,"userId":1,"email":"admin@localhost","login":"admin","role":"Admin","lastSeenAt":"2024-01-01T00:00:00Z","lastSeenAtAge":"1d"}]
   */
  async listOrgUsers() {
    const logTag = '[listOrgUsers]'

    return await this.#apiRequest({
      logTag,
      path: '/org/users',
      method: 'get',
    })
  }

  /**
   * @operationName Get Current User
   * @category Organization & Users
   * @description Returns the profile of the currently authenticated user or service account, including id, login, email and admin flags.
   * @route GET /user
   * @returns {Object}
   * @sampleResult {"id":1,"email":"admin@localhost","name":"Admin","login":"admin","theme":"dark","orgId":1,"isGrafanaAdmin":true,"isDisabled":false}
   */
  async getCurrentUser() {
    const logTag = '[getCurrentUser]'

    return await this.#apiRequest({
      logTag,
      path: '/user',
      method: 'get',
    })
  }

  /**
   * @operationName Health Check
   * @category Organization & Users
   * @description Checks connectivity to the configured Grafana instance and returns its health status, including database state, version and commit. Use this to verify the server URL and API token are valid.
   * @route GET /health
   * @returns {Object}
   * @sampleResult {"commit":"087143285","database":"ok","version":"11.6.0"}
   */
  async healthCheck() {
    const logTag = '[healthCheck]'

    return await this.#apiRequest({
      logTag,
      path: '/health',
      method: 'get',
    })
  }

  /**
   * @typedef {Object} getFoldersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter folders by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Grafana returns folders in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Folders Dictionary
   * @description Provides a searchable list of folders for selecting a folder UID in dependent parameters. The option value is the folder UID.
   * @route POST /get-folders-dictionary
   * @paramDef {"type":"getFoldersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input for filtering folders."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Ops","value":"nErXDvCkzz","note":"nErXDvCkzz"}],"cursor":null}
   */
  async getFoldersDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getFoldersDictionary]'

    const folders = await this.#apiRequest({
      logTag,
      path: '/folders',
      method: 'get',
      query: { limit: 5000 },
    })

    const term = (search || '').toLowerCase()
    const filtered = (Array.isArray(folders) ? folders : [])
      .filter(folder => !term || (folder.title || '').toLowerCase().includes(term))

    return {
      items: filtered.map(folder => ({
        label: folder.title,
        value: folder.uid,
        note: folder.uid,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getDataSourcesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter data sources by name or type."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Grafana returns data sources in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Data Sources Dictionary
   * @description Provides a searchable list of data sources for selecting a data source UID in dependent parameters. The option value is the data source UID.
   * @route POST /get-data-sources-dictionary
   * @paramDef {"type":"getDataSourcesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input for filtering data sources."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Prometheus","value":"H8joYFVGz","note":"prometheus"}],"cursor":null}
   */
  async getDataSourcesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getDataSourcesDictionary]'

    const dataSources = await this.#apiRequest({
      logTag,
      path: '/datasources',
      method: 'get',
    })

    const term = (search || '').toLowerCase()
    const filtered = (Array.isArray(dataSources) ? dataSources : [])
      .filter(ds => !term || (ds.name || '').toLowerCase().includes(term) || (ds.type || '').toLowerCase().includes(term))

    return {
      items: filtered.map(ds => ({
        label: ds.name,
        value: ds.uid,
        note: ds.type,
      })),
      cursor: null,
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }
}

Flowrunner.ServerCode.addService(GrafanaService, [
  {
    name: 'serverUrl',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Grafana URL, e.g. https://myorg.grafana.net or your self-hosted address. Strip any trailing slash.',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Grafana service account token: Grafana → Administration → Service accounts → add a service account token (or a legacy API key). Sent as a Bearer token.',
  },
])
