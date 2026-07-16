const logger = {
  info: (...args) => console.log('[Pushover] info:', ...args),
  debug: (...args) => console.log('[Pushover] debug:', ...args),
  error: (...args) => console.log('[Pushover] error:', ...args),
  warn: (...args) => console.log('[Pushover] warn:', ...args),
}

const API_BASE_URL = 'https://api.pushover.net/1'

const PRIORITY_MAP = {
  Lowest: -2,
  Low: -1,
  Normal: 0,
  High: 1,
  Emergency: 2,
}

const EMERGENCY_PRIORITY = 2
const MIN_RETRY_SECONDS = 30
const MAX_EXPIRE_SECONDS = 10800

// Built-in Pushover notification sounds (label -> API value). Values equal labels except where noted.
const SOUND_MAP = {
  'Pushover (default)': 'pushover',
  'Bike': 'bike',
  'Bugle': 'bugle',
  'Cash Register': 'cashregister',
  'Classical': 'classical',
  'Cosmic': 'cosmic',
  'Falling': 'falling',
  'Gamelan': 'gamelan',
  'Incoming': 'incoming',
  'Intermission': 'intermission',
  'Magic': 'magic',
  'Mechanical': 'mechanical',
  'Piano Bar': 'pianobar',
  'Siren': 'siren',
  'Space Alarm': 'spacealarm',
  'Tug Boat': 'tugboat',
  'Alien Alarm (long)': 'alien',
  'Climb (long)': 'climb',
  'Persistent (long)': 'persistent',
  'Pushover Echo (long)': 'echo',
  'Up Down (long)': 'updown',
  'Vibrate Only': 'vibrate',
  'None (silent)': 'none',
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
 * @integrationName Pushover
 * @integrationIcon /icon.png
 */
class PushoverService {
  constructor(config) {
    this.appToken = config.appToken
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper. Pushover authenticates via the `token` param in
  // the form body (writes) or query string (reads), never via an Authorization header.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query(clean(query) || {})

      const response = body !== undefined ? await request.send(clean(body)) : await request

      if (response && response.status === 0) {
        const errors = Array.isArray(response.errors) ? response.errors.join('; ') : 'Unknown error'

        throw new Error(`Pushover API error: ${ errors }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('Pushover API error:')) {
        throw error
      }

      const bodyErrors = Array.isArray(error.body?.errors) ? error.body.errors.join('; ') : undefined
      const message = bodyErrors || error.body?.message || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Pushover API error: ${ message }`)
    }
  }

  /**
   * @operationName Send Notification
   * @category Notifications
   * @description Sends a push notification to a Pushover user or group. Requires the recipient's user/group key and a message body (max 1024 characters). Supports an optional title, priority (Lowest to Emergency), a notification sound, a supplementary URL with title, targeting a specific device, HTML formatting, a custom timestamp, and a message time-to-live. For Emergency priority (2) the notification repeats until acknowledged, and both Retry Interval and Expire After are required; a receipt id is returned so you can poll acknowledgement status with Get Receipt. Returns the API status and request id.
   * @route POST /messages
   * @appearanceColor #249DF1 #5FB8F5
   *
   * @paramDef {"type":"String","label":"User/Group Key","name":"userKey","required":true,"description":"The recipient's Pushover user key or group key (or a comma-separated list of up to 50 user keys). This is the per-message recipient, distinct from the application API token configured on the service."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The notification body text (max 1024 UTF-8 characters)."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional message title (max 250 characters). Defaults to the application name."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Lowest","Low","Normal","High","Emergency"]}},"description":"Delivery priority. Lowest sends no notification (badge only), Low is quiet, Normal is default, High bypasses quiet hours, and Emergency repeats until acknowledged. Defaults to Normal."}
   * @paramDef {"type":"String","label":"Sound","name":"sound","uiComponent":{"type":"DROPDOWN","options":{"values":["Pushover (default)","Bike","Bugle","Cash Register","Classical","Cosmic","Falling","Gamelan","Incoming","Intermission","Magic","Mechanical","Piano Bar","Siren","Space Alarm","Tug Boat","Alien Alarm (long)","Climb (long)","Persistent (long)","Pushover Echo (long)","Up Down (long)","Vibrate Only","None (silent)"]}},"description":"Notification sound to play on the recipient's device. Defaults to the user's chosen tone."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"Optional supplementary URL to show with the message (max 512 characters)."}
   * @paramDef {"type":"String","label":"URL Title","name":"urlTitle","description":"Optional title for the supplementary URL, shown instead of the raw URL (max 100 characters). Requires URL."}
   * @paramDef {"type":"String","label":"Device","name":"device","description":"Optional device name to deliver only to that specific device rather than all of the user's devices."}
   * @paramDef {"type":"Boolean","label":"HTML Formatting","name":"html","uiComponent":{"type":"TOGGLE"},"description":"Enable limited HTML formatting (bold, italic, underline, color, links) in the message body."}
   * @paramDef {"type":"Number","label":"Timestamp","name":"timestamp","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional Unix timestamp (seconds) to display as the message time instead of the time Pushover received it."}
   * @paramDef {"type":"Number","label":"Time To Live (seconds)","name":"ttl","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional number of seconds after which the notification is auto-deleted from devices. Ignored for Emergency priority."}
   * @paramDef {"type":"Number","label":"Retry Interval (seconds)","name":"retry","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Emergency priority only (required): seconds between repeated notifications until acknowledged. Minimum 30."}
   * @paramDef {"type":"Number","label":"Expire After (seconds)","name":"expire","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Emergency priority only (required): seconds after which Pushover stops retrying an unacknowledged message. Maximum 10800 (3 hours)."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"request":"647d2300-702c-4b38-8b2f-d56326ae460b","receipt":"rIf8t2sh2AwCq8dSj6xdgOI8itwT5w"}
   */
  async sendNotification(userKey, message, title, priority, sound, url, urlTitle, device, html, timestamp, ttl, retry, expire) {
    const logTag = '[sendNotification]'

    const priorityValue = this.#resolveChoice(priority, PRIORITY_MAP)

    if (priorityValue === EMERGENCY_PRIORITY) {
      if (retry === undefined || retry === null || expire === undefined || expire === null) {
        throw new Error('Pushover API error: Emergency priority requires both Retry Interval and Expire After.')
      }

      if (retry < MIN_RETRY_SECONDS) {
        throw new Error(`Pushover API error: Retry Interval must be at least ${ MIN_RETRY_SECONDS } seconds.`)
      }

      if (expire > MAX_EXPIRE_SECONDS) {
        throw new Error(`Pushover API error: Expire After must be at most ${ MAX_EXPIRE_SECONDS } seconds.`)
      }
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/messages.json`,
      method: 'post',
      body: {
        token: this.appToken,
        user: userKey,
        message,
        title,
        priority: priorityValue,
        sound: this.#resolveChoice(sound, SOUND_MAP),
        url,
        url_title: urlTitle,
        device,
        html: html ? 1 : undefined,
        timestamp,
        ttl: priorityValue === EMERGENCY_PRIORITY ? undefined : ttl,
        retry: priorityValue === EMERGENCY_PRIORITY ? retry : undefined,
        expire: priorityValue === EMERGENCY_PRIORITY ? expire : undefined,
      },
    })
  }

  /**
   * @operationName Validate User/Group
   * @category Notifications
   * @description Verifies that a Pushover user or group key is valid and has at least one active device that can receive notifications. Optionally checks a specific device name. Returns the list of the user's device names and platform licenses. Use this to confirm a recipient before sending.
   * @route POST /users/validate
   * @appearanceColor #249DF1 #5FB8F5
   *
   * @paramDef {"type":"String","label":"User/Group Key","name":"userKey","required":true,"description":"The Pushover user key or group key to validate."}
   * @paramDef {"type":"String","label":"Device","name":"device","description":"Optional device name to also confirm belongs to this user."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"group":0,"devices":["iphone","desktop"],"licenses":["iOS","Desktop"],"request":"5042853c-402d-4a18-abcb-168734a801de"}
   */
  async validateUser(userKey, device) {
    const logTag = '[validateUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/validate.json`,
      method: 'post',
      body: {
        token: this.appToken,
        user: userKey,
        device,
      },
    })
  }

  /**
   * @operationName Get Receipt
   * @category Emergency
   * @description Retrieves the acknowledgement status of an Emergency-priority (2) notification using the receipt id returned by Send Notification. Reports whether the message has been acknowledged, by which device, when it was last delivered, and whether it has expired or a callback has fired. Poll this to track whether an emergency alert was seen.
   * @route GET /receipts
   * @appearanceColor #249DF1 #5FB8F5
   *
   * @paramDef {"type":"String","label":"Receipt ID","name":"receipt","required":true,"description":"The receipt id returned by Send Notification for an Emergency-priority message."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"acknowledged":1,"acknowledged_at":1424305421,"acknowledged_by":"uQiRzpo4DXghDmr9QzzfQu27cmVRsG","acknowledged_by_device":"iphone","last_delivered_at":1424305401,"expired":0,"expires_at":1424308400,"called_back":0,"called_back_at":0,"request":"e460545c-2c9d-4b2c-8a3e-3b1f5c9a1234"}
   */
  async getReceipt(receipt) {
    const logTag = '[getReceipt]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/receipts/${ encodeURIComponent(receipt) }.json`,
      method: 'get',
      query: {
        token: this.appToken,
      },
    })
  }

  /**
   * @operationName Cancel Emergency Retry
   * @category Emergency
   * @description Stops an Emergency-priority (2) notification from continuing to repeat, using the receipt id returned by Send Notification. Use this once an alert has been handled outside of Pushover so recipients stop being re-notified. Returns the API status and request id.
   * @route POST /receipts/cancel
   * @appearanceColor #249DF1 #5FB8F5
   *
   * @paramDef {"type":"String","label":"Receipt ID","name":"receipt","required":true,"description":"The receipt id of the Emergency-priority message whose retries should be cancelled."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"request":"52dd6c86-6f16-4d1c-8b9a-2b3f4c5d6e7f"}
   */
  async cancelEmergencyRetry(receipt) {
    const logTag = '[cancelEmergencyRetry]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/receipts/${ encodeURIComponent(receipt) }/cancel.json`,
      method: 'post',
      body: {
        token: this.appToken,
      },
    })
  }

  /**
   * @operationName Get Sounds
   * @category Account
   * @description Lists the notification sounds available to the configured application, including any custom sounds the application owner has uploaded. Each entry maps a sound identifier to its display name. Useful for discovering valid sound values beyond the built-in set offered on Send Notification.
   * @route GET /sounds
   * @appearanceColor #249DF1 #5FB8F5
   *
   * @returns {Object}
   * @sampleResult {"status":1,"sounds":{"pushover":"Pushover (default)","bike":"Bike","bugle":"Bugle","siren":"Siren","none":"None (silent)"},"request":"d9c3f0a1-5b2e-4c7d-9f8a-1b2c3d4e5f60"}
   */
  async getSounds() {
    const logTag = '[getSounds]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sounds.json`,
      method: 'get',
      query: {
        token: this.appToken,
      },
    })
  }

  /**
   * @operationName Get Limits
   * @category Account
   * @description Returns the application's monthly message quota and usage: the total limit, the number of messages remaining, and the Unix timestamp at which the counter next resets. Use this to monitor how close the application is to its sending cap.
   * @route GET /apps/limits
   * @appearanceColor #249DF1 #5FB8F5
   *
   * @returns {Object}
   * @sampleResult {"status":1,"limit":10000,"remaining":7496,"reset":1393653600,"request":"a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"}
   */
  async getLimits() {
    const logTag = '[getLimits]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/apps/limits.json`,
      method: 'get',
      query: {
        token: this.appToken,
      },
    })
  }
}

Flowrunner.ServerCode.addService(PushoverService, [
  {
    name: 'appToken',
    displayName: 'Application API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Pushover application API token/key. Create an Application/API Token at https://pushover.net/apps/build, then copy the API Token/Key shown on the app page.',
  },
])
