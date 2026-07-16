const logger = {
  info: (...args) => console.log('[Cloudflare] info:', ...args),
  debug: (...args) => console.log('[Cloudflare] debug:', ...args),
  error: (...args) => console.log('[Cloudflare] error:', ...args),
  warn: (...args) => console.log('[Cloudflare] warn:', ...args),
}

const API_BASE_URL = 'https://api.cloudflare.com/client/v4'

const DEFAULT_PER_PAGE = 20
const DICTIONARY_PER_PAGE = 50

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
 * @integrationName Cloudflare
 * @integrationIcon /icon.svg
 */
class CloudflareService {
  constructor(config) {
    this.apiToken = config.apiToken
    this.accountId = config.accountId
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #requireAccountId() {
    if (!this.accountId) {
      throw new Error('Cloudflare API error: This operation requires an Account ID. Add the "Account ID" configuration item (Cloudflare dashboard, right sidebar of your account overview).')
    }

    return this.accountId
  }

  /**
   * Single request helper for the Cloudflare v4 API. Cloudflare wraps every JSON
   * response as { result, success, errors, messages, result_info }. This unwraps
   * the payload: when `raw` is set the response body is returned verbatim (used by
   * KV value reads which return the stored value, not a JSON envelope); otherwise
   * the envelope is validated and `result` (plus `result_info` when present) is
   * returned.
   */
  async #apiRequest({ url, method = 'get', body, query, raw = false, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      const response = body !== undefined ? await request.send(body) : await request

      if (raw) {
        return response
      }

      if (response && response.success === false) {
        const messages = (response.errors || []).map(err => err.message).filter(Boolean)
        throw new Error(`Cloudflare API error: ${ messages.join('; ') || 'Request failed' }`)
      }

      if (response && response.result_info) {
        return { result: response.result, result_info: response.result_info }
      }

      return response && Object.prototype.hasOwnProperty.call(response, 'result')
        ? response.result
        : response
    } catch (error) {
      if (error.message && error.message.startsWith('Cloudflare API error:')) {
        throw error
      }

      const apiErrors = error.body?.errors
      const message = (Array.isArray(apiErrors) && apiErrors.map(e => e.message).filter(Boolean).join('; ')) ||
        error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Cloudflare API error: ${ message }`)
    }
  }

  // ---------------------------------------------------------------------------
  // Zones
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Zones
   * @category Zones
   * @description Lists the zones (domains) in your Cloudflare account. Supports filtering by domain name and status, and paginates through results. Returns each zone's id, name, status, plan, and name servers. Use a zone id with the DNS Records, Purge Cache, and Rulesets operations.
   * @route GET /zones
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Filter by domain name (e.g. example.com). Matches exactly."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Initializing","Pending","Active","Moved"]}},"description":"Filter zones by their current status."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of results to return (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of zones per page, 5-50 (default 20)."}
   * @returns {Object}
   * @sampleResult {"result":[{"id":"023e105f4ecef8ad9ca31a8372d0c353","name":"example.com","status":"active","paused":false,"type":"full","name_servers":["ns1.cloudflare.com","ns2.cloudflare.com"]}],"result_info":{"page":1,"per_page":20,"count":1,"total_count":1,"total_pages":1}}
   */
  async listZones(name, status, page, perPage) {
    return await this.#apiRequest({
      logTag: '[listZones]',
      url: `${ API_BASE_URL }/zones`,
      method: 'get',
      query: {
        name,
        status: this.#resolveChoice(status, {
          Initializing: 'initializing',
          Pending: 'pending',
          Active: 'active',
          Moved: 'moved',
        }),
        page: page || 1,
        per_page: perPage || DEFAULT_PER_PAGE,
      },
    })
  }

  /**
   * @operationName Get Zone
   * @category Zones
   * @description Retrieves the full details of a single zone by its id, including status, plan, owner, name servers, and configuration timestamps.
   * @route GET /get-zone
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"dictionary":"getZonesDictionary","description":"The zone (domain) to retrieve. Select a zone or paste its id."}
   * @returns {Object}
   * @sampleResult {"id":"023e105f4ecef8ad9ca31a8372d0c353","name":"example.com","status":"active","paused":false,"type":"full","development_mode":0,"name_servers":["ns1.cloudflare.com","ns2.cloudflare.com"]}
   */
  async getZone(zoneId) {
    return await this.#apiRequest({
      logTag: '[getZone]',
      url: `${ API_BASE_URL }/zones/${ encodeURIComponent(zoneId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Purge Cache
   * @category Zones
   * @description Purges cached content for a zone. Choose ONE strategy: purge everything, or purge by specific file URLs, tags, hosts, or prefixes. If Purge Everything is enabled it takes precedence and all other targets are ignored. Tags, hosts, and prefixes require an Enterprise plan. Passing no targets returns an error from Cloudflare.
   * @route POST /zones/purge-cache
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"dictionary":"getZonesDictionary","description":"The zone whose cache should be purged."}
   * @paramDef {"type":"Boolean","label":"Purge Everything","name":"purgeEverything","uiComponent":{"type":"TOGGLE"},"description":"Purge the entire cache for the zone. When enabled, all other targets below are ignored."}
   * @paramDef {"type":"Array<String>","label":"Files","name":"files","description":"Absolute URLs of individual cached resources to purge, e.g. https://example.com/logo.png. Up to 30 per request."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Cache-Tag values to purge (Enterprise only). Purges all resources tagged with these values."}
   * @paramDef {"type":"Array<String>","label":"Hosts","name":"hosts","description":"Hostnames to purge cached content for (Enterprise only), e.g. assets.example.com."}
   * @paramDef {"type":"Array<String>","label":"Prefixes","name":"prefixes","description":"URL prefixes to purge (Enterprise only), e.g. example.com/images/. Path-only, no scheme."}
   * @returns {Object}
   * @sampleResult {"id":"023e105f4ecef8ad9ca31a8372d0c353"}
   */
  async purgeCache(zoneId, purgeEverything, files, tags, hosts, prefixes) {
    let body

    if (purgeEverything) {
      body = { purge_everything: true }
    } else {
      body = clean({
        files: Array.isArray(files) && files.length ? files : undefined,
        tags: Array.isArray(tags) && tags.length ? tags : undefined,
        hosts: Array.isArray(hosts) && hosts.length ? hosts : undefined,
        prefixes: Array.isArray(prefixes) && prefixes.length ? prefixes : undefined,
      })
    }

    return await this.#apiRequest({
      logTag: '[purgeCache]',
      url: `${ API_BASE_URL }/zones/${ encodeURIComponent(zoneId) }/purge_cache`,
      method: 'post',
      body,
    })
  }

  // ---------------------------------------------------------------------------
  // DNS Records
  // ---------------------------------------------------------------------------

  /**
   * @operationName List DNS Records
   * @category DNS Records
   * @description Lists DNS records for a zone. Supports filtering by record type, name, and content, and paginates through results. Returns each record's id, type, name, content, ttl, and proxied status.
   * @route GET /zones/dns-records
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"dictionary":"getZonesDictionary","description":"The zone whose DNS records to list."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["A","AAAA","CNAME","TXT","MX","NS","SRV","CAA"]}},"description":"Filter by DNS record type."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Filter by record name, e.g. www.example.com."}
   * @paramDef {"type":"String","label":"Content","name":"content","description":"Filter by record content, e.g. an IP address or target hostname."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of results to return (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page, 5-100 (default 20)."}
   * @returns {Object}
   * @sampleResult {"result":[{"id":"372e67954025e0ba6aaa6d586b9e0b59","type":"A","name":"www.example.com","content":"198.51.100.4","proxied":true,"ttl":1}],"result_info":{"page":1,"per_page":20,"count":1,"total_count":1,"total_pages":1}}
   */
  async listDnsRecords(zoneId, type, name, content, page, perPage) {
    return await this.#apiRequest({
      logTag: '[listDnsRecords]',
      url: `${ API_BASE_URL }/zones/${ encodeURIComponent(zoneId) }/dns_records`,
      method: 'get',
      query: {
        type,
        name,
        content,
        page: page || 1,
        per_page: perPage || DEFAULT_PER_PAGE,
      },
    })
  }

  /**
   * @operationName Create DNS Record
   * @category DNS Records
   * @description Creates a new DNS record in a zone. Supports A, AAAA, CNAME, TXT, MX, NS, SRV, and CAA record types. Set TTL to 1 for automatic, or 60-86400 seconds. Proxied is only valid for A, AAAA, and CNAME records. Priority is required for MX records.
   * @route POST /zones/dns-records
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"dictionary":"getZonesDictionary","description":"The zone to create the DNS record in."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["A","AAAA","CNAME","TXT","MX","NS","SRV","CAA"]}},"description":"The DNS record type."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The record name, e.g. www.example.com or @ for the zone root."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"description":"The record value: an IP for A/AAAA, a hostname for CNAME/NS, text for TXT, mail server for MX."}
   * @paramDef {"type":"Number","label":"TTL","name":"ttl","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Time to live in seconds. Use 1 for automatic (default), or 60-86400."}
   * @paramDef {"type":"Boolean","label":"Proxied","name":"proxied","uiComponent":{"type":"TOGGLE"},"description":"Route traffic through Cloudflare's proxy (orange cloud). Only valid for A, AAAA, and CNAME records."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Priority for MX and SRV records (0-65535). Lower values are preferred."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","description":"Optional note stored with the record for your own reference."}
   * @returns {Object}
   * @sampleResult {"id":"372e67954025e0ba6aaa6d586b9e0b59","type":"A","name":"www.example.com","content":"198.51.100.4","proxied":true,"ttl":1,"created_on":"2026-07-14T10:00:00.000Z"}
   */
  async createDnsRecord(zoneId, type, name, content, ttl, proxied, priority, comment) {
    const body = clean({
      type,
      name,
      content,
      ttl: ttl || 1,
      proxied,
      priority,
      comment,
    })

    return await this.#apiRequest({
      logTag: '[createDnsRecord]',
      url: `${ API_BASE_URL }/zones/${ encodeURIComponent(zoneId) }/dns_records`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get DNS Record
   * @category DNS Records
   * @description Retrieves the full details of a single DNS record by its id within a zone.
   * @route GET /zones/dns-records/get
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"dictionary":"getZonesDictionary","description":"The zone the record belongs to."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getDnsRecordsDictionary","description":"The DNS record to retrieve. Select a zone first, then a record."}
   * @returns {Object}
   * @sampleResult {"id":"372e67954025e0ba6aaa6d586b9e0b59","type":"A","name":"www.example.com","content":"198.51.100.4","proxied":true,"ttl":1}
   */
  async getDnsRecord(zoneId, recordId) {
    return await this.#apiRequest({
      logTag: '[getDnsRecord]',
      url: `${ API_BASE_URL }/zones/${ encodeURIComponent(zoneId) }/dns_records/${ encodeURIComponent(recordId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update DNS Record
   * @category DNS Records
   * @description Fully replaces a DNS record. All record fields are overwritten, so provide the complete desired state. To change only individual fields, use Patch DNS Record instead.
   * @route PUT /zones/dns-records
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"dictionary":"getZonesDictionary","description":"The zone the record belongs to."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getDnsRecordsDictionary","description":"The DNS record to update. Select a zone first, then a record."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["A","AAAA","CNAME","TXT","MX","NS","SRV","CAA"]}},"description":"The DNS record type."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The record name, e.g. www.example.com."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"description":"The record value: an IP, hostname, or text depending on type."}
   * @paramDef {"type":"Number","label":"TTL","name":"ttl","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Time to live in seconds. Use 1 for automatic (default), or 60-86400."}
   * @paramDef {"type":"Boolean","label":"Proxied","name":"proxied","uiComponent":{"type":"TOGGLE"},"description":"Route traffic through Cloudflare's proxy. Only valid for A, AAAA, and CNAME records."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Priority for MX and SRV records (0-65535)."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","description":"Optional note stored with the record."}
   * @returns {Object}
   * @sampleResult {"id":"372e67954025e0ba6aaa6d586b9e0b59","type":"A","name":"www.example.com","content":"198.51.100.5","proxied":false,"ttl":3600}
   */
  async updateDnsRecord(zoneId, recordId, type, name, content, ttl, proxied, priority, comment) {
    const body = clean({
      type,
      name,
      content,
      ttl: ttl || 1,
      proxied,
      priority,
      comment,
    })

    return await this.#apiRequest({
      logTag: '[updateDnsRecord]',
      url: `${ API_BASE_URL }/zones/${ encodeURIComponent(zoneId) }/dns_records/${ encodeURIComponent(recordId) }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Patch DNS Record
   * @category DNS Records
   * @description Partially updates a DNS record. Only the fields you provide are changed; all others keep their current values. Use this to flip proxied on/off or update content without resending the whole record.
   * @route PATCH /zones/dns-records
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"dictionary":"getZonesDictionary","description":"The zone the record belongs to."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getDnsRecordsDictionary","description":"The DNS record to patch. Select a zone first, then a record."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["A","AAAA","CNAME","TXT","MX","NS","SRV","CAA"]}},"description":"New record type. Leave empty to keep the current type."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New record name. Leave empty to keep the current name."}
   * @paramDef {"type":"String","label":"Content","name":"content","description":"New record value. Leave empty to keep the current content."}
   * @paramDef {"type":"Number","label":"TTL","name":"ttl","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New TTL in seconds (1 for automatic, or 60-86400). Leave empty to keep the current TTL."}
   * @paramDef {"type":"Boolean","label":"Proxied","name":"proxied","uiComponent":{"type":"TOGGLE"},"description":"New proxied state (A, AAAA, CNAME only). Leave empty to keep the current state."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New priority for MX and SRV records. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","description":"New note for the record. Leave empty to keep the current comment."}
   * @returns {Object}
   * @sampleResult {"id":"372e67954025e0ba6aaa6d586b9e0b59","type":"A","name":"www.example.com","content":"198.51.100.4","proxied":false,"ttl":1}
   */
  async patchDnsRecord(zoneId, recordId, type, name, content, ttl, proxied, priority, comment) {
    const body = clean({
      type,
      name,
      content,
      ttl,
      proxied,
      priority,
      comment,
    })

    return await this.#apiRequest({
      logTag: '[patchDnsRecord]',
      url: `${ API_BASE_URL }/zones/${ encodeURIComponent(zoneId) }/dns_records/${ encodeURIComponent(recordId) }`,
      method: 'patch',
      body,
    })
  }

  /**
   * @operationName Delete DNS Record
   * @category DNS Records
   * @description Permanently deletes a DNS record from a zone. This action cannot be undone. Returns the id of the deleted record.
   * @route DELETE /zones/dns-records
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"dictionary":"getZonesDictionary","description":"The zone the record belongs to."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getDnsRecordsDictionary","description":"The DNS record to delete. Select a zone first, then a record."}
   * @returns {Object}
   * @sampleResult {"id":"372e67954025e0ba6aaa6d586b9e0b59"}
   */
  async deleteDnsRecord(zoneId, recordId) {
    return await this.#apiRequest({
      logTag: '[deleteDnsRecord]',
      url: `${ API_BASE_URL }/zones/${ encodeURIComponent(zoneId) }/dns_records/${ encodeURIComponent(recordId) }`,
      method: 'delete',
    })
  }

  // ---------------------------------------------------------------------------
  // Rulesets (WAF / custom rules)
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Rulesets
   * @category Rulesets
   * @description Lists the rulesets configured for a zone, including managed WAF rulesets and custom rule phases (e.g. http_request_firewall_custom, http_ratelimit). Returns each ruleset's id, name, phase, and kind. Use a ruleset id with Get Ruleset to inspect its individual rules.
   * @route GET /zones/rulesets
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"dictionary":"getZonesDictionary","description":"The zone whose rulesets to list."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":"2c0fc9fa937b11eaa1b71c4d701ab86e","name":"Cloudflare Managed Ruleset","kind":"managed","phase":"http_request_firewall_managed","last_updated":"2026-07-14T10:00:00.000Z"}]
   */
  async listRulesets(zoneId) {
    return await this.#apiRequest({
      logTag: '[listRulesets]',
      url: `${ API_BASE_URL }/zones/${ encodeURIComponent(zoneId) }/rulesets`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Ruleset
   * @category Rulesets
   * @description Retrieves a single ruleset by its id within a zone, including the full list of rules it contains with their expressions, actions, and descriptions.
   * @route GET /zones/rulesets/get
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"dictionary":"getZonesDictionary","description":"The zone the ruleset belongs to."}
   * @paramDef {"type":"String","label":"Ruleset ID","name":"rulesetId","required":true,"description":"The id of the ruleset to retrieve (from List Rulesets)."}
   * @returns {Object}
   * @sampleResult {"id":"2c0fc9fa937b11eaa1b71c4d701ab86e","name":"Cloudflare Managed Ruleset","kind":"managed","phase":"http_request_firewall_managed","rules":[{"id":"3a03d7bbe9b34c9e9d1f0e4f8f8b8b8b","action":"block","expression":"(cf.threat_score gt 50)","description":"Block high threat score"}]}
   */
  async getRuleset(zoneId, rulesetId) {
    return await this.#apiRequest({
      logTag: '[getRuleset]',
      url: `${ API_BASE_URL }/zones/${ encodeURIComponent(zoneId) }/rulesets/${ encodeURIComponent(rulesetId) }`,
      method: 'get',
    })
  }

  // ---------------------------------------------------------------------------
  // Workers KV
  // ---------------------------------------------------------------------------

  /**
   * @operationName List KV Namespaces
   * @category Workers KV
   * @description Lists the Workers KV namespaces in your account. Requires the Account ID configuration item. Returns each namespace's id and title. Use a namespace id with the KV key/value operations.
   * @route GET /accounts/kv/namespaces
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of results to return (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of namespaces per page, 5-100 (default 20)."}
   * @returns {Object}
   * @sampleResult {"result":[{"id":"0f2ac74b498b48028cb68387c421e279","title":"My Namespace","supports_url_encoding":true}],"result_info":{"page":1,"per_page":20,"count":1,"total_count":1,"total_pages":1}}
   */
  async listKvNamespaces(page, perPage) {
    const accountId = this.#requireAccountId()

    return await this.#apiRequest({
      logTag: '[listKvNamespaces]',
      url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(accountId) }/storage/kv/namespaces`,
      method: 'get',
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PER_PAGE,
      },
    })
  }

  /**
   * @operationName List KV Keys
   * @category Workers KV
   * @description Lists the keys stored in a Workers KV namespace. Requires the Account ID configuration item. Supports an optional prefix filter and cursor-based pagination via the returned cursor in result_info. Returns each key's name and metadata.
   * @route GET /accounts/kv/namespaces/keys
   * @paramDef {"type":"String","label":"Namespace ID","name":"namespaceId","required":true,"dictionary":"getKvNamespacesDictionary","description":"The KV namespace whose keys to list."}
   * @paramDef {"type":"String","label":"Prefix","name":"prefix","description":"Only return keys that begin with this string."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of keys to return, 10-1000 (default 1000)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's result_info.cursor to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"result":[{"name":"user:123","expiration":1893456000}],"result_info":{"count":1,"cursor":"6Ck1la0VxJ0djhidm1MdX2FyD"}}
   */
  async listKvKeys(namespaceId, prefix, limit, cursor) {
    const accountId = this.#requireAccountId()

    return await this.#apiRequest({
      logTag: '[listKvKeys]',
      url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(accountId) }/storage/kv/namespaces/${ encodeURIComponent(namespaceId) }/keys`,
      method: 'get',
      query: {
        prefix,
        limit,
        cursor,
      },
    })
  }

  /**
   * @operationName Get KV Value
   * @category Workers KV
   * @description Reads the raw stored value for a key in a Workers KV namespace. Requires the Account ID configuration item. Returns the value exactly as stored (string). Returns an error if the key does not exist.
   * @route GET /accounts/kv/namespaces/values/get
   * @paramDef {"type":"String","label":"Namespace ID","name":"namespaceId","required":true,"dictionary":"getKvNamespacesDictionary","description":"The KV namespace to read from."}
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The key whose value to retrieve."}
   * @returns {Object}
   * @sampleResult {"value":"hello world"}
   */
  async getKvValue(namespaceId, key) {
    const accountId = this.#requireAccountId()

    const value = await this.#apiRequest({
      logTag: '[getKvValue]',
      url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(accountId) }/storage/kv/namespaces/${ encodeURIComponent(namespaceId) }/values/${ encodeURIComponent(key) }`,
      method: 'get',
      raw: true,
    })

    return { value }
  }

  /**
   * @operationName Put KV Value
   * @category Workers KV
   * @description Writes a value to a key in a Workers KV namespace, creating the key or overwriting its existing value. Requires the Account ID configuration item. Optionally set an expiration TTL (in seconds) after which the key is automatically deleted. Changes may take up to 60 seconds to propagate globally.
   * @route PUT /accounts/kv/namespaces/values
   * @paramDef {"type":"String","label":"Namespace ID","name":"namespaceId","required":true,"dictionary":"getKvNamespacesDictionary","description":"The KV namespace to write to."}
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The key to create or overwrite."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The value to store for the key."}
   * @paramDef {"type":"Number","label":"Expiration TTL","name":"expirationTtl","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seconds until the key expires and is deleted (minimum 60). Leave empty for no expiration."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async putKvValue(namespaceId, key, value, expirationTtl) {
    const accountId = this.#requireAccountId()

    const formData = new Flowrunner.Request.FormData()
    formData.append('value', value)
    formData.append('metadata', '{}')

    const query = clean({ expiration_ttl: expirationTtl })

    try {
      logger.debug(`[putKvValue] - [PUT::values/${ key }] ttl=${ expirationTtl }`)

      const response = await Flowrunner.Request
        .put(`${ API_BASE_URL }/accounts/${ encodeURIComponent(accountId) }/storage/kv/namespaces/${ encodeURIComponent(namespaceId) }/values/${ encodeURIComponent(key) }`)
        .set({ 'Authorization': `Bearer ${ this.apiToken }` })
        .query(query)
        .form(formData)

      if (response && response.success === false) {
        const messages = (response.errors || []).map(err => err.message).filter(Boolean)
        throw new Error(`Cloudflare API error: ${ messages.join('; ') || 'Request failed' }`)
      }

      return { success: true }
    } catch (error) {
      if (error.message && error.message.startsWith('Cloudflare API error:')) {
        throw error
      }

      const apiErrors = error.body?.errors
      const message = (Array.isArray(apiErrors) && apiErrors.map(e => e.message).filter(Boolean).join('; ')) ||
        error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`[putKvValue] - Request failed: ${ message }`)

      throw new Error(`Cloudflare API error: ${ message }`)
    }
  }

  /**
   * @operationName Delete KV Value
   * @category Workers KV
   * @description Deletes a key and its value from a Workers KV namespace. Requires the Account ID configuration item. This action cannot be undone. Succeeds even if the key does not exist.
   * @route DELETE /accounts/kv/namespaces/values
   * @paramDef {"type":"String","label":"Namespace ID","name":"namespaceId","required":true,"dictionary":"getKvNamespacesDictionary","description":"The KV namespace to delete from."}
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The key to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteKvValue(namespaceId, key) {
    const accountId = this.#requireAccountId()

    await this.#apiRequest({
      logTag: '[deleteKvValue]',
      url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(accountId) }/storage/kv/namespaces/${ encodeURIComponent(namespaceId) }/values/${ encodeURIComponent(key) }`,
      method: 'delete',
    })

    return { success: true }
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getZonesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter zones by domain name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) to fetch the next page of zones."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Zones Dictionary
   * @description Provides a searchable list of zones (domains) for selecting a Zone ID in DNS, cache, and ruleset operations. The option value is the zone id.
   * @route POST /get-zones-dictionary
   * @paramDef {"type":"getZonesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for filtering zones."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"example.com","value":"023e105f4ecef8ad9ca31a8372d0c353","note":"active"}],"cursor":"2"}
   */
  async getZonesDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) : 1

    const { result, result_info } = await this.#apiRequest({
      logTag: '[getZonesDictionary]',
      url: `${ API_BASE_URL }/zones`,
      method: 'get',
      query: {
        name: search,
        page,
        per_page: DICTIONARY_PER_PAGE,
      },
    })

    const zones = result || []
    const info = result_info || {}
    const hasMore = info.page && info.total_pages && info.page < info.total_pages

    return {
      items: zones.map(zone => ({
        label: zone.name,
        value: zone.id,
        note: zone.status,
      })),
      cursor: hasMore ? String(info.page + 1) : undefined,
    }
  }

  /**
   * @typedef {Object} getDnsRecordsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"description":"The zone whose DNS records to list."}
   */

  /**
   * @typedef {Object} getDnsRecordsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter records by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) to fetch the next page of records."}
   * @paramDef {"type":"getDnsRecordsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependency values; requires the selected Zone ID."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get DNS Records Dictionary
   * @description Provides a searchable list of DNS records for a selected zone, for choosing a Record ID in the DNS record operations. Depends on the Zone ID being selected first. The option value is the record id.
   * @route POST /get-dns-records-dictionary
   * @paramDef {"type":"getDnsRecordsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the selected Zone ID."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"www.example.com","value":"372e67954025e0ba6aaa6d586b9e0b59","note":"A - 198.51.100.4"}],"cursor":"2"}
   */
  async getDnsRecordsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const zoneId = criteria?.zoneId

    if (!zoneId) {
      return { items: [], cursor: undefined }
    }

    const page = cursor ? parseInt(cursor, 10) : 1

    const { result, result_info } = await this.#apiRequest({
      logTag: '[getDnsRecordsDictionary]',
      url: `${ API_BASE_URL }/zones/${ encodeURIComponent(zoneId) }/dns_records`,
      method: 'get',
      query: {
        name: search,
        page,
        per_page: DICTIONARY_PER_PAGE,
      },
    })

    const records = result || []
    const info = result_info || {}
    const hasMore = info.page && info.total_pages && info.page < info.total_pages

    return {
      items: records.map(record => ({
        label: record.name,
        value: record.id,
        note: `${ record.type } - ${ record.content }`,
      })),
      cursor: hasMore ? String(info.page + 1) : undefined,
    }
  }

  /**
   * @typedef {Object} getKvNamespacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter namespaces by title (client-side)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) to fetch the next page of namespaces."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get KV Namespaces Dictionary
   * @description Provides a list of Workers KV namespaces for selecting a Namespace ID in the KV operations. Requires the Account ID configuration item. The option value is the namespace id.
   * @route POST /get-kv-namespaces-dictionary
   * @paramDef {"type":"getKvNamespacesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for filtering namespaces."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Namespace","value":"0f2ac74b498b48028cb68387c421e279","note":null}],"cursor":"2"}
   */
  async getKvNamespacesDictionary(payload) {
    const { search, cursor } = payload || {}
    const accountId = this.#requireAccountId()
    const page = cursor ? parseInt(cursor, 10) : 1

    const { result, result_info } = await this.#apiRequest({
      logTag: '[getKvNamespacesDictionary]',
      url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(accountId) }/storage/kv/namespaces`,
      method: 'get',
      query: {
        page,
        per_page: DICTIONARY_PER_PAGE,
      },
    })

    let namespaces = result || []

    if (search) {
      const term = search.toLowerCase()
      namespaces = namespaces.filter(ns => (ns.title || '').toLowerCase().includes(term))
    }

    const info = result_info || {}
    const hasMore = info.page && info.total_pages && info.page < info.total_pages

    return {
      items: namespaces.map(ns => ({
        label: ns.title,
        value: ns.id,
        note: undefined,
      })),
      cursor: hasMore ? String(info.page + 1) : undefined,
    }
  }
}

Flowrunner.ServerCode.addService(CloudflareService, [
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Cloudflare dashboard -> My Profile -> API Tokens -> Create Token. Scope it to the permissions you need (e.g. Zone.DNS Edit, Workers KV Storage Edit). Sent as an Authorization: Bearer header.',
  },
  {
    name: 'accountId',
    displayName: 'Account ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Required only for Workers KV operations. Find it in the Cloudflare dashboard on the account overview page (right sidebar) or in the URL after dash.cloudflare.com/.',
  },
])
