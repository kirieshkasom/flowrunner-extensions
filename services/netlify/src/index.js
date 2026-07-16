const logger = {
  info: (...args) => console.log('[Netlify] info:', ...args),
  debug: (...args) => console.log('[Netlify] debug:', ...args),
  error: (...args) => console.log('[Netlify] error:', ...args),
  warn: (...args) => console.log('[Netlify] warn:', ...args),
}

const API_BASE_URL = 'https://api.netlify.com/api/v1'

const DEFAULT_PER_PAGE = 20

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
 * @integrationName Netlify
 * @integrationIcon /icon.svg
 */
class NetlifyService {
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
      throw new Error(
        'Netlify API error: this operation requires an Account ID. Set the Account ID config item (find it with the List Accounts operation, or in Netlify → Team settings).'
      )
    }

    return this.accountId
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.message || error.body?.error || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Netlify API error: ${ message }`)
    }
  }

  // ---------------------------------------------------------------------------
  // Sites
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Sites
   * @category Sites
   * @description Lists all sites the authenticated user has access to. Supports optional name filtering and pagination. Returns an array of site objects, each including the site id, name, URL, custom domain, and current published deploy details.
   * @route GET /sites
   *
   * @paramDef {"type":"String","label":"Name Filter","name":"name","description":"Optional site name to filter by. Netlify matches sites whose name contains this value."}
   * @paramDef {"type":"String","label":"Ownership","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Owner","Guest"]}},"description":"Restrict results by the user's relationship to the site. Defaults to All."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination (1-based)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of sites per page (default 20, max 100)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"a1b2c3d4-0000-0000-0000-000000000000","name":"my-site","url":"https://my-site.netlify.app","custom_domain":"example.com","ssl":true,"account_id":"acct_123","published_deploy":{"id":"dep_1","state":"ready"}}]
   */
  async listSites(name, filter, page, perPage) {
    const logTag = '[listSites]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sites`,
      method: 'get',
      query: {
        name,
        filter: this.#resolveChoice(filter, { All: 'all', Owner: 'owner', Guest: 'guest' }),
        page,
        per_page: perPage || DEFAULT_PER_PAGE,
      },
    })
  }

  /**
   * @operationName Get Site
   * @category Sites
   * @description Retrieves the full details for a single site by its id, including build settings, custom domain, SSL status, and the currently published deploy.
   * @route GET /get-site
   *
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The site to retrieve. Search and select a site, or provide a site id directly."}
   *
   * @returns {Object}
   * @sampleResult {"id":"a1b2c3d4-0000-0000-0000-000000000000","name":"my-site","url":"https://my-site.netlify.app","custom_domain":"example.com","ssl":true,"account_id":"acct_123","build_settings":{"repo_url":"https://github.com/acme/my-site"}}
   */
  async getSite(siteId) {
    const logTag = '[getSite]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sites/${ siteId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Site
   * @category Sites
   * @description Creates a new Netlify site. You can optionally set a subdomain name and a custom domain. If no name is given, Netlify generates a random one. Returns the created site object with its id and default netlify.app URL.
   * @route POST /create-site
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional subdomain name for the site (becomes name.netlify.app). Must be globally unique. Netlify generates a random name if omitted."}
   * @paramDef {"type":"String","label":"Custom Domain","name":"customDomain","description":"Optional custom domain to attach to the site, e.g. www.example.com."}
   *
   * @returns {Object}
   * @sampleResult {"id":"a1b2c3d4-0000-0000-0000-000000000000","name":"my-site","url":"https://my-site.netlify.app","custom_domain":"example.com","account_id":"acct_123"}
   */
  async createSite(name, customDomain) {
    const logTag = '[createSite]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sites`,
      method: 'post',
      body: clean({
        name,
        custom_domain: customDomain,
      }),
    })
  }

  /**
   * @operationName Update Site
   * @category Sites
   * @description Updates settings on an existing site, such as its name or custom domain. Only the provided fields are changed. Returns the updated site object.
   * @route PATCH /update-site
   *
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The site to update. Search and select a site, or provide a site id directly."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New subdomain name for the site (becomes name.netlify.app). Must be globally unique."}
   * @paramDef {"type":"String","label":"Custom Domain","name":"customDomain","description":"New custom domain to attach to the site, e.g. www.example.com."}
   *
   * @returns {Object}
   * @sampleResult {"id":"a1b2c3d4-0000-0000-0000-000000000000","name":"renamed-site","url":"https://renamed-site.netlify.app","custom_domain":"new.example.com"}
   */
  async updateSite(siteId, name, customDomain) {
    const logTag = '[updateSite]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sites/${ siteId }`,
      method: 'patch',
      body: clean({
        name,
        custom_domain: customDomain,
      }),
    })
  }

  /**
   * @operationName Delete Site
   * @category Sites
   * @description Permanently deletes a site and all of its deploys. This action cannot be undone. Returns a confirmation object.
   * @route DELETE /delete-site
   *
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The site to delete. Search and select a site, or provide a site id directly."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"site_id":"a1b2c3d4-0000-0000-0000-000000000000"}
   */
  async deleteSite(siteId) {
    const logTag = '[deleteSite]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sites/${ siteId }`,
      method: 'delete',
    })

    return { deleted: true, site_id: siteId }
  }

  // ---------------------------------------------------------------------------
  // Deploys
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Deploys
   * @category Deploys
   * @description Lists deploys for a site, most recent first. Each deploy includes its id, state (e.g. ready, building, error), branch, commit, and deploy URL. Supports pagination.
   * @route GET /list-deploys
   *
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The site whose deploys to list. Search and select a site, or provide a site id directly."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination (1-based)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of deploys per page (default 20, max 100)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"dep_1","site_id":"a1b2c3d4-0000-0000-0000-000000000000","state":"ready","branch":"main","commit_ref":"abc1234","deploy_url":"https://dep-1--my-site.netlify.app","created_at":"2026-07-01T10:00:00Z"}]
   */
  async listDeploys(siteId, page, perPage) {
    const logTag = '[listDeploys]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sites/${ siteId }/deploys`,
      method: 'get',
      query: {
        page,
        per_page: perPage || DEFAULT_PER_PAGE,
      },
    })
  }

  /**
   * @operationName Get Deploy
   * @category Deploys
   * @description Retrieves the full details of a single deploy by its id, including its state, associated site, branch, commit, error message (if any), and published URL.
   * @route GET /get-deploy
   *
   * @paramDef {"type":"String","label":"Deploy ID","name":"deployId","required":true,"description":"The id of the deploy to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"dep_1","site_id":"a1b2c3d4-0000-0000-0000-000000000000","state":"ready","branch":"main","commit_ref":"abc1234","deploy_url":"https://dep-1--my-site.netlify.app","published_at":"2026-07-01T10:05:00Z"}
   */
  async getDeploy(deployId) {
    const logTag = '[getDeploy]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/deploys/${ deployId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Trigger Build
   * @category Deploys
   * @description Triggers a new build and deploy for a site from its connected Git repository. Optionally clears the build cache first. Returns the created build object. Use this instead of uploading files directly.
   * @route POST /trigger-build
   *
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The site to build. Search and select a site, or provide a site id directly."}
   * @paramDef {"type":"Boolean","label":"Clear Cache","name":"clearCache","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, clears the build cache before running the build. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"id":"build_1","deploy_id":"dep_2","sha":"abc1234","done":false,"created_at":"2026-07-01T11:00:00Z"}
   */
  async triggerBuild(siteId, clearCache) {
    const logTag = '[triggerBuild]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sites/${ siteId }/builds`,
      method: 'post',
      body: clean({
        clear_cache: clearCache === true ? true : undefined,
      }),
    })
  }

  /**
   * @operationName Lock Deploy
   * @category Deploys
   * @description Locks a deploy so it stays published and cannot be replaced by new deploys until it is unlocked. Useful for pinning a known-good release. Returns the locked deploy object.
   * @route POST /lock-deploy
   *
   * @paramDef {"type":"String","label":"Deploy ID","name":"deployId","required":true,"description":"The id of the deploy to lock."}
   *
   * @returns {Object}
   * @sampleResult {"id":"dep_1","state":"ready","locked":true}
   */
  async lockDeploy(deployId) {
    const logTag = '[lockDeploy]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/deploys/${ deployId }/lock`,
      method: 'post',
    })
  }

  /**
   * @operationName Unlock Deploy
   * @category Deploys
   * @description Unlocks a previously locked deploy, allowing new deploys to be published again. Returns the unlocked deploy object.
   * @route POST /unlock-deploy
   *
   * @paramDef {"type":"String","label":"Deploy ID","name":"deployId","required":true,"description":"The id of the deploy to unlock."}
   *
   * @returns {Object}
   * @sampleResult {"id":"dep_1","state":"ready","locked":false}
   */
  async unlockDeploy(deployId) {
    const logTag = '[unlockDeploy]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/deploys/${ deployId }/unlock`,
      method: 'post',
    })
  }

  /**
   * @operationName Restore Deploy
   * @category Deploys
   * @description Publishes (rolls back to) a previous deploy for a site, making it the live deploy again. Provide the site and the id of the older deploy to restore. Returns the restored deploy object.
   * @route POST /restore-deploy
   *
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The site whose deploy to restore. Search and select a site, or provide a site id directly."}
   * @paramDef {"type":"String","label":"Deploy ID","name":"deployId","required":true,"description":"The id of the older deploy to publish/restore."}
   *
   * @returns {Object}
   * @sampleResult {"id":"dep_0","site_id":"a1b2c3d4-0000-0000-0000-000000000000","state":"ready","branch":"main"}
   */
  async restoreDeploy(siteId, deployId) {
    const logTag = '[restoreDeploy]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sites/${ siteId }/deploys/${ deployId }/restore`,
      method: 'post',
    })
  }

  /**
   * @operationName Cancel Deploy
   * @category Deploys
   * @description Cancels an in-progress deploy by its id, stopping the build/publish process. Returns the cancelled deploy object.
   * @route POST /cancel-deploy
   *
   * @paramDef {"type":"String","label":"Deploy ID","name":"deployId","required":true,"description":"The id of the in-progress deploy to cancel."}
   *
   * @returns {Object}
   * @sampleResult {"id":"dep_2","state":"error","error_message":"Canceled build"}
   */
  async cancelDeploy(deployId) {
    const logTag = '[cancelDeploy]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/deploys/${ deployId }/cancel`,
      method: 'post',
    })
  }

  // ---------------------------------------------------------------------------
  // Environment Variables (account-scoped)
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Environment Variables
   * @category Environment Variables
   * @description Lists environment variables for the configured account, optionally scoped to a specific site. Requires the Account ID config item to be set. Returns an array of env var objects, each with its key and per-context values.
   * @route GET /list-env-vars
   *
   * @paramDef {"type":"String","label":"Site","name":"siteId","dictionary":"getSitesDictionary","description":"Optional site to scope variables to. Leave empty to list account-level variables. Search and select a site, or provide a site id directly."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"key":"API_URL","is_secret":false,"scopes":["builds","functions"],"values":[{"id":"v1","value":"https://api.example.com","context":"all"}]}]
   */
  async listEnvVars(siteId) {
    const logTag = '[listEnvVars]'
    const accountId = this.#requireAccountId()

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/accounts/${ accountId }/env`,
      method: 'get',
      query: { site_id: siteId },
    })
  }

  /**
   * @operationName Create Environment Variable
   * @category Environment Variables
   * @description Creates a new environment variable in the configured account with a value for a specific deploy context. Requires the Account ID config item. Optionally scopes the variable to a single site. Returns the created env var object.
   * @route POST /create-env-var
   *
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The environment variable name, e.g. API_URL."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The value to store for the selected deploy context."}
   * @paramDef {"type":"String","label":"Context","name":"context","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Production","Deploy Preview","Branch Deploy","Local Development"]}},"description":"The deploy context this value applies to. Defaults to All."}
   * @paramDef {"type":"String","label":"Site","name":"siteId","dictionary":"getSitesDictionary","description":"Optional site to scope the variable to. Leave empty to create it at the account level."}
   *
   * @returns {Object}
   * @sampleResult {"key":"API_URL","is_secret":false,"values":[{"id":"v1","value":"https://api.example.com","context":"all"}]}
   */
  async createEnvVar(key, value, context, siteId) {
    const logTag = '[createEnvVar]'
    const accountId = this.#requireAccountId()

    const resolvedContext = this.#resolveChoice(context, {
      All: 'all',
      Production: 'production',
      'Deploy Preview': 'deploy-preview',
      'Branch Deploy': 'branch-deploy',
      'Local Development': 'dev',
    }) || 'all'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/accounts/${ accountId }/env`,
      method: 'post',
      query: { site_id: siteId },
      body: [
        {
          key,
          values: [{ value, context: resolvedContext }],
        },
      ],
    })
  }

  /**
   * @operationName Get Environment Variable
   * @category Environment Variables
   * @description Retrieves a single environment variable by key from the configured account, optionally scoped to a site. Requires the Account ID config item. Returns the env var object with all of its context values.
   * @route GET /get-env-var
   *
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The environment variable name to retrieve, e.g. API_URL."}
   * @paramDef {"type":"String","label":"Site","name":"siteId","dictionary":"getSitesDictionary","description":"Optional site the variable is scoped to. Leave empty for account-level variables."}
   *
   * @returns {Object}
   * @sampleResult {"key":"API_URL","is_secret":false,"scopes":["builds","functions"],"values":[{"id":"v1","value":"https://api.example.com","context":"all"}]}
   */
  async getEnvVar(key, siteId) {
    const logTag = '[getEnvVar]'
    const accountId = this.#requireAccountId()

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/accounts/${ accountId }/env/${ encodeURIComponent(key) }`,
      method: 'get',
      query: { site_id: siteId },
    })
  }

  /**
   * @operationName Set Environment Variable Value
   * @category Environment Variables
   * @description Updates the value of an existing environment variable for a specific deploy context in the configured account. Requires the Account ID config item. Optionally scopes to a site. Returns the updated env var object.
   * @route PATCH /set-env-var-value
   *
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The environment variable name to update, e.g. API_URL."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The new value to store for the selected deploy context."}
   * @paramDef {"type":"String","label":"Context","name":"context","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Production","Deploy Preview","Branch Deploy","Local Development"]}},"description":"The deploy context this value applies to. Defaults to All."}
   * @paramDef {"type":"String","label":"Site","name":"siteId","dictionary":"getSitesDictionary","description":"Optional site the variable is scoped to. Leave empty for account-level variables."}
   *
   * @returns {Object}
   * @sampleResult {"key":"API_URL","is_secret":false,"values":[{"id":"v1","value":"https://api2.example.com","context":"all"}]}
   */
  async setEnvVarValue(key, value, context, siteId) {
    const logTag = '[setEnvVarValue]'
    const accountId = this.#requireAccountId()

    const resolvedContext = this.#resolveChoice(context, {
      All: 'all',
      Production: 'production',
      'Deploy Preview': 'deploy-preview',
      'Branch Deploy': 'branch-deploy',
      'Local Development': 'dev',
    }) || 'all'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/accounts/${ accountId }/env/${ encodeURIComponent(key) }`,
      method: 'patch',
      query: { site_id: siteId },
      body: {
        context: resolvedContext,
        value,
      },
    })
  }

  /**
   * @operationName Delete Environment Variable
   * @category Environment Variables
   * @description Deletes an environment variable by key from the configured account, optionally scoped to a site. Requires the Account ID config item. Returns a confirmation object.
   * @route DELETE /delete-env-var
   *
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The environment variable name to delete, e.g. API_URL."}
   * @paramDef {"type":"String","label":"Site","name":"siteId","dictionary":"getSitesDictionary","description":"Optional site the variable is scoped to. Leave empty for account-level variables."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"key":"API_URL"}
   */
  async deleteEnvVar(key, siteId) {
    const logTag = '[deleteEnvVar]'
    const accountId = this.#requireAccountId()

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/accounts/${ accountId }/env/${ encodeURIComponent(key) }`,
      method: 'delete',
      query: { site_id: siteId },
    })

    return { deleted: true, key }
  }

  // ---------------------------------------------------------------------------
  // Forms
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Forms
   * @category Forms
   * @description Lists all Netlify Forms detected for a site, including each form's id, name, number of submissions, and the fields it captures.
   * @route GET /list-forms
   *
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The site whose forms to list. Search and select a site, or provide a site id directly."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"form_1","site_id":"a1b2c3d4-0000-0000-0000-000000000000","name":"contact","submission_count":42,"fields":[{"name":"email","type":"email"}]}]
   */
  async listForms(siteId) {
    const logTag = '[listForms]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sites/${ siteId }/forms`,
      method: 'get',
    })
  }

  /**
   * @operationName List Form Submissions
   * @category Forms
   * @description Lists submissions for a specific Netlify Form. Each submission includes its id, the submitted field data, the submitter's email/name (when captured), and the creation timestamp. Supports pagination.
   * @route GET /list-form-submissions
   *
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form whose submissions to list. Select a site first, then choose a form, or provide a form id directly."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination (1-based)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of submissions per page (default 20, max 100)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"sub_1","form_id":"form_1","email":"jane@example.com","name":"Jane","data":{"message":"Hello"},"created_at":"2026-07-01T09:00:00Z"}]
   */
  async listFormSubmissions(formId, page, perPage) {
    const logTag = '[listFormSubmissions]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/forms/${ formId }/submissions`,
      method: 'get',
      query: {
        page,
        per_page: perPage || DEFAULT_PER_PAGE,
      },
    })
  }

  /**
   * @operationName Delete Form Submission
   * @category Forms
   * @description Permanently deletes a single form submission by its id. This action cannot be undone. Returns a confirmation object.
   * @route DELETE /delete-submission
   *
   * @paramDef {"type":"String","label":"Submission ID","name":"submissionId","required":true,"description":"The id of the form submission to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"submission_id":"sub_1"}
   */
  async deleteSubmission(submissionId) {
    const logTag = '[deleteSubmission]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/submissions/${ submissionId }`,
      method: 'delete',
    })

    return { deleted: true, submission_id: submissionId }
  }

  // ---------------------------------------------------------------------------
  // DNS
  // ---------------------------------------------------------------------------

  /**
   * @operationName List DNS Zones
   * @category DNS
   * @description Lists all DNS zones the authenticated user manages in Netlify DNS. Each zone includes its id, domain name, name servers, and associated account.
   * @route GET /list-dns-zones
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"zone_1","name":"example.com","account_id":"acct_123","dns_servers":["dns1.p01.nsone.net"],"records_count":5}]
   */
  async listDnsZones() {
    const logTag = '[listDnsZones]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/dns_zones`,
      method: 'get',
    })
  }

  /**
   * @operationName List DNS Records
   * @category DNS
   * @description Lists all DNS records for a DNS zone. Each record includes its id, type (A, AAAA, CNAME, MX, TXT, etc.), hostname, value, and TTL.
   * @route GET /list-dns-records
   *
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"description":"The id of the DNS zone whose records to list. Get it from List DNS Zones."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"rec_1","zone_id":"zone_1","type":"A","hostname":"example.com","value":"192.0.2.1","ttl":3600}]
   */
  async listDnsRecords(zoneId) {
    const logTag = '[listDnsRecords]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/dns_zones/${ zoneId }/dns_records`,
      method: 'get',
    })
  }

  /**
   * @operationName Create DNS Record
   * @category DNS
   * @description Creates a new DNS record in a zone. Provide the record type, hostname, value, and optional TTL. Returns the created DNS record object.
   * @route POST /create-dns-record
   *
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"description":"The id of the DNS zone to add the record to. Get it from List DNS Zones."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["A","AAAA","CNAME","MX","TXT","NS","SPF","CAA","SRV"]}},"description":"The DNS record type."}
   * @paramDef {"type":"String","label":"Hostname","name":"hostname","required":true,"description":"The fully qualified hostname for the record, e.g. www.example.com."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The record value, e.g. an IP address for A records or a target host for CNAME records."}
   * @paramDef {"type":"Number","label":"TTL","name":"ttl","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Time to live in seconds. Defaults to Netlify's automatic TTL if omitted."}
   *
   * @returns {Object}
   * @sampleResult {"id":"rec_2","zone_id":"zone_1","type":"CNAME","hostname":"www.example.com","value":"example.com","ttl":3600}
   */
  async createDnsRecord(zoneId, type, hostname, value, ttl) {
    const logTag = '[createDnsRecord]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/dns_zones/${ zoneId }/dns_records`,
      method: 'post',
      body: clean({
        type,
        hostname,
        value,
        ttl,
      }),
    })
  }

  /**
   * @operationName Delete DNS Record
   * @category DNS
   * @description Permanently deletes a DNS record from a zone by its id. This action cannot be undone. Returns a confirmation object.
   * @route DELETE /delete-dns-record
   *
   * @paramDef {"type":"String","label":"Zone ID","name":"zoneId","required":true,"description":"The id of the DNS zone containing the record. Get it from List DNS Zones."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"The id of the DNS record to delete. Get it from List DNS Records."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"record_id":"rec_2"}
   */
  async deleteDnsRecord(zoneId, recordId) {
    const logTag = '[deleteDnsRecord]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/dns_zones/${ zoneId }/dns_records/${ recordId }`,
      method: 'delete',
    })

    return { deleted: true, record_id: recordId }
  }

  // ---------------------------------------------------------------------------
  // Account
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Accounts
   * @category Account
   * @description Lists the accounts (teams) the authenticated user belongs to. Use this to discover the account id required by the Environment Variable operations, then set it as the Account ID config item.
   * @route GET /list-accounts
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"acct_123","name":"Acme Team","slug":"acme","type_name":"Pro","roles_allowed":["owner"]}]
   */
  async listAccounts() {
    const logTag = '[listAccounts]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/accounts`,
      method: 'get',
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getSitesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter sites by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sites Dictionary
   * @description Provides a searchable list of the account's sites for selecting a site in site-scoped operations. The option value is the site id.
   * @route POST /get-sites-dictionary
   * @paramDef {"type":"getSitesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing sites."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"my-site","value":"a1b2c3d4-0000-0000-0000-000000000000","note":"https://my-site.netlify.app"}],"cursor":"2"}
   */
  async getSitesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getSitesDictionary]'

    const page = cursor ? Number(cursor) : 1

    const sites = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sites`,
      method: 'get',
      query: {
        name: search,
        page,
        per_page: DEFAULT_PER_PAGE,
      },
    })

    const list = Array.isArray(sites) ? sites : []

    return {
      items: list.map(site => ({
        label: site.name || site.id,
        value: site.id,
        note: site.custom_domain || site.url || undefined,
      })),
      cursor: list.length === DEFAULT_PER_PAGE ? String(page + 1) : undefined,
    }
  }

  /**
   * @typedef {Object} getFormsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Site","name":"siteId","dictionary":"getSitesDictionary","description":"The site whose forms should be listed."}
   */

  /**
   * @typedef {Object} getFormsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter forms by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Netlify returns all forms in one call, so this is unused."}
   * @paramDef {"type":"getFormsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent values; requires the selected site id."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Forms Dictionary
   * @description Provides a searchable list of a site's Netlify Forms for selecting a form in form operations. Depends on a selected site. The option value is the form id.
   * @route POST /get-forms-dictionary
   * @paramDef {"type":"getFormsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the selected site id."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"contact","value":"form_1","note":"42 submissions"}],"cursor":null}
   */
  async getFormsDictionary(payload) {
    const { search, criteria } = payload || {}
    const logTag = '[getFormsDictionary]'

    const siteId = criteria?.siteId

    if (!siteId) {
      return { items: [], cursor: null }
    }

    const forms = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sites/${ siteId }/forms`,
      method: 'get',
    })

    const list = Array.isArray(forms) ? forms : []
    const searchLower = (search || '').toLowerCase()

    return {
      items: list
        .filter(form => !searchLower || (form.name || '').toLowerCase().includes(searchLower))
        .map(form => ({
          label: form.name || form.id,
          value: form.id,
          note: form.submission_count !== undefined ? `${ form.submission_count } submissions` : undefined,
        })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(NetlifyService, [
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Netlify personal access token (sent as a Bearer token). Create one in Netlify → User settings → Applications → Personal access tokens.',
  },
  {
    name: 'accountId',
    displayName: 'Account ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional. Required only for Environment Variable operations. Find it with the List Accounts operation (the account "id" field) or in Netlify → Team settings.',
  },
])
