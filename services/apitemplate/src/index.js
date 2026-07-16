const logger = {
  info: (...args) => console.log('[APITemplate.io] info:', ...args),
  debug: (...args) => console.log('[APITemplate.io] debug:', ...args),
  error: (...args) => console.log('[APITemplate.io] error:', ...args),
  warn: (...args) => console.log('[APITemplate.io] warn:', ...args),
}

const REGION_BASE_URLS = {
  'Default': 'https://rest.apitemplate.io/v2',
  'Europe (DE)': 'https://rest-de.apitemplate.io/v2',
  'Australia (AU)': 'https://rest-au.apitemplate.io/v2',
}

const DEFAULT_LIST_LIMIT = 300

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
 * @integrationName APITemplate.io
 * @integrationIcon /icon.png
 */
class ApiTemplateService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.baseUrl = this.#resolveChoice(config.region, REGION_BASE_URLS) || REGION_BASE_URLS['Default']
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      const response = body !== undefined ? await request.send(body) : await request

      if (response && response.status === 'error') {
        throw new Error(`APITemplate.io API error: ${ response.message || 'Unknown error' }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('APITemplate.io API error:')) {
        throw error
      }

      const status = error.status || error.statusCode
      const apiMessage = error.body?.message || error.response?.body?.message
      const message = apiMessage ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - Request failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`APITemplate.io API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Create PDF
   * @category PDF Generation
   * @description Generates a PDF from a saved APITemplate.io template by merging your data into it. Provide the template ID (from List Templates or the dashboard) and a data object whose keys match the placeholders/expressions in the template. Optionally choose the delivery method, override the output filename, or set a link expiration. Returns the hosted download URL for the generated PDF.
   * @route POST /create-pdf
   * @appearanceColor #2F6FED #5B93F2
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to render. Search and select a template, or paste an ID from List Templates or the APITemplate.io dashboard."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"The merge data object. Keys must match the placeholders/expressions defined in the template (e.g. {\"name\":\"John\",\"items\":[...]})."}
   * @paramDef {"type":"String","label":"Export Type","name":"exportType","uiComponent":{"type":"DROPDOWN","options":{"values":["Hosted URL","File Download"]}},"description":"How the result is delivered. Hosted URL (default) returns a JSON payload with a download link; File Download returns the PDF file directly."}
   * @paramDef {"type":"Boolean","label":"Output HTML","name":"outputHtml","uiComponent":{"type":"TOGGLE"},"description":"When true, also returns the rendered HTML used to build the PDF. Defaults to false."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Optional output filename for the generated PDF (e.g. invoice-123.pdf)."}
   * @paramDef {"type":"Number","label":"Expiration (minutes)","name":"expiration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Minutes until the hosted download URL expires. 0 (default) means it never expires."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success","download_url":"https://storage.googleapis.com/pdfsapi/xxxx.pdf","template_id":"0c6f8...","transaction_ref":"c1a2b3d4-...","total_pages":1}
   */
  async createPdf(templateId, data, exportType, outputHtml, filename, expiration) {
    const logTag = '[createPdf]'

    return await this.#apiRequest({
      logTag,
      path: '/create-pdf',
      method: 'post',
      query: clean({
        template_id: templateId,
        export_type: this.#resolveChoice(exportType, {
          'Hosted URL': 'json',
          'File Download': 'file',
        }),
        output_html: outputHtml === true ? '1' : undefined,
        filename,
        expiration,
      }),
      body: data || {},
    })
  }

  /**
   * @operationName Create PDF from HTML
   * @category PDF Generation
   * @description Generates a PDF directly from raw HTML and CSS you supply, without a saved template. Provide the HTML body, optional CSS, and optional rendering settings (page size, margins, orientation, etc.). Returns the hosted download URL for the generated PDF.
   * @route POST /create-pdf-from-html
   * @appearanceColor #2F6FED #5B93F2
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"HTML Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The HTML content to render into a PDF (e.g. \"<html><body><h1>Hello</h1></body></html>\")."}
   * @paramDef {"type":"String","label":"CSS","name":"css","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional CSS applied to the HTML body."}
   * @paramDef {"type":"Object","label":"Settings","name":"settings","description":"Optional rendering settings object, e.g. {\"paper_size\":\"A4\",\"orientation\":\"1\",\"margin_top\":\"10\"}."}
   * @paramDef {"type":"Boolean","label":"Output HTML","name":"outputHtml","uiComponent":{"type":"TOGGLE"},"description":"When true, also returns the rendered HTML. Defaults to false."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Optional output filename for the generated PDF."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success","download_url":"https://storage.googleapis.com/pdfsapi/xxxx.pdf","transaction_ref":"c1a2b3d4-...","total_pages":1}
   */
  async createPdfFromHtml(body, css, settings, outputHtml, filename) {
    const logTag = '[createPdfFromHtml]'

    return await this.#apiRequest({
      logTag,
      path: '/create-pdf-from-html',
      method: 'post',
      query: clean({
        output_html: outputHtml === true ? '1' : undefined,
        filename,
      }),
      body: clean({
        body,
        css,
        settings,
      }),
    })
  }

  /**
   * @operationName Create Image
   * @category Image Generation
   * @description Generates a JPEG/PNG image from a saved APITemplate.io image template. Provide the template ID (from List Templates or the dashboard) and an overrides object that replaces the text, images, and other layer properties defined in the template. Returns hosted download URLs for both the JPEG and PNG outputs.
   * @route POST /create-image
   * @appearanceColor #2F6FED #5B93F2
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The image template to render. Search and select a template, or paste an ID from List Templates or the dashboard."}
   * @paramDef {"type":"Object","label":"Overrides","name":"overrides","required":true,"description":"The override data. Use {\"overrides\":[{\"name\":\"text_1\",\"text\":\"Hello\"}]} to target named layers, or a flat property object matching the template's placeholders."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success","download_url":"https://storage.googleapis.com/imagesapi/xxxx.jpeg","download_url_png":"https://storage.googleapis.com/imagesapi/xxxx.png","template_id":"0c6f8...","transaction_ref":"c1a2b3d4-..."}
   */
  async createImage(templateId, overrides) {
    const logTag = '[createImage]'

    return await this.#apiRequest({
      logTag,
      path: '/create-image',
      method: 'post',
      query: {
        template_id: templateId,
      },
      body: overrides || {},
    })
  }

  /**
   * @operationName List Templates
   * @category Templates
   * @description Lists all PDF and image templates available in your APITemplate.io account, including each template's ID, name, and format. Use a returned template_id with Create PDF or Create Image.
   * @route GET /list-templates
   * @appearanceColor #2F6FED #5B93F2
   *
   * @returns {Object}
   * @sampleResult {"status":"success","templates":[{"template_id":"0c6f8...","name":"Invoice","format":"PDF"},{"template_id":"1d7e9...","name":"Social Card","format":"JPEG"}]}
   */
  async listTemplates() {
    const logTag = '[listTemplates]'

    return await this.#apiRequest({
      logTag,
      path: '/list-templates',
      method: 'get',
    })
  }

  /**
   * @operationName List Generated Objects
   * @category Objects
   * @description Lists previously generated PDFs and images in your account, most recent first. Each object includes its transaction reference, template ID, download URL, and creation time. Supports pagination via limit and offset.
   * @route GET /list-objects
   * @appearanceColor #2F6FED #5B93F2
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of objects to return (default 300)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of objects to skip for pagination (default 0)."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success","objects":[{"transaction_ref":"c1a2b3d4-...","template_id":"0c6f8...","download_url":"https://storage.googleapis.com/pdfsapi/xxxx.pdf","create_time":"2024-01-01 12:00:00"}]}
   */
  async listObjects(limit, offset) {
    const logTag = '[listObjects]'

    return await this.#apiRequest({
      logTag,
      path: '/list-objects',
      method: 'get',
      query: clean({
        limit: limit || DEFAULT_LIST_LIMIT,
        offset,
      }),
    })
  }

  /**
   * @operationName Delete Object
   * @category Objects
   * @description Deletes a previously generated PDF or image and its hosted file, identified by its transaction reference (returned by Create PDF/Create Image or List Generated Objects). This action cannot be undone.
   * @route DELETE /delete-object
   * @appearanceColor #2F6FED #5B93F2
   *
   * @paramDef {"type":"String","label":"Transaction Reference","name":"transactionRef","required":true,"description":"The transaction_ref of the generated object to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteObject(transactionRef) {
    const logTag = '[deleteObject]'

    return await this.#apiRequest({
      logTag,
      path: '/delete-object',
      method: 'get',
      query: {
        transaction_ref: transactionRef,
      },
    })
  }

  /**
   * @operationName Get Account Information
   * @category Account
   * @description Retrieves your APITemplate.io account information, including the remaining API credits and plan details. Useful as a connection check to confirm the API key and region are configured correctly.
   * @route GET /account-information
   * @appearanceColor #2F6FED #5B93F2
   *
   * @returns {Object}
   * @sampleResult {"status":"success","remaining_pdf":950,"remaining_image":480,"plan":"Free"}
   */
  async getAccountInformation() {
    const logTag = '[getAccountInformation]'

    return await this.#apiRequest({
      logTag,
      path: '/account-information',
      method: 'get',
    })
  }

  /**
   * @typedef {Object} getTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter templates by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. List Templates returns all templates in one call, so this is unused but kept for compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Templates Dictionary
   * @description Provides a searchable list of your APITemplate.io templates for selecting a template ID in Create PDF and Create Image. The option value is the template_id expected by those operations.
   * @route POST /get-templates-dictionary
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string used to filter templates by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Invoice","value":"0c6f8...","note":"PDF"}],"cursor":null}
   */
  async getTemplatesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getTemplatesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      path: '/list-templates',
      method: 'get',
    })

    const templates = response.templates || []
    const term = (search || '').toLowerCase()

    const filtered = term
      ? templates.filter(t => (t.name || '').toLowerCase().includes(term))
      : templates

    return {
      items: filtered.map(t => ({
        label: t.name || t.template_id,
        value: t.template_id,
        note: t.format || undefined,
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(ApiTemplateService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your APITemplate.io API key, sent as the X-API-KEY header. Find it in the APITemplate.io dashboard under API Integration → API Key.',
  },
  {
    name: 'region',
    displayName: 'Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    required: false,
    shared: false,
    defaultValue: 'Default',
    options: ['Default', 'Europe (DE)', 'Australia (AU)'],
    hint: 'Pick the region matching your account. Default uses rest.apitemplate.io, Europe uses rest-de.apitemplate.io, Australia uses rest-au.apitemplate.io.',
  },
])
