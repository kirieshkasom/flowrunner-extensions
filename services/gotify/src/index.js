const logger = {
  info: (...args) => console.log('[Gotify] info:', ...args),
  debug: (...args) => console.log('[Gotify] debug:', ...args),
  error: (...args) => console.log('[Gotify] error:', ...args),
  warn: (...args) => console.log('[Gotify] warn:', ...args),
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
 * @integrationName Gotify
 * @integrationIcon /icon.png
 */
class GotifyService {
  constructor(config) {
    this.serverUrl = (config.serverUrl || '').replace(/\/+$/, '')
    this.appToken = config.appToken
    this.clientToken = config.clientToken
  }

  // Returns the client token, throwing a clear error when it is missing.
  // Client-token operations (reading/managing messages, applications, clients) cannot run without it.
  #requireClientToken() {
    if (!this.clientToken) {
      throw new Error(
        'Gotify API error: a Client Token is required for this operation. Add one in the service configuration (Gotify -> Clients).'
      )
    }

    return this.clientToken
  }

  // Single private request helper. `auth` selects which token is sent via the X-Gotify-Key header.
  async #apiRequest({ path, method = 'get', body, query, auth = 'client', formData, logTag }) {
    const url = `${ this.serverUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const headers = { 'Accept': 'application/json' }

      if (auth === 'app') {
        headers['X-Gotify-Key'] = this.appToken
      } else if (auth === 'client') {
        headers['X-Gotify-Key'] = this.#requireClientToken()
      }

      let request = Flowrunner.Request[method.toLowerCase()](url).set(headers).query(cleanedQuery)

      if (formData !== undefined) {
        return await request.form(formData)
      }

      if (body !== undefined) {
        request = request.set({ 'Content-Type': 'application/json' })

        return await request.send(body)
      }

      return await request
    } catch (error) {
      const description = error.body?.errorDescription || error.body?.error || error.message
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status }): ${ description }`)

      throw new Error(`Gotify API error${ status ? ` (${ status })` : '' }: ${ description }`)
    }
  }

  /**
   * @operationName Create Message
   * @category Messages
   * @description Sends a push notification message to Gotify using the application token. Provide the message body and optionally a title, a priority (0-10; higher shows more prominently and can bypass notification limits), and an extras object for client-specific behavior (for example {"client::display":{"contentType":"text/markdown"}} to render Markdown). The message is delivered to all clients subscribed to the application that owns the token.
   * @route POST /message
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message body. Supports plain text or Markdown when an appropriate extras content type is set."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional message title. Defaults to the application name when omitted."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Priority from 0 to 10. Higher values are more prominent; values of 4+ typically trigger a notification. Defaults to the application default priority."}
   * @paramDef {"type":"Object","label":"Extras","name":"extras","required":false,"description":"Optional extras object for client-specific features, e.g. {\"client::display\":{\"contentType\":\"text/markdown\"}} or {\"client::notification\":{\"click\":{\"url\":\"https://example.com\"}}}."}
   * @returns {Object}
   * @sampleResult {"id":25,"appid":5,"message":"Backup was successfully finished.","title":"Backup","priority":5,"date":"2018-02-27T19:36:10.504Z","extras":{"client::display":{"contentType":"text/markdown"}}}
   */
  async createMessage(message, title, priority, extras) {
    const logTag = '[createMessage]'

    return await this.#apiRequest({
      logTag,
      auth: 'app',
      path: '/message',
      method: 'post',
      body: clean({
        message,
        title,
        priority: priority !== undefined && priority !== null ? Number(priority) : undefined,
        extras: extras && Object.keys(extras).length > 0 ? extras : undefined,
      }),
    })
  }

  /**
   * @operationName Get Messages
   * @category Messages
   * @description Retrieves messages received across all applications, most recent first. Requires the client token. Use limit to control page size (1-200) and since to page through older messages by passing the paging.since value from a previous response.
   * @route GET /message
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages to return (1-200). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Since","name":"since","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Return messages with an ID lower than this value, for pagination. Use the paging.since value from a previous response."}
   * @returns {Object}
   * @sampleResult {"messages":[{"id":25,"appid":5,"message":"Backup was successfully finished.","title":"Backup","priority":5,"date":"2018-02-27T19:36:10.504Z"}],"paging":{"limit":100,"since":25,"size":1}}
   */
  async getMessages(limit, since) {
    const logTag = '[getMessages]'

    return await this.#apiRequest({
      logTag,
      auth: 'client',
      path: '/message',
      method: 'get',
      query: {
        limit: limit !== undefined && limit !== null ? Number(limit) : undefined,
        since: since !== undefined && since !== null ? Number(since) : undefined,
      },
    })
  }

  /**
   * @operationName Get Application Messages
   * @category Messages
   * @description Retrieves messages for a single application, most recent first. Requires the client token. Use limit for page size (1-200) and since for pagination.
   * @route GET /application/{applicationId}/message
   * @paramDef {"type":"Number","label":"Application ID","name":"applicationId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the application whose messages to retrieve."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages to return (1-200). Defaults to 100."}
   * @paramDef {"type":"Number","label":"Since","name":"since","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Return messages with an ID lower than this value, for pagination."}
   * @returns {Object}
   * @sampleResult {"messages":[{"id":25,"appid":5,"message":"Backup was successfully finished.","title":"Backup","priority":5,"date":"2018-02-27T19:36:10.504Z"}],"paging":{"limit":100,"since":25,"size":1}}
   */
  async getApplicationMessages(applicationId, limit, since) {
    const logTag = '[getApplicationMessages]'

    return await this.#apiRequest({
      logTag,
      auth: 'client',
      path: `/application/${ encodeURIComponent(applicationId) }/message`,
      method: 'get',
      query: {
        limit: limit !== undefined && limit !== null ? Number(limit) : undefined,
        since: since !== undefined && since !== null ? Number(since) : undefined,
      },
    })
  }

  /**
   * @operationName Delete Message
   * @category Messages
   * @description Deletes a single message by its numeric ID. Requires the client token. This action is permanent.
   * @route DELETE /message/{messageId}
   * @paramDef {"type":"Number","label":"Message ID","name":"messageId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the message to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteMessage(messageId) {
    const logTag = '[deleteMessage]'

    await this.#apiRequest({
      logTag,
      auth: 'client',
      path: `/message/${ encodeURIComponent(messageId) }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName Delete All Messages
   * @category Messages
   * @description Deletes every message across all applications owned by the client token. Requires the client token. This action is permanent and cannot be undone.
   * @route DELETE /message
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteAllMessages() {
    const logTag = '[deleteAllMessages]'

    await this.#apiRequest({
      logTag,
      auth: 'client',
      path: '/message',
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName Get Applications
   * @category Applications
   * @description Lists all applications registered on the Gotify server. Requires the client token. Each application includes its ID, name, description, image path, default priority, and send token.
   * @route GET /application
   * @returns {Array<Object>}
   * @sampleResult [{"id":5,"name":"Backup Server","description":"Backup server for the interwebs","token":"AWH0wZ5r0Mbac.r","image":"static/defaultapp.png","internal":false,"defaultPriority":4}]
   */
  async getApplications() {
    const logTag = '[getApplications]'

    return await this.#apiRequest({
      logTag,
      auth: 'client',
      path: '/application',
      method: 'get',
    })
  }

  /**
   * @operationName Create Application
   * @category Applications
   * @description Creates a new application and returns it, including its send token. Requires the client token. The returned token can be used with Create Message to send notifications for this application.
   * @route POST /application
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The application name shown in the Gotify UI and used as the default message title."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of the application."}
   * @paramDef {"type":"Number","label":"Default Priority","name":"defaultPriority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional default priority (0-10) applied to messages that do not specify one."}
   * @returns {Object}
   * @sampleResult {"id":6,"name":"CI Pipeline","description":"Build notifications","token":"A0RM8Bd8Qeb.dw","image":"static/defaultapp.png","internal":false,"defaultPriority":5}
   */
  async createApplication(name, description, defaultPriority) {
    const logTag = '[createApplication]'

    return await this.#apiRequest({
      logTag,
      auth: 'client',
      path: '/application',
      method: 'post',
      body: clean({
        name,
        description,
        defaultPriority:
          defaultPriority !== undefined && defaultPriority !== null ? Number(defaultPriority) : undefined,
      }),
    })
  }

  /**
   * @operationName Update Application
   * @category Applications
   * @description Updates an existing application's name, description, or default priority. Requires the client token. Returns the updated application.
   * @route PUT /application/{applicationId}
   * @paramDef {"type":"Number","label":"Application ID","name":"applicationId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the application to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The new application name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional new description for the application."}
   * @paramDef {"type":"Number","label":"Default Priority","name":"defaultPriority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional new default priority (0-10)."}
   * @returns {Object}
   * @sampleResult {"id":6,"name":"CI Pipeline","description":"Updated build notifications","token":"A0RM8Bd8Qeb.dw","image":"static/defaultapp.png","internal":false,"defaultPriority":6}
   */
  async updateApplication(applicationId, name, description, defaultPriority) {
    const logTag = '[updateApplication]'

    return await this.#apiRequest({
      logTag,
      auth: 'client',
      path: `/application/${ encodeURIComponent(applicationId) }`,
      method: 'put',
      body: clean({
        name,
        description,
        defaultPriority:
          defaultPriority !== undefined && defaultPriority !== null ? Number(defaultPriority) : undefined,
      }),
    })
  }

  /**
   * @operationName Delete Application
   * @category Applications
   * @description Deletes an application by its numeric ID. Requires the client token. All messages belonging to the application are removed and its send token is invalidated. This action is permanent.
   * @route DELETE /application/{applicationId}
   * @paramDef {"type":"Number","label":"Application ID","name":"applicationId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the application to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteApplication(applicationId) {
    const logTag = '[deleteApplication]'

    await this.#apiRequest({
      logTag,
      auth: 'client',
      path: `/application/${ encodeURIComponent(applicationId) }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName Upload Application Image
   * @category Applications
   * @description Uploads an image to use as an application's icon in the Gotify UI. Requires the client token. Provide the numeric application ID and a publicly accessible image URL; the image is downloaded and sent to Gotify as multipart form data. Returns the updated application with its new image path.
   * @route POST /application/{applicationId}/image
   * @paramDef {"type":"Number","label":"Application ID","name":"applicationId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the application to set the image for."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":true,"description":"Publicly accessible URL of the image (png, jpg, or gif). It is fetched and uploaded to Gotify."}
   * @returns {Object}
   * @sampleResult {"id":6,"name":"CI Pipeline","description":"Build notifications","token":"A0RM8Bd8Qeb.dw","image":"image/abc123.png","internal":false,"defaultPriority":5}
   */
  async uploadApplicationImage(applicationId, imageUrl) {
    const logTag = '[uploadApplicationImage]'

    const bytes = await Flowrunner.Request.get(imageUrl).setEncoding(null)
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

    const filename = (imageUrl.split('/').pop() || 'image').split('?')[0] || 'image.png'

    const formData = new Flowrunner.Request.FormData()
    formData.append('file', buffer, filename)

    return await this.#apiRequest({
      logTag,
      auth: 'client',
      path: `/application/${ encodeURIComponent(applicationId) }/image`,
      method: 'post',
      formData,
    })
  }

  /**
   * @operationName Get Clients
   * @category Clients
   * @description Lists all clients registered on the Gotify server. Requires the client token. Each client includes its ID, name, and token used to read and manage messages.
   * @route GET /client
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"name":"Android Phone","token":"Cdvlrwe5B9pF-i0"}]
   */
  async getClients() {
    const logTag = '[getClients]'

    return await this.#apiRequest({
      logTag,
      auth: 'client',
      path: '/client',
      method: 'get',
    })
  }

  /**
   * @operationName Create Client
   * @category Clients
   * @description Creates a new client and returns it, including its token. Requires the client token. The returned token can read and manage messages, applications, and clients.
   * @route POST /client
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A descriptive name for the client, e.g. the device or integration using it."}
   * @returns {Object}
   * @sampleResult {"id":2,"name":"Workflow Client","token":"Cx7yR0k2Qeb.dw"}
   */
  async createClient(name) {
    const logTag = '[createClient]'

    return await this.#apiRequest({
      logTag,
      auth: 'client',
      path: '/client',
      method: 'post',
      body: clean({ name }),
    })
  }

  /**
   * @operationName Delete Client
   * @category Clients
   * @description Deletes a client by its numeric ID, invalidating its token. Requires the client token. This action is permanent.
   * @route DELETE /client/{clientId}
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the client to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteClient(clientId) {
    const logTag = '[deleteClient]'

    await this.#apiRequest({
      logTag,
      auth: 'client',
      path: `/client/${ encodeURIComponent(clientId) }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName Get Health
   * @category System
   * @description Checks the health of the Gotify server. Requires no authentication, so it is useful for verifying that the configured server URL is reachable. Returns the overall health and database status.
   * @route GET /health
   * @returns {Object}
   * @sampleResult {"health":"green","database":"green"}
   */
  async getHealth() {
    const logTag = '[getHealth]'

    return await this.#apiRequest({
      logTag,
      auth: 'none',
      path: '/health',
      method: 'get',
    })
  }

  /**
   * @operationName Get Version
   * @category System
   * @description Returns the Gotify server version information, including the version string, git commit, and build date. Requires no authentication.
   * @route GET /version
   * @returns {Object}
   * @sampleResult {"version":"2.4.0","commit":"1d1a3b0a","buildDate":"2023-01-01T00:00:00Z"}
   */
  async getVersion() {
    const logTag = '[getVersion]'

    return await this.#apiRequest({
      logTag,
      auth: 'none',
      path: '/version',
      method: 'get',
    })
  }

  /**
   * @typedef {Object} getApplicationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter applications by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Gotify returns all applications in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Applications Dictionary
   * @description Provides a selectable list of Gotify applications for choosing an application ID in dependent parameters. Requires the client token. The option value is the numeric application ID.
   * @route POST /get-applications-dictionary
   * @paramDef {"type":"getApplicationsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text used to filter applications by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Backup Server","value":"5","note":"Backup server for the interwebs"}],"cursor":null}
   */
  async getApplicationsDictionary(payload) {
    const logTag = '[getApplicationsDictionary]'
    const { search } = payload || {}

    const applications = await this.#apiRequest({
      logTag,
      auth: 'client',
      path: '/application',
      method: 'get',
    })

    const list = Array.isArray(applications) ? applications : []
    const term = (search || '').trim().toLowerCase()

    const filtered = term
      ? list.filter(app => (app.name || '').toLowerCase().includes(term))
      : list

    return {
      items: filtered.map(app => ({
        label: app.name,
        value: String(app.id),
        note: app.description || undefined,
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(GotifyService, [
  {
    name: 'serverUrl',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Gotify server URL, e.g. https://gotify.example.com (strip any trailing slash).',
  },
  {
    name: 'appToken',
    displayName: 'Application Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'In Gotify, go to Apps and create an application, then copy its token. Used to SEND messages.',
  },
  {
    name: 'clientToken',
    displayName: 'Client Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'In Gotify, go to Clients and copy a client token. Needed to READ/manage messages, applications, and clients.',
  },
])
