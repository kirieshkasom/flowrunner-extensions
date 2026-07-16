const API_BASE_URL = 'https://rest.messagebird.com'
const PAGE_SIZE_DICTIONARY = 50

const logger = {
  info: (...args) => console.log('[MessageBird] info:', ...args),
  debug: (...args) => console.log('[MessageBird] debug:', ...args),
  error: (...args) => console.log('[MessageBird] error:', ...args),
  warn: (...args) => console.log('[MessageBird] warn:', ...args),
}

/**
 * Normalizes a recipients value into an array of phone numbers.
 * Accepts an array or a comma-separated string.
 */
function toRecipientsArray(recipients) {
  if (Array.isArray(recipients)) {
    return recipients.map(item => String(item).trim()).filter(Boolean)
  }

  if (typeof recipients === 'string') {
    return recipients.split(',').map(item => item.trim()).filter(Boolean)
  }

  return []
}

/**
 * Removes properties that are undefined, null, or empty-string so they are not
 * sent to the API (MessageBird rejects some empty values).
 */
function cleanupObject(object) {
  if (!object || typeof object !== 'object') {
    return object
  }

  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '')
  )
}

/**
 * @integrationName MessageBird
 * @integrationIcon /icon.png
 */
class MessageBirdService {
  /**
   * @typedef {Object} getGroupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter groups by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  constructor(config) {
    this.accessKey = config.accessKey
  }

  #getHeaders() {
    return {
      'Authorization': `AccessKey ${ this.accessKey }`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    method = method.toLowerCase()
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method](url).set(this.#getHeaders()).query(query || {})

      return body !== undefined ? await request.send(cleanupObject(body)) : await request
    } catch (error) {
      const apiErrors = error.body?.errors
      const message = Array.isArray(apiErrors) && apiErrors.length
        ? apiErrors.map(item => {
          const parameter = item.parameter ? ` (parameter: ${ item.parameter })` : ''

          return `[${ item.code }] ${ item.description }${ parameter }`
        }).join('; ')
        : (error.body?.message || error.message)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`MessageBird API error: ${ message }`)
    }
  }

  /**
   * @operationName Send SMS
   * @category Messaging
   * @appearanceColor #2481D7 #4FA3E8
   * @description Sends an SMS or binary message to one or more recipients through the MessageBird (Bird) platform. Supports an alphanumeric sender name or phone number originator, a message reference for tracking, and scheduled delivery. The response includes per-recipient delivery status. Note: alphanumeric originators are not supported in all countries and cannot receive replies.
   * @route POST /send-sms
   * @paramDef {"type":"String","label":"Originator","name":"originator","required":true,"description":"The sender of the message. This can be a telephone number (including country code, e.g. +31612345678) or an alphanumeric name up to 11 characters (e.g. MyCompany)."}
   * @paramDef {"type":"Array<String>","label":"Recipients","name":"recipients","required":true,"description":"The recipient phone numbers in international format including country code (e.g. +31612345678). Accepts multiple numbers."}
   * @paramDef {"type":"String","label":"Message Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the message. For type 'binary' this should be a hex-encoded string."}
   * @paramDef {"type":"String","label":"Type","name":"type","defaultValue":"Text","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Binary"]}},"description":"The type of message. Use 'Text' for standard SMS or 'Binary' for hex-encoded binary payloads."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"An optional client reference for identifying the message in delivery reports and webhooks."}
   * @paramDef {"type":"String","label":"Scheduled Date/Time","name":"scheduledDatetime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional scheduled send time in RFC3339 format (e.g. 2024-05-01T14:00:00+00:00). If omitted, the message is sent immediately."}
   * @returns {Object}
   * @sampleResult {"id":"e8077d803532c0b5937c639b60216938","href":"https://rest.messagebird.com/messages/e8077d803532c0b5937c639b60216938","direction":"mt","type":"sms","originator":"MyCompany","body":"Hello!","reference":null,"createdDatetime":"2024-05-01T13:00:00+00:00","recipients":{"totalCount":1,"totalSentCount":1,"items":[{"recipient":31612345678,"status":"sent","statusDatetime":"2024-05-01T13:00:00+00:00"}]}}
   */
  async sendSms(originator, recipients, body, type, reference, scheduledDatetime) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/messages`,
      method: 'post',
      body: {
        originator,
        recipients: toRecipientsArray(recipients),
        body,
        type: this.#resolveChoice(type, { Text: 'text', Binary: 'binary' }),
        reference,
        scheduledDatetime,
      },
      logTag: 'sendSms',
    })
  }

  /**
   * @operationName Get Message
   * @category Messaging
   * @appearanceColor #2481D7 #4FA3E8
   * @description Retrieves a single SMS message by its unique identifier, including its current per-recipient delivery status, originator, body, and timestamps.
   * @route GET /get-message
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The unique identifier of the message to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"e8077d803532c0b5937c639b60216938","href":"https://rest.messagebird.com/messages/e8077d803532c0b5937c639b60216938","direction":"mt","type":"sms","originator":"MyCompany","body":"Hello!","createdDatetime":"2024-05-01T13:00:00+00:00","recipients":{"totalCount":1,"totalDeliveredCount":1,"items":[{"recipient":31612345678,"status":"delivered","statusDatetime":"2024-05-01T13:00:05+00:00"}]}}
   */
  async getMessage(messageId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/messages/${ encodeURIComponent(messageId) }`,
      logTag: 'getMessage',
    })
  }

  /**
   * @operationName List Messages
   * @category Messaging
   * @appearanceColor #2481D7 #4FA3E8
   * @description Retrieves a paginated list of previously sent and received messages. Use the limit and offset parameters to page through results.
   * @route GET /list-messages
   * @paramDef {"type":"Number","label":"Limit","name":"limit","defaultValue":20,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages to return per page (default 20, maximum 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of messages to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"offset":0,"limit":20,"count":1,"totalCount":1,"items":[{"id":"e8077d803532c0b5937c639b60216938","direction":"mt","type":"sms","originator":"MyCompany","body":"Hello!","createdDatetime":"2024-05-01T13:00:00+00:00"}]}
   */
  async listMessages(limit, offset) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/messages`,
      query: { limit, offset },
      logTag: 'listMessages',
    })
  }

  /**
   * @operationName Send Voice Message
   * @category Voice
   * @appearanceColor #2481D7 #4FA3E8
   * @description Sends a text-to-speech voice message (voice call) to one or more recipients. The body text is read aloud in the selected language and voice. Answering-machine behavior is configurable via the 'If Machine' setting.
   * @route POST /send-voice-message
   * @paramDef {"type":"Array<String>","label":"Recipients","name":"recipients","required":true,"description":"The recipient phone numbers in international format including country code (e.g. +31612345678). Accepts multiple numbers."}
   * @paramDef {"type":"String","label":"Message Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text that will be converted to speech and read to the recipient."}
   * @paramDef {"type":"String","label":"Language","name":"language","defaultValue":"English (UK)","uiComponent":{"type":"DROPDOWN","options":{"values":["English (UK)","English (US)","English (Australia)","English (India)","French (France)","French (Canada)","German","Spanish (Spain)","Spanish (Mexico)","Italian","Dutch","Portuguese (Brazil)","Portuguese (Portugal)","Polish","Russian","Japanese","Korean","Chinese (Mandarin)","Turkish"]}},"description":"The language and locale used for text-to-speech synthesis."}
   * @paramDef {"type":"String","label":"Voice","name":"voice","defaultValue":"Female","uiComponent":{"type":"DROPDOWN","options":{"values":["Female","Male"]}},"description":"The voice gender used for text-to-speech synthesis."}
   * @paramDef {"type":"String","label":"If Machine","name":"ifMachine","defaultValue":"Delay","uiComponent":{"type":"DROPDOWN","options":{"values":["Delay","Continue","Hang Up"]}},"description":"Behavior when an answering machine is detected: 'Continue' plays immediately, 'Delay' waits for the beep, 'Hang Up' ends the call."}
   * @returns {Object}
   * @sampleResult {"id":"14fe1a2e8f0b40a5a12f8b6e0e2d1a3c","href":"https://rest.messagebird.com/voicemessages/14fe1a2e8f0b40a5a12f8b6e0e2d1a3c","body":"Your appointment is confirmed.","language":"en-gb","voice":"female","repeat":1,"ifMachine":"delay","createdDatetime":"2024-05-01T13:00:00+00:00","recipients":{"totalCount":1,"totalSentCount":1,"items":[{"recipient":31612345678,"status":"calling","statusDatetime":"2024-05-01T13:00:00+00:00"}]}}
   */
  async sendVoiceMessage(recipients, body, language, voice, ifMachine) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/voicemessages`,
      method: 'post',
      body: {
        recipients: toRecipientsArray(recipients),
        body,
        language: this.#resolveChoice(language, {
          'English (UK)': 'en-gb',
          'English (US)': 'en-us',
          'English (Australia)': 'en-au',
          'English (India)': 'en-in',
          'French (France)': 'fr-fr',
          'French (Canada)': 'fr-ca',
          'German': 'de-de',
          'Spanish (Spain)': 'es-es',
          'Spanish (Mexico)': 'es-mx',
          'Italian': 'it-it',
          'Dutch': 'nl-nl',
          'Portuguese (Brazil)': 'pt-br',
          'Portuguese (Portugal)': 'pt-pt',
          'Polish': 'pl-pl',
          'Russian': 'ru-ru',
          'Japanese': 'ja-jp',
          'Korean': 'ko-kr',
          'Chinese (Mandarin)': 'zh-cn',
          'Turkish': 'tr-tr',
        }),
        voice: this.#resolveChoice(voice, { Female: 'female', Male: 'male' }),
        ifMachine: this.#resolveChoice(ifMachine, { Delay: 'delay', Continue: 'continue', 'Hang Up': 'hangup' }),
      },
      logTag: 'sendVoiceMessage',
    })
  }

  /**
   * @operationName Send Verification
   * @category Verify
   * @appearanceColor #2481D7 #4FA3E8
   * @description Sends a one-time password (OTP) to a recipient to verify ownership of a phone number. The code can be delivered via SMS, spoken via text-to-speech, or sent as a flash call. Use the returned verification ID with 'Verify Token' to confirm the code entered by the user.
   * @route POST /send-verification
   * @paramDef {"type":"String","label":"Recipient","name":"recipient","required":true,"description":"The phone number to verify, in international format including country code (e.g. +31612345678)."}
   * @paramDef {"type":"String","label":"Originator","name":"originator","description":"The sender name or number shown to the recipient. Defaults to 'Code' when omitted."}
   * @paramDef {"type":"String","label":"Type","name":"type","defaultValue":"SMS","uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","Text-to-Speech","Flash"]}},"description":"The delivery channel for the verification code."}
   * @paramDef {"type":"String","label":"Template","name":"template","description":"Optional message template containing the %token placeholder where the generated code is inserted (e.g. 'Your code is %token'). Required for SMS if you want custom wording."}
   * @returns {Object}
   * @sampleResult {"id":"75a9d21c2f9f4b0c9d0e2f5a1b3c4d5e","href":"https://rest.messagebird.com/verify/75a9d21c2f9f4b0c9d0e2f5a1b3c4d5e","recipient":31612345678,"reference":null,"messages":{"href":"https://rest.messagebird.com/messages/abc"},"status":"sent","createdDatetime":"2024-05-01T13:00:00+00:00","validUntilDatetime":"2024-05-01T13:00:30+00:00"}
   */
  async sendVerification(recipient, originator, type, template) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/verify`,
      method: 'post',
      body: {
        recipient,
        originator,
        type: this.#resolveChoice(type, { SMS: 'sms', 'Text-to-Speech': 'tts', Flash: 'flash' }),
        template,
      },
      logTag: 'sendVerification',
    })
  }

  /**
   * @operationName Verify Token
   * @category Verify
   * @appearanceColor #2481D7 #4FA3E8
   * @description Verifies the one-time password (OTP) entered by a user against a previously created verification. Returns a 'verified' status on success or an error if the token is incorrect or expired.
   * @route GET /verify-token
   * @paramDef {"type":"String","label":"Verification ID","name":"verificationId","required":true,"description":"The unique identifier returned by Send Verification."}
   * @paramDef {"type":"String","label":"Token","name":"token","required":true,"description":"The one-time password entered by the user."}
   * @returns {Object}
   * @sampleResult {"id":"75a9d21c2f9f4b0c9d0e2f5a1b3c4d5e","href":"https://rest.messagebird.com/verify/75a9d21c2f9f4b0c9d0e2f5a1b3c4d5e","recipient":31612345678,"status":"verified","createdDatetime":"2024-05-01T13:00:00+00:00","validUntilDatetime":"2024-05-01T13:00:30+00:00"}
   */
  async verifyToken(verificationId, token) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/verify/${ encodeURIComponent(verificationId) }`,
      query: { token },
      logTag: 'verifyToken',
    })
  }

  /**
   * @operationName Get Verification
   * @category Verify
   * @appearanceColor #2481D7 #4FA3E8
   * @description Retrieves the status and details of an existing verification request by its identifier without submitting a token.
   * @route GET /get-verification
   * @paramDef {"type":"String","label":"Verification ID","name":"verificationId","required":true,"description":"The unique identifier of the verification to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"75a9d21c2f9f4b0c9d0e2f5a1b3c4d5e","href":"https://rest.messagebird.com/verify/75a9d21c2f9f4b0c9d0e2f5a1b3c4d5e","recipient":31612345678,"status":"sent","createdDatetime":"2024-05-01T13:00:00+00:00","validUntilDatetime":"2024-05-01T13:00:30+00:00"}
   */
  async getVerification(verificationId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/verify/${ encodeURIComponent(verificationId) }`,
      logTag: 'getVerification',
    })
  }

  /**
   * @operationName Delete Verification
   * @category Verify
   * @appearanceColor #2481D7 #4FA3E8
   * @description Deletes (cancels) an existing verification request so that its token can no longer be used. Returns an empty response on success.
   * @route DELETE /delete-verification
   * @paramDef {"type":"String","label":"Verification ID","name":"verificationId","required":true,"description":"The unique identifier of the verification to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteVerification(verificationId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/verify/${ encodeURIComponent(verificationId) }`,
      method: 'delete',
      logTag: 'deleteVerification',
    })

    return { success: true }
  }

  /**
   * @operationName Phone Number Lookup
   * @category Lookup
   * @appearanceColor #2481D7 #4FA3E8
   * @description Validates a phone number and returns metadata including the number type, country code, and multiple formatted representations (E.164, international, national, RFC3966). Use this to check number validity before sending.
   * @route GET /phone-number-lookup
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","required":true,"description":"The phone number to look up. Provide in international format (e.g. +31612345678), or a national number together with a Country Code."}
   * @paramDef {"type":"String","label":"Country Code","name":"countryCode","description":"Optional ISO 3166-1 alpha-2 country code (e.g. NL, US) used to interpret national-format numbers."}
   * @returns {Object}
   * @sampleResult {"href":"https://rest.messagebird.com/lookup/31612345678","countryCode":"NL","countryPrefix":31,"phoneNumber":31612345678,"type":"mobile","formats":{"e164":"+31612345678","international":"+31 6 12345678","national":"06 12345678","rfc3966":"tel:+31-6-12345678"}}
   */
  async phoneNumberLookup(phoneNumber, countryCode) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/lookup/${ encodeURIComponent(phoneNumber) }`,
      query: { countryCode },
      logTag: 'phoneNumberLookup',
    })
  }

  /**
   * @operationName Lookup HLR
   * @category Lookup
   * @appearanceColor #2481D7 #4FA3E8
   * @description Performs a Home Location Register (HLR) lookup on a phone number to retrieve live network status, current carrier, and whether the number is reachable or ported. HLR lookups may incur a charge on your account.
   * @route GET /lookup-hlr
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","required":true,"description":"The phone number to query, in international format (e.g. +31612345678) or national format with a Country Code."}
   * @paramDef {"type":"String","label":"Country Code","name":"countryCode","description":"Optional ISO 3166-1 alpha-2 country code (e.g. NL, US) used to interpret national-format numbers."}
   * @returns {Object}
   * @sampleResult {"id":"9e2f4b1c8d0a4f5b9c3e1d2a5b6c7d8e","href":"https://rest.messagebird.com/lookup/31612345678/hlr","msisdn":31612345678,"network":20416,"reference":null,"status":"active","details":{"status_desc":"delivered","imsi":"204080000000000","country_iso":"NLD","operator":"KPN"},"createdDatetime":"2024-05-01T13:00:00+00:00"}
   */
  async lookupHlr(phoneNumber, countryCode) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/lookup/${ encodeURIComponent(phoneNumber) }/hlr`,
      query: { countryCode },
      logTag: 'lookupHlr',
    })
  }

  /**
   * @operationName Create Contact
   * @category Contacts
   * @appearanceColor #2481D7 #4FA3E8
   * @description Creates a new contact in your MessageBird (Bird) address book. Contacts store a phone number (msisdn), optional first and last name, and up to four custom fields for storing additional metadata.
   * @route POST /create-contact
   * @paramDef {"type":"String","label":"Phone Number (MSISDN)","name":"msisdn","required":true,"description":"The contact's phone number in international format including country code (e.g. +31612345678)."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The contact's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The contact's last name."}
   * @paramDef {"type":"String","label":"Custom 1","name":"custom1","description":"Optional custom field value for storing additional metadata."}
   * @paramDef {"type":"String","label":"Custom 2","name":"custom2","description":"Optional custom field value for storing additional metadata."}
   * @paramDef {"type":"String","label":"Custom 3","name":"custom3","description":"Optional custom field value for storing additional metadata."}
   * @paramDef {"type":"String","label":"Custom 4","name":"custom4","description":"Optional custom field value for storing additional metadata."}
   * @returns {Object}
   * @sampleResult {"id":"3fc86f2b1d0e4a7c9b1f2e3d4c5b6a7e","href":"https://rest.messagebird.com/contacts/3fc86f2b1d0e4a7c9b1f2e3d4c5b6a7e","msisdn":31612345678,"firstName":"Jane","lastName":"Doe","customDetails":{"custom1":"VIP"},"createdDatetime":"2024-05-01T13:00:00+00:00","updatedDatetime":"2024-05-01T13:00:00+00:00"}
   */
  async createContact(msisdn, firstName, lastName, custom1, custom2, custom3, custom4) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/contacts`,
      method: 'post',
      body: { msisdn, firstName, lastName, custom1, custom2, custom3, custom4 },
      logTag: 'createContact',
    })
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @appearanceColor #2481D7 #4FA3E8
   * @description Retrieves a single contact by its unique identifier, including phone number, name, custom fields, and the groups the contact belongs to.
   * @route GET /get-contact
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The unique identifier of the contact to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"3fc86f2b1d0e4a7c9b1f2e3d4c5b6a7e","href":"https://rest.messagebird.com/contacts/3fc86f2b1d0e4a7c9b1f2e3d4c5b6a7e","msisdn":31612345678,"firstName":"Jane","lastName":"Doe","customDetails":{"custom1":"VIP"},"groups":{"totalCount":1,"href":"https://rest.messagebird.com/contacts/3fc86f2b1d0e4a7c9b1f2e3d4c5b6a7e/groups"},"createdDatetime":"2024-05-01T13:00:00+00:00"}
   */
  async getContact(contactId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }`,
      logTag: 'getContact',
    })
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @appearanceColor #2481D7 #4FA3E8
   * @description Retrieves a paginated list of contacts from your address book. Use the limit and offset parameters to page through results.
   * @route GET /list-contacts
   * @paramDef {"type":"Number","label":"Limit","name":"limit","defaultValue":20,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of contacts to return per page (default 20, maximum 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of contacts to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"offset":0,"limit":20,"count":1,"totalCount":1,"items":[{"id":"3fc86f2b1d0e4a7c9b1f2e3d4c5b6a7e","msisdn":31612345678,"firstName":"Jane","lastName":"Doe"}]}
   */
  async listContacts(limit, offset) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/contacts`,
      query: { limit, offset },
      logTag: 'listContacts',
    })
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @appearanceColor #2481D7 #4FA3E8
   * @description Updates an existing contact's phone number, name, or custom fields. Only the fields you provide are changed; omitted fields are left untouched.
   * @route PATCH /update-contact
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The unique identifier of the contact to update."}
   * @paramDef {"type":"String","label":"Phone Number (MSISDN)","name":"msisdn","description":"The updated phone number in international format including country code (e.g. +31612345678)."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The updated first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The updated last name."}
   * @paramDef {"type":"String","label":"Custom 1","name":"custom1","description":"Updated custom field value."}
   * @paramDef {"type":"String","label":"Custom 2","name":"custom2","description":"Updated custom field value."}
   * @paramDef {"type":"String","label":"Custom 3","name":"custom3","description":"Updated custom field value."}
   * @paramDef {"type":"String","label":"Custom 4","name":"custom4","description":"Updated custom field value."}
   * @returns {Object}
   * @sampleResult {"id":"3fc86f2b1d0e4a7c9b1f2e3d4c5b6a7e","href":"https://rest.messagebird.com/contacts/3fc86f2b1d0e4a7c9b1f2e3d4c5b6a7e","msisdn":31612345678,"firstName":"Jane","lastName":"Smith","customDetails":{"custom1":"VIP"},"updatedDatetime":"2024-05-01T14:00:00+00:00"}
   */
  async updateContact(contactId, msisdn, firstName, lastName, custom1, custom2, custom3, custom4) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }`,
      method: 'patch',
      body: { msisdn, firstName, lastName, custom1, custom2, custom3, custom4 },
      logTag: 'updateContact',
    })
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @appearanceColor #2481D7 #4FA3E8
   * @description Permanently deletes a contact from your address book by its unique identifier. Returns an empty response on success.
   * @route DELETE /delete-contact
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The unique identifier of the contact to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteContact(contactId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }`,
      method: 'delete',
      logTag: 'deleteContact',
    })

    return { success: true }
  }

  /**
   * @operationName List Groups
   * @category Groups
   * @appearanceColor #2481D7 #4FA3E8
   * @description Retrieves a paginated list of contact groups from your account. Groups let you organize contacts and send messages to many recipients at once.
   * @route GET /list-groups
   * @paramDef {"type":"Number","label":"Limit","name":"limit","defaultValue":20,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of groups to return per page (default 20, maximum 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of groups to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"offset":0,"limit":20,"count":1,"totalCount":1,"items":[{"id":"2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d","href":"https://rest.messagebird.com/groups/2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d","name":"Newsletter","contacts":{"totalCount":42},"createdDatetime":"2024-05-01T13:00:00+00:00"}]}
   */
  async listGroups(limit, offset) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups`,
      query: { limit, offset },
      logTag: 'listGroups',
    })
  }

  /**
   * @operationName Add Contact to Group
   * @category Groups
   * @appearanceColor #2481D7 #4FA3E8
   * @description Adds one or more existing contacts to a contact group. Contacts must already exist in your address book; pass their contact identifiers. Returns an empty response on success.
   * @route PUT /add-contact-to-group
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The group to add contacts to."}
   * @paramDef {"type":"Array<String>","label":"Contact IDs","name":"contactIds","required":true,"description":"The unique identifiers of the contacts to add to the group. Accepts multiple contact IDs."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async addContactToGroup(groupId, contactIds) {
    const ids = toRecipientsArray(contactIds)
    const queryString = ids.map(id => `ids[]=${ encodeURIComponent(id) }`).join('&')

    await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupId) }/contacts?${ queryString }`,
      method: 'put',
      logTag: 'addContactToGroup',
    })

    return { success: true }
  }

  /**
   * @operationName Remove Contact from Group
   * @category Groups
   * @appearanceColor #2481D7 #4FA3E8
   * @description Removes a single contact from a contact group. The contact itself is not deleted from your address book. Returns an empty response on success.
   * @route DELETE /remove-contact-from-group
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The group to remove the contact from."}
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The unique identifier of the contact to remove from the group."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async removeContactFromGroup(groupId, contactId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupId) }/contacts/${ encodeURIComponent(contactId) }`,
      method: 'delete',
      logTag: 'removeContactFromGroup',
    })

    return { success: true }
  }

  /**
   * @operationName Get Balance
   * @category Account
   * @appearanceColor #2481D7 #4FA3E8
   * @description Retrieves the current balance of your MessageBird (Bird) account, including the amount, payment type (prepaid or postpaid), and currency.
   * @route GET /get-balance
   * @returns {Object}
   * @sampleResult {"payment":"prepaid","type":"credits","amount":87.5}
   */
  async getBalance() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/balance`,
      logTag: 'getBalance',
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Groups Dictionary
   * @description Provides a searchable list of contact groups for dynamic parameter selection.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering groups."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter","value":"2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d","note":"42 contacts"}],"cursor":"50"}
   */
  async getGroupsDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = cursor ? Number(cursor) : 0

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/groups`,
      query: { limit: PAGE_SIZE_DICTIONARY, offset },
      logTag: 'getGroupsDictionary',
    })

    const groups = response.items || []
    const filteredGroups = search
      ? groups.filter(group => String(group.name || '').toLowerCase().includes(search.toLowerCase()))
      : groups

    const nextOffset = offset + PAGE_SIZE_DICTIONARY
    const hasMore = typeof response.totalCount === 'number' && nextOffset < response.totalCount

    return {
      cursor: hasMore ? String(nextOffset) : null,
      items: filteredGroups.map(group => ({
        label: group.name,
        value: group.id,
        note: `${ group.contacts?.totalCount ?? 0 } contacts`,
      })),
    }
  }
}

Flowrunner.ServerCode.addService(MessageBirdService, [
  {
    name: 'accessKey',
    displayName: 'Access Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your MessageBird/Bird API access key. Find it in the Bird Dashboard under Developers → API access → a Live access key.',
  },
])
