const logger = {
  info: (...args) => console.log('[Dropcontact] info:', ...args),
  debug: (...args) => console.log('[Dropcontact] debug:', ...args),
  error: (...args) => console.log('[Dropcontact] error:', ...args),
  warn: (...args) => console.log('[Dropcontact] warn:', ...args),
}

const API_BASE_URL = 'https://api.dropcontact.com'

// Enrich (submit) and result (poll) endpoints. The modern API uses /v1/enrich/all;
// the legacy /batch path is retired.
const ENRICH_PATH = `${ API_BASE_URL }/v1/enrich/all`

const DEFAULT_LANGUAGE = 'en'

// Bounded polling for the convenience "Enrich and Wait" operation. Total wait is
// kept well under the declared execution timeout so the platform never kills it mid-poll.
const POLL_INTERVAL_MS = 8000
const MAX_POLL_ATTEMPTS = 11

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * @integrationName Dropcontact
 * @integrationIcon /icon.png
 */
class DropcontactService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'X-Access-Token': this.apiKey,
          'Content-Type': 'application/json',
        })

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error ||
        error.body?.reason ||
        error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`Dropcontact API error: ${ message }`)
    }
  }

  // Normalizes a single-contact convenience object into a Dropcontact contact record,
  // dropping empty fields so only meaningful data is submitted.
  #buildContact({ email, firstName, lastName, fullName, company, website, phone, numSiren, linkedin }) {
    return clean({
      email,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      company,
      website,
      phone,
      num_siren: numSiren,
      linkedin,
    })
  }

  /**
   * @operationName Enrich Contacts (Batch)
   * @category Enrichment
   * @description Submits one or more contacts to Dropcontact for enrichment (verified professional email finding plus company data, GDPR/EU-focused). This call is asynchronous: it queues the batch and immediately returns a request_id — it does NOT return enriched data. Poll "Get Enrichment Result" with that request_id until success is true and data is present. Provide either the single-contact convenience fields (at least an email, or first/last name + company, or a LinkedIn URL) OR a full Contacts array for batch enrichment (up to 250 records). If a non-empty Contacts array is supplied it takes precedence over the single-contact fields. Enable SIREN to also retrieve French legal/company data (SIREN, NAF code, VAT, registered address).
   * @route POST /enrich
   * @appearanceColor #4B41E8 #7A72F0
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Single-contact convenience: the contact email to enrich. Ignored when a Contacts array is provided."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Single-contact convenience: contact first name. Combine with last name and company when no email is known."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Single-contact convenience: contact last name. Combine with first name and company when no email is known."}
   * @paramDef {"type":"String","label":"Full Name","name":"fullName","description":"Single-contact convenience: full name, used with company as an alternative to first/last name."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Single-contact convenience: company name. Required for name-based lookups; improves match quality."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"Single-contact convenience: company website or domain to help identify the organization."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Single-contact convenience: known phone number for the contact."}
   * @paramDef {"type":"String","label":"SIREN Number","name":"numSiren","description":"Single-contact convenience: French SIREN number of the company, if known."}
   * @paramDef {"type":"String","label":"LinkedIn URL","name":"linkedin","description":"Single-contact convenience: contact LinkedIn profile URL. Sufficient on its own to attempt enrichment."}
   * @paramDef {"type":"Array<Object>","label":"Contacts","name":"contacts","description":"Batch mode: array of contact objects to enrich (up to 250). Each object may include email, first_name, last_name, full_name, company, website, phone, num_siren, and linkedin. When provided, this overrides the single-contact fields above."}
   * @paramDef {"type":"Boolean","label":"Fetch SIREN Data","name":"siren","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, also retrieves French legal/company data (SIREN, NAF code, VAT, registered address). Defaults to false."}
   * @paramDef {"type":"String","label":"Language","name":"language","uiComponent":{"type":"DROPDOWN","options":{"values":["en","fr"]}},"description":"Language for returned company descriptions and labels. Defaults to en."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"error":false,"request_id":"5f7b3b3e2b9d4a0012a3c4d5","credits_left":950}
   */
  async enrichContacts(email, firstName, lastName, fullName, company, website, phone, numSiren, linkedin, contacts, siren, language) {
    const logTag = '[enrichContacts]'

    const data = Array.isArray(contacts) && contacts.length > 0
      ? contacts
      : [this.#buildContact({ email, firstName, lastName, fullName, company, website, phone, numSiren, linkedin })]

    if (data.length === 1 && Object.keys(data[0]).length === 0) {
      throw new Error('Dropcontact API error: provide at least an email, a first/last name with company, or a LinkedIn URL (or a non-empty Contacts array).')
    }

    return await this.#apiRequest({
      logTag,
      url: ENRICH_PATH,
      method: 'post',
      body: clean({
        data,
        siren: siren === true ? true : undefined,
        language: language || DEFAULT_LANGUAGE,
      }),
    })
  }

  /**
   * @operationName Get Enrichment Result
   * @category Enrichment
   * @description Retrieves the result of a previously submitted enrichment batch using its request_id. Because enrichment is asynchronous, this may return success:false with a reason like "Request not ready yet" while processing is in progress — in that case wait a few seconds and call again. Poll pattern: call Enrich Contacts (Batch) to get a request_id, then poll this operation until success is true and the data array is populated. When ready, data contains one enriched record per submitted contact (email with qualification, phone, company, and optional SIREN/legal fields).
   * @route GET /result
   * @appearanceColor #4B41E8 #7A72F0
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"The request_id returned by Enrich Contacts (Batch)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"error":false,"data":[{"first_name":"Jean","last_name":"Dupont","full_name":"Jean Dupont","email":[{"email":"jean.dupont@acme.fr","qualification":"nominative@pro"}],"phone":"+33123456789","company":"Acme","website":"acme.fr","linkedin":"https://www.linkedin.com/in/jeandupont","siren":"123456789","vat":"FR12345678900","job":"Head of Sales"}]}
   */
  async getEnrichmentResult(requestId) {
    const logTag = '[getEnrichmentResult]'

    if (!requestId) {
      throw new Error('Dropcontact API error: requestId is required.')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ ENRICH_PATH }/${ encodeURIComponent(requestId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Enrich and Wait
   * @category Enrichment
   * @description Convenience operation that submits a contact for enrichment and then polls internally for the result, so callers get the enriched data back in a single step without managing the request_id themselves. Polling is bounded (roughly 90 seconds) to stay within the execution timeout. If the result is ready in time it returns status "completed" with the enriched data; if Dropcontact is still processing when polling ends it returns status "pending" together with the request_id so you can retry later with Get Enrichment Result. Accepts the same single-contact convenience fields as Enrich Contacts (Batch), or a full Contacts array.
   * @route POST /enrich-and-wait
   * @appearanceColor #4B41E8 #7A72F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Single-contact convenience: the contact email to enrich. Ignored when a Contacts array is provided."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Single-contact convenience: contact first name. Combine with last name and company when no email is known."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Single-contact convenience: contact last name. Combine with first name and company when no email is known."}
   * @paramDef {"type":"String","label":"Full Name","name":"fullName","description":"Single-contact convenience: full name, used with company as an alternative to first/last name."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Single-contact convenience: company name. Required for name-based lookups; improves match quality."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"Single-contact convenience: company website or domain to help identify the organization."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Single-contact convenience: known phone number for the contact."}
   * @paramDef {"type":"String","label":"SIREN Number","name":"numSiren","description":"Single-contact convenience: French SIREN number of the company, if known."}
   * @paramDef {"type":"String","label":"LinkedIn URL","name":"linkedin","description":"Single-contact convenience: contact LinkedIn profile URL. Sufficient on its own to attempt enrichment."}
   * @paramDef {"type":"Array<Object>","label":"Contacts","name":"contacts","description":"Batch mode: array of contact objects to enrich (up to 250). Each object may include email, first_name, last_name, full_name, company, website, phone, num_siren, and linkedin. When provided, this overrides the single-contact fields above."}
   * @paramDef {"type":"Boolean","label":"Fetch SIREN Data","name":"siren","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, also retrieves French legal/company data (SIREN, NAF code, VAT, registered address). Defaults to false."}
   * @paramDef {"type":"String","label":"Language","name":"language","uiComponent":{"type":"DROPDOWN","options":{"values":["en","fr"]}},"description":"Language for returned company descriptions and labels. Defaults to en."}
   *
   * @returns {Object}
   * @sampleResult {"status":"completed","request_id":"5f7b3b3e2b9d4a0012a3c4d5","credits_left":950,"data":[{"first_name":"Jean","last_name":"Dupont","email":[{"email":"jean.dupont@acme.fr","qualification":"nominative@pro"}],"company":"Acme","siren":"123456789"}]}
   */
  async enrichAndWait(email, firstName, lastName, fullName, company, website, phone, numSiren, linkedin, contacts, siren, language) {
    const logTag = '[enrichAndWait]'

    const submission = await this.enrichContacts(
      email, firstName, lastName, fullName, company, website, phone, numSiren, linkedin, contacts, siren, language
    )

    const requestId = submission?.request_id

    if (!requestId) {
      throw new Error('Dropcontact API error: submission did not return a request_id.')
    }

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS)

      const result = await this.getEnrichmentResult(requestId)

      if (result?.success === true && Array.isArray(result.data)) {
        return {
          status: 'completed',
          request_id: requestId,
          credits_left: submission.credits_left,
          data: result.data,
        }
      }

      logger.debug(`${ logTag } - not ready (attempt ${ attempt + 1 }/${ MAX_POLL_ATTEMPTS }): ${ result?.reason || 'processing' }`)
    }

    return {
      status: 'pending',
      request_id: requestId,
      credits_left: submission.credits_left,
      reason: 'Enrichment still processing. Retry later with Get Enrichment Result using this request_id.',
    }
  }
}

Flowrunner.ServerCode.addService(DropcontactService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Dropcontact API key (sent as the X-Access-Token header). Get it from Dropcontact → Account → API → your API key.',
  },
])
