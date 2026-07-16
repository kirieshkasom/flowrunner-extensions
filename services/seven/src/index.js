const logger = {
  info: (...args) => console.log('[seven] info:', ...args),
  debug: (...args) => console.log('[seven] debug:', ...args),
  error: (...args) => console.log('[seven] error:', ...args),
  warn: (...args) => console.log('[seven] warn:', ...args),
}

const API_BASE_URL = 'https://gateway.seven.io/api'

// seven.io numeric status codes returned in the `success`/`code` field.
const STATUS_CODES = {
  100: 'SMS accepted by the gateway and is being sent.',
  101: 'Sending to at least one recipient failed.',
  201: 'The sender (from) is invalid.',
  202: 'The recipient number is invalid.',
  300: 'Variable "user" or "password" not set.',
  301: 'Variable "to" not set.',
  305: 'Variable "text" is invalid.',
  308: 'Unknown or unsupported parameter.',
  401: 'Variable "text" is too long.',
  402: 'This SMS has already been sent within the last 180 seconds.',
  403: 'Maximum daily limit for this recipient reached.',
  500: 'Insufficient account credit.',
  600: 'An error occurred during sending.',
  801: 'A temporary error occurred at the gateway. Please retry later.',
  802: 'Invalid label.',
  900: 'Authentication failed. Check your API key.',
  901: 'Signature/hash verification failed.',
  902: 'The API key lacks access rights for this endpoint.',
  903: 'The requesting IP address is not whitelisted.',
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
 * @integrationName seven
 * @integrationIcon /icon.png
 */
class SevenService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'X-Api-Key': this.apiKey,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      const response = body !== undefined ? await request.send(body) : await request

      return this.#assertSuccess(response, logTag)
    } catch (error) {
      const message = error.body?.message || error.body?.error || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`seven API error: ${ message }`)
    }
  }

  // seven returns a numeric status code in `success`/`code`. Surface non-100 codes as errors.
  #assertSuccess(response, logTag) {
    if (!response || typeof response !== 'object') {
      return response
    }

    const rawCode = response.success !== undefined ? response.success : response.code

    if (rawCode === undefined || rawCode === null) {
      return response
    }

    const code = String(rawCode)

    // "true"/true are used by some sub-objects; only numeric codes are gateway status codes.
    if (!/^\d+$/.test(code)) {
      return response
    }

    if (code !== '100') {
      const meaning = STATUS_CODES[code] || 'Unknown status code.'

      logger.error(`${ logTag } - seven returned code ${ code }: ${ meaning }`)

      throw new Error(`seven API error: code ${ code } - ${ meaning }`)
    }

    return response
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @operationName Send SMS
   * @category Messaging
   * @description Sends an SMS message to one or more recipients through the seven.io gateway. Provide the recipient number(s) in international format (e.g. 491710000000), the message text, and an optional sender ID (alphanumeric up to 11 chars or numeric up to 16). Supports flash messages, unicode/special characters, scheduled delivery, and a foreign ID for delivery-report matching. Returns the gateway status code (100 = accepted), a per-message breakdown, the total price, and remaining account balance.
   * @route POST /sms
   * @appearanceColor #00C36A #33D98C
   *
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Recipient number(s) in international format, e.g. 491710000000. Multiple recipients can be comma-separated. Can also be a seven.io contact or group name."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message body to send."}
   * @paramDef {"type":"String","label":"Sender ID (From)","name":"from","description":"Sender ID shown to the recipient: up to 11 alphanumeric characters or 16 numeric digits. Alphanumeric sender IDs disable inbound replies."}
   * @paramDef {"type":"Boolean","label":"Flash SMS","name":"flash","uiComponent":{"type":"TOGGLE"},"description":"Send as a flash SMS that appears directly on the recipient's screen without being stored. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Unicode","name":"unicode","uiComponent":{"type":"TOGGLE"},"description":"Force unicode (UCS-2) encoding to preserve special characters and emoji. Reduces the per-part character limit."}
   * @paramDef {"type":"String","label":"Delay Until","name":"delay","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Schedule delivery for a future time. Accepts a Unix timestamp or a YYYY-MM-DD hh:mm:ss value. Leave empty to send immediately."}
   * @paramDef {"type":"String","label":"Foreign ID","name":"foreignId","description":"Your own reference (up to 64 chars) echoed back in delivery reports for matching."}
   * @paramDef {"type":"String","label":"Label","name":"label","description":"Optional label (up to 100 chars) for grouping and statistics."}
   *
   * @returns {Object}
   * @sampleResult {"success":"100","total_price":0.075,"balance":593.994,"sms_type":"direct","messages":[{"id":"77229318510","sender":"seven","recipient":"491710000000","text":"Hello World","encoding":"gsm","label":null,"parts":1,"price":0.075,"success":true,"error":null}]}
   */
  async sendSms(to, text, from, flash, unicode, delay, foreignId, label) {
    const logTag = '[sendSms]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sms`,
      method: 'post',
      body: clean({
        to,
        text,
        from,
        flash: flash ? 1 : undefined,
        unicode: unicode ? 1 : undefined,
        delay: delay || undefined,
        foreign_id: foreignId,
        label,
        json: 1,
      }),
    })
  }

  /**
   * @operationName Get SMS Delivery Status
   * @category Messaging
   * @description Retrieves the delivery status of a previously sent SMS by its message ID (returned from Send SMS). Reports whether the message was delivered, is pending, was rejected, or failed, along with the status timestamp when available.
   * @route GET /status
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The SMS message ID returned by Send SMS (the `id` field of a message)."}
   *
   * @returns {Object}
   * @sampleResult {"success":"100","report":{"id":"77229318510","status":"DELIVERED","status_time":"2026-07-14 10:15:00"}}
   */
  async getSmsStatus(messageId) {
    const logTag = '[getSmsStatus]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/status`,
      method: 'get',
      query: {
        msg_id: messageId,
        json: 1,
      },
    })
  }

  /**
   * @operationName Number Lookup
   * @category Lookup
   * @description Looks up information about a phone number using the seven.io lookup service. Choose the lookup type: Format returns national/international formatting, country, carrier and network type; Carrier Name (CNAM) returns the registered caller ID name; Portability (MNP) returns the current network operator and whether the number was ported; HLR returns live reachability, roaming and porting status from the mobile network. Provide the number in international format.
   * @route GET /lookup
   *
   * @paramDef {"type":"String","label":"Lookup Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Format","Carrier Name (CNAM)","Portability (MNP)","HLR (Live Status)"]}},"defaultValue":"Format","description":"Which lookup to perform against the number."}
   * @paramDef {"type":"String","label":"Number","name":"number","required":true,"description":"Phone number in international format, e.g. 491710000000."}
   *
   * @returns {Object}
   * @sampleResult {"success":"100","national":"0171 0000000","international":"+491710000000","country_code":"49","country_iso":"DE","country_name":"Germany","carrier":"Telekom Deutschland GmbH","network_type":"mobile"}
   */
  async numberLookup(type, number) {
    const logTag = '[numberLookup]'

    const lookupType = this.#resolveChoice(type, {
      'Format': 'format',
      'Carrier Name (CNAM)': 'cnam',
      'Portability (MNP)': 'mnp',
      'HLR (Live Status)': 'hlr',
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/lookup/${ lookupType }`,
      method: 'get',
      query: {
        number,
        json: 1,
      },
    })
  }

  /**
   * @operationName Send Voice Call
   * @category Voice
   * @description Places an outbound voice call that reads the supplied text to the recipient using text-to-speech (TTS). Provide the recipient number in international format, the message text, and an optional caller ID. Enable XML mode when the text contains seven.io Voice XML for advanced call flows (menus, pauses, DTMF) instead of plain TTS.
   * @route POST /voice
   * @appearanceColor #00C36A #33D98C
   *
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Recipient number in international format, e.g. 491710000000."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message to read aloud via text-to-speech, or seven.io Voice XML when XML mode is enabled."}
   * @paramDef {"type":"String","label":"Caller ID (From)","name":"from","description":"The number shown to the recipient as the caller ID. Must be a verified number on your account."}
   * @paramDef {"type":"Boolean","label":"XML Mode","name":"xml","uiComponent":{"type":"TOGGLE"},"description":"Interpret the text as seven.io Voice XML rather than plain text-to-speech. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"success":"100","total_price":0.06,"balance":593.934,"id":"88123456","cost":0.06}
   */
  async sendVoiceCall(to, text, from, xml) {
    const logTag = '[sendVoiceCall]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/voice`,
      method: 'post',
      body: clean({
        to,
        text,
        from,
        xml: xml ? 1 : undefined,
        json: 1,
      }),
    })
  }

  /**
   * @operationName Get Account Balance
   * @category Account
   * @description Returns the current credit balance of the seven.io account in the account currency. Use this to check remaining funds before sending messages.
   * @route GET /balance
   *
   * @returns {Object}
   * @sampleResult {"amount":593.994,"currency":"EUR"}
   */
  async getBalance() {
    const logTag = '[getBalance]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/balance`,
      method: 'get',
      query: {
        json: 1,
      },
    })
  }

  /**
   * @operationName Get Pricing
   * @category Account
   * @description Returns the SMS and network pricing for a country. Provide an ISO 3166-1 alpha-2 country code (e.g. DE, US, GB) to get per-message prices and network breakdown. Omit the country to return pricing for all supported countries.
   * @route GET /pricing
   *
   * @paramDef {"type":"String","label":"Country","name":"country","description":"ISO 3166-1 alpha-2 country code, e.g. DE, US, GB. Leave empty to return pricing for all countries."}
   *
   * @returns {Object}
   * @sampleResult {"countCountries":1,"countNetworks":3,"countries":[{"countryCode":"de","countryName":"Germany","countryPrefix":"49","networks":[{"mcc":"262","mncs":["01","06"],"networkName":"Telekom Deutschland","price":0.075,"comment":""}]}]}
   */
  async getPricing(country) {
    const logTag = '[getPricing]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/pricing`,
      method: 'get',
      query: {
        country: country ? country.toLowerCase() : undefined,
        format: 'json',
      },
    })
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Returns the contacts stored in your seven.io account, including their ID, name, mobile number and email. Contacts can be used as recipients in Send SMS by name or group.
   * @route GET /contacts
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"12345","nick":"Jane Doe","mobile":"491710000000","email":"jane@example.com","created":"2026-07-01 09:00:00"}]
   */
  async listContacts() {
    const logTag = '[listContacts]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/contacts`,
      method: 'get',
      query: {
        action: 'read',
        json: 1,
      },
    })
  }

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new contact in your seven.io address book. Provide at least a name; the mobile number and email are optional but recommended so the contact can be used as an SMS recipient. Returns the created contact's ID.
   * @route POST /contacts
   * @appearanceColor #00C36A #33D98C
   *
   * @paramDef {"type":"String","label":"Name","name":"nick","required":true,"description":"Display name for the contact."}
   * @paramDef {"type":"String","label":"Mobile Number","name":"mobile","description":"Mobile number in international format, e.g. 491710000000."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Contact email address."}
   *
   * @returns {Object}
   * @sampleResult {"return":"152522","id":"152522"}
   */
  async createContact(nick, mobile, email) {
    const logTag = '[createContact]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/contacts`,
      method: 'post',
      body: clean({
        action: 'create',
        nick,
        mobile,
        email,
        json: 1,
      }),
    })
  }
}

Flowrunner.ServerCode.addService(SevenService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your seven.io API key, sent as the X-Api-Key header. Get it from your seven.io Dashboard under API key.',
  },
])
