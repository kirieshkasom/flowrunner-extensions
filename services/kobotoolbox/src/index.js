const logger = {
  info: (...args) => console.log('[KoBoToolbox] info:', ...args),
  debug: (...args) => console.log('[KoBoToolbox] debug:', ...args),
  error: (...args) => console.log('[KoBoToolbox] error:', ...args),
  warn: (...args) => console.log('[KoBoToolbox] warn:', ...args),
}

const DEFAULT_ASSET_LIMIT = 30
const DEFAULT_DATA_LIMIT = 30
const DICTIONARY_LIMIT = 50

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
 * @integrationName KoBoToolbox
 * @integrationIcon /icon.png
 */
class KoBoToolboxService {
  constructor(config) {
    this.baseUrl = (config.baseUrl || 'https://kf.kobotoolbox.org').replace(/\/+$/, '')
    this.apiToken = config.apiToken
    this.apiBaseUrl = `${ this.baseUrl }/api/v2`
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.apiBaseUrl }${ path }`

    try {
      const cleanedQuery = clean({ format: 'json', ...(query || {}) })

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Token ${ this.apiToken }`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const responseBody = error.body || {}
      const detail = responseBody.detail || responseBody.error ||
        (typeof responseBody === 'string' ? responseBody : undefined)
      const status = error.status || error.statusCode
      const message = detail || error.message || 'Unknown error'

      logger.error(`${ logTag } - failed (${ status || 'no status' }): ${ typeof message === 'string' ? message : JSON.stringify(message) }`)

      throw new Error(`KoBoToolbox API error${ status ? ` (${ status })` : '' }: ${ typeof message === 'string' ? message : JSON.stringify(message) }`)
    }
  }

  /* ============================ Assets ============================ */

  /**
   * @operationName List Assets
   * @category Assets
   * @description Lists assets (forms and projects) on your KoBoToolbox account. Returns a paginated envelope with the total count and an array of assets, each including its uid, name, asset_type, owner, deployment status, and submission count. Use the optional search text to filter by name and limit/start for pagination.
   * @route GET /assets
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter assets by name/title (maps to the API q parameter)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of assets to return (default 30)."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based offset of the first asset to return, for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"count":2,"next":null,"previous":null,"results":[{"uid":"aXaMpLe1234567890","name":"Household Survey","asset_type":"survey","owner__username":"jane","deployment__active":true,"deployment__submission_count":128,"date_created":"2024-01-10T09:00:00Z"}]}
   */
  async listAssets(search, limit, start) {
    return await this.#apiRequest({
      logTag: '[listAssets]',
      path: '/assets/',
      method: 'get',
      query: {
        q: search,
        limit: limit || DEFAULT_ASSET_LIMIT,
        start: start,
      },
    })
  }

  /**
   * @operationName Get Asset
   * @category Assets
   * @description Retrieves a single asset (form/project) by its uid, including metadata such as name, asset_type, owner, permissions, deployment status, and submission count. Does not include full survey content unless requested via Get Asset Content.
   * @route GET /assets/get
   * @paramDef {"type":"String","label":"Asset UID","name":"uid","required":true,"dictionary":"getAssetsDictionary","description":"The uid of the asset to retrieve. Select from the list or type a uid directly."}
   * @returns {Object}
   * @sampleResult {"uid":"aXaMpLe1234567890","name":"Household Survey","asset_type":"survey","owner__username":"jane","deployment__active":true,"deployment__submission_count":128,"has_deployment":true,"version_count":3}
   */
  async getAsset(uid) {
    return await this.#apiRequest({
      logTag: '[getAsset]',
      path: `/assets/${ encodeURIComponent(uid) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Asset Content
   * @category Assets
   * @description Retrieves the full definition of an asset, including its survey content (questions, choices, settings). Returns the same asset object as Get Asset plus the content structure used to build the form. Useful for inspecting or duplicating a form's schema.
   * @route GET /assets/content
   * @paramDef {"type":"String","label":"Asset UID","name":"uid","required":true,"dictionary":"getAssetsDictionary","description":"The uid of the asset whose content to retrieve. Select from the list or type a uid directly."}
   * @returns {Object}
   * @sampleResult {"uid":"aXaMpLe1234567890","name":"Household Survey","asset_type":"survey","content":{"survey":[{"type":"text","name":"full_name","label":["Full name"]}],"choices":[],"settings":{}}}
   */
  async getAssetContent(uid) {
    return await this.#apiRequest({
      logTag: '[getAssetContent]',
      path: `/assets/${ encodeURIComponent(uid) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Asset
   * @category Assets
   * @description Creates a new asset (typically a survey/form) on your KoBoToolbox account. Provide a name and an optional content object describing the survey structure (survey questions, choices, settings). The created asset is a draft; deploy it with Deploy Asset before collecting data. Returns the created asset including its new uid.
   * @route POST /assets
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name/title for the new asset."}
   * @paramDef {"type":"String","label":"Asset Type","name":"assetType","uiComponent":{"type":"DROPDOWN","options":{"values":["Survey","Template","Block","Question","Collection"]}},"description":"Type of asset to create. Defaults to Survey (a data-collection form)."}
   * @paramDef {"type":"Object","label":"Content","name":"content","required":false,"description":"Optional XLSForm-style content object defining the survey, e.g. {\"survey\":[{\"type\":\"text\",\"name\":\"full_name\",\"label\":[\"Full name\"]}],\"choices\":[],\"settings\":{}}. Omit to create an empty draft."}
   * @returns {Object}
   * @sampleResult {"uid":"aNeWaSsEt987654321","name":"New Survey","asset_type":"survey","has_deployment":false,"deployment__active":false,"date_created":"2024-05-01T12:00:00Z"}
   */
  async createAsset(name, assetType, content) {
    const type = this.#resolveChoice(assetType, {
      Survey: 'survey',
      Template: 'template',
      Block: 'block',
      Question: 'question',
      Collection: 'collection',
    }) || 'survey'

    return await this.#apiRequest({
      logTag: '[createAsset]',
      path: '/assets/',
      method: 'post',
      body: clean({
        name,
        asset_type: type,
        content: content || undefined,
      }),
    })
  }

  /**
   * @operationName Deploy Asset
   * @category Assets
   * @description Deploys an asset for the first time, creating an active deployment that can receive submissions. Sets the deployment to active. Use Redeploy Asset to push subsequent changes to an already-deployed form. Returns the deployment object.
   * @route POST /assets/deploy
   * @paramDef {"type":"String","label":"Asset UID","name":"uid","required":true,"dictionary":"getAssetsDictionary","description":"The uid of the asset to deploy. Select from the list or type a uid directly."}
   * @returns {Object}
   * @sampleResult {"backend":"mock","active":true,"version_id":"vAbC123","asset":"https://kf.kobotoolbox.org/api/v2/assets/aXaMpLe1234567890/"}
   */
  async deployAsset(uid) {
    return await this.#apiRequest({
      logTag: '[deployAsset]',
      path: `/assets/${ encodeURIComponent(uid) }/deployment/`,
      method: 'post',
      body: { active: true },
    })
  }

  /**
   * @operationName Redeploy Asset
   * @category Assets
   * @description Redeploys an already-deployed asset, pushing its latest saved version to the active deployment and (re)activating it. Use this after editing a form that was previously deployed. Returns the updated deployment object.
   * @route PATCH /assets/redeploy
   * @paramDef {"type":"String","label":"Asset UID","name":"uid","required":true,"dictionary":"getAssetsDictionary","description":"The uid of the asset to redeploy. Select from the list or type a uid directly."}
   * @returns {Object}
   * @sampleResult {"backend":"mock","active":true,"version_id":"vDeF456","asset":"https://kf.kobotoolbox.org/api/v2/assets/aXaMpLe1234567890/"}
   */
  async redeployAsset(uid) {
    return await this.#apiRequest({
      logTag: '[redeployAsset]',
      path: `/assets/${ encodeURIComponent(uid) }/deployment/`,
      method: 'patch',
      body: { active: true },
    })
  }

  /**
   * @operationName Get Deployment
   * @category Assets
   * @description Retrieves the deployment details for an asset, including whether it is active, the deployed version identifier, the backend, and the current submission count. Returns an error if the asset has never been deployed.
   * @route GET /assets/deployment
   * @paramDef {"type":"String","label":"Asset UID","name":"uid","required":true,"dictionary":"getAssetsDictionary","description":"The uid of the asset whose deployment to retrieve. Select from the list or type a uid directly."}
   * @returns {Object}
   * @sampleResult {"backend":"mock","active":true,"version_id":"vAbC123","asset":"https://kf.kobotoolbox.org/api/v2/assets/aXaMpLe1234567890/"}
   */
  async getDeployment(uid) {
    return await this.#apiRequest({
      logTag: '[getDeployment]',
      path: `/assets/${ encodeURIComponent(uid) }/deployment/`,
      method: 'get',
    })
  }

  /* ========================= Submissions ========================= */

  /**
   * @operationName Get Submissions
   * @category Submissions
   * @description Retrieves submitted data (records) for a deployed asset. Supports a Mongo-style JSON query filter, sorting, and pagination. Returns an envelope with the total matching count and a results array of submission objects. Each submission includes system fields (_id, _uuid, _submission_time) plus the answered question fields.
   * @route GET /submissions
   * @paramDef {"type":"String","label":"Asset UID","name":"uid","required":true,"dictionary":"getAssetsDictionary","description":"The uid of the deployed asset whose submissions to retrieve. Select from the list or type a uid directly."}
   * @paramDef {"type":"Object","label":"Query","name":"query","required":false,"description":"Optional Mongo-style JSON filter applied server-side, e.g. {\"_submission_time\":{\"$gt\":\"2024-01-01\"}} or {\"gender\":\"female\"}. Omit to return all submissions."}
   * @paramDef {"type":"Object","label":"Sort","name":"sort","required":false,"description":"Optional Mongo-style JSON sort object, e.g. {\"_submission_time\":-1} for newest first (1 = ascending, -1 = descending)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of submissions to return (default 30)."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based offset of the first submission to return, for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"count":128,"results":[{"_id":501,"_uuid":"a1b2c3d4-e5f6","_submission_time":"2024-02-01T10:15:00","full_name":"Jane Doe","gender":"female"}]}
   */
  async getSubmissions(uid, query, sort, limit, start) {
    return await this.#apiRequest({
      logTag: '[getSubmissions]',
      path: `/assets/${ encodeURIComponent(uid) }/data/`,
      method: 'get',
      query: {
        query: query ? JSON.stringify(query) : undefined,
        sort: sort ? JSON.stringify(sort) : undefined,
        limit: limit || DEFAULT_DATA_LIMIT,
        start: start,
      },
    })
  }

  /**
   * @operationName Get Submission
   * @category Submissions
   * @description Retrieves a single submission (record) by its numeric id for a deployed asset. Returns the full submission object including system fields and all answered question fields.
   * @route GET /submissions/get
   * @paramDef {"type":"String","label":"Asset UID","name":"uid","required":true,"dictionary":"getAssetsDictionary","description":"The uid of the deployed asset. Select from the list or type a uid directly."}
   * @paramDef {"type":"String","label":"Submission ID","name":"submissionId","required":true,"description":"The numeric submission id (the _id field of a submission)."}
   * @returns {Object}
   * @sampleResult {"_id":501,"_uuid":"a1b2c3d4-e5f6","_submission_time":"2024-02-01T10:15:00","full_name":"Jane Doe","gender":"female"}
   */
  async getSubmission(uid, submissionId) {
    return await this.#apiRequest({
      logTag: '[getSubmission]',
      path: `/assets/${ encodeURIComponent(uid) }/data/${ encodeURIComponent(submissionId) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Submission Count
   * @category Submissions
   * @description Returns the total number of submissions for a deployed asset. Fetches a minimal page of data and reads the count field from the response envelope, so it is efficient regardless of how many submissions exist.
   * @route GET /submissions/count
   * @paramDef {"type":"String","label":"Asset UID","name":"uid","required":true,"dictionary":"getAssetsDictionary","description":"The uid of the deployed asset to count submissions for. Select from the list or type a uid directly."}
   * @returns {Object}
   * @sampleResult {"count":128}
   */
  async getSubmissionCount(uid) {
    const response = await this.#apiRequest({
      logTag: '[getSubmissionCount]',
      path: `/assets/${ encodeURIComponent(uid) }/data/`,
      method: 'get',
      query: { limit: 1 },
    })

    const count = response && typeof response.count === 'number'
      ? response.count
      : Array.isArray(response) ? response.length : 0

    return { count }
  }

  /**
   * @operationName Delete Submission
   * @category Submissions
   * @description Permanently deletes a single submission (record) by its numeric id from a deployed asset. This action cannot be undone. Returns a confirmation object.
   * @route DELETE /submissions
   * @paramDef {"type":"String","label":"Asset UID","name":"uid","required":true,"dictionary":"getAssetsDictionary","description":"The uid of the deployed asset. Select from the list or type a uid directly."}
   * @paramDef {"type":"String","label":"Submission ID","name":"submissionId","required":true,"description":"The numeric submission id (the _id field) to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"uid":"aXaMpLe1234567890","submissionId":"501"}
   */
  async deleteSubmission(uid, submissionId) {
    await this.#apiRequest({
      logTag: '[deleteSubmission]',
      path: `/assets/${ encodeURIComponent(uid) }/data/${ encodeURIComponent(submissionId) }/`,
      method: 'delete',
    })

    return { deleted: true, uid, submissionId }
  }

  /* =========================== Exports =========================== */

  /**
   * @operationName Create Export
   * @category Exports
   * @description Creates a data export task for a deployed asset in the requested format (CSV or XLS). Optionally controls which fields are included and the label language. Exports are generated asynchronously; the response includes the export uid and a URL to poll/download once complete. Use List Exports to check status and retrieve the download link.
   * @route POST /exports
   * @paramDef {"type":"String","label":"Asset UID","name":"uid","required":true,"dictionary":"getAssetsDictionary","description":"The uid of the deployed asset to export data from. Select from the list or type a uid directly."}
   * @paramDef {"type":"String","label":"Format","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["CSV","XLS"]}},"description":"Export file format. Defaults to CSV."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","required":false,"description":"Optional list of question/field names to include in the export. Omit to include all fields."}
   * @paramDef {"type":"String","label":"Language","name":"lang","required":false,"description":"Optional label language for column headers, e.g. a language name defined in the form (\"English (en)\") or \"_default\" for XML question names."}
   * @returns {Object}
   * @sampleResult {"uid":"eXpOrT12345","status":"created","data_url_csv":"https://kf.kobotoolbox.org/api/v2/assets/aXaMpLe1234567890/exports/eXpOrT12345/","type":"csv"}
   */
  async createExport(uid, type, fields, lang) {
    const exportType = this.#resolveChoice(type, { CSV: 'csv', XLS: 'xls' }) || 'csv'

    return await this.#apiRequest({
      logTag: '[createExport]',
      path: `/assets/${ encodeURIComponent(uid) }/exports/`,
      method: 'post',
      body: clean({
        type: exportType,
        fields: fields && fields.length ? fields : undefined,
        lang: lang,
      }),
    })
  }

  /**
   * @operationName List Exports
   * @category Exports
   * @description Lists the export tasks previously created for a deployed asset, including each export's uid, format, status (created/processing/complete/error), and download URL once complete. Use this to retrieve the download link for an export created with Create Export.
   * @route GET /exports
   * @paramDef {"type":"String","label":"Asset UID","name":"uid","required":true,"dictionary":"getAssetsDictionary","description":"The uid of the deployed asset whose exports to list. Select from the list or type a uid directly."}
   * @returns {Object}
   * @sampleResult {"count":1,"next":null,"previous":null,"results":[{"uid":"eXpOrT12345","status":"complete","data_url_csv":"https://kf.kobotoolbox.org/private-media/jane/exports/export.csv","date_created":"2024-05-01T12:05:00Z"}]}
   */
  async listExports(uid) {
    return await this.#apiRequest({
      logTag: '[listExports]',
      path: `/assets/${ encodeURIComponent(uid) }/exports/`,
      method: 'get',
    })
  }

  /* ========================= Dictionaries ========================= */

  /**
   * @typedef {Object} getAssetsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter assets by name/title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Zero-based offset used for pagination through assets."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Assets Dictionary
   * @description Provides a searchable list of assets (forms/projects) for selecting an asset in other operations. Each option's value is the asset uid and the label is the asset name.
   * @route POST /get-assets-dictionary
   * @paramDef {"type":"getAssetsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing assets."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Household Survey","value":"aXaMpLe1234567890","note":"survey - 128 submissions"}],"cursor":"30"}
   */
  async getAssetsDictionary(payload) {
    const { search, cursor } = payload || {}
    const start = cursor ? parseInt(cursor, 10) || 0 : 0

    const response = await this.#apiRequest({
      logTag: '[getAssetsDictionary]',
      path: '/assets/',
      method: 'get',
      query: {
        q: search,
        limit: DICTIONARY_LIMIT,
        start,
      },
    })

    const results = (response && response.results) || []

    const items = results.map(asset => {
      const noteParts = []

      if (asset.asset_type) {
        noteParts.push(asset.asset_type)
      }

      if (typeof asset.deployment__submission_count === 'number') {
        noteParts.push(`${ asset.deployment__submission_count } submissions`)
      }

      return {
        label: asset.name || asset.uid,
        value: asset.uid,
        note: noteParts.join(' - ') || undefined,
      }
    })

    const nextCursor = response && response.next ? String(start + results.length) : undefined

    return { items, cursor: nextCursor }
  }

  /* =========================== Helpers =========================== */

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }
}

Flowrunner.ServerCode.addService(KoBoToolboxService, [
  {
    name: 'baseUrl',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    defaultValue: 'https://kf.kobotoolbox.org',
    hint: 'KoBoToolbox server — https://kf.kobotoolbox.org (global) or https://eu.kobotoolbox.org (EU). Strip any trailing slash.',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your KoBoToolbox API token. Find it under KoBoToolbox → Account Settings → Security → API token.',
  },
])
