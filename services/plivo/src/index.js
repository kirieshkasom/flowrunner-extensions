const PLIVO_API_ROOT = 'https://api.plivo.com/v1'
const PAGE_SIZE_DICTIONARY = 20

const logger = {
  info: (...args) => console.log('[Plivo] info:', ...args),
  debug: (...args) => console.log('[Plivo] debug:', ...args),
  error: (...args) => console.log('[Plivo] error:', ...args),
  warn: (...args) => console.log('[Plivo] warn:', ...args),
}

/**
 * @integrationName Plivo
 * @integrationIcon /logo.png
 */
class Plivo {
  /**
   * @typedef {Object} getNumbersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter numbers by phone number or alias. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getApplicationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter applications by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  constructor(config) {
    this.authId = config.authId
    this.authToken = config.authToken
    this.accountBaseUrl = `${ PLIVO_API_ROOT }/Account/${ this.authId }`
  }

  #getAuthHeader() {
    const credentials = Buffer.from(`${ this.authId }:${ this.authToken }`).toString('base64')

    return {
      'Authorization': `Basic ${ credentials }`,
      'Content-Type': 'application/json',
    }
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(this.#getAuthHeader())
        .query(cleanupObject(query) || {})

      return body !== undefined ? await request.send(cleanupObject(body)) : await request
    } catch (error) {
      const errBody = error.body || {}
      const message = errBody.error || errBody.message || error.message
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)
      throw new Error(`Plivo API error${ status ? ` [${ status }]` : '' }: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @operationName Send SMS
   * @category Messaging
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Sends an SMS or MMS message via Plivo. Send to a single recipient or to multiple recipients by joining destination numbers with the '<' delimiter (e.g. "12025551111<12025552222"). Numbers use E.164 format without the leading '+'. For MMS, set the type to MMS and provide one or more media URLs. Returns an api_id and an array of message_uuid values, one per recipient.
   * @route POST /send-sms
   * @paramDef {"type":"String","label":"From (Sender Number)","name":"src","required":true,"dictionary":"getNumbersDictionary","description":"The sender phone number (a Plivo number you own) or an approved alphanumeric sender ID."}
   * @paramDef {"type":"String","label":"To (Destination)","name":"dst","required":true,"description":"Destination phone number in E.164 format without the leading '+'. Send to multiple recipients by joining numbers with the '<' delimiter (e.g. '12025551111<12025552222')."}
   * @paramDef {"type":"String","label":"Message Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the message (up to 1600 characters)."}
   * @paramDef {"type":"String","label":"Message Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","MMS"]}},"defaultValue":"SMS","description":"The message type. Use MMS when sending media URLs."}
   * @paramDef {"type":"String","label":"Callback URL","name":"url","description":"Optional URL to receive delivery report callbacks for this message."}
   * @paramDef {"type":"Array<String>","label":"Media URLs","name":"media_urls","description":"Publicly accessible URLs of media files to send with an MMS message. Only used when Message Type is MMS."}
   * @returns {Object}
   * @sampleResult {"api_id":"a2b3c4d5-1234-5678-9abc-def012345678","message_uuid":["e1f2a3b4-1111-2222-3333-444455556666"]}
   */
  async sendSms(src, dst, text, type, url, media_urls) {
    const body = {
      src,
      dst,
      text,
      type: this.#resolveChoice(type, { SMS: 'sms', MMS: 'mms' }) || 'sms',
    }

    if (url) body.url = url
    if (Array.isArray(media_urls) && media_urls.length) body.media_urls = media_urls

    return this.#apiRequest({
      url: `${ this.accountBaseUrl }/Message/`,
      method: 'post',
      body,
      logTag: 'sendSms',
    })
  }

  /**
   * @operationName Get Message
   * @category Messaging
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Retrieves the details of a single message by its message UUID, including delivery status, sender, recipient, and message body.
   * @route GET /get-message
   * @paramDef {"type":"String","label":"Message UUID","name":"messageUuid","required":true,"description":"The unique identifier of the message to retrieve."}
   * @returns {Object}
   * @sampleResult {"api_id":"a2b3c4d5-1234-5678-9abc-def012345678","message_uuid":"e1f2a3b4-1111-2222-3333-444455556666","from_number":"12025551111","to_number":"12025552222","message_state":"delivered","message_direction":"outbound","total_amount":"0.00650"}
   */
  async getMessage(messageUuid) {
    return this.#apiRequest({
      url: `${ this.accountBaseUrl }/Message/${ messageUuid }/`,
      logTag: 'getMessage',
    })
  }

  /**
   * @operationName List Messages
   * @category Messaging
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Retrieves a paginated list of messages sent from and received by your Plivo account, with optional filtering by message time and pagination controls.
   * @route GET /list-messages
   * @paramDef {"type":"String","label":"Message Time","name":"message_time","description":"Filter by the time the message was sent, in 'YYYY-MM-DD HH:MM' format. Supports range operators as documented by Plivo (e.g. message_time__gte)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return per page (1-20, default 20)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"api_id":"a2b3c4d5-1234-5678-9abc-def012345678","meta":{"limit":20,"offset":0,"total_count":2},"objects":[{"message_uuid":"e1f2a3b4-1111-2222-3333-444455556666","from_number":"12025551111","to_number":"12025552222","message_state":"delivered"}]}
   */
  async listMessages(message_time, limit, offset) {
    return this.#apiRequest({
      url: `${ this.accountBaseUrl }/Message/`,
      query: { message_time, limit, offset },
      logTag: 'listMessages',
    })
  }

  /**
   * @operationName Make Call
   * @category Voice
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Initiates an outbound voice call from a Plivo number. When the call is answered, Plivo fetches XML call instructions from the provided answer URL. Numbers use E.164 format without the leading '+'.
   * @route POST /make-call
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"dictionary":"getNumbersDictionary","description":"The caller ID, a Plivo number you own, in E.164 format without the leading '+'."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"The destination phone number in E.164 format without the leading '+'. Multiple numbers can be joined with '<' to dial in sequence."}
   * @paramDef {"type":"String","label":"Answer URL","name":"answer_url","required":true,"description":"Publicly accessible URL that returns Plivo XML instructions to execute when the call is answered."}
   * @paramDef {"type":"String","label":"Answer Method","name":"answer_method","uiComponent":{"type":"DROPDOWN","options":{"values":["GET","POST"]}},"defaultValue":"POST","description":"The HTTP method Plivo uses to request the answer URL."}
   * @returns {Object}
   * @sampleResult {"api_id":"b3c4d5e6-2345-6789-abcd-ef0123456789","message":"call fired","request_uuid":"f7a8b9c0-1234-5678-9abc-def012345678"}
   */
  async makeCall(from, to, answer_url, answer_method) {
    const body = {
      from,
      to,
      answer_url,
      answer_method: this.#resolveChoice(answer_method, { GET: 'GET', POST: 'POST' }) || 'POST',
    }

    return this.#apiRequest({
      url: `${ this.accountBaseUrl }/Call/`,
      method: 'post',
      body,
      logTag: 'makeCall',
    })
  }

  /**
   * @operationName Get Call
   * @category Voice
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Retrieves details for a single call by its call UUID, including status, direction, duration, and cost. Works for live (in-progress) and completed calls.
   * @route GET /get-call
   * @paramDef {"type":"String","label":"Call UUID","name":"callUuid","required":true,"description":"The unique identifier of the call to retrieve."}
   * @returns {Object}
   * @sampleResult {"api_id":"c4d5e6f7-3456-789a-bcde-f01234567890","call_uuid":"f7a8b9c0-1234-5678-9abc-def012345678","from_number":"12025551111","to_number":"12025552222","call_state":"ANSWER","call_duration":42,"total_amount":"0.01000"}
   */
  async getCall(callUuid) {
    return this.#apiRequest({
      url: `${ this.accountBaseUrl }/Call/${ callUuid }/`,
      logTag: 'getCall',
    })
  }

  /**
   * @operationName List Calls
   * @category Voice
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Retrieves a paginated list of completed calls (Call Detail Records) for your Plivo account, with optional filtering by call direction and pagination controls.
   * @route GET /list-calls
   * @paramDef {"type":"String","label":"Direction","name":"call_direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Inbound","Outbound"]}},"description":"Filter calls by their direction."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return per page (1-20, default 20)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"api_id":"c4d5e6f7-3456-789a-bcde-f01234567890","meta":{"limit":20,"offset":0,"total_count":1},"objects":[{"call_uuid":"f7a8b9c0-1234-5678-9abc-def012345678","from_number":"12025551111","to_number":"12025552222","call_direction":"outbound","call_duration":42}]}
   */
  async listCalls(call_direction, limit, offset) {
    return this.#apiRequest({
      url: `${ this.accountBaseUrl }/Call/`,
      query: {
        call_direction: this.#resolveChoice(call_direction, { Inbound: 'inbound', Outbound: 'outbound' }),
        limit,
        offset,
      },
      logTag: 'listCalls',
    })
  }

  /**
   * @operationName Hangup Call
   * @category Voice
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Terminates a live (in-progress) call immediately by its call UUID.
   * @route DELETE /hangup-call
   * @paramDef {"type":"String","label":"Call UUID","name":"callUuid","required":true,"description":"The unique identifier of the live call to hang up."}
   * @returns {Object}
   * @sampleResult {"success":true,"call_uuid":"f7a8b9c0-1234-5678-9abc-def012345678","message":"Call hung up successfully"}
   */
  async hangupCall(callUuid) {
    await this.#apiRequest({
      url: `${ this.accountBaseUrl }/Call/${ callUuid }/`,
      method: 'delete',
      logTag: 'hangupCall',
    })

    return {
      success: true,
      call_uuid: callUuid,
      message: 'Call hung up successfully',
    }
  }

  /**
   * @operationName List Numbers
   * @category Numbers
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Retrieves a paginated list of phone numbers currently rented on your Plivo account, with optional filtering by number type and pagination controls.
   * @route GET /list-numbers
   * @paramDef {"type":"String","label":"Number Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Local","Toll-Free","Mobile","National","Fixed"]}},"description":"Filter owned numbers by their type."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return per page (1-20, default 20)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"api_id":"d5e6f7a8-4567-89ab-cdef-012345678901","meta":{"limit":20,"offset":0,"total_count":1},"objects":[{"number":"12025551111","alias":"Main Line","number_type":"local","sms_enabled":true,"voice_enabled":true}]}
   */
  async listNumbers(type, limit, offset) {
    return this.#apiRequest({
      url: `${ this.accountBaseUrl }/Number/`,
      query: {
        type: this.#resolveChoice(type, {
          'Local': 'local',
          'Toll-Free': 'tollfree',
          'Mobile': 'mobile',
          'National': 'national',
          'Fixed': 'fixed',
        }),
        limit,
        offset,
      },
      logTag: 'listNumbers',
    })
  }

  /**
   * @operationName Get Number
   * @category Numbers
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Retrieves the details of a single rented phone number on your account, including its capabilities, application association, and alias.
   * @route GET /get-number
   * @paramDef {"type":"String","label":"Number","name":"number","required":true,"dictionary":"getNumbersDictionary","description":"The phone number to retrieve, in E.164 format without the leading '+'."}
   * @returns {Object}
   * @sampleResult {"api_id":"d5e6f7a8-4567-89ab-cdef-012345678901","number":"12025551111","alias":"Main Line","number_type":"local","sms_enabled":true,"voice_enabled":true,"application":"/v1/Account/MAXXXXXX/Application/12345/"}
   */
  async getNumber(number) {
    return this.#apiRequest({
      url: `${ this.accountBaseUrl }/Number/${ number }/`,
      logTag: 'getNumber',
    })
  }

  /**
   * @operationName Search Numbers
   * @category Numbers
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Searches Plivo's inventory for available phone numbers to rent, filtered by country and number type. Returns numbers that can subsequently be purchased with the Buy Number operation.
   * @route GET /search-numbers
   * @paramDef {"type":"String","label":"Country ISO","name":"country_iso","required":true,"description":"Two-letter ISO country code to search within (e.g. 'US', 'GB', 'CA')."}
   * @paramDef {"type":"String","label":"Number Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Local","Toll-Free","Mobile","National","Fixed"]}},"description":"The type of number to search for."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return per page (1-20, default 20)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"api_id":"e6f7a8b9-5678-9abc-def0-123456789012","meta":{"limit":20,"offset":0,"total_count":1},"objects":[{"number":"12025559999","country":"United States","type":"local","monthly_rental_rate":"0.50000","sms_enabled":true,"voice_enabled":true}]}
   */
  async searchNumbers(country_iso, type, limit, offset) {
    return this.#apiRequest({
      url: `${ this.accountBaseUrl }/PhoneNumber/`,
      query: {
        country_iso,
        type: this.#resolveChoice(type, {
          'Local': 'local',
          'Toll-Free': 'tollfree',
          'Mobile': 'mobile',
          'National': 'national',
          'Fixed': 'fixed',
        }),
        limit,
        offset,
      },
      logTag: 'searchNumbers',
    })
  }

  /**
   * @operationName Buy Number
   * @category Numbers
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Rents (purchases) a specific available phone number found via Search Numbers and adds it to your Plivo account. Optionally associates the number with a Plivo application.
   * @route POST /buy-number
   * @paramDef {"type":"String","label":"Number","name":"number","required":true,"description":"The available phone number to rent, in E.164 format without the leading '+', as returned by Search Numbers."}
   * @paramDef {"type":"String","label":"Application ID","name":"app_id","dictionary":"getApplicationsDictionary","description":"Optional ID of a Plivo application to associate with the purchased number."}
   * @returns {Object}
   * @sampleResult {"api_id":"f7a8b9c0-6789-abcd-ef01-234567890123","message":"created","numbers":[{"number":"12025559999","status":"Success"}],"status":"fulfilled"}
   */
  async buyNumber(number, app_id) {
    const body = {}

    if (app_id) body.app_id = app_id

    return this.#apiRequest({
      url: `${ this.accountBaseUrl }/PhoneNumber/${ number }/`,
      method: 'post',
      body,
      logTag: 'buyNumber',
    })
  }

  /**
   * @operationName List Powerpacks
   * @category Powerpacks
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Retrieves a paginated list of Powerpacks on your account. Powerpacks group sender numbers and sender IDs (including 10DLC campaigns) into a single sender pool that Plivo automatically selects from when sending messages.
   * @route GET /list-powerpacks
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return per page (1-20, default 20)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"api_id":"a8b9c0d1-789a-bcde-f012-345678901234","meta":{"limit":20,"offset":0,"total_count":1},"objects":[{"uuid":"c0d1e2f3-1111-2222-3333-444455556666","name":"US Campaign Pool","sticky_sender":true,"local_connect":false}]}
   */
  async listPowerpacks(limit, offset) {
    return this.#apiRequest({
      url: `${ PLIVO_API_ROOT }/Account/${ this.authId }/Powerpack/`,
      query: { limit, offset },
      logTag: 'listPowerpacks',
    })
  }

  /**
   * @operationName List Applications
   * @category Applications
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Retrieves a paginated list of Plivo applications on your account. Applications hold reusable voice and messaging configuration (answer URLs, message URLs) that can be associated with numbers.
   * @route GET /list-applications
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return per page (1-20, default 20)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"api_id":"b9c0d1e2-89ab-cdef-0123-456789012345","meta":{"limit":20,"offset":0,"total_count":1},"objects":[{"app_id":"12345678901234567","app_name":"Support App","answer_url":"https://example.com/answer","message_url":"https://example.com/message"}]}
   */
  async listApplications(limit, offset) {
    return this.#apiRequest({
      url: `${ this.accountBaseUrl }/Application/`,
      query: { limit, offset },
      logTag: 'listApplications',
    })
  }

  /**
   * @operationName Get Account Details
   * @category Account
   * @appearanceColor #28A2C8 #4FC3E8
   * @description Retrieves details about your Plivo account, including the account name, current balance, available cash credits, and account type.
   * @route GET /get-account-details
   * @returns {Object}
   * @sampleResult {"api_id":"c0d1e2f3-9abc-def0-1234-567890123456","account_type":"standard","auth_id":"MAXXXXXXXXXXXXXXXXXX","name":"Acme Inc","cash_credits":"25.00000","address":"","city":"","state":""}
   */
  async getAccountDetails() {
    return this.#apiRequest({
      url: `${ this.accountBaseUrl }/`,
      logTag: 'getAccountDetails',
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Numbers Dictionary
   * @description Provides a searchable list of phone numbers rented on your Plivo account for dynamic parameter selection, such as choosing a sender number.
   * @route POST /get-numbers-dictionary
   * @paramDef {"type":"getNumbersDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string and pagination cursor for retrieving and filtering owned numbers."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"12025551111 (Main Line)","value":"12025551111","note":"Type: local, SMS/Voice enabled"}],"cursor":"20"}
   */
  async getNumbersDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = cursor ? Number(cursor) : 0

    const response = await this.#apiRequest({
      url: `${ this.accountBaseUrl }/Number/`,
      query: { limit: PAGE_SIZE_DICTIONARY, offset },
      logTag: 'getNumbersDictionary',
    })

    const numbers = response.objects || []
    const filtered = search
      ? searchFilter(numbers, ['number', 'alias'], search)
      : numbers

    const total = response.meta?.total_count ?? 0
    const nextOffset = offset + PAGE_SIZE_DICTIONARY

    return {
      cursor: nextOffset < total ? String(nextOffset) : null,
      items: filtered.map(number => ({
        label: number.alias ? `${ number.number } (${ number.alias })` : number.number,
        value: number.number,
        note: `Type: ${ number.number_type || 'unknown' }, ${ [
          number.sms_enabled && 'SMS',
          number.voice_enabled && 'Voice',
        ].filter(Boolean).join('/') || 'no capabilities' } enabled`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Applications Dictionary
   * @description Provides a searchable list of Plivo applications for dynamic parameter selection, such as associating an application with a number.
   * @route POST /get-applications-dictionary
   * @paramDef {"type":"getApplicationsDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string and pagination cursor for retrieving and filtering applications."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Support App","value":"12345678901234567","note":"Answer URL: https://example.com/answer"}],"cursor":"20"}
   */
  async getApplicationsDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = cursor ? Number(cursor) : 0

    const response = await this.#apiRequest({
      url: `${ this.accountBaseUrl }/Application/`,
      query: { limit: PAGE_SIZE_DICTIONARY, offset },
      logTag: 'getApplicationsDictionary',
    })

    const apps = response.objects || []
    const filtered = search
      ? searchFilter(apps, ['app_name', 'app_id'], search)
      : apps

    const total = response.meta?.total_count ?? 0
    const nextOffset = offset + PAGE_SIZE_DICTIONARY

    return {
      cursor: nextOffset < total ? String(nextOffset) : null,
      items: filtered.map(app => ({
        label: app.app_name || app.app_id,
        value: String(app.app_id),
        note: app.answer_url ? `Answer URL: ${ app.answer_url }` : 'No answer URL configured',
      })),
    }
  }
}

Flowrunner.ServerCode.addService(Plivo, [
  {
    name: 'authId',
    displayName: 'Auth ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Plivo Auth ID. Find it in the Plivo Console under Account > Auth ID.',
  },
  {
    name: 'authToken',
    displayName: 'Auth Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Plivo Auth Token. Find it in the Plivo Console next to your Auth ID. Keep this secure!',
  },
])

function searchFilter(list, props, searchString) {
  const caseInsensitiveSearch = searchString.toLowerCase()

  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(caseInsensitiveSearch)
    })
  )
}

function cleanupObject(data) {
  if (!data) {
    return data
  }

  Object.keys(data).forEach(key => {
    if (data[key] === undefined || data[key] === null) {
      delete data[key]
    }
  })

  return data
}
