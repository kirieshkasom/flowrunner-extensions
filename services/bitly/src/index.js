const logger = {
  info: (...args) => console.log('[Bitly] info:', ...args),
  debug: (...args) => console.log('[Bitly] debug:', ...args),
  error: (...args) => console.log('[Bitly] error:', ...args),
  warn: (...args) => console.log('[Bitly] warn:', ...args),
}

const API_BASE_URL = 'https://api-ssl.bitly.com/v4'

const DEFAULT_DOMAIN = 'bit.ly'

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
 * @usesFileStorage
 * @integrationName Bitly
 * @integrationIcon /icon.svg
 */
class BitlyService {
  constructor(config) {
    this.accessToken = config.accessToken
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const errorBody = error.body || {}
      const detailParts = [errorBody.message, errorBody.description].filter(Boolean)

      if (Array.isArray(errorBody.errors) && errorBody.errors.length) {
        const fieldErrors = errorBody.errors
          .map(fieldError => {
            const field = fieldError.field || fieldError.resource
            const reason = fieldError.error_code || fieldError.message

            return [field, reason].filter(Boolean).join(': ')
          })
          .filter(Boolean)
          .join(', ')

        if (fieldErrors) {
          detailParts.push(`(${ fieldErrors })`)
        }
      }

      const message = detailParts.join(' - ') || error.message || 'Unknown error'

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Bitly API error: ${ message }`)
    }
  }

  // Bitlinks are addressed by their id (e.g. "bit.ly/abc123"), which contains a
  // slash and must be URL-encoded when placed in the request path.
  #encodeBitlink(bitlink) {
    if (!bitlink) {
      throw new Error('Bitly API error: A bitlink (e.g. bit.ly/abc123) is required.')
    }

    // Strip any protocol the user may have pasted, Bitly expects "domain/hash".
    const normalized = bitlink.replace(/^https?:\/\//i, '').replace(/\/$/, '')

    return encodeURIComponent(normalized)
  }

  /**
   * @operationName Shorten Link
   * @category Links
   * @description Shortens a long URL into a Bitlink in a single call. This is the fastest way to create a short link: provide a long URL and optionally a branded domain and group. Returns the created Bitlink id (e.g. bit.ly/abc123) and its full short link. If the same long URL was already shortened in the group, Bitly returns the existing Bitlink.
   * @route POST /shorten
   * @appearanceColor #EE6123 #F58A5A
   * @paramDef {"type":"String","label":"Long URL","name":"longUrl","required":true,"description":"The destination URL to shorten. Must include the scheme, e.g. https://example.com/page."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"Branded short domain to use. Defaults to bit.ly. Only domains available to your account are accepted."}
   * @paramDef {"type":"String","label":"Group","name":"groupGuid","dictionary":"getGroupsDictionary","description":"The group (BSD) to create the Bitlink in. Defaults to your account's default group when omitted."}
   * @returns {Object}
   * @sampleResult {"id":"bit.ly/3xY4zAb","link":"https://bit.ly/3xY4zAb","long_url":"https://example.com/page","created_at":"2026-07-13T10:00:00+0000"}
   */
  async shortenLink(longUrl, domain, groupGuid) {
    return await this.#apiRequest({
      logTag: '[shortenLink]',
      url: `${ API_BASE_URL }/shorten`,
      method: 'post',
      body: clean({
        long_url: longUrl,
        domain: domain || DEFAULT_DOMAIN,
        group_guid: groupGuid,
      }),
    })
  }

  /**
   * @operationName Create Bitlink
   * @category Links
   * @description Creates a fully configured Bitlink from a long URL. Unlike Shorten Link, this supports a title, tags, and mobile deep links so you can organize and route the link at creation time. Returns the complete Bitlink object including its id and short link.
   * @route POST /bitlinks
   * @appearanceColor #EE6123 #F58A5A
   * @paramDef {"type":"String","label":"Long URL","name":"longUrl","required":true,"description":"The destination URL to shorten. Must include the scheme, e.g. https://example.com/page."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"A human-friendly title for the Bitlink, shown in the Bitly dashboard."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to organize the Bitlink. Provide one or more tag strings."}
   * @paramDef {"type":"Array<Object>","label":"Deep Links","name":"deeplinks","description":"Optional mobile deep link rules. Each item is an object such as {\"app_uri_path\":\"/store\",\"install_type\":\"promote_install\",\"install_url\":\"https://...\",\"app_id\":\"com.example\"}."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"Branded short domain to use. Defaults to bit.ly."}
   * @paramDef {"type":"String","label":"Group","name":"groupGuid","dictionary":"getGroupsDictionary","description":"The group (BSD) to create the Bitlink in. Defaults to your account's default group when omitted."}
   * @returns {Object}
   * @sampleResult {"id":"bit.ly/3xY4zAb","link":"https://bit.ly/3xY4zAb","long_url":"https://example.com/page","title":"Launch page","tags":["launch"],"created_at":"2026-07-13T10:00:00+0000"}
   */
  async createBitlink(longUrl, title, tags, deeplinks, domain, groupGuid) {
    return await this.#apiRequest({
      logTag: '[createBitlink]',
      url: `${ API_BASE_URL }/bitlinks`,
      method: 'post',
      body: clean({
        long_url: longUrl,
        title,
        tags: Array.isArray(tags) && tags.length ? tags : undefined,
        deeplinks: Array.isArray(deeplinks) && deeplinks.length ? deeplinks : undefined,
        domain: domain || DEFAULT_DOMAIN,
        group_guid: groupGuid,
      }),
    })
  }

  /**
   * @operationName Get Bitlink
   * @category Links
   * @description Retrieves the full details of an existing Bitlink, including its long URL, title, tags, archived state, and creation time. Provide the Bitlink id in the form "bit.ly/abc123" (the protocol is optional and stripped automatically).
   * @route GET /get-bitlink
   * @appearanceColor #EE6123 #F58A5A
   * @paramDef {"type":"String","label":"Bitlink","name":"bitlink","required":true,"description":"The Bitlink id to look up, e.g. bit.ly/abc123. A full https:// URL is also accepted."}
   * @returns {Object}
   * @sampleResult {"id":"bit.ly/3xY4zAb","link":"https://bit.ly/3xY4zAb","long_url":"https://example.com/page","title":"Launch page","tags":["launch"],"archived":false,"created_at":"2026-07-13T10:00:00+0000"}
   */
  async getBitlink(bitlink) {
    return await this.#apiRequest({
      logTag: '[getBitlink]',
      url: `${ API_BASE_URL }/bitlinks/${ this.#encodeBitlink(bitlink) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Bitlink
   * @category Links
   * @description Updates an existing Bitlink's title, tags, and/or archived state. Only the fields you provide are changed; leave a field blank to keep its current value. Supplying tags replaces the full tag list on the Bitlink.
   * @route PATCH /update-bitlink
   * @appearanceColor #EE6123 #F58A5A
   * @paramDef {"type":"String","label":"Bitlink","name":"bitlink","required":true,"description":"The Bitlink id to update, e.g. bit.ly/abc123."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title for the Bitlink. Leave blank to keep the current title."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Replacement tag list. Supplying this overwrites all existing tags. Leave blank to keep current tags."}
   * @paramDef {"type":"Boolean","label":"Archived","name":"archived","uiComponent":{"type":"TOGGLE"},"description":"Set to true to archive the Bitlink or false to un-archive it. Leave blank to keep the current state."}
   * @returns {Object}
   * @sampleResult {"id":"bit.ly/3xY4zAb","link":"https://bit.ly/3xY4zAb","long_url":"https://example.com/page","title":"Updated title","tags":["launch","promo"],"archived":false}
   */
  async updateBitlink(bitlink, title, tags, archived) {
    return await this.#apiRequest({
      logTag: '[updateBitlink]',
      url: `${ API_BASE_URL }/bitlinks/${ this.#encodeBitlink(bitlink) }`,
      method: 'patch',
      body: clean({
        title,
        tags: Array.isArray(tags) ? tags : undefined,
        archived: typeof archived === 'boolean' ? archived : undefined,
      }),
    })
  }

  /**
   * @operationName Expand Bitlink
   * @category Links
   * @description Expands a Bitlink back to its original long URL without requiring group scopes. Provide the Bitlink id (e.g. bit.ly/abc123) and receive the destination long URL and creation time.
   * @route POST /expand
   * @appearanceColor #EE6123 #F58A5A
   * @paramDef {"type":"String","label":"Bitlink","name":"bitlink","required":true,"description":"The Bitlink id to expand, e.g. bit.ly/abc123. A full https:// URL is also accepted."}
   * @returns {Object}
   * @sampleResult {"link":"https://bit.ly/3xY4zAb","id":"bit.ly/3xY4zAb","long_url":"https://example.com/page","created_at":"2026-07-13T10:00:00+0000"}
   */
  async expandBitlink(bitlink) {
    const normalized = bitlink ? bitlink.replace(/^https?:\/\//i, '').replace(/\/$/, '') : bitlink

    return await this.#apiRequest({
      logTag: '[expandBitlink]',
      url: `${ API_BASE_URL }/expand`,
      method: 'post',
      body: { bitlink_id: normalized },
    })
  }

  /**
   * @operationName Get Clicks Summary
   * @category Metrics
   * @description Returns the total number of clicks for a Bitlink over a time range. Choose the time unit (e.g. day, hour) and how many units of history to include. Useful for a single click count rather than a time series.
   * @route GET /clicks-summary
   * @appearanceColor #EE6123 #F58A5A
   * @paramDef {"type":"String","label":"Bitlink","name":"bitlink","required":true,"description":"The Bitlink id, e.g. bit.ly/abc123."}
   * @paramDef {"type":"String","label":"Unit","name":"unit","uiComponent":{"type":"DROPDOWN","options":{"values":["Minute","Hour","Day","Week","Month"]}},"description":"The time unit for the window. Defaults to Day."}
   * @paramDef {"type":"Number","label":"Units","name":"units","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units to include, counting back from the current time. Use -1 for all available data. Defaults to -1."}
   * @returns {Object}
   * @sampleResult {"units":-1,"unit":"day","unit_reference":"2026-07-13T10:00:00+0000","total_clicks":42}
   */
  async getClicksSummary(bitlink, unit, units) {
    return await this.#apiRequest({
      logTag: '[getClicksSummary]',
      url: `${ API_BASE_URL }/bitlinks/${ this.#encodeBitlink(bitlink) }/clicks/summary`,
      method: 'get',
      query: {
        unit: this.#resolveUnit(unit),
        units: typeof units === 'number' ? units : -1,
      },
    })
  }

  /**
   * @operationName Get Clicks
   * @category Metrics
   * @description Returns a time series of click counts for a Bitlink, one data point per time unit. Choose the unit (e.g. day, hour) and the number of units of history. Use this for charting clicks over time.
   * @route GET /clicks
   * @appearanceColor #EE6123 #F58A5A
   * @paramDef {"type":"String","label":"Bitlink","name":"bitlink","required":true,"description":"The Bitlink id, e.g. bit.ly/abc123."}
   * @paramDef {"type":"String","label":"Unit","name":"unit","uiComponent":{"type":"DROPDOWN","options":{"values":["Minute","Hour","Day","Week","Month"]}},"description":"The time unit for each data point. Defaults to Day."}
   * @paramDef {"type":"Number","label":"Units","name":"units","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units to include, counting back from the current time. Use -1 for all available data. Defaults to -1."}
   * @returns {Object}
   * @sampleResult {"units":-1,"unit":"day","link_clicks":[{"date":"2026-07-13T00:00:00+0000","clicks":12},{"date":"2026-07-12T00:00:00+0000","clicks":8}]}
   */
  async getClicks(bitlink, unit, units) {
    return await this.#apiRequest({
      logTag: '[getClicks]',
      url: `${ API_BASE_URL }/bitlinks/${ this.#encodeBitlink(bitlink) }/clicks`,
      method: 'get',
      query: {
        unit: this.#resolveUnit(unit),
        units: typeof units === 'number' ? units : -1,
      },
    })
  }

  /**
   * @operationName Get Clicks by Country
   * @category Metrics
   * @description Returns click counts for a Bitlink broken down by the country where each click originated. Choose the time unit and history length. Useful for understanding the geographic reach of a link.
   * @route GET /clicks-by-country
   * @appearanceColor #EE6123 #F58A5A
   * @paramDef {"type":"String","label":"Bitlink","name":"bitlink","required":true,"description":"The Bitlink id, e.g. bit.ly/abc123."}
   * @paramDef {"type":"String","label":"Unit","name":"unit","uiComponent":{"type":"DROPDOWN","options":{"values":["Minute","Hour","Day","Week","Month"]}},"description":"The time unit for the window. Defaults to Day."}
   * @paramDef {"type":"Number","label":"Units","name":"units","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units to include, counting back from the current time. Use -1 for all available data. Defaults to -1."}
   * @returns {Object}
   * @sampleResult {"units":-1,"unit":"day","metrics":[{"value":"US","clicks":30},{"value":"GB","clicks":8}]}
   */
  async getClicksByCountry(bitlink, unit, units) {
    return await this.#apiRequest({
      logTag: '[getClicksByCountry]',
      url: `${ API_BASE_URL }/bitlinks/${ this.#encodeBitlink(bitlink) }/countries`,
      method: 'get',
      query: {
        unit: this.#resolveUnit(unit),
        units: typeof units === 'number' ? units : -1,
      },
    })
  }

  /**
   * @operationName Get Clicks by Referrer
   * @category Metrics
   * @description Returns click counts for a Bitlink broken down by referring source (e.g. direct, facebook.com, email). Choose the time unit and history length. Useful for understanding which channels drive traffic to a link.
   * @route GET /clicks-by-referrer
   * @appearanceColor #EE6123 #F58A5A
   * @paramDef {"type":"String","label":"Bitlink","name":"bitlink","required":true,"description":"The Bitlink id, e.g. bit.ly/abc123."}
   * @paramDef {"type":"String","label":"Unit","name":"unit","uiComponent":{"type":"DROPDOWN","options":{"values":["Minute","Hour","Day","Week","Month"]}},"description":"The time unit for the window. Defaults to Day."}
   * @paramDef {"type":"Number","label":"Units","name":"units","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units to include, counting back from the current time. Use -1 for all available data. Defaults to -1."}
   * @returns {Object}
   * @sampleResult {"units":-1,"unit":"day","metrics":[{"value":"direct","clicks":25},{"value":"facebook.com","clicks":10}]}
   */
  async getClicksByReferrer(bitlink, unit, units) {
    return await this.#apiRequest({
      logTag: '[getClicksByReferrer]',
      url: `${ API_BASE_URL }/bitlinks/${ this.#encodeBitlink(bitlink) }/referrers`,
      method: 'get',
      query: {
        unit: this.#resolveUnit(unit),
        units: typeof units === 'number' ? units : -1,
      },
    })
  }

  /**
   * @operationName List Bitlinks by Group
   * @category Links
   * @description Lists the Bitlinks belonging to a group, most recent first. Supports pagination via page and size, and optional filtering by search term, tags, and archived state. Use Get Group or List Groups to find a group GUID.
   * @route GET /bitlinks-by-group
   * @appearanceColor #EE6123 #F58A5A
   * @paramDef {"type":"String","label":"Group","name":"groupGuid","required":true,"dictionary":"getGroupsDictionary","description":"The group (BSD) whose Bitlinks to list."}
   * @paramDef {"type":"Number","label":"Size","name":"size","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of Bitlinks per page (max 100). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve, starting at 1. Defaults to 1."}
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Optional text to filter Bitlinks by title or long URL."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Optional list of tags; only Bitlinks with these tags are returned."}
   * @paramDef {"type":"String","label":"Archived","name":"archived","uiComponent":{"type":"DROPDOWN","options":{"values":["Active Only","Archived Only","Both"]}},"description":"Which Bitlinks to include by archived state. Defaults to Active Only."}
   * @returns {Object}
   * @sampleResult {"links":[{"id":"bit.ly/3xY4zAb","link":"https://bit.ly/3xY4zAb","long_url":"https://example.com/page","title":"Launch page"}],"pagination":{"total":120,"page":1,"size":50}}
   */
  async listBitlinksByGroup(groupGuid, size, page, query, tags, archived) {
    return await this.#apiRequest({
      logTag: '[listBitlinksByGroup]',
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupGuid) }/bitlinks`,
      method: 'get',
      query: {
        size: typeof size === 'number' ? size : 50,
        page: typeof page === 'number' ? page : 1,
        query,
        tags: Array.isArray(tags) && tags.length ? tags : undefined,
        archived: this.#resolveChoice(archived, {
          'Active Only': 'off',
          'Archived Only': 'on',
          'Both': 'both',
        }) || 'off',
      },
    })
  }

  /**
   * @operationName Create QR Code
   * @category QR Codes
   * @description Generates a QR code image for an existing Bitlink and saves it to FlowRunner file storage, returning a downloadable URL. Provide the Bitlink id (e.g. bit.ly/abc123). The QR code encodes the Bitlink so scans are tracked as clicks.
   * @route POST /create-qr-code
   * @appearanceColor #EE6123 #F58A5A
   * @paramDef {"type":"String","label":"Bitlink","name":"bitlink","required":true,"description":"The Bitlink id to generate a QR code for, e.g. bit.ly/abc123."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   * @returns {Object}
   * @sampleResult {"bitlink":"bit.ly/3xY4zAb","fileName":"bitly-qr-3xY4zAb.png","contentType":"image/png","qrCodeUrl":"https://files.flowrunner.io/qr/bitly-qr-3xY4zAb.png"}
   */
  async createQrCode(bitlink, fileOptions) {
    const logTag = '[createQrCode]'
    const encoded = this.#encodeBitlink(bitlink)

    // Bitly returns the QR image as a base64 string (or data URI) in `qr_code`.
    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/bitlinks/${ encoded }/qr`,
      method: 'get',
    })

    const rawQr = response && response.qr_code

    if (!rawQr) {
      throw new Error('Bitly API error: The QR code response did not contain image data.')
    }

    // Strip an optional data-URI prefix (e.g. "data:image/png;base64,") before decoding.
    const base64 = rawQr.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
    const buffer = Buffer.from(base64, 'base64')

    const hash = bitlink.replace(/^https?:\/\//i, '').split('/').pop() || 'code'
    const fileName = `bitly-qr-${ hash }.png`

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: fileName,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      bitlink: bitlink.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
      fileName,
      contentType: 'image/png',
      qrCodeUrl: url,
    }
  }

  /**
   * @operationName List Groups
   * @category Organization
   * @description Lists the groups (Bitly Sub-Domains / BSDs) available to your account. Groups scope Bitlinks, campaigns, and permissions. Optionally filter by organization GUID. Use a returned group GUID with link and metrics operations.
   * @route GET /groups
   * @appearanceColor #EE6123 #F58A5A
   * @paramDef {"type":"String","label":"Organization","name":"organizationGuid","description":"Optional organization GUID to list groups for. Omit to list all groups you can access."}
   * @returns {Object}
   * @sampleResult {"groups":[{"guid":"Bg1AbCdEf","name":"My Group","organization_guid":"Og1AbCdEf","is_active":true}]}
   */
  async listGroups(organizationGuid) {
    return await this.#apiRequest({
      logTag: '[listGroups]',
      url: `${ API_BASE_URL }/groups`,
      method: 'get',
      query: { organization_guid: organizationGuid },
    })
  }

  /**
   * @operationName Get Group
   * @category Organization
   * @description Retrieves the details of a single group (BSD) by its GUID, including its name, organization, role, and BSDs. Use List Groups to discover available group GUIDs.
   * @route GET /get-group
   * @appearanceColor #EE6123 #F58A5A
   * @paramDef {"type":"String","label":"Group","name":"groupGuid","required":true,"dictionary":"getGroupsDictionary","description":"The group GUID to retrieve."}
   * @returns {Object}
   * @sampleResult {"guid":"Bg1AbCdEf","name":"My Group","organization_guid":"Og1AbCdEf","role":"admin","is_active":true}
   */
  async getGroup(groupGuid) {
    return await this.#apiRequest({
      logTag: '[getGroup]',
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupGuid) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Organizations
   * @category Organization
   * @description Lists the organizations your account belongs to. An organization is the top-level container for groups, users, and billing. Use a returned organization GUID to filter groups.
   * @route GET /organizations
   * @appearanceColor #EE6123 #F58A5A
   * @returns {Object}
   * @sampleResult {"organizations":[{"guid":"Og1AbCdEf","name":"My Org","role":"org-admin","tier":"enterprise","is_active":true}]}
   */
  async getOrganizations() {
    return await this.#apiRequest({
      logTag: '[getOrganizations]',
      url: `${ API_BASE_URL }/organizations`,
      method: 'get',
    })
  }

  /**
   * @operationName Get User
   * @category Organization
   * @description Returns the profile of the authenticated Bitly user, including name, email, default group GUID, and login. Useful as a quick connection check to confirm the access token is valid.
   * @route GET /user
   * @appearanceColor #EE6123 #F58A5A
   * @returns {Object}
   * @sampleResult {"login":"jdoe","name":"Jane Doe","emails":[{"email":"jane@example.com","is_primary":true}],"default_group_guid":"Bg1AbCdEf","is_active":true}
   */
  async getUser() {
    return await this.#apiRequest({
      logTag: '[getUser]',
      url: `${ API_BASE_URL }/user`,
      method: 'get',
    })
  }

  // Maps a friendly time-unit label to the token the Bitly API expects.
  #resolveUnit(unit) {
    return this.#resolveChoice(unit, {
      Minute: 'minute',
      Hour: 'hour',
      Day: 'day',
      Week: 'week',
      Month: 'month',
    }) || 'day'
  }

  // Maps a friendly dropdown label to its API value; passes through unknown values.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @typedef {Object} getGroupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter groups by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Bitly returns all groups in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Groups Dictionary
   * @description Provides a selectable list of Bitly groups (BSDs) for choosing a group GUID in link and metrics operations. The option value is the group GUID.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text used to filter groups by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Group","value":"Bg1AbCdEf","note":"admin"}],"cursor":null}
   */
  async getGroupsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getGroupsDictionary]',
      url: `${ API_BASE_URL }/groups`,
      method: 'get',
    })

    const groups = (response && response.groups) || []
    const filter = search ? String(search).toLowerCase() : null

    const items = groups
      .filter(group => !filter || (group.name || '').toLowerCase().includes(filter))
      .map(group => ({
        label: group.name || group.guid,
        value: group.guid,
        note: group.role || group.organization_guid || undefined,
      }))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(BitlyService, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Bitly access token. Generate one in Bitly under Settings → API → generate an access token (or via OAuth). This is a generic access token sent as a Bearer token.',
  },
])
