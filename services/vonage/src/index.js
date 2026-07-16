'use strict'

const SMS_BASE_URL = 'https://rest.nexmo.com'
const API_BASE_URL = 'https://api.nexmo.com'

const logger = {
  info: (...args) => console.log('[Vonage Service] info:', ...args),
  debug: (...args) => console.log('[Vonage Service] debug:', ...args),
  error: (...args) => console.log('[Vonage Service] error:', ...args),
  warn: (...args) => console.log('[Vonage Service] warn:', ...args),
}

/**
 * @integrationName Vonage
 * @integrationIcon /icon.svg
 */
class Vonage {
  constructor(config) {
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
  }

  #getAuthHeader() {
    const credentials = Buffer.from(`${ this.apiKey }:${ this.apiSecret }`).toString('base64')

    return {
      'Authorization': `Basic ${ credentials }`,
      'Content-Type': 'application/json',
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Surfaces both Vonage error shapes: SMS API returns messages[].status/error-text,
  // while Messages/Verify/Insight use { title, detail, type, instance }.
  #formatError(error, logTag) {
    const responseBody = error.body || {}
    const message = responseBody.detail ||
      responseBody.title ||
      responseBody['error-text'] ||
      error.message ||
      'Unknown error'

    logger.error(`${ logTag } - failed: ${ message }`)

    return new Error(`Vonage API error: ${ message }`)
  }

  // All calls that use HTTP Basic auth (Messages API v1, Verify v2) go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - api request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(this.#getAuthHeader())
        .query(cleanupObject(query) || {})

      return body !== undefined ? await request.send(cleanupObject(body)) : await request
    } catch (error) {
      throw this.#formatError(error, logTag)
    }
  }

  /**
   * @operationName Send SMS
   * @category Messaging
   * @appearanceColor #871719 #E9564B
   * @description Sends an SMS text message through the Vonage SMS API. Credentials are passed in the request body. Set the message type to Unicode when sending non-GSM characters (e.g. emoji or non-Latin scripts). The response contains a messages array; each entry has a status of "0" on success, or a non-zero status plus an error-text on failure.
   * @route POST /send-sms
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"description":"The sender ID. A Vonage virtual number in E.164 format (e.g. 447700900000) or, where supported, an alphanumeric sender name (up to 11 characters)."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"The recipient phone number in E.164 international format without a leading + or 00 (e.g. 447700900001)."}
   * @paramDef {"type":"String","label":"Message Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The body of the SMS message. Long messages are automatically split into multiple parts and concatenated on delivery."}
   * @paramDef {"type":"Boolean","label":"Unicode","name":"unicode","uiComponent":{"type":"CHECKBOX"},"description":"Enable to send the message as Unicode (UCS-2). Required for emoji or non-Latin characters. When disabled the message is sent as standard GSM text."}
   * @paramDef {"type":"String","label":"Client Reference","name":"clientRef","description":"An optional reference of up to 100 characters included in delivery receipts and callbacks to correlate the message."}
   * @returns {Object}
   * @sampleResult {"message-count":"1","messages":[{"to":"447700900001","message-id":"0A0000001234567B","status":"0","remaining-balance":"18.99550000","message-price":"0.03330000","network":"23410"}]}
   */
  async sendSms(from, to, text, unicode, clientRef) {
    const body = {
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      from,
      to,
      text,
      type: unicode ? 'unicode' : undefined,
      'client-ref': clientRef,
    }

    try {
      logger.debug(`sendSms - api request: [POST::${ SMS_BASE_URL }/sms/json]`)

      const response = await Flowrunner.Request
        .post(`${ SMS_BASE_URL }/sms/json`)
        .set({ 'Content-Type': 'application/json' })
        .send(cleanupObject(body))

      const messages = response.messages || []
      const failed = messages.find(message => message.status && message.status !== '0')

      if (failed) {
        logger.error(`sendSms - failed: status ${ failed.status } - ${ failed['error-text'] }`)
        throw new Error(`Vonage SMS error (status ${ failed.status }): ${ failed['error-text'] || 'Unknown error' }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('Vonage SMS error')) {
        throw error
      }

      throw this.#formatError(error, 'sendSms')
    }
  }

  /**
   * @operationName Send Message (Multichannel)
   * @category Messaging
   * @appearanceColor #871719 #E9564B
   * @description Sends a message over the Vonage Messages API, which supports multiple channels from a single endpoint. Choose the channel (SMS, WhatsApp, MMS, Messenger, or Viber) and provide a text body. The recipient and sender formats depend on the channel: phone numbers in E.164 format for SMS/WhatsApp/MMS/Viber, and a page-scoped ID for Messenger. Returns a message UUID for tracking. This action sends text content; for rich media use the channel's native tooling.
   * @route POST /send-message
   * @paramDef {"type":"String","label":"Channel","name":"channel","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","WhatsApp","MMS","Messenger","Viber"]}},"defaultValue":"SMS","description":"The channel to deliver the message over. Each channel must be enabled and configured in your Vonage account before use."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"The recipient. A phone number in E.164 format (e.g. 447700900001) for SMS, WhatsApp, MMS, and Viber; a page-scoped recipient ID for Messenger."}
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"description":"The sender. Your Vonage virtual number (or WhatsApp/Viber sender ID) for most channels, or your Facebook page ID for Messenger."}
   * @paramDef {"type":"String","label":"Message Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the message (up to 1000 characters for SMS)."}
   * @paramDef {"type":"String","label":"Client Reference","name":"clientRef","description":"An optional reference of up to 100 characters returned in status webhooks to correlate the message."}
   * @returns {Object}
   * @sampleResult {"message_uuid":"aaaaaaaa-bbbb-cccc-dddd-0123456789ab"}
   */
  async sendMessage(channel, to, from, text, clientRef) {
    const resolvedChannel = this.#resolveChoice(channel, {
      SMS: 'sms',
      WhatsApp: 'whatsapp',
      MMS: 'mms',
      Messenger: 'messenger',
      Viber: 'viber',
    })

    const body = {
      message_type: 'text',
      channel: resolvedChannel,
      to,
      from,
      text,
      client_ref: clientRef,
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/messages`,
      method: 'post',
      body,
      logTag: 'sendMessage',
    })
  }

  /**
   * @operationName Start Verification
   * @category Verify
   * @appearanceColor #871719 #E9564B
   * @description Starts a two-factor authentication (2FA) request using Vonage Verify v2. Vonage generates a one-time code and delivers it to the recipient over the selected channel (SMS, Voice, Email, or WhatsApp). Returns a request ID that must be supplied to Check Verification to validate the code the user enters. Configure the brand name shown to the recipient and, optionally, the code length and channel timeout.
   * @route POST /start-verification
   * @paramDef {"type":"String","label":"Brand","name":"brand","required":true,"description":"The brand or application name presented to the recipient in the verification message (1-18 characters)."}
   * @paramDef {"type":"String","label":"Channel","name":"channel","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","Voice","Email","WhatsApp"]}},"defaultValue":"SMS","description":"The channel used to deliver the verification code."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"The recipient to verify: a phone number in E.164 format for SMS, Voice, and WhatsApp (e.g. 447700900001), or an email address when the channel is Email."}
   * @paramDef {"type":"Number","label":"Code Length","name":"codeLength","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Length of the generated code, between 4 and 10 digits (default 4)."}
   * @paramDef {"type":"Number","label":"Channel Timeout","name":"channelTimeout","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seconds to wait before advancing to the next workflow step, between 15 and 900 (default 300)."}
   * @returns {Object}
   * @sampleResult {"request_id":"c11236f4-00bf-4b89-84ba-88b25df97315"}
   */
  async startVerification(brand, channel, to, codeLength, channelTimeout) {
    const resolvedChannel = this.#resolveChoice(channel, {
      SMS: 'sms',
      Voice: 'voice',
      Email: 'email',
      WhatsApp: 'whatsapp',
    })

    const body = {
      brand,
      code_length: codeLength,
      channel_timeout: channelTimeout,
      workflow: [{ channel: resolvedChannel, to }],
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v2/verify`,
      method: 'post',
      body,
      logTag: 'startVerification',
    })
  }

  /**
   * @operationName Check Verification
   * @category Verify
   * @appearanceColor #871719 #E9564B
   * @description Checks a code entered by the user against a Verify v2 request. Provide the request ID returned by Start Verification and the code the recipient received. On success the response status is "completed". An incorrect code returns an error; the verification also fails if the code has expired or too many incorrect attempts have been made.
   * @route POST /check-verification
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"The request ID returned by Start Verification."}
   * @paramDef {"type":"String","label":"Code","name":"code","required":true,"description":"The verification code entered by the recipient."}
   * @returns {Object}
   * @sampleResult {"request_id":"c11236f4-00bf-4b89-84ba-88b25df97315","status":"completed"}
   */
  async checkVerification(requestId, code) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/v2/verify/${ requestId }`,
      method: 'post',
      body: { code },
      logTag: 'checkVerification',
    })
  }

  /**
   * @operationName Cancel Verification
   * @category Verify
   * @appearanceColor #871719 #E9564B
   * @description Cancels an in-progress Verify v2 request so that no further codes are sent. Provide the request ID returned by Start Verification. Cancellation is only possible within a short window after the request starts and before the next workflow event occurs.
   * @route DELETE /cancel-verification
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"The request ID of the verification to cancel."}
   * @returns {Object}
   * @sampleResult {"success":true,"request_id":"c11236f4-00bf-4b89-84ba-88b25df97315"}
   */
  async cancelVerification(requestId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/verify/${ requestId }`,
      method: 'delete',
      logTag: 'cancelVerification',
    })

    return { success: true, request_id: requestId }
  }

  /**
   * @operationName Number Insight (Basic)
   * @category Number Insight
   * @appearanceColor #871719 #E9564B
   * @description Performs a basic Number Insight lookup for a phone number. Returns the number formatted internationally and nationally along with the country name, country code, and country prefix. Basic lookups are synchronous and validate number format and country; use Standard lookup for carrier and portability data.
   * @route GET /number-insight-basic
   * @paramDef {"type":"String","label":"Number","name":"number","required":true,"description":"The phone number to look up, in E.164 international format (e.g. 447700900000)."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Optional two-letter ISO country code (e.g. GB) used to resolve numbers supplied in national format."}
   * @returns {Object}
   * @sampleResult {"status":0,"status_message":"Success","request_id":"aaaaaaaa-bbbb-cccc-dddd-0123456789ab","international_format_number":"447700900000","national_format_number":"07700 900000","country_code":"GB","country_code_iso3":"GBR","country_name":"United Kingdom","country_prefix":"44"}
   */
  async numberInsightBasic(number, country) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/ni/basic/json`,
      query: {
        api_key: this.apiKey,
        api_secret: this.apiSecret,
        number,
        country,
      },
      logTag: 'numberInsightBasic',
    })
  }

  /**
   * @operationName Number Insight (Standard)
   * @category Number Insight
   * @appearanceColor #871719 #E9564B
   * @description Performs a standard Number Insight lookup for a phone number. In addition to the basic formatting and country data, it returns the current and original carrier, the line type (mobile, landline, or virtual), portability status, and roaming information where available. Standard lookups incur a charge.
   * @route GET /number-insight-standard
   * @paramDef {"type":"String","label":"Number","name":"number","required":true,"description":"The phone number to look up, in E.164 international format (e.g. 447700900000)."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Optional two-letter ISO country code (e.g. GB) used to resolve numbers supplied in national format."}
   * @returns {Object}
   * @sampleResult {"status":0,"status_message":"Success","request_id":"aaaaaaaa-bbbb-cccc-dddd-0123456789ab","international_format_number":"447700900000","national_format_number":"07700 900000","country_code":"GB","country_name":"United Kingdom","country_prefix":"44","current_carrier":{"network_code":"23410","name":"Telefonica UK Limited","country":"GB","network_type":"mobile"},"ported":"not_ported","roaming":{"status":"unknown"}}
   */
  async numberInsightStandard(number, country) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/ni/standard/json`,
      query: {
        api_key: this.apiKey,
        api_secret: this.apiSecret,
        number,
        country,
      },
      logTag: 'numberInsightStandard',
    })
  }

  /**
   * @operationName Get Balance
   * @category Account
   * @appearanceColor #871719 #E9564B
   * @description Retrieves the current balance of your Vonage account. Returns the remaining credit value in euros and whether auto-reload (auto top-up) is enabled on the account.
   * @route GET /get-balance
   * @returns {Object}
   * @sampleResult {"value":18.99550000,"autoReload":false}
   */
  async getBalance() {
    return this.#apiRequest({
      url: `${ SMS_BASE_URL }/account/get-balance`,
      query: {
        api_key: this.apiKey,
        api_secret: this.apiSecret,
      },
      logTag: 'getBalance',
    })
  }

  /**
   * @operationName List Owned Numbers
   * @category Numbers
   * @appearanceColor #871719 #E9564B
   * @description Lists the virtual phone numbers owned by your Vonage account. Returns each number with its country, type, capabilities (SMS, voice, and MMS features), and any configured webhook or voice call settings. Supports pagination and filtering by a partial number pattern.
   * @route GET /list-owned-numbers
   * @paramDef {"type":"String","label":"Pattern","name":"pattern","description":"An optional partial number to filter results (e.g. 4477 to match UK numbers)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"size","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to return per page (default 10, maximum 100)."}
   * @paramDef {"type":"Number","label":"Index","name":"index","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The page index of results to return, starting at 1 (default 1)."}
   * @returns {Object}
   * @sampleResult {"count":1,"numbers":[{"country":"GB","msisdn":"447700900000","type":"mobile-lvn","cost":"1.00","features":["SMS","VOICE"]}]}
   */
  async listOwnedNumbers(pattern, size, index) {
    return this.#apiRequest({
      url: `${ SMS_BASE_URL }/account/numbers`,
      query: {
        api_key: this.apiKey,
        api_secret: this.apiSecret,
        pattern,
        search_pattern: pattern !== undefined ? 1 : undefined,
        size,
        index,
      },
      logTag: 'listOwnedNumbers',
    })
  }
}

Flowrunner.ServerCode.addService(Vonage, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Vonage API key. Find it in the Vonage API Dashboard under API settings.',
  },
  {
    name: 'apiSecret',
    displayName: 'API Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Vonage API secret. Find it in the Vonage API Dashboard under API settings. Keep this secure.',
  },
])

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
