const logger = {
  info: (...args) => console.log('[Tapfiliate] info:', ...args),
  debug: (...args) => console.log('[Tapfiliate] debug:', ...args),
  error: (...args) => console.log('[Tapfiliate] error:', ...args),
  warn: (...args) => console.log('[Tapfiliate] warn:', ...args),
}

const API_BASE_URL = 'https://api.tapfiliate.com/1.6'

const DEFAULT_PAGE_SIZE = 25

/**
 * Remove undefined/null/empty-string entries so we never send blank optional fields.
 */
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
 * @integrationName Tapfiliate
 * @integrationIcon /icon.png
 */
class TapfiliateService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  /**
   * Single private request helper. Tapfiliate authenticates via the X-Api-Key header
   * and reports failures as { errors: [{ message, ... }] } or { message }.
   */
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const body = error.body
      let message = error.message

      if (body) {
        if (Array.isArray(body.errors) && body.errors.length) {
          message = body.errors.map(e => e.message || JSON.stringify(e)).join('; ')
        } else if (body.message) {
          message = body.message
        }
      }

      const status = error.status || error.statusCode
      logger.error(`${ logTag } - failed (${ status || 'n/a' }): ${ message }`)

      throw new Error(`Tapfiliate API error: ${ message }`)
    }
  }

  /**
   * Maps a friendly dropdown label to the API value, passing through unknown values.
   */
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ---------------------------------------------------------------------------
  // Affiliates
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Affiliate
   * @category Affiliates
   * @description Creates a new affiliate account. Requires firstname, lastname and email. Optionally set a password (otherwise the affiliate receives an activation email), a company object (name, description, address), and additional profile fields. Returns the created affiliate including its generated id and referral code.
   * @route POST /affiliates
   * @appearanceColor #4A90D9 #6FB0EE
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstname","required":true,"description":"Affiliate's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","required":true,"description":"Affiliate's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Affiliate's email address. Must be unique within the account."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"Optional password for the affiliate account. If omitted, Tapfiliate sends an activation email so the affiliate can set their own."}
   * @paramDef {"type":"Object","label":"Company","name":"company","description":"Optional company details, e.g. {\"name\":\"Acme Inc\",\"description\":\"...\",\"address\":{\"address\":\"1 Main St\",\"country\":{\"code\":\"US\"}}}."}
   *
   * @returns {Object}
   * @sampleResult {"id":"john-doe","firstname":"John","lastname":"Doe","email":"john@example.com","referral_link":{"link":"https://example.com/?ref=john-doe"},"created_at":"2026-07-14T10:00:00","approved":false}
   */
  async createAffiliate(firstname, lastname, email, password, company) {
    const logTag = '[createAffiliate]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/affiliates/`,
      method: 'post',
      body: clean({
        firstname,
        lastname,
        email,
        password,
        company,
      }),
    })
  }

  /**
   * @operationName Get Affiliate
   * @category Affiliates
   * @description Retrieves a single affiliate by its id, including profile details, referral link, company, meta data and approval status.
   * @route GET /affiliates/{id}
   * @appearanceColor #4A90D9 #6FB0EE
   *
   * @paramDef {"type":"String","label":"Affiliate ID","name":"affiliateId","required":true,"description":"The unique id of the affiliate to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"john-doe","firstname":"John","lastname":"Doe","email":"john@example.com","approved":true,"referral_link":{"link":"https://example.com/?ref=john-doe"},"created_at":"2026-07-14T10:00:00"}
   */
  async getAffiliate(affiliateId) {
    const logTag = '[getAffiliate]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/affiliates/${ encodeURIComponent(affiliateId) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName List Affiliates
   * @category Affiliates
   * @description Lists affiliates in the account, optionally filtered by click id, source id or referral code. Results are paginated (25 per page by default); use the page parameter to fetch subsequent pages.
   * @route GET /affiliates
   * @appearanceColor #4A90D9 #6FB0EE
   *
   * @paramDef {"type":"String","label":"Click ID","name":"clickId","description":"Filter affiliates by the click id associated with them."}
   * @paramDef {"type":"String","label":"Source ID","name":"sourceId","description":"Filter affiliates by source id."}
   * @paramDef {"type":"String","label":"Referral Code","name":"referralCode","description":"Filter affiliates by referral code."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of results to return (starts at 1)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"john-doe","firstname":"John","lastname":"Doe","email":"john@example.com","approved":true}]
   */
  async listAffiliates(clickId, sourceId, referralCode, page) {
    const logTag = '[listAffiliates]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/affiliates/`,
      method: 'get',
      query: {
        click_id: clickId,
        source_id: sourceId,
        referral_code: referralCode,
        page,
      },
    })
  }

  /**
   * @operationName Update Affiliate
   * @category Affiliates
   * @description Updates an existing affiliate's profile fields such as first name, last name, email, password or company object. Only the fields you provide are changed. Returns the updated affiliate.
   * @route PUT /affiliates/{id}
   * @appearanceColor #4A90D9 #6FB0EE
   *
   * @paramDef {"type":"String","label":"Affiliate ID","name":"affiliateId","required":true,"description":"The id of the affiliate to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstname","description":"New first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","description":"New last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"New account password."}
   * @paramDef {"type":"Object","label":"Company","name":"company","description":"Updated company object, e.g. {\"name\":\"Acme Inc\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":"john-doe","firstname":"Jonathan","lastname":"Doe","email":"jonathan@example.com","approved":true}
   */
  async updateAffiliate(affiliateId, firstname, lastname, email, password, company) {
    const logTag = '[updateAffiliate]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/affiliates/${ encodeURIComponent(affiliateId) }/`,
      method: 'put',
      body: clean({
        firstname,
        lastname,
        email,
        password,
        company,
      }),
    })
  }

  /**
   * @operationName Delete Affiliate
   * @category Affiliates
   * @description Permanently deletes an affiliate by id. This removes the affiliate from the account; use with care as it cannot be undone.
   * @route DELETE /affiliates/{id}
   * @appearanceColor #4A90D9 #6FB0EE
   *
   * @paramDef {"type":"String","label":"Affiliate ID","name":"affiliateId","required":true,"description":"The id of the affiliate to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"john-doe"}
   */
  async deleteAffiliate(affiliateId) {
    const logTag = '[deleteAffiliate]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/affiliates/${ encodeURIComponent(affiliateId) }/`,
      method: 'delete',
    })

    return { success: true, id: affiliateId }
  }

  /**
   * @operationName Approve Affiliate
   * @category Affiliates
   * @description Approves an affiliate's participation in a specific program. Approval is per program, so provide both the program id and the affiliate id. Returns the updated program affiliation.
   * @route PUT /programs/{program_id}/affiliates/{affiliate_id}/approval
   * @appearanceColor #4A90D9 #6FB0EE
   *
   * @paramDef {"type":"String","label":"Program ID","name":"programId","required":true,"dictionary":"getProgramsDictionary","description":"The program the affiliate belongs to. Approval is per program."}
   * @paramDef {"type":"String","label":"Affiliate ID","name":"affiliateId","required":true,"description":"The id of the affiliate to approve in this program."}
   *
   * @returns {Object}
   * @sampleResult {"approved":true,"affiliate":{"id":"john-doe"},"program":{"id":"my-program"}}
   */
  async approveAffiliate(programId, affiliateId) {
    const logTag = '[approveAffiliate]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/programs/${ encodeURIComponent(programId) }/affiliates/${ encodeURIComponent(affiliateId) }/approval/`,
      method: 'put',
      body: {},
    })
  }

  /**
   * @operationName Disapprove Affiliate
   * @category Affiliates
   * @description Disapproves (revokes approval for) an affiliate in a specific program. Approval is per program, so provide both the program id and the affiliate id.
   * @route DELETE /programs/{program_id}/affiliates/{affiliate_id}/approval
   * @appearanceColor #4A90D9 #6FB0EE
   *
   * @paramDef {"type":"String","label":"Program ID","name":"programId","required":true,"dictionary":"getProgramsDictionary","description":"The program the affiliate belongs to."}
   * @paramDef {"type":"String","label":"Affiliate ID","name":"affiliateId","required":true,"description":"The id of the affiliate to disapprove in this program."}
   *
   * @returns {Object}
   * @sampleResult {"approved":false,"affiliate":{"id":"john-doe"},"program":{"id":"my-program"}}
   */
  async disapproveAffiliate(programId, affiliateId) {
    const logTag = '[disapproveAffiliate]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/programs/${ encodeURIComponent(programId) }/affiliates/${ encodeURIComponent(affiliateId) }/approval/`,
      method: 'delete',
    })

    return { approved: false, affiliate: { id: affiliateId }, program: { id: programId } }
  }

  // ---------------------------------------------------------------------------
  // Programs
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Programs
   * @category Programs
   * @description Lists all affiliate programs configured in the account, including their id, title, currency and commission structure. Results are paginated.
   * @route GET /programs
   * @appearanceColor #7B61FF #A794FF
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of results to return (starts at 1)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"my-program","title":"My Program","currency":"USD","affiliates_count":42}]
   */
  async listPrograms(page) {
    const logTag = '[listPrograms]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/programs/`,
      method: 'get',
      query: { page },
    })
  }

  /**
   * @operationName Get Program
   * @category Programs
   * @description Retrieves a single affiliate program by its id, including title, currency, commission settings and asset details.
   * @route GET /programs/{id}
   * @appearanceColor #7B61FF #A794FF
   *
   * @paramDef {"type":"String","label":"Program ID","name":"programId","required":true,"dictionary":"getProgramsDictionary","description":"The id of the program to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"my-program","title":"My Program","currency":"USD","affiliates_count":42,"commission_type":"percentage"}
   */
  async getProgram(programId) {
    const logTag = '[getProgram]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/programs/${ encodeURIComponent(programId) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Add Affiliate to Program
   * @category Programs
   * @description Adds an existing affiliate to a program. Identify the affiliate by id or email, and optionally set whether they are approved immediately and assign a coupon. Returns the created program affiliation.
   * @route POST /programs/{program_id}/affiliates
   * @appearanceColor #7B61FF #A794FF
   *
   * @paramDef {"type":"String","label":"Program ID","name":"programId","required":true,"dictionary":"getProgramsDictionary","description":"The program to add the affiliate to."}
   * @paramDef {"type":"String","label":"Affiliate ID","name":"affiliateId","description":"The id of the affiliate to add. Provide either this or the affiliate email."}
   * @paramDef {"type":"String","label":"Affiliate Email","name":"affiliateEmail","description":"The email of the affiliate to add. Used when the affiliate id is not provided."}
   * @paramDef {"type":"Boolean","label":"Approved","name":"approved","uiComponent":{"type":"TOGGLE"},"description":"Whether the affiliate is approved in this program immediately."}
   * @paramDef {"type":"String","label":"Coupon","name":"coupon","description":"Optional coupon code to assign to the affiliate within this program."}
   *
   * @returns {Object}
   * @sampleResult {"approved":true,"affiliate":{"id":"john-doe","email":"john@example.com"},"program":{"id":"my-program"}}
   */
  async addAffiliateToProgram(programId, affiliateId, affiliateEmail, approved, coupon) {
    const logTag = '[addAffiliateToProgram]'

    const affiliate = clean({ id: affiliateId, email: affiliateEmail })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/programs/${ encodeURIComponent(programId) }/affiliates/`,
      method: 'post',
      body: clean({
        affiliate,
        approved,
        coupon,
      }),
    })
  }

  /**
   * @operationName List Program Affiliates
   * @category Programs
   * @description Lists the affiliates enrolled in a specific program, optionally filtered by approval status. Results are paginated.
   * @route GET /programs/{program_id}/affiliates
   * @appearanceColor #7B61FF #A794FF
   *
   * @paramDef {"type":"String","label":"Program ID","name":"programId","required":true,"dictionary":"getProgramsDictionary","description":"The program whose affiliates to list."}
   * @paramDef {"type":"String","label":"Approval Status","name":"approvalStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Approved","Not Approved"]}},"description":"Filter by approval status within the program. Leave empty to return all."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of results to return (starts at 1)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"approved":true,"affiliate":{"id":"john-doe","email":"john@example.com"}}]
   */
  async listProgramAffiliates(programId, approvalStatus, page) {
    const logTag = '[listProgramAffiliates]'

    const approved = this.#resolveChoice(approvalStatus, { 'Approved': 'true', 'Not Approved': 'false' })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/programs/${ encodeURIComponent(programId) }/affiliates/`,
      method: 'get',
      query: {
        approved,
        page,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Conversions
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Conversion
   * @category Conversions
   * @description Records a conversion (sale or lead) and its commissions. Attribute it with at least one tracking identifier: click id, referral code, customer id or coupon. You may pass an external_id (your order id), an amount for automatic commission calculation, an explicit program group, a manual commissions array, and arbitrary meta_data. Returns the created conversion with generated commissions.
   * @route POST /conversions
   * @appearanceColor #E8590C #F08A4B
   *
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"Your own identifier for this conversion (e.g. order id). Used to prevent duplicate conversions."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sale amount used to auto-calculate commissions when no explicit commissions are provided."}
   * @paramDef {"type":"String","label":"Program Group","name":"programGroup","dictionary":"getProgramsDictionary","description":"The program group (program id) to attribute the conversion to. Optional when it can be inferred from the tracking identifier."}
   * @paramDef {"type":"String","label":"Click ID","name":"clickId","description":"The click id captured on the landing page to attribute this conversion."}
   * @paramDef {"type":"String","label":"Referral Code","name":"referralCode","description":"Referral code used to attribute this conversion to an affiliate."}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","description":"The customer id to attribute this conversion to (recurring/customer-based attribution)."}
   * @paramDef {"type":"String","label":"Coupon","name":"coupon","description":"Coupon code used to attribute this conversion."}
   * @paramDef {"type":"Array<Object>","name":"commissions","label":"Commissions","description":"Optional array of explicit commission objects, e.g. [{\"amount\":10,\"comment\":\"Sale\"}]. Overrides automatic calculation."}
   * @paramDef {"type":"Object","name":"metaData","label":"Meta Data","description":"Optional arbitrary key/value data to store with the conversion, e.g. {\"plan\":\"pro\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"external_id":"order-987","amount":100,"commissions":[{"id":54321,"amount":10,"approved":false}],"created_at":"2026-07-14T10:00:00"}
   */
  async createConversion(externalId, amount, programGroup, clickId, referralCode, customerId, coupon, commissions, metaData) {
    const logTag = '[createConversion]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/conversions/`,
      method: 'post',
      body: clean({
        external_id: externalId,
        amount,
        program_group: programGroup,
        click_id: clickId,
        referral_code: referralCode,
        customer_id: customerId,
        coupon,
        commissions,
        meta_data: metaData,
      }),
    })
  }

  /**
   * @operationName Get Conversion
   * @category Conversions
   * @description Retrieves a single conversion by its id, including its amount, attributed affiliate, commissions and meta data.
   * @route GET /conversions/{id}
   * @appearanceColor #E8590C #F08A4B
   *
   * @paramDef {"type":"String","label":"Conversion ID","name":"conversionId","required":true,"description":"The id of the conversion to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"external_id":"order-987","amount":100,"commissions":[{"id":54321,"amount":10,"approved":false}]}
   */
  async getConversion(conversionId) {
    const logTag = '[getConversion]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/conversions/${ encodeURIComponent(conversionId) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName List Conversions
   * @category Conversions
   * @description Lists conversions in the account, optionally filtered by program, affiliate, external id, or a created date range. Results are paginated.
   * @route GET /conversions
   * @appearanceColor #E8590C #F08A4B
   *
   * @paramDef {"type":"String","label":"Program ID","name":"programId","dictionary":"getProgramsDictionary","description":"Filter conversions by program."}
   * @paramDef {"type":"String","label":"Affiliate ID","name":"affiliateId","description":"Filter conversions by the attributed affiliate id."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"Filter conversions by your own external identifier."}
   * @paramDef {"type":"String","label":"Created After","name":"dateFrom","uiComponent":{"type":"DATE_PICKER"},"description":"Return conversions created on or after this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Created Before","name":"dateTo","uiComponent":{"type":"DATE_PICKER"},"description":"Return conversions created on or before this date (YYYY-MM-DD)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of results to return (starts at 1)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":12345,"external_id":"order-987","amount":100,"affiliate":{"id":"john-doe"}}]
   */
  async listConversions(programId, affiliateId, externalId, dateFrom, dateTo, page) {
    const logTag = '[listConversions]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/conversions/`,
      method: 'get',
      query: {
        program_id: programId,
        affiliate_id: affiliateId,
        external_id: externalId,
        date_from: dateFrom,
        date_to: dateTo,
        page,
      },
    })
  }

  /**
   * @operationName Add Commission to Conversion
   * @category Conversions
   * @description Adds an additional commission to an existing conversion. Provide the conversion id and the conversion sub-amount the commission is calculated from, with an optional comment and commission type. Returns the created commission.
   * @route POST /conversions/{id}/commissions
   * @appearanceColor #E8590C #F08A4B
   *
   * @paramDef {"type":"String","label":"Conversion ID","name":"conversionId","required":true,"description":"The id of the conversion to add a commission to."}
   * @paramDef {"type":"Number","label":"Conversion Sub-Amount","name":"conversionSubAmount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The portion of the conversion amount this commission is calculated from."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","description":"Optional note describing the commission."}
   * @paramDef {"type":"String","label":"Commission Type","name":"commissionType","description":"Optional commission type identifier (matches a commission type configured on the program)."}
   *
   * @returns {Object}
   * @sampleResult {"id":54322,"amount":5,"comment":"Bonus","approved":false}
   */
  async addCommissionToConversion(conversionId, conversionSubAmount, comment, commissionType) {
    const logTag = '[addCommissionToConversion]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/conversions/${ encodeURIComponent(conversionId) }/commissions/`,
      method: 'post',
      body: clean({
        conversion_sub_amount: conversionSubAmount,
        comment,
        commission_type: commissionType,
      }),
    })
  }

  // ---------------------------------------------------------------------------
  // Commissions
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Commissions
   * @category Commissions
   * @description Lists commissions in the account, optionally filtered by payout status (pending, approved, disapproved or paid), affiliate, or conversion. Results are paginated.
   * @route GET /commissions
   * @appearanceColor #2B8A3E #51C46A
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Pending","Approved"]}},"description":"Filter commissions by approval status. Pending returns commissions awaiting approval; Approved returns approved ones. Leave empty to return all."}
   * @paramDef {"type":"String","label":"Affiliate ID","name":"affiliateId","description":"Filter commissions by the affiliate that earned them."}
   * @paramDef {"type":"String","label":"Conversion ID","name":"conversionId","description":"Filter commissions belonging to a specific conversion."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of results to return (starts at 1)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":54321,"amount":10,"approved":false,"affiliate":{"id":"john-doe"}}]
   */
  async listCommissions(status, affiliateId, conversionId, page) {
    const logTag = '[listCommissions]'

    // Tapfiliate filters commissions by a `pending` boolean: pending=true (awaiting
    // approval) vs pending=false (approved).
    const pending = this.#resolveChoice(status, {
      'Pending': 'true',
      'Approved': 'false',
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/commissions/`,
      method: 'get',
      query: {
        pending,
        affiliate_id: affiliateId,
        conversion_id: conversionId,
        page,
      },
    })
  }

  /**
   * @operationName Get Commission
   * @category Commissions
   * @description Retrieves a single commission by its id, including its amount, approval status, affiliate and parent conversion.
   * @route GET /commissions/{id}
   * @appearanceColor #2B8A3E #51C46A
   *
   * @paramDef {"type":"String","label":"Commission ID","name":"commissionId","required":true,"description":"The id of the commission to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":54321,"amount":10,"approved":false,"affiliate":{"id":"john-doe"},"conversion_id":12345}
   */
  async getCommission(commissionId) {
    const logTag = '[getCommission]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/commissions/${ encodeURIComponent(commissionId) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Approve Commission
   * @category Commissions
   * @description Approves a pending commission by id, making it eligible for payout. Returns the updated commission.
   * @route PUT /commissions/{id}/approval
   * @appearanceColor #2B8A3E #51C46A
   *
   * @paramDef {"type":"String","label":"Commission ID","name":"commissionId","required":true,"description":"The id of the commission to approve."}
   *
   * @returns {Object}
   * @sampleResult {"id":54321,"amount":10,"approved":true}
   */
  async approveCommission(commissionId) {
    const logTag = '[approveCommission]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/commissions/${ encodeURIComponent(commissionId) }/approval/`,
      method: 'put',
      body: {},
    })
  }

  /**
   * @operationName Disapprove Commission
   * @category Commissions
   * @description Disapproves a commission by id, removing it from the payable balance. Returns the updated commission.
   * @route DELETE /commissions/{id}/approval
   * @appearanceColor #2B8A3E #51C46A
   *
   * @paramDef {"type":"String","label":"Commission ID","name":"commissionId","required":true,"description":"The id of the commission to disapprove."}
   *
   * @returns {Object}
   * @sampleResult {"id":54321,"amount":10,"approved":false}
   */
  async disapproveCommission(commissionId) {
    const logTag = '[disapproveCommission]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/commissions/${ encodeURIComponent(commissionId) }/approval/`,
      method: 'delete',
    })

    return { id: commissionId, approved: false }
  }

  // ---------------------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a customer record and attributes it to an affiliate for customer-based (recurring) tracking. Attribute with a click id or referral code, and provide the customer id and optional name. Returns the created customer.
   * @route POST /customers
   * @appearanceColor #A61E4D #D6558B
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"description":"Your unique identifier for the customer."}
   * @paramDef {"type":"String","label":"Click ID","name":"clickId","description":"The click id used to attribute this customer to an affiliate. Provide this or a referral code."}
   * @paramDef {"type":"String","label":"Referral Code","name":"referralCode","description":"The referral code used to attribute this customer to an affiliate."}
   * @paramDef {"type":"String","label":"Coupon","name":"coupon","description":"Optional coupon code used to attribute this customer to an affiliate."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"Optional initial lifecycle status for the customer."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cust-123","status":"new","affiliate":{"id":"john-doe"},"created_at":"2026-07-14T10:00:00"}
   */
  async createCustomer(customerId, clickId, referralCode, coupon, status) {
    const logTag = '[createCustomer]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/customers/`,
      method: 'post',
      body: clean({
        customer_id: customerId,
        click_id: clickId,
        referral_code: referralCode,
        coupon,
        status,
      }),
    })
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves a single customer by its id, including the attributed affiliate and status.
   * @route GET /customers/{id}
   * @appearanceColor #A61E4D #D6558B
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"description":"The id of the customer to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cust-123","status":"active","affiliate":{"id":"john-doe"}}
   */
  async getCustomer(customerId) {
    const logTag = '[getCustomer]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/customers/${ encodeURIComponent(customerId) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName List Customers
   * @category Customers
   * @description Lists customers in the account, optionally filtered by the attributed affiliate, program, or a created date range. Results are paginated.
   * @route GET /customers
   * @appearanceColor #A61E4D #D6558B
   *
   * @paramDef {"type":"String","label":"Affiliate ID","name":"affiliateId","description":"Filter customers by the affiliate they are attributed to."}
   * @paramDef {"type":"String","label":"Program ID","name":"programId","dictionary":"getProgramsDictionary","description":"Filter customers by program."}
   * @paramDef {"type":"String","label":"Created After","name":"dateFrom","uiComponent":{"type":"DATE_PICKER"},"description":"Return customers created on or after this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Created Before","name":"dateTo","uiComponent":{"type":"DATE_PICKER"},"description":"Return customers created on or before this date (YYYY-MM-DD)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of results to return (starts at 1)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"cust-123","status":"active","affiliate":{"id":"john-doe"}}]
   */
  async listCustomers(affiliateId, programId, dateFrom, dateTo, page) {
    const logTag = '[listCustomers]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/customers/`,
      method: 'get',
      query: {
        affiliate_id: affiliateId,
        program_id: programId,
        date_from: dateFrom,
        date_to: dateTo,
        page,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getProgramsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter programs by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) used to fetch subsequent pages of programs."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Programs Dictionary
   * @description Provides a searchable list of affiliate programs for selecting a program id in other operations. The option value is the program id.
   * @route POST /get-programs-dictionary
   * @paramDef {"type":"getProgramsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing programs."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Program","value":"my-program","note":"USD"}],"cursor":"2"}
   */
  async getProgramsDictionary(payload) {
    const logTag = '[getProgramsDictionary]'
    const { search, cursor } = payload || {}

    const page = cursor ? Number(cursor) : 1

    const programs = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/programs/`,
      method: 'get',
      query: { page },
    })

    const list = Array.isArray(programs) ? programs : []

    const filtered = search
      ? list.filter(p => (p.title || '').toLowerCase().includes(search.toLowerCase()))
      : list

    const items = filtered.map(program => ({
      label: program.title || program.id,
      value: program.id,
      note: program.currency || undefined,
    }))

    const nextCursor = list.length >= DEFAULT_PAGE_SIZE ? String(page + 1) : undefined

    return { items, cursor: nextCursor }
  }
}

Flowrunner.ServerCode.addService(TapfiliateService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Tapfiliate API key, sent as the X-Api-Key header. Find it in Tapfiliate under Settings -> API -> your API key.',
  },
])
