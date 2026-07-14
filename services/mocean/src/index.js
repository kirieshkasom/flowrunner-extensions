const logger = {
  info: (...args) => console.log('[Mocean] info:', ...args),
  debug: (...args) => console.log('[Mocean] debug:', ...args),
  error: (...args) => console.log('[Mocean] error:', ...args),
  warn: (...args) => console.log('[Mocean] warn:', ...args),
}

const API_BASE_URL = 'https://rest.moceanapi.com/rest/2'

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
 * @integrationName Mocean
 * @integrationIcon /icon.png
 */
class MoceanService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
  }

  // Mocean authenticates via mocean-api-key/mocean-api-secret sent as form/query
  // params on every request, plus mocean-resp-format=json for a JSON response.
  #authParams() {
    return {
      'mocean-api-key': this.apiKey,
      'mocean-api-secret': this.apiSecret,
      'mocean-resp-format': 'json',
    }
  }

  // Surface Mocean's error shape: top-level { status, err_msg } or per-message
  // { status, err_msg } inside messages[]. status !== 0 signals an error.
  #assertOk(response, logTag) {
    if (!response || typeof response !== 'object') {
      return response
    }

    const failedMessage = Array.isArray(response.messages)
      ? response.messages.find(message => message && Number(message.status) !== 0)
      : undefined

    const errorHolder = failedMessage || (Number(response.status) !== 0 && response.status !== undefined ? response : undefined)

    if (errorHolder) {
      const status = errorHolder.status
      const message = errorHolder.err_msg || 'Unknown error'

      logger.error(`${ logTag } - Mocean returned error status ${ status }: ${ message }`)

      throw new Error(`Mocean API error (status ${ status }): ${ message }`)
    }

    return response
  }

  async #apiRequest({ url, method = 'post', params, logTag }) {
    const payload = clean({ ...this.#authParams(), ...(params || {}) })

    try {
      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      let response

      if (method.toLowerCase() === 'get') {
        response = await Flowrunner.Request.get(url).query(payload)
      } else {
        response = await Flowrunner.Request[method.toLowerCase()](url)
          .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
          .type('form')
          .send(payload)
      }

      return this.#assertOk(response, logTag)
    } catch (error) {
      if (error.message && error.message.startsWith('Mocean API error')) {
        throw error
      }

      const body = error.body || {}
      const message = body.err_msg ||
        (Array.isArray(body.messages) && body.messages[0] && body.messages[0].err_msg) ||
        error.message ||
        'Unknown error'

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Mocean API error: ${ message }`)
    }
  }

  /**
   * @operationName Send SMS
   * @category SMS
   * @description Sends an SMS message through the Mocean network. Provide a sender ID, one or more recipient numbers in international MSISDN format (no leading + or 00), and the message text. Long messages are automatically concatenated. Returns a per-recipient result with the delivery status code (0 = accepted), the receiver number, and a message ID for tracking.
   * @route POST /send-sms
   * @appearanceColor #0057FF #4D8CFF
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"description":"Sender ID shown to the recipient. An alphanumeric sender name (max 11 chars) or an approved phone number, depending on destination country regulations."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Recipient phone number in international MSISDN format without a leading + or 00 (e.g. 60123456789). Provide up to 500 comma-separated numbers for a bulk send."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message body. Unicode is supported; messages longer than a single segment are concatenated automatically."}
   * @returns {Object}
   * @sampleResult {"messages":[{"status":0,"receiver":"60123456789","msgid":"cust20013050311050614001"}]}
   */
  async sendSms(from, to, text) {
    const logTag = '[sendSms]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sms`,
      method: 'post',
      params: {
        'mocean-from': from,
        'mocean-to': to,
        'mocean-text': text,
      },
    })
  }

  /**
   * @operationName Send Verification Code
   * @category Verify
   * @description Starts a 2FA verification by generating a one-time PIN and delivering it to the recipient by SMS. Provide the recipient number and a brand name shown in the message. Returns a request ID (reqid) that you must pass to Check Verification Code to confirm the code the user entered. Optionally control the PIN length and how long it stays valid.
   * @route POST /send-verification-code
   * @appearanceColor #0057FF #4D8CFF
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Recipient phone number with country code in international MSISDN format (e.g. 60123456789)."}
   * @paramDef {"type":"String","label":"Brand","name":"brand","required":true,"description":"Company or application name shown in the verification message so the recipient recognizes the sender."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Optional SMS sender ID for the verification message."}
   * @paramDef {"type":"Number","label":"Code Length","name":"codeLength","uiComponent":{"type":"DROPDOWN","options":{"values":["4","6"]}},"description":"Number of digits in the PIN. Allowed values are 4 or 6. Defaults to 4."}
   * @paramDef {"type":"Number","label":"PIN Validity","name":"pinValidity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How long the PIN remains valid, in seconds (60-3600). Defaults to 300."}
   * @returns {Object}
   * @sampleResult {"reqid":"e8697f4351c8447fb00b117f4dd276fd","status":0,"to":"60123456789","is_number_reachable":"unknown"}
   */
  async sendVerificationCode(to, brand, from, codeLength, pinValidity) {
    const logTag = '[sendVerificationCode]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/verify/req/sms`,
      method: 'post',
      params: {
        'mocean-to': to,
        'mocean-brand': brand,
        'mocean-from': from,
        'mocean-code-length': codeLength,
        'mocean-pin-validity': pinValidity,
      },
    })
  }

  /**
   * @operationName Check Verification Code
   * @category Verify
   * @description Validates the one-time PIN a user entered against a pending verification request. Provide the request ID returned by Send Verification Code together with the code supplied by the user. A status of 0 confirms the code is correct; a non-zero status indicates a wrong or expired code.
   * @route POST /check-verification-code
   * @appearanceColor #0057FF #4D8CFF
   * @paramDef {"type":"String","label":"Request ID","name":"reqid","required":true,"description":"The verification request ID (reqid) returned by Send Verification Code."}
   * @paramDef {"type":"String","label":"Code","name":"code","required":true,"description":"The one-time PIN the user entered, to be checked against the pending request."}
   * @returns {Object}
   * @sampleResult {"reqid":"e8697f4351c8447fb00b117f4dd276fd","status":0}
   */
  async checkVerificationCode(reqid, code) {
    const logTag = '[checkVerificationCode]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/verify/check`,
      method: 'post',
      params: {
        'mocean-reqid': reqid,
        'mocean-code': code,
      },
    })
  }

  /**
   * @operationName Resend Verification Code
   * @category Verify
   * @description Resends the one-time PIN for an existing verification request over SMS, reusing the original request ID rather than starting a new verification. Use this when the recipient did not receive the first message. Returns the request ID and the current resend count.
   * @route POST /resend-verification-code
   * @appearanceColor #0057FF #4D8CFF
   * @paramDef {"type":"String","label":"Request ID","name":"reqid","required":true,"description":"The verification request ID (reqid) returned by Send Verification Code that should have its PIN resent."}
   * @returns {Object}
   * @sampleResult {"reqid":"e8697f4351c8447fb00b117f4dd276fd","status":0,"to":"60123456789","is_number_reachable":"unknown","resend_number":"2"}
   */
  async resendVerificationCode(reqid) {
    const logTag = '[resendVerificationCode]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/verify/resend/sms`,
      method: 'post',
      params: {
        'mocean-reqid': reqid,
      },
    })
  }

  /**
   * @operationName Number Lookup
   * @category Number Lookup
   * @description Looks up carrier and portability information for a phone number in real time. Provide a number in international MSISDN format and receive the current carrier (name, country, and network codes), the original carrier, and whether the number has been ported to another network. Useful for validating numbers and routing before sending SMS.
   * @route POST /number-lookup
   * @appearanceColor #0057FF #4D8CFF
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Phone number to look up, with country code, in international MSISDN format (e.g. 60123456789)."}
   * @returns {Object}
   * @sampleResult {"status":0,"msgid":"test0412143224000022.0002","to":"60123456789","current_carrier":{"country":"MY","name":"U Mobile","network_code":50218,"mcc":"502","mnc":"18"},"original_carrier":{"country":"MY","name":"Maxis Mobile","network_code":50212,"mcc":"502","mnc":"12"},"ported":"ported"}
   */
  async numberLookup(to) {
    const logTag = '[numberLookup]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/nl`,
      method: 'post',
      params: {
        'mocean-to': to,
      },
    })
  }

  /**
   * @operationName Get Balance
   * @category Account
   * @description Retrieves the current prepaid balance of your Mocean account, returned in your account currency. Use this to monitor available funds before sending messages or starting verifications.
   * @route GET /get-balance
   * @appearanceColor #0057FF #4D8CFF
   * @returns {Object}
   * @sampleResult {"status":0,"balance":"1234.50"}
   */
  async getBalance() {
    const logTag = '[getBalance]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/account/balance`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Pricing
   * @category Account
   * @description Retrieves per-country SMS pricing for your Mocean account. Returns a list of countries with their name and the current price per message. Optionally filter to a single country by its ISO country code.
   * @route GET /get-pricing
   * @appearanceColor #0057FF #4D8CFF
   * @paramDef {"type":"String","label":"Country Code","name":"countryCode","description":"Optional two-letter ISO country code (e.g. MY, US) to return pricing for a single country. Leave empty to return pricing for all countries."}
   * @returns {Object}
   * @sampleResult {"status":0,"pricing":[{"country":"MY","country_name":"Malaysia","price":"0.05"}]}
   */
  async getPricing(countryCode) {
    const logTag = '[getPricing]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/account/pricing`,
      method: 'get',
      params: {
        'mocean-country-code': countryCode,
      },
    })
  }
}

Flowrunner.ServerCode.addService(MoceanService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your MoceanAPI key. Get it from MoceanAPI → Dashboard → API key.',
  },
  {
    name: 'apiSecret',
    displayName: 'API Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your MoceanAPI secret. Get it from MoceanAPI → Dashboard → API secret.',
  },
])
