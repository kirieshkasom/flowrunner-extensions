const logger = {
  info: (...args) => console.log('[MISP] info:', ...args),
  debug: (...args) => console.log('[MISP] debug:', ...args),
  error: (...args) => console.log('[MISP] error:', ...args),
  warn: (...args) => console.log('[MISP] warn:', ...args),
}

const DISTRIBUTION_MAP = {
  'Your organisation only': 0,
  'This community only': 1,
  'Connected communities': 2,
  'All communities': 3,
}

const THREAT_LEVEL_MAP = {
  High: 1,
  Medium: 2,
  Low: 3,
  Undefined: 4,
}

const ANALYSIS_MAP = {
  Initial: 0,
  Ongoing: 1,
  Completed: 2,
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
 * @integrationName MISP
 * @integrationIcon /icon.png
 */
class MISPService {
  constructor(config) {
    this.url = (config.url || '').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.url }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': this.apiKey,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        })
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.message || error.body?.name || error.message
      const errors = error.body?.errors ? ` (${ JSON.stringify(error.body.errors) })` : ''

      logger.error(`${ logTag } - failed [${ status || 'n/a' }]: ${ message }`)

      throw new Error(`MISP API error${ status ? ` (${ status })` : '' }: ${ message }${ errors }`)
    }
  }

  // MISP restSearch endpoints wrap results as { response: [...] }; normalize to a plain array.
  #unwrapSearch(response) {
    if (Array.isArray(response)) {
      return response
    }

    if (response && Array.isArray(response.response)) {
      return response.response
    }

    return response
  }

  /**
   * @operationName Get Event
   * @category Events
   * @description Retrieves a single MISP event by its numeric ID or UUID, including its metadata, attributes, tags, and related objects. Use this to inspect the full contents of a threat event.
   * @route GET /events/view
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"description":"Numeric ID or UUID of the event to retrieve."}
   * @returns {Object}
   * @sampleResult {"Event":{"id":"42","uuid":"5a1b...","info":"Phishing campaign","threat_level_id":"2","analysis":"1","published":false,"Attribute":[]}}
   */
  async getEvent(eventId) {
    return await this.#apiRequest({
      logTag: '[getEvent]',
      path: `/events/view/${ encodeURIComponent(eventId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Add Event
   * @category Events
   * @description Creates a new MISP event to group related threat indicators. Set the event summary, distribution level, threat level, and analysis stage. The event is created unpublished by default unless you set Published to true.
   * @route POST /events/add
   * @paramDef {"type":"String","label":"Info","name":"info","required":true,"description":"Short human-readable summary describing the event."}
   * @paramDef {"type":"String","label":"Distribution","name":"distribution","uiComponent":{"type":"DROPDOWN","options":{"values":["Your organisation only","This community only","Connected communities","All communities"]}},"description":"Who the event is shared with. Defaults to Your organisation only."}
   * @paramDef {"type":"String","label":"Threat Level","name":"threatLevel","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low","Undefined"]}},"description":"Severity of the threat. Defaults to Undefined."}
   * @paramDef {"type":"String","label":"Analysis","name":"analysis","uiComponent":{"type":"DROPDOWN","options":{"values":["Initial","Ongoing","Completed"]}},"description":"Analysis stage of the event. Defaults to Initial."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Event date in YYYY-MM-DD format. Defaults to the current date."}
   * @paramDef {"type":"Boolean","label":"Published","name":"published","uiComponent":{"type":"TOGGLE"},"description":"Whether to publish the event immediately. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"Event":{"id":"42","uuid":"5a1b...","info":"Phishing campaign","threat_level_id":"4","analysis":"0","distribution":"0","published":false}}
   */
  async addEvent(info, distribution, threatLevel, analysis, date, published) {
    return await this.#apiRequest({
      logTag: '[addEvent]',
      path: '/events/add',
      method: 'post',
      body: clean({
        info,
        distribution: this.#resolveChoice(distribution, DISTRIBUTION_MAP),
        threat_level_id: this.#resolveChoice(threatLevel, THREAT_LEVEL_MAP),
        analysis: this.#resolveChoice(analysis, ANALYSIS_MAP),
        date,
        published,
      }),
    })
  }

  /**
   * @operationName Update Event
   * @category Events
   * @description Updates an existing MISP event's metadata such as its summary, distribution, threat level, and analysis stage. Only provided fields are changed; empty fields are left untouched.
   * @route PUT /events/edit
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"description":"Numeric ID or UUID of the event to update."}
   * @paramDef {"type":"String","label":"Info","name":"info","description":"Updated summary describing the event."}
   * @paramDef {"type":"String","label":"Distribution","name":"distribution","uiComponent":{"type":"DROPDOWN","options":{"values":["Your organisation only","This community only","Connected communities","All communities"]}},"description":"Updated sharing level of the event."}
   * @paramDef {"type":"String","label":"Threat Level","name":"threatLevel","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low","Undefined"]}},"description":"Updated severity of the threat."}
   * @paramDef {"type":"String","label":"Analysis","name":"analysis","uiComponent":{"type":"DROPDOWN","options":{"values":["Initial","Ongoing","Completed"]}},"description":"Updated analysis stage of the event."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Updated event date in YYYY-MM-DD format."}
   * @paramDef {"type":"Boolean","label":"Published","name":"published","uiComponent":{"type":"TOGGLE"},"description":"Whether the event should be published."}
   * @returns {Object}
   * @sampleResult {"Event":{"id":"42","uuid":"5a1b...","info":"Phishing campaign (updated)","threat_level_id":"1","analysis":"2","published":false}}
   */
  async updateEvent(eventId, info, distribution, threatLevel, analysis, date, published) {
    return await this.#apiRequest({
      logTag: '[updateEvent]',
      path: `/events/edit/${ encodeURIComponent(eventId) }`,
      method: 'put',
      body: clean({
        info,
        distribution: this.#resolveChoice(distribution, DISTRIBUTION_MAP),
        threat_level_id: this.#resolveChoice(threatLevel, THREAT_LEVEL_MAP),
        analysis: this.#resolveChoice(analysis, ANALYSIS_MAP),
        date,
        published,
      }),
    })
  }

  /**
   * @operationName Delete Event
   * @category Events
   * @description Permanently deletes a MISP event and all of its attributes by ID or UUID. This action cannot be undone.
   * @route DELETE /events/delete
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"description":"Numeric ID or UUID of the event to delete."}
   * @returns {Object}
   * @sampleResult {"message":"Event deleted.","name":"Event deleted.","url":"/events/delete/42"}
   */
  async deleteEvent(eventId) {
    return await this.#apiRequest({
      logTag: '[deleteEvent]',
      path: `/events/delete/${ encodeURIComponent(eventId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Publish Event
   * @category Events
   * @description Publishes a MISP event, making it visible to other organisations according to its distribution level and triggering configured export and notification workflows.
   * @route POST /events/publish
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"description":"Numeric ID or UUID of the event to publish."}
   * @returns {Object}
   * @sampleResult {"name":"Job queued","message":"Job queued","url":"/events/publish/42","id":"42"}
   */
  async publishEvent(eventId) {
    return await this.#apiRequest({
      logTag: '[publishEvent]',
      path: `/events/publish/${ encodeURIComponent(eventId) }`,
      method: 'post',
    })
  }

  /**
   * @operationName Search Events
   * @category Events
   * @description Searches MISP events using the REST search API. Filter by attribute value, attribute type/category, tags, date range, event summary text, and paginate results. Returns matching events with their attributes.
   * @route POST /events/restSearch
   * @paramDef {"type":"String","label":"Value","name":"value","description":"Attribute value to match within events (e.g. an IP, domain, or hash)."}
   * @paramDef {"type":"String","label":"Type","name":"type","description":"Attribute type to filter by (e.g. ip-src, domain, md5)."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Attribute category to filter by (e.g. Network activity, Payload delivery)."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags an event must carry to match (e.g. tlp:red)."}
   * @paramDef {"type":"String","label":"From","name":"from","uiComponent":{"type":"DATE_PICKER"},"description":"Earliest event date to include, YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"To","name":"to","uiComponent":{"type":"DATE_PICKER"},"description":"Latest event date to include, YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Event Info","name":"eventInfo","description":"Text to match against the event summary field."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of events to return per page."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of results to return, starting at 1."}
   * @returns {Array<Object>}
   * @sampleResult {"response":[{"Event":{"id":"42","info":"Phishing campaign","threat_level_id":"2","Attribute":[{"type":"domain","value":"evil.example.com"}]}}]}
   */
  async searchEvents(value, type, category, tags, from, to, eventInfo, limit, page) {
    const response = await this.#apiRequest({
      logTag: '[searchEvents]',
      path: '/events/restSearch',
      method: 'post',
      body: clean({
        value,
        type,
        category,
        tags,
        from,
        to,
        eventinfo: eventInfo,
        limit,
        page,
        returnFormat: 'json',
      }),
    })

    return this.#unwrapSearch(response)
  }

  /**
   * @operationName List Events
   * @category Events
   * @description Lists events from the MISP instance in index form, returning a lightweight summary for each event (ID, summary, org, threat level, attribute count). Use Search Events for filtered queries.
   * @route GET /events/index
   * @returns {Array<Object>}
   * @sampleResult [{"id":"42","info":"Phishing campaign","threat_level_id":"2","analysis":"1","attribute_count":"5","published":false}]
   */
  async listEvents() {
    return await this.#apiRequest({
      logTag: '[listEvents]',
      path: '/events/index',
      method: 'get',
    })
  }

  /**
   * @operationName Add Attribute
   * @category Attributes
   * @description Adds an attribute (indicator of compromise) to an existing MISP event. Specify the attribute type and category, its value, whether it should be used for IDS detection, and its distribution level.
   * @route POST /attributes/add
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"description":"Numeric ID or UUID of the event to add the attribute to."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"description":"Attribute type (e.g. ip-src, ip-dst, domain, url, md5, sha256, email-src)."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The indicator value itself (e.g. the IP address, domain, or hash)."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Attribute category (e.g. Network activity, Payload delivery). Defaults to the type's default category."}
   * @paramDef {"type":"Boolean","label":"For IDS","name":"toIds","uiComponent":{"type":"TOGGLE"},"description":"Whether this attribute should be flagged for automated IDS/IPS detection. Defaults to false."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional free-text comment or context for the attribute."}
   * @paramDef {"type":"String","label":"Distribution","name":"distribution","uiComponent":{"type":"DROPDOWN","options":{"values":["Your organisation only","This community only","Connected communities","All communities"]}},"description":"Who the attribute is shared with. Defaults to inheriting the event's distribution."}
   * @returns {Object}
   * @sampleResult {"Attribute":{"id":"1001","event_id":"42","type":"domain","category":"Network activity","value":"evil.example.com","to_ids":true,"distribution":"5"}}
   */
  async addAttribute(eventId, type, value, category, toIds, comment, distribution) {
    return await this.#apiRequest({
      logTag: '[addAttribute]',
      path: `/attributes/add/${ encodeURIComponent(eventId) }`,
      method: 'post',
      body: clean({
        type,
        value,
        category,
        to_ids: toIds,
        comment,
        distribution: this.#resolveChoice(distribution, DISTRIBUTION_MAP),
      }),
    })
  }

  /**
   * @operationName Get Attribute
   * @category Attributes
   * @description Retrieves a single attribute (indicator) by its numeric ID or UUID, including its type, category, value, IDS flag, and parent event.
   * @route GET /attributes/view
   * @paramDef {"type":"String","label":"Attribute ID","name":"attributeId","required":true,"description":"Numeric ID or UUID of the attribute to retrieve."}
   * @returns {Object}
   * @sampleResult {"Attribute":{"id":"1001","event_id":"42","type":"domain","category":"Network activity","value":"evil.example.com","to_ids":true}}
   */
  async getAttribute(attributeId) {
    return await this.#apiRequest({
      logTag: '[getAttribute]',
      path: `/attributes/view/${ encodeURIComponent(attributeId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Edit Attribute
   * @category Attributes
   * @description Updates an existing attribute's value, category, IDS flag, comment, or distribution by its ID or UUID. Only provided fields are changed.
   * @route PUT /attributes/edit
   * @paramDef {"type":"String","label":"Attribute ID","name":"attributeId","required":true,"description":"Numeric ID or UUID of the attribute to update."}
   * @paramDef {"type":"String","label":"Type","name":"type","description":"Updated attribute type (e.g. ip-src, domain, sha256)."}
   * @paramDef {"type":"String","label":"Value","name":"value","description":"Updated indicator value."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Updated attribute category."}
   * @paramDef {"type":"Boolean","label":"For IDS","name":"toIds","uiComponent":{"type":"TOGGLE"},"description":"Updated IDS/IPS detection flag."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated free-text comment for the attribute."}
   * @paramDef {"type":"String","label":"Distribution","name":"distribution","uiComponent":{"type":"DROPDOWN","options":{"values":["Your organisation only","This community only","Connected communities","All communities"]}},"description":"Updated sharing level of the attribute."}
   * @returns {Object}
   * @sampleResult {"Attribute":{"id":"1001","event_id":"42","type":"domain","category":"Network activity","value":"evil.example.org","to_ids":false}}
   */
  async editAttribute(attributeId, type, value, category, toIds, comment, distribution) {
    return await this.#apiRequest({
      logTag: '[editAttribute]',
      path: `/attributes/edit/${ encodeURIComponent(attributeId) }`,
      method: 'put',
      body: clean({
        type,
        value,
        category,
        to_ids: toIds,
        comment,
        distribution: this.#resolveChoice(distribution, DISTRIBUTION_MAP),
      }),
    })
  }

  /**
   * @operationName Delete Attribute
   * @category Attributes
   * @description Deletes an attribute (indicator) from its event by ID or UUID. On a standard MISP instance this soft-deletes the attribute.
   * @route DELETE /attributes/delete
   * @paramDef {"type":"String","label":"Attribute ID","name":"attributeId","required":true,"description":"Numeric ID or UUID of the attribute to delete."}
   * @returns {Object}
   * @sampleResult {"message":"Attribute deleted.","name":"Attribute deleted.","url":"/attributes/delete/1001"}
   */
  async deleteAttribute(attributeId) {
    return await this.#apiRequest({
      logTag: '[deleteAttribute]',
      path: `/attributes/delete/${ encodeURIComponent(attributeId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Search Attributes
   * @category Attributes
   * @description Searches attributes (indicators) across all events using the REST search API. Filter by value, type, category, tags, and IDS flag, and paginate results. Useful for hunting specific IOCs across the instance.
   * @route POST /attributes/restSearch
   * @paramDef {"type":"String","label":"Value","name":"value","description":"Indicator value to match (e.g. an IP, domain, or hash)."}
   * @paramDef {"type":"String","label":"Type","name":"type","description":"Attribute type to filter by (e.g. ip-src, domain, md5)."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Attribute category to filter by (e.g. Network activity)."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags an attribute or its event must carry to match (e.g. tlp:amber)."}
   * @paramDef {"type":"Boolean","label":"For IDS","name":"toIds","uiComponent":{"type":"TOGGLE"},"description":"Restrict to attributes flagged (true) or not flagged (false) for IDS detection."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of attributes to return per page."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of results to return, starting at 1."}
   * @returns {Array<Object>}
   * @sampleResult {"response":{"Attribute":[{"id":"1001","event_id":"42","type":"domain","value":"evil.example.com","to_ids":true}]}}
   */
  async searchAttributes(value, type, category, tags, toIds, limit, page) {
    const response = await this.#apiRequest({
      logTag: '[searchAttributes]',
      path: '/attributes/restSearch',
      method: 'post',
      body: clean({
        value,
        type,
        category,
        tags,
        to_ids: toIds,
        limit,
        page,
        returnFormat: 'json',
      }),
    })

    return this.#unwrapSearch(response)
  }

  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists all tags defined on the MISP instance, including their names, colours, and IDs. Use a tag's ID with Add Tag to Event, or its name with tag-based searches.
   * @route GET /tags
   * @returns {Object}
   * @sampleResult {"Tag":[{"id":"1","name":"tlp:red","colour":"#cc0033","exportable":true},{"id":"2","name":"tlp:amber","colour":"#ffc000"}]}
   */
  async listTags() {
    return await this.#apiRequest({
      logTag: '[listTags]',
      path: '/tags',
      method: 'get',
    })
  }

  /**
   * @operationName Add Tag to Event
   * @category Tags
   * @description Attaches an existing tag to an event by the event ID and tag ID. Tags classify events for filtering, sharing (e.g. TLP), and correlation.
   * @route POST /events/addTag
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"description":"Numeric ID of the event to tag."}
   * @paramDef {"type":"String","label":"Tag ID","name":"tagId","required":true,"description":"Numeric ID of the tag to attach (from List Tags)."}
   * @returns {Object}
   * @sampleResult {"saved":true,"success":"Tag added.","check_publish":true}
   */
  async addTagToEvent(eventId, tagId) {
    return await this.#apiRequest({
      logTag: '[addTagToEvent]',
      path: `/events/addTag/${ encodeURIComponent(eventId) }/${ encodeURIComponent(tagId) }`,
      method: 'post',
    })
  }

  /**
   * @operationName Remove Tag from Event
   * @category Tags
   * @description Removes a tag from an event by the event ID and tag ID, reversing a previous Add Tag to Event.
   * @route POST /events/removeTag
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"description":"Numeric ID of the event to untag."}
   * @paramDef {"type":"String","label":"Tag ID","name":"tagId","required":true,"description":"Numeric ID of the tag to remove."}
   * @returns {Object}
   * @sampleResult {"saved":true,"success":"Tag removed.","check_publish":true}
   */
  async removeTagFromEvent(eventId, tagId) {
    return await this.#apiRequest({
      logTag: '[removeTagFromEvent]',
      path: `/events/removeTag/${ encodeURIComponent(eventId) }/${ encodeURIComponent(tagId) }`,
      method: 'post',
    })
  }

  /**
   * @operationName Add Sighting
   * @category Sightings
   * @description Records a sighting for one or more attributes matching a given value, indicating that the indicator was observed. Sightings help track how frequently and where an indicator is seen.
   * @route POST /sightings/add
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The attribute value that was sighted (e.g. an IP, domain, or hash)."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Sighting","False positive","Expiration"]}},"description":"Sighting type. Defaults to Sighting."}
   * @returns {Object}
   * @sampleResult {"message":"1 sighting successfully added.","name":"1 sighting successfully added."}
   */
  async addSighting(value, type) {
    return await this.#apiRequest({
      logTag: '[addSighting]',
      path: '/sightings/add',
      method: 'post',
      body: clean({
        value,
        type: this.#resolveChoice(type, { Sighting: 0, 'False positive': 1, Expiration: 2 }),
      }),
    })
  }
}

Flowrunner.ServerCode.addService(MISPService, [
  {
    name: 'url',
    displayName: 'Instance URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your MISP instance URL, e.g. https://misp.example.com (strip any trailing slash).',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your MISP auth key, sent as the Authorization header. Find it in MISP under Administration > List Auth Keys, or your profile > Auth key.',
  },
])
