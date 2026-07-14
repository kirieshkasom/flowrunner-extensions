const logger = {
  info: (...args) => console.log('[MSG91] info:', ...args),
  debug: (...args) => console.log('[MSG91] debug:', ...args),
  error: (...args) => console.log('[MSG91] error:', ...args),
  warn: (...args) => console.log('[MSG91] warn:', ...args),
}

const API_BASE_URL = 'https://control.msg91.com/api/v5'

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
 * @integrationName MSG91
 * @integrationIcon /icon.svg
 */
class MSG91Service {
  constructor(config) {
    this.authKey = config.authKey
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'authkey': this.authKey,
          'Content-Type': 'application/json',
          'accept': 'application/json',
        })
        .query(cleanedQuery)

      const response = body !== undefined ? await request.send(body) : await request

      // MSG91 returns { type: 'success' | 'error', message } on most endpoints.
      if (response && response.type === 'error') {
        throw new Error(`MSG91 API error: ${ response.message || 'Unknown error' }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('MSG91 API error:')) {
        throw error
      }

      const message = error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`MSG91 API error: ${ message }`)
    }
  }

  /**
   * @operationName Send SMS
   * @category SMS
   * @description Sends an SMS using an approved MSG91 Flow (template). MSG91 does not send free-form SMS text directly; instead you create a Flow/template in the MSG91 panel, get it approved (mandatory for Indian numbers under TRAI DLT regulations), and reference its template/flow ID here. The Flow body contains placeholder variables (for example ##name## or ##otp##) that you fill per recipient. Each entry in Recipients targets one or more comma-separated mobile numbers (in international format with country code, no + or leading zeros, e.g. 919812345678) plus a key/value map of the template's variable names to their values. Returns the MSG91 request identifier used to track delivery in reports.
   * @route POST /send-sms
   * @paramDef {"type":"String","label":"Template/Flow ID","name":"templateId","required":true,"description":"ID of the approved Flow/template created in the MSG91 panel (Flow section). Required for delivery to Indian numbers under DLT rules."}
   * @paramDef {"type":"Array<Object>","label":"Recipients","name":"recipients","required":true,"description":"List of recipient objects. Each object must contain a 'mobiles' string (one or more comma-separated numbers in international format without + or leading zeros) and additional keys matching the Flow's variable names, e.g. {\"mobiles\":\"919812345678\",\"name\":\"Alex\",\"otp\":\"1234\"}."}
   * @paramDef {"type":"String","label":"Sender ID","name":"sender","description":"Approved sender/header ID (typically 6 alphanumeric characters for India). If omitted, the sender configured on the Flow is used."}
   * @paramDef {"type":"Boolean","label":"Shorten URLs","name":"shortUrl","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, MSG91 shortens URLs contained in the message. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"type":"success","message":"3456abcd1234ef567890"}
   */
  async sendSms(templateId, recipients, sender, shortUrl) {
    const logTag = '[sendSms]'

    const body = clean({
      template_id: templateId,
      sender,
      short_url: shortUrl ? '1' : undefined,
      recipients: Array.isArray(recipients) ? recipients : [recipients],
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/flow`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Send OTP
   * @category OTP
   * @description Sends a one-time password (OTP) to a mobile number using an approved OTP template from the MSG91 panel. If you do not supply an OTP value, MSG91 generates one automatically according to the requested length. The number must be in international format with country code and no + or leading zeros (e.g. 919812345678). You can control the code length, its validity window, and the sender/header ID. Use Verify OTP to validate the code the user enters, and Resend OTP to deliver it again.
   * @route POST /send-otp
   * @paramDef {"type":"String","label":"Mobile Number","name":"mobile","required":true,"description":"Recipient number in international format with country code, no + or leading zeros, e.g. 919812345678."}
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","required":true,"description":"ID of the approved OTP template created in the MSG91 panel."}
   * @paramDef {"type":"String","label":"OTP","name":"otp","description":"Specific OTP value to send. Leave empty to have MSG91 generate one automatically."}
   * @paramDef {"type":"Number","label":"OTP Length","name":"otpLength","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of digits in an auto-generated OTP (typically 4-6). Ignored when an explicit OTP is supplied."}
   * @paramDef {"type":"Number","label":"OTP Expiry (minutes)","name":"otpExpiry","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How long the OTP remains valid, in minutes. MSG91 default applies when omitted."}
   * @paramDef {"type":"String","label":"Sender ID","name":"sender","description":"Approved sender/header ID used for the OTP message. Optional when set on the template."}
   * @returns {Object}
   * @sampleResult {"type":"success","message":"3456abcd1234ef567890"}
   */
  async sendOtp(mobile, templateId, otp, otpLength, otpExpiry, sender) {
    const logTag = '[sendOtp]'

    const query = clean({
      template_id: templateId,
      mobile,
      otp,
      otp_length: otpLength,
      otp_expiry: otpExpiry,
      sender,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/otp`,
      method: 'post',
      query,
      body: {},
    })
  }

  /**
   * @operationName Verify OTP
   * @category OTP
   * @description Validates the OTP a user entered against the code MSG91 sent to their mobile number. Returns a success response when the code matches and is still within its validity window; otherwise an error is returned (for example when the code is wrong, already used, or expired). Both the mobile number and the OTP are required, and the number must match the one used in Send OTP (international format with country code, no + or leading zeros).
   * @route GET /verify-otp
   * @paramDef {"type":"String","label":"Mobile Number","name":"mobile","required":true,"description":"The number the OTP was sent to, in international format with country code, no + or leading zeros, e.g. 919812345678."}
   * @paramDef {"type":"String","label":"OTP","name":"otp","required":true,"description":"The one-time password entered by the user."}
   * @returns {Object}
   * @sampleResult {"type":"success","message":"OTP verified success"}
   */
  async verifyOtp(mobile, otp) {
    const logTag = '[verifyOtp]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/otp/verify`,
      method: 'get',
      query: {
        mobile,
        otp,
      },
    })
  }

  /**
   * @operationName Resend OTP
   * @category OTP
   * @description Re-sends the most recent OTP to a mobile number, either as a text message or as a voice call. Use this when the user did not receive the original code. The mobile number must match the one used in Send OTP (international format with country code, no + or leading zeros). Choose the delivery channel with Retry Type.
   * @route GET /resend-otp
   * @paramDef {"type":"String","label":"Mobile Number","name":"mobile","required":true,"description":"The number to resend the OTP to, in international format with country code, no + or leading zeros, e.g. 919812345678."}
   * @paramDef {"type":"String","label":"Retry Type","name":"retryType","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Voice"]}},"description":"Delivery channel for the resent OTP. Text sends an SMS; Voice places a voice call. Defaults to Text."}
   * @returns {Object}
   * @sampleResult {"type":"success","message":"OTP sent successfully"}
   */
  async resendOtp(mobile, retryType) {
    const logTag = '[resendOtp]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/otp/retry`,
      method: 'get',
      query: {
        mobile,
        retrytype: this.#resolveChoice(retryType, { Text: 'text', Voice: 'voice' }) || 'text',
      },
    })
  }

  /**
   * @operationName Send WhatsApp Message
   * @category WhatsApp
   * @description Sends a WhatsApp message from your MSG91-integrated WhatsApp Business number using an approved WhatsApp template. WhatsApp Business requires pre-approved templates for business-initiated conversations; create and get the template approved in the MSG91 WhatsApp panel first. Provide your integrated WhatsApp number, the recipient number (international format with country code), the template name and its language code, and the ordered list of body-component values that fill the template's placeholders. Returns the MSG91 acceptance response for the outbound message.
   * @route POST /send-whatsapp-message
   * @paramDef {"type":"String","label":"Integrated Number","name":"integratedNumber","required":true,"description":"Your MSG91-integrated WhatsApp Business number (with country code, no +), e.g. 919812345678."}
   * @paramDef {"type":"String","label":"Recipient Number","name":"recipient","required":true,"description":"Destination WhatsApp number in international format with country code, no + or leading zeros."}
   * @paramDef {"type":"String","label":"Template Name","name":"templateName","required":true,"description":"Name of the approved WhatsApp template in your MSG91 WhatsApp panel."}
   * @paramDef {"type":"String","label":"Language Code","name":"languageCode","description":"Template language/locale code, e.g. en, en_US, hi. Defaults to en."}
   * @paramDef {"type":"Array<String>","label":"Body Parameters","name":"bodyParameters","description":"Ordered values that fill the template body placeholders ({{1}}, {{2}}, ...). Leave empty for templates with no variables."}
   * @returns {Object}
   * @sampleResult {"type":"success","message":"messages queued","data":{"messageId":"wamid.HBgLOTE5OD..."}}
   */
  async sendWhatsappMessage(integratedNumber, recipient, templateName, languageCode, bodyParameters) {
    const logTag = '[sendWhatsappMessage]'

    const components = Array.isArray(bodyParameters) && bodyParameters.length > 0
      ? [
        {
          type: 'body',
          parameters: bodyParameters.map(text => ({ type: 'text', text: String(text) })),
        },
      ]
      : []

    const body = {
      integrated_number: integratedNumber,
      content_type: 'template',
      payload: {
        to: recipient,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: languageCode || 'en',
            policy: 'deterministic',
          },
          components,
        },
      },
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/whatsapp/whatsapp-outbound-message/bulk/`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Send Email
   * @category Email
   * @description Sends a transactional email through MSG91 Email using an approved email template. Emails are sent from a verified sending domain configured in your MSG91 Email panel. Provide the recipient's email address (and optional display name), the from address and its verified domain, the template's slug/ID, and a key/value map of variables that populate the template. Returns the MSG91 acceptance response.
   * @route POST /send-email
   * @paramDef {"type":"String","label":"To Email","name":"toEmail","required":true,"description":"Recipient email address."}
   * @paramDef {"type":"String","label":"From Email","name":"fromEmail","required":true,"description":"Sender email address on your verified MSG91 domain, e.g. no-reply@mail.yourdomain.com."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"Verified sending domain configured in the MSG91 Email panel, e.g. mail.yourdomain.com."}
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","required":true,"description":"Slug/ID of the approved email template in the MSG91 Email panel."}
   * @paramDef {"type":"String","label":"To Name","name":"toName","description":"Optional display name for the recipient."}
   * @paramDef {"type":"Object","label":"Variables","name":"variables","description":"Key/value map of template variable names to their values, e.g. {\"name\":\"Alex\",\"link\":\"https://...\"}. Leave empty for templates with no variables."}
   * @returns {Object}
   * @sampleResult {"type":"success","message":"Mail sent successfully","data":{"unique_id":"abc123"}}
   */
  async sendEmail(toEmail, fromEmail, domain, templateId, toName, variables) {
    const logTag = '[sendEmail]'

    const recipient = clean({
      to: [clean({ email: toEmail, name: toName })],
      variables: variables && Object.keys(variables).length > 0 ? variables : undefined,
    })

    const body = clean({
      recipients: [recipient],
      from: clean({ email: fromEmail }),
      domain,
      template_id: templateId,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/email/send`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Balance
   * @category Account
   * @description Retrieves the remaining balance on your MSG91 account for a given product type (for example SMS, WhatsApp, or Email). Balances are tracked per product, so specify which product's balance to return. Useful for monitoring credits and triggering low-balance alerts.
   * @route GET /get-balance
   * @paramDef {"type":"String","label":"Product Type","name":"productType","uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","WhatsApp","Email","Voice"]}},"description":"Product whose balance to retrieve. Defaults to SMS."}
   * @returns {Object}
   * @sampleResult {"type":"success","data":{"balance":1250.5}}
   */
  async getBalance(productType) {
    const logTag = '[getBalance]'

    const type = this.#resolveChoice(productType, {
      SMS: 'sms',
      WhatsApp: 'wa',
      Email: 'email',
      Voice: 'voice',
    }) || 'sms'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/report/balances/${ type }`,
      method: 'get',
    })
  }
}

Flowrunner.ServerCode.addService(MSG91Service, [
  {
    name: 'authKey',
    displayName: 'Auth Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your MSG91 Auth Key, sent as the authkey header. Find it in the MSG91 panel under Settings → API → Auth Key.',
  },
])
