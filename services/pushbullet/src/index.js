const logger = {
  info: (...args) => console.log('[Pushbullet] info:', ...args),
  debug: (...args) => console.log('[Pushbullet] debug:', ...args),
  error: (...args) => console.log('[Pushbullet] error:', ...args),
  warn: (...args) => console.log('[Pushbullet] warn:', ...args),
}

const API_BASE_URL = 'https://api.pushbullet.com/v2'

const DEFAULT_LIST_LIMIT = 50

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
 * @integrationName Pushbullet
 * @integrationIcon /logo.png
 */
class PushbulletService {
  constructor(config) {
    this.accessToken = config.accessToken
  }

  /**
   * Single request helper. All external calls go through here.
   * Pushbullet returns the response body directly on success and an
   * { error: { message, type, cat } } shape on failure.
   */
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Access-Token': this.accessToken,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const apiError = error.body?.error
      const status = error.status || error.statusCode
      const message = apiError?.message || error.body?.message || error.message
      const type = apiError?.type ? ` (${ apiError.type })` : ''

      logger.error(`${ logTag } - failed${ status ? ` [${ status }]` : '' }: ${ message }`)

      throw new Error(`Pushbullet API error${ status ? ` [${ status }]` : '' }${ type }: ${ message }`)
    }
  }

  /**
   * @operationName Push Note
   * @category Pushes
   * @description Sends a note push (a simple text notification with a title and body) to your own devices or to another user. Leave all targeting fields empty to push to every device on your account, or set exactly one of Device, Email, or Channel Tag to target a specific destination. The note appears instantly on connected Pushbullet apps.
   * @route POST /pushes
   * @appearanceColor #4AB367 #6FD48C
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The note's title, shown in bold at the top of the notification."}
   * @paramDef {"type":"String","label":"Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The note's message text."}
   * @paramDef {"type":"String","label":"Device","name":"deviceIden","dictionary":"getDevicesDictionary","description":"Optional device iden to push to a single device. Leave empty to push to all of your devices. Do not combine with Email or Channel Tag."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Optional email address to push to another Pushbullet user or invite them by email. Do not combine with Device or Channel Tag."}
   * @paramDef {"type":"String","label":"Channel Tag","name":"channelTag","description":"Optional channel tag to broadcast to all subscribers of a channel you own. Do not combine with Device or Email."}
   *
   * @returns {Object}
   * @sampleResult {"active":true,"iden":"ujpah72o0sjAoRtnM0jc","created":1720000000.1,"modified":1720000000.1,"type":"note","dismissed":false,"direction":"self","sender_iden":"ujpah72o0","sender_email":"me@example.com","title":"Deployment complete","body":"Build 1234 shipped to production."}
   */
  async pushNote(title, body, deviceIden, email, channelTag) {
    const logTag = '[pushNote]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/pushes`,
      method: 'post',
      body: clean({
        type: 'note',
        title,
        body,
        device_iden: deviceIden,
        email,
        channel_tag: channelTag,
      }),
    })
  }

  /**
   * @operationName Push Link
   * @category Pushes
   * @description Sends a link push (a clickable URL with an optional title and body) to your own devices or to another user. Leave all targeting fields empty to push to every device on your account, or set exactly one of Device, Email, or Channel Tag to target a specific destination.
   * @route POST /pushes
   * @appearanceColor #4AB367 #6FD48C
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The link's title, shown in bold at the top of the notification."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The URL to open when the push is tapped."}
   * @paramDef {"type":"String","label":"Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional message text shown below the title."}
   * @paramDef {"type":"String","label":"Device","name":"deviceIden","dictionary":"getDevicesDictionary","description":"Optional device iden to push to a single device. Leave empty to push to all of your devices. Do not combine with Email or Channel Tag."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Optional email address to push to another Pushbullet user. Do not combine with Device or Channel Tag."}
   * @paramDef {"type":"String","label":"Channel Tag","name":"channelTag","description":"Optional channel tag to broadcast to all subscribers of a channel you own. Do not combine with Device or Email."}
   *
   * @returns {Object}
   * @sampleResult {"active":true,"iden":"ujpah72o0sjAoRtnM0jc","created":1720000000.1,"modified":1720000000.1,"type":"link","dismissed":false,"direction":"self","title":"FlowRunner docs","url":"https://flowrunner.io/docs","body":"Read the getting-started guide."}
   */
  async pushLink(title, url, body, deviceIden, email, channelTag) {
    const logTag = '[pushLink]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/pushes`,
      method: 'post',
      body: clean({
        type: 'link',
        title,
        url,
        body,
        device_iden: deviceIden,
        email,
        channel_tag: channelTag,
      }),
    })
  }

  /**
   * @operationName Push File from URL
   * @category Pushes
   * @description Pushes a file that is already hosted at a publicly accessible URL. Provide the file's URL, name, and MIME type; Pushbullet delivers it as a file push to your devices or to a target recipient. For uploading a local file, first request an upload URL, upload the bytes, then use the returned file URL here (see the README).
   * @route POST /pushes
   * @appearanceColor #4AB367 #6FD48C
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"Publicly accessible URL of the file to push. For local files, upload them first via Pushbullet's upload-request flow (see README) and pass the returned file_url."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"The file name to display, e.g. report.pdf."}
   * @paramDef {"type":"String","label":"File Type","name":"fileType","required":true,"description":"The file's MIME type, e.g. application/pdf or image/png."}
   * @paramDef {"type":"String","label":"Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional message text shown alongside the file."}
   * @paramDef {"type":"String","label":"Device","name":"deviceIden","dictionary":"getDevicesDictionary","description":"Optional device iden to push to a single device. Leave empty to push to all of your devices. Do not combine with Email or Channel Tag."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Optional email address to push to another Pushbullet user. Do not combine with Device or Channel Tag."}
   * @paramDef {"type":"String","label":"Channel Tag","name":"channelTag","description":"Optional channel tag to broadcast to all subscribers of a channel you own. Do not combine with Device or Email."}
   *
   * @returns {Object}
   * @sampleResult {"active":true,"iden":"ujpah72o0sjAoRtnM0jc","created":1720000000.1,"modified":1720000000.1,"type":"file","dismissed":false,"direction":"self","file_name":"report.pdf","file_type":"application/pdf","file_url":"https://dl.pushbulletusercontent.com/abc/report.pdf","body":"Q3 report attached."}
   */
  async pushFileFromUrl(fileUrl, fileName, fileType, body, deviceIden, email, channelTag) {
    const logTag = '[pushFileFromUrl]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/pushes`,
      method: 'post',
      body: clean({
        type: 'file',
        file_url: fileUrl,
        file_name: fileName,
        file_type: fileType,
        body,
        device_iden: deviceIden,
        email,
        channel_tag: channelTag,
      }),
    })
  }

  /**
   * @operationName List Pushes
   * @category Pushes
   * @description Lists pushes on your account, most recent first. Use Modified After to fetch only pushes changed since a given time (for incremental sync), Active to exclude deleted pushes, Limit to cap page size, and Cursor to page through large result sets. Returns the pushes and a cursor for the next page when more results exist.
   * @route GET /pushes
   * @appearanceColor #4AB367 #6FD48C
   *
   * @paramDef {"type":"Number","label":"Modified After","name":"modifiedAfter","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp (seconds, may include a fractional part). Only pushes modified after this time are returned."}
   * @paramDef {"type":"Boolean","label":"Active Only","name":"active","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, deleted pushes are excluded from the results."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of pushes to return per page. Defaults to 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous call, used to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"pushes":[{"active":true,"iden":"ujpah72o0sjAoRtnM0jc","created":1720000000.1,"modified":1720000000.1,"type":"note","dismissed":false,"direction":"self","title":"Deployment complete","body":"Build 1234 shipped."}],"cursor":"1sdf2r3r"}
   */
  async listPushes(modifiedAfter, active, limit, cursor) {
    const logTag = '[listPushes]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/pushes`,
      method: 'get',
      query: {
        modified_after: modifiedAfter,
        active: active === true ? 'true' : undefined,
        limit: limit || DEFAULT_LIST_LIMIT,
        cursor,
      },
    })
  }

  /**
   * @operationName Get Push
   * @category Pushes
   * @description Retrieves a single push by its identifier. Pushbullet has no direct get-by-id endpoint, so this fetches the push list and returns the matching push. Returns null when no push with the given iden exists.
   * @route GET /pushes/get
   * @appearanceColor #4AB367 #6FD48C
   *
   * @paramDef {"type":"String","label":"Push Iden","name":"pushIden","required":true,"description":"The iden of the push to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"active":true,"iden":"ujpah72o0sjAoRtnM0jc","created":1720000000.1,"modified":1720000000.1,"type":"note","dismissed":false,"direction":"self","title":"Deployment complete","body":"Build 1234 shipped."}
   */
  async getPush(pushIden) {
    const logTag = '[getPush]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/pushes`,
      method: 'get',
      query: {
        limit: 500,
      },
    })

    const pushes = response.pushes || []

    return pushes.find(push => push.iden === pushIden) || null
  }

  /**
   * @operationName Dismiss Push
   * @category Pushes
   * @description Marks a push as dismissed so it stops appearing as an active notification, without deleting it. Useful for clearing a notification programmatically after it has been handled.
   * @route POST /pushes/dismiss
   * @appearanceColor #4AB367 #6FD48C
   *
   * @paramDef {"type":"String","label":"Push Iden","name":"pushIden","required":true,"description":"The iden of the push to dismiss."}
   *
   * @returns {Object}
   * @sampleResult {"active":true,"iden":"ujpah72o0sjAoRtnM0jc","created":1720000000.1,"modified":1720000010.2,"type":"note","dismissed":true,"direction":"self","title":"Deployment complete"}
   */
  async dismissPush(pushIden) {
    const logTag = '[dismissPush]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/pushes/${ pushIden }`,
      method: 'post',
      body: {
        dismissed: true,
      },
    })
  }

  /**
   * @operationName Delete Push
   * @category Pushes
   * @description Permanently deletes a single push by its identifier. This cannot be undone. Returns an empty object on success.
   * @route DELETE /pushes/delete
   * @appearanceColor #4AB367 #6FD48C
   *
   * @paramDef {"type":"String","label":"Push Iden","name":"pushIden","required":true,"description":"The iden of the push to delete."}
   *
   * @returns {Object}
   * @sampleResult {}
   */
  async deletePush(pushIden) {
    const logTag = '[deletePush]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/pushes/${ pushIden }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Delete All Pushes
   * @category Pushes
   * @description Permanently deletes every push on your account. This is irreversible and removes all push history. Use with caution. Returns an empty object on success.
   * @route DELETE /pushes/delete-all
   * @appearanceColor #C0392B #E74C3C
   *
   * @returns {Object}
   * @sampleResult {}
   */
  async deleteAllPushes() {
    const logTag = '[deleteAllPushes]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/pushes`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Devices
   * @category Devices
   * @description Lists all devices registered on your Pushbullet account, including phones, browsers, and virtual devices. Each device includes its iden, nickname, type, and whether it can send SMS. Use a device's iden to target pushes or send SMS.
   * @route GET /devices
   * @appearanceColor #4AB367 #6FD48C
   *
   * @returns {Object}
   * @sampleResult {"devices":[{"active":true,"iden":"ujpah72o0sjAoRtnM0jc","created":1720000000.1,"modified":1720000000.1,"type":"android","nickname":"Pixel 8","manufacturer":"Google","model":"Pixel 8","has_sms":true}]}
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
   * @operationName Create Device
   * @category Devices
   * @description Creates a new virtual device on your account. Virtual devices are useful as a stable push target (for example, a "Server Alerts" device) that pushes can be addressed to. Returns the created device including its iden.
   * @route POST /devices
   * @appearanceColor #4AB367 #6FD48C
   *
   * @paramDef {"type":"String","label":"Nickname","name":"nickname","required":true,"description":"Display name for the device, e.g. Server Alerts."}
   * @paramDef {"type":"String","label":"Icon","name":"icon","uiComponent":{"type":"DROPDOWN","options":{"values":["Desktop","Browser","Website","Laptop","Tablet","Phone","Watch","System"]}},"description":"Icon to represent the device. Defaults to System."}
   * @paramDef {"type":"String","label":"Model","name":"model","description":"Optional model string, e.g. FlowRunner Automation."}
   * @paramDef {"type":"String","label":"Manufacturer","name":"manufacturer","description":"Optional manufacturer string."}
   *
   * @returns {Object}
   * @sampleResult {"active":true,"iden":"ujpah72o0sjAoRtnM0jc","created":1720000000.1,"modified":1720000000.1,"type":"stream","icon":"system","nickname":"Server Alerts"}
   */
  async createDevice(nickname, icon, model, manufacturer) {
    const logTag = '[createDevice]'

    const resolvedIcon = this.#resolveChoice(icon, {
      Desktop: 'desktop',
      Browser: 'browser',
      Website: 'website',
      Laptop: 'laptop',
      Tablet: 'tablet',
      Phone: 'phone',
      Watch: 'watch',
      System: 'system',
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/devices`,
      method: 'post',
      body: clean({
        nickname,
        icon: resolvedIcon || 'system',
        model,
        manufacturer,
      }),
    })
  }

  /**
   * @operationName Delete Device
   * @category Devices
   * @description Permanently deletes a device from your account by its identifier. Pushes can no longer be addressed to a deleted device. Returns an empty object on success.
   * @route DELETE /devices/delete
   * @appearanceColor #C0392B #E74C3C
   *
   * @paramDef {"type":"String","label":"Device","name":"deviceIden","required":true,"dictionary":"getDevicesDictionary","description":"The iden of the device to delete."}
   *
   * @returns {Object}
   * @sampleResult {}
   */
  async deleteDevice(deviceIden) {
    const logTag = '[deleteDevice]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/devices/${ deviceIden }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Chats
   * @category Chats
   * @description Lists your active chats (conversations with other Pushbullet users you have pushed to or received pushes from). Each chat includes the other party's email, name, and image. Useful for discovering recipients you can push to.
   * @route GET /chats
   * @appearanceColor #4AB367 #6FD48C
   *
   * @returns {Object}
   * @sampleResult {"chats":[{"active":true,"iden":"ujpah72o0sjAoRtnM0jc","created":1720000000.1,"modified":1720000000.1,"muted":false,"with":{"type":"user","iden":"ujlMns72k","name":"Alex Doe","email":"alex@example.com","email_normalized":"alex@example.com","image_url":"https://example.com/avatar.png"}}]}
   */
  async listChats() {
    const logTag = '[listChats]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/chats`,
      method: 'get',
    })
  }

  /**
   * @operationName Get User Info
   * @category Account
   * @description Retrieves the current authenticated user's profile, including email, name, and account limits such as the maximum upload size. Also serves as a connection check to verify the access token is valid.
   * @route GET /users/me
   * @appearanceColor #4AB367 #6FD48C
   *
   * @returns {Object}
   * @sampleResult {"iden":"ujpah72o0","created":1690000000.1,"modified":1720000000.1,"email":"me@example.com","email_normalized":"me@example.com","name":"Jane Doe","image_url":"https://dl.pushbulletusercontent.com/avatar.png","max_upload_size":26214400}
   */
  async getUserInfo() {
    const logTag = '[getUserInfo]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/me`,
      method: 'get',
    })
  }

  /**
   * @operationName Send SMS
   * @category SMS
   * @description Sends an SMS text message through one of your connected phones that has SMS enabled. The sending device must have has_sms set to true (list your devices to check). Provide the source device iden, one or more recipient phone numbers, and the message text.
   * @route POST /texts
   * @appearanceColor #4AB367 #6FD48C
   *
   * @paramDef {"type":"String","label":"Sending Device","name":"targetDeviceIden","required":true,"dictionary":"getDevicesDictionary","description":"The iden of the phone that will send the SMS. It must have SMS support (has_sms true)."}
   * @paramDef {"type":"Array<String>","label":"Recipients","name":"addresses","required":true,"description":"One or more recipient phone numbers, e.g. +15551234567. Multiple numbers create a group message."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text of the SMS to send."}
   *
   * @returns {Object}
   * @sampleResult {"active":true,"iden":"ujpah72o0sjAoRtnM0jc","created":1720000000.1,"modified":1720000000.1,"data":{"addresses":["+15551234567"],"message":"Server is back up.","target_device_iden":"ujpah72o0","status":"queued"}}
   */
  async sendSms(targetDeviceIden, addresses, message) {
    const logTag = '[sendSms]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/texts`,
      method: 'post',
      body: {
        data: clean({
          target_device_iden: targetDeviceIden,
          addresses: Array.isArray(addresses) ? addresses : [addresses].filter(Boolean),
          message,
          status: 'queued',
        }),
      },
    })
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @typedef {Object} getDevicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter devices by nickname or model."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Pushbullet returns all devices in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Devices Dictionary
   * @description Provides a selectable list of your Pushbullet devices for targeting pushes and SMS. The option value is the device iden. The note indicates the device type and whether it supports SMS.
   * @route POST /get-devices-dictionary
   * @paramDef {"type":"getDevicesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string used to filter devices by nickname or model."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Pixel 8","value":"ujpah72o0sjAoRtnM0jc","note":"android - SMS"}],"cursor":null}
   */
  async getDevicesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getDevicesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/devices`,
      method: 'get',
    })

    const devices = (response.devices || []).filter(device => device.active !== false)

    const term = (search || '').trim().toLowerCase()

    const filtered = term
      ? devices.filter(device => {
        const haystack = `${ device.nickname || '' } ${ device.model || '' }`.toLowerCase()

        return haystack.includes(term)
      })
      : devices

    return {
      items: filtered.map(device => {
        const noteParts = [device.type, device.has_sms ? 'SMS' : null].filter(Boolean)

        return {
          label: device.nickname || device.model || device.iden,
          value: device.iden,
          note: noteParts.join(' - ') || undefined,
        }
      }),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(PushbulletService, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Pushbullet access token, sent as the Access-Token header. Create one in Pushbullet -> Settings -> Account -> Create Access Token.',
  },
])
