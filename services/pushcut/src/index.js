const logger = {
  info: (...args) => console.log('[Pushcut] info:', ...args),
  debug: (...args) => console.log('[Pushcut] debug:', ...args),
  error: (...args) => console.log('[Pushcut] error:', ...args),
  warn: (...args) => console.log('[Pushcut] warn:', ...args),
}

const API_BASE_URL = 'https://api.pushcut.io/v1'

function clean(obj) {
  if (!obj || typeof obj !== 'object') {
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
 * @integrationName Pushcut
 * @integrationIcon /icon.png
 */
class PushcutService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'API-Key': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.error || error.body?.message || error.message

      logger.error(`${ logTag } - failed (${ status || 'no status' }): ${ message }`)

      throw new Error(`Pushcut API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Send Notification
   * @category Notifications
   * @description Sends a predefined notification, identified by its name, to your Pushcut devices. The notification must first be created in the Pushcut app (Notifications tab); this operation triggers it and can override its title, text, image, sound, actions, and target devices at send time. Supports dynamic actions (each opening a URL or running a Shortcut), a default tap action, time-sensitive delivery, and grouping via a thread ID.
   * @route POST /send-notification
   * @appearanceColor #1E244D #F0668E
   *
   * @paramDef {"type":"String","label":"Notification Name","name":"notificationName","required":true,"dictionary":"getNotificationsDictionary","description":"Name of a notification defined in the Pushcut app. Select one from the list or type its exact name."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Overrides the notification title."}
   * @paramDef {"type":"String","label":"Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Overrides the notification body text."}
   * @paramDef {"type":"String","label":"Input","name":"input","description":"Text value passed to the notification's input action (available to Shortcuts and URL actions as the notification input)."}
   * @paramDef {"type":"String","label":"Default Action URL","name":"defaultAction","description":"URL opened when the notification itself is tapped (the default action)."}
   * @paramDef {"type":"Array<PushcutAction>","label":"Actions","name":"actions","description":"Dynamic action buttons shown on the notification. Each action has a name and either opens a URL or runs a Shortcut."}
   * @paramDef {"type":"String","label":"Sound","name":"sound","uiComponent":{"type":"DROPDOWN","options":{"values":["vibrateOnly","system","subtle","question","jobDone","problem","loud","lasers"]}},"description":"Sound played with the notification. Defaults to the notification's configured sound."}
   * @paramDef {"type":"String","label":"Image","name":"image","description":"Name of an image in the Pushcut app, or a public image URL, to display in the notification."}
   * @paramDef {"type":"String","label":"Image Data","name":"imageData","description":"Base64-encoded image data to display in the notification (alternative to Image)."}
   * @paramDef {"type":"Array<String>","label":"Devices","name":"devices","description":"Device names to send to. Leave empty to send to all your devices."}
   * @paramDef {"type":"Boolean","label":"Time Sensitive","name":"isTimeSensitive","uiComponent":{"type":"CHECKBOX"},"description":"Marks the notification as time-sensitive so it can break through Focus modes."}
   * @paramDef {"type":"String","label":"Thread ID","name":"threadId","description":"Groups notifications sharing the same thread ID together in Notification Center."}
   *
   * @returns {Object}
   * @sampleResult {"message":"Notification request received."}
   */
  async sendNotification(notificationName, title, text, input, defaultAction, actions, sound, image, imageData, devices, isTimeSensitive, threadId) {
    const logTag = '[sendNotification]'

    if (!notificationName) {
      throw new Error('Pushcut API error: notificationName is required.')
    }

    const body = clean({
      title,
      text,
      input,
      defaultAction,
      actions: Array.isArray(actions) && actions.length ? actions.map(action => clean(action)) : undefined,
      sound,
      image,
      imageData,
      devices: Array.isArray(devices) && devices.length ? devices : undefined,
      isTimeSensitive,
      threadId,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/notifications/${ encodeURIComponent(notificationName) }`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName List Notifications
   * @category Notifications
   * @description Lists the notifications you have defined in the Pushcut app, returning each notification's name and identifier. Use a returned name with Send Notification.
   * @route GET /notifications
   * @appearanceColor #1E244D #F0668E
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"Reminder","title":"Reminder"}]
   */
  async listNotifications() {
    const logTag = '[listNotifications]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/notifications`,
      method: 'get',
    })
  }

  /**
   * @operationName Execute Action
   * @category Execute
   * @description Runs a Shortcut, activates a HomeKit scene, or triggers a Pushcut automation on your devices. Provide exactly one of Shortcut, HomeKit Scene, or Automation. Optionally pass an input value, a delay before execution (e.g. "10s", "5m", "1h"), and specific target devices. Use an Identifier together with a delay to later cancel the scheduled execution.
   * @route POST /execute
   * @appearanceColor #1E244D #F0668E
   *
   * @paramDef {"type":"String","label":"Shortcut","name":"shortcut","description":"Name of the Shortcut to run. Provide only one of Shortcut, HomeKit Scene, or Automation."}
   * @paramDef {"type":"String","label":"HomeKit Scene","name":"homekit","description":"Name of the HomeKit scene to activate. Provide only one of Shortcut, HomeKit Scene, or Automation."}
   * @paramDef {"type":"String","label":"Automation","name":"automation","description":"Name of the Pushcut automation to trigger. Provide only one of Shortcut, HomeKit Scene, or Automation."}
   * @paramDef {"type":"String","label":"Input","name":"input","description":"Input value passed to the Shortcut, scene, or automation."}
   * @paramDef {"type":"String","label":"Delay","name":"delay","description":"Delay before execution, e.g. \"10s\", \"5m\", or \"1h\". Executes immediately if omitted."}
   * @paramDef {"type":"String","label":"Identifier","name":"identifier","description":"Identifier for a delayed execution. Reuse it with the same request to overwrite, or to cancel a scheduled execution."}
   * @paramDef {"type":"Array<String>","label":"Devices","name":"devices","description":"Device names to run on. Leave empty to run on all your devices."}
   *
   * @returns {Object}
   * @sampleResult {"message":"Execute request received."}
   */
  async executeAction(shortcut, homekit, automation, input, delay, identifier, devices) {
    const logTag = '[executeAction]'

    if (!shortcut && !homekit && !automation) {
      throw new Error('Pushcut API error: provide one of shortcut, homekit, or automation.')
    }

    const body = clean({
      shortcut,
      homekit,
      automation,
      input,
      delay,
      identifier,
      devices: Array.isArray(devices) && devices.length ? devices : undefined,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/execute`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName List Devices
   * @category Devices
   * @description Lists the devices connected to your Pushcut account, returning each device's id and name. Useful as a connection check and to discover device names for the Devices parameter on Send Notification and Execute Action.
   * @route GET /devices
   * @appearanceColor #1E244D #F0668E
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"iPhone","name":"iPhone"}]
   */
  async listDevices() {
    const logTag = '[listDevices]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/devices`,
      method: 'get',
    })
  }

  /**
   * @operationName List Subscriptions
   * @category Subscriptions
   * @description Lists your active API subscriptions (server-side webhooks). Each subscription fires the given URL whenever the named Pushcut action is triggered. Returns each subscription's id, action name, and URL.
   * @route GET /subscriptions
   * @appearanceColor #1E244D #F0668E
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"abc123","actionName":"My Action","url":"https://example.com/hook"}]
   */
  async listSubscriptions() {
    const logTag = '[listSubscriptions]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/subscriptions`,
      method: 'get',
    })
  }

  /**
   * @operationName Add Subscription
   * @category Subscriptions
   * @description Creates an API subscription that sends an HTTP request to the given URL whenever the specified Pushcut action is triggered. Returns the created subscription id, which you can pass to Remove Subscription.
   * @route POST /subscriptions
   * @appearanceColor #1E244D #F0668E
   *
   * @paramDef {"type":"String","label":"Action Name","name":"actionName","required":true,"description":"Name of the Pushcut action that should trigger the webhook."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"URL called when the action is triggered."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123"}
   */
  async addSubscription(actionName, url) {
    const logTag = '[addSubscription]'

    if (!actionName || !url) {
      throw new Error('Pushcut API error: actionName and url are required.')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/subscriptions`,
      method: 'post',
      body: { actionName, url },
    })
  }

  /**
   * @operationName Remove Subscription
   * @category Subscriptions
   * @description Deletes an API subscription by its id, stopping its webhook from firing. Get subscription ids from List Subscriptions or Add Subscription.
   * @route DELETE /subscriptions
   * @appearanceColor #1E244D #F0668E
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"Id of the subscription to remove."}
   *
   * @returns {Object}
   * @sampleResult {"message":"Subscription removed."}
   */
  async removeSubscription(subscriptionId) {
    const logTag = '[removeSubscription]'

    if (!subscriptionId) {
      throw new Error('Pushcut API error: subscriptionId is required.')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/subscriptions/${ encodeURIComponent(subscriptionId) }`,
      method: 'delete',
    })
  }

  /**
   * @typedef {Object} PushcutAction
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Label shown on the action button."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"URL opened when the action is tapped."}
   * @paramDef {"type":"Boolean","label":"Run in Background","name":"urlBackgroundOptions","uiComponent":{"type":"CHECKBOX"},"description":"Open the URL in the background without launching the app."}
   * @paramDef {"type":"String","label":"Shortcut","name":"shortcut","description":"Name of a Shortcut to run when the action is tapped (instead of opening a URL)."}
   * @paramDef {"type":"String","label":"Input","name":"input","description":"Input value passed to the action's URL or Shortcut."}
   */

  /**
   * @typedef {Object} getNotificationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter notifications by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Pushcut returns all notifications in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Notifications Dictionary
   * @description Provides a selectable list of the notifications defined in the Pushcut app for the Notification Name parameter of Send Notification.
   * @route POST /get-notifications-dictionary
   * @paramDef {"type":"getNotificationsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text used to filter notifications by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Reminder","value":"Reminder","note":"Pushcut notification"}],"cursor":null}
   */
  async getNotificationsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getNotificationsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/notifications`,
      method: 'get',
    })

    const notifications = Array.isArray(response) ? response : []
    const term = (search || '').toLowerCase()

    const items = notifications
      .map(notification => {
        const name = notification.id || notification.title

        return name ? { label: name, value: name, note: 'Pushcut notification' } : null
      })
      .filter(Boolean)
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getDevicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter devices by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Pushcut returns all devices in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Devices Dictionary
   * @description Provides a selectable list of the devices connected to your Pushcut account, for choosing target devices in Send Notification and Execute Action. The option value is the device name.
   * @route POST /get-devices-dictionary
   * @paramDef {"type":"getDevicesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text used to filter devices by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"iPhone","value":"iPhone","note":"Pushcut device"}],"cursor":null}
   */
  async getDevicesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getDevicesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/devices`,
      method: 'get',
    })

    const devices = Array.isArray(response) ? response : []
    const term = (search || '').toLowerCase()

    const items = devices
      .map(device => {
        const name = device.name || device.id

        return name ? { label: name, value: name, note: 'Pushcut device' } : null
      })
      .filter(Boolean)
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(PushcutService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Pushcut API key, sent as the API-Key header. Get it in the Pushcut app under Account → API key (Integrations).',
  },
])
