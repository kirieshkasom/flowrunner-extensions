const logger = {
  info: (...args) => console.log('[Travis CI] info:', ...args),
  debug: (...args) => console.log('[Travis CI] debug:', ...args),
  error: (...args) => console.log('[Travis CI] error:', ...args),
  warn: (...args) => console.log('[Travis CI] warn:', ...args),
}

const API_VERSION = '3'

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
 * @integrationName Travis CI
 * @integrationIcon /icon.svg
 */
class TravisCIService {
  constructor(config) {
    this.apiToken = config.apiToken
    this.domain = config.domain || 'travis-ci.com'
    this.baseUrl = `https://api.${ this.domain }`
  }

  /**
   * Encodes a repository slug (owner/name) for use in a URL path.
   * Travis expects the slash escaped, e.g. "owner/name" -> "owner%2Fname".
   */
  #encodeSlug(slug) {
    if (!slug) {
      throw new Error('Travis CI API error: repository slug (owner/name) is required')
    }

    return encodeURIComponent(String(slug).trim())
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ path, method = 'get', body, query, logTag, raw = false }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `token ${ this.apiToken }`,
          'Travis-API-Version': API_VERSION,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      if (raw) {
        request = request.setEncoding(null)
      }

      const response = body !== undefined ? await request.send(body) : await request

      return response
    } catch (error) {
      const message = error.body?.error_message ||
        error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))
      const errorType = error.body?.error_type
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - Request failed (status=${ status }, type=${ errorType }): ${ message }`)

      throw new Error(`Travis CI API error${ status ? ` [${ status }]` : '' }${ errorType ? ` (${ errorType })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName List Repositories
   * @category Repositories
   * @description Lists repositories accessible to the authenticated user. Use Active Only to return only repositories with builds enabled on Travis CI. Supports pagination via Limit and Offset, and sorting.
   * @route GET /repos
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"Boolean","label":"Active Only","name":"activeOnly","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, only returns repositories that are currently active (builds enabled) on Travis CI."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of repositories to return per page. Travis defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of repositories to skip before the first returned entry, used for pagination."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Default","ID","Name","Active","Last Build (Newest)"]}},"description":"How to order the returned repositories."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"repositories","@pagination":{"limit":100,"offset":0,"count":2},"repositories":[{"@type":"repository","id":123,"name":"my-project","slug":"owner/my-project","description":"My project","active":true,"private":false,"default_branch":{"name":"main"}}]}
   */
  async listRepositories(activeOnly, limit, offset, sortBy) {
    const logTag = '[listRepositories]'
    const sort = this.#resolveChoice(sortBy, {
      'Default': undefined,
      'ID': 'id',
      'Name': 'name',
      'Active': 'active',
      'Last Build (Newest)': 'current_build:desc',
    })

    return await this.#apiRequest({
      logTag,
      path: '/repos',
      method: 'get',
      query: {
        active_only: activeOnly ? 'true' : undefined,
        limit,
        offset,
        sort_by: sort,
      },
    })
  }

  /**
   * @operationName Get Repository
   * @category Repositories
   * @description Retrieves a single repository by its slug (owner/name), including its active state, privacy, default branch, and owner.
   * @route GET /repo
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"String","label":"Repository Slug","name":"slug","required":true,"description":"Repository identifier in the form owner/name, e.g. travis-ci/travis-web."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"repository","id":123,"name":"my-project","slug":"owner/my-project","description":"My project","active":true,"private":false,"owner":{"login":"owner"},"default_branch":{"name":"main"},"starred":false}
   */
  async getRepository(slug) {
    const logTag = '[getRepository]'

    return await this.#apiRequest({
      logTag,
      path: `/repo/${ this.#encodeSlug(slug) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Activate Repository
   * @category Repositories
   * @description Activates a repository so Travis CI will run builds for it. Requires admin access to the repository.
   * @route POST /repo/activate
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"String","label":"Repository Slug","name":"slug","required":true,"description":"Repository identifier in the form owner/name."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"repository","id":123,"name":"my-project","slug":"owner/my-project","active":true,"private":false}
   */
  async activateRepository(slug) {
    const logTag = '[activateRepository]'

    return await this.#apiRequest({
      logTag,
      path: `/repo/${ this.#encodeSlug(slug) }/activate`,
      method: 'post',
    })
  }

  /**
   * @operationName Deactivate Repository
   * @category Repositories
   * @description Deactivates a repository so Travis CI will no longer run builds for it. Requires admin access to the repository.
   * @route POST /repo/deactivate
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"String","label":"Repository Slug","name":"slug","required":true,"description":"Repository identifier in the form owner/name."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"repository","id":123,"name":"my-project","slug":"owner/my-project","active":false,"private":false}
   */
  async deactivateRepository(slug) {
    const logTag = '[deactivateRepository]'

    return await this.#apiRequest({
      logTag,
      path: `/repo/${ this.#encodeSlug(slug) }/deactivate`,
      method: 'post',
    })
  }

  /**
   * @operationName Star Repository
   * @category Repositories
   * @description Stars a repository for the authenticated user so it is highlighted in the Travis CI dashboard.
   * @route POST /repo/star
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"String","label":"Repository Slug","name":"slug","required":true,"description":"Repository identifier in the form owner/name."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"repository","id":123,"name":"my-project","slug":"owner/my-project","starred":true}
   */
  async starRepository(slug) {
    const logTag = '[starRepository]'

    return await this.#apiRequest({
      logTag,
      path: `/repo/${ this.#encodeSlug(slug) }/star`,
      method: 'post',
    })
  }

  /**
   * @operationName Unstar Repository
   * @category Repositories
   * @description Removes the star from a repository for the authenticated user.
   * @route POST /repo/unstar
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"String","label":"Repository Slug","name":"slug","required":true,"description":"Repository identifier in the form owner/name."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"repository","id":123,"name":"my-project","slug":"owner/my-project","starred":false}
   */
  async unstarRepository(slug) {
    const logTag = '[unstarRepository]'

    return await this.#apiRequest({
      logTag,
      path: `/repo/${ this.#encodeSlug(slug) }/unstar`,
      method: 'post',
    })
  }

  /**
   * @operationName List Builds
   * @category Builds
   * @description Lists builds for a repository, most recent first by default. Supports sorting and a Limit to control how many builds are returned.
   * @route GET /repo/builds
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"String","label":"Repository Slug","name":"slug","required":true,"description":"Repository identifier in the form owner/name."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Newest First","Oldest First","Recently Started","Recently Finished"]}},"description":"How to order the returned builds. Defaults to newest first."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of builds to return."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of builds to skip before the first returned entry, used for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"builds","@pagination":{"limit":25,"offset":0,"count":1},"builds":[{"@type":"build","id":456,"number":"12","state":"passed","event_type":"push","branch":{"name":"main"},"commit":{"sha":"abc123","message":"Fix bug"}}]}
   */
  async listBuilds(slug, sortBy, limit, offset) {
    const logTag = '[listBuilds]'
    const sort = this.#resolveChoice(sortBy, {
      'Newest First': 'number:desc',
      'Oldest First': 'number:asc',
      'Recently Started': 'started_at:desc',
      'Recently Finished': 'finished_at:desc',
    })

    return await this.#apiRequest({
      logTag,
      path: `/repo/${ this.#encodeSlug(slug) }/builds`,
      method: 'get',
      query: {
        sort_by: sort,
        limit,
        offset,
      },
    })
  }

  /**
   * @operationName Get Build
   * @category Builds
   * @description Retrieves a single build by its numeric ID, including its state, event type, branch, commit, and jobs.
   * @route GET /build
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"Number","label":"Build ID","name":"buildId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the build (not the build number)."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"build","id":456,"number":"12","state":"passed","duration":120,"event_type":"push","branch":{"name":"main"},"commit":{"sha":"abc123","message":"Fix bug"},"jobs":[{"@type":"job","id":789}]}
   */
  async getBuild(buildId) {
    const logTag = '[getBuild]'

    return await this.#apiRequest({
      logTag,
      path: `/build/${ encodeURIComponent(buildId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Cancel Build
   * @category Builds
   * @description Cancels a running or queued build by its numeric ID. All of the build's jobs are cancelled.
   * @route POST /build/cancel
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"Number","label":"Build ID","name":"buildId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the build to cancel."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"pending","state_change":"cancel","build":{"@type":"build","id":456,"number":"12","state":"canceled"}}
   */
  async cancelBuild(buildId) {
    const logTag = '[cancelBuild]'

    return await this.#apiRequest({
      logTag,
      path: `/build/${ encodeURIComponent(buildId) }/cancel`,
      method: 'post',
    })
  }

  /**
   * @operationName Restart Build
   * @category Builds
   * @description Restarts a build by its numeric ID, re-running all of its jobs.
   * @route POST /build/restart
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"Number","label":"Build ID","name":"buildId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the build to restart."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"pending","state_change":"restart","build":{"@type":"build","id":456,"number":"12","state":"created"}}
   */
  async restartBuild(buildId) {
    const logTag = '[restartBuild]'

    return await this.#apiRequest({
      logTag,
      path: `/build/${ encodeURIComponent(buildId) }/restart`,
      method: 'post',
    })
  }

  /**
   * @operationName Trigger Build
   * @category Builds
   * @description Triggers a new build for a repository on a given branch. Optionally include a commit message and a config object that overrides keys in the repository's .travis.yml for this build only.
   * @route POST /repo/requests
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"String","label":"Repository Slug","name":"slug","required":true,"description":"Repository identifier in the form owner/name."}
   * @paramDef {"type":"String","label":"Branch","name":"branch","required":true,"description":"Name of the branch to build, e.g. main."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional custom message describing why the build was triggered."}
   * @paramDef {"type":"Object","label":"Config Override","name":"config","description":"Optional build configuration object. Any keys provided override matching keys in the repository's .travis.yml for this build only."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"pending","remaining_requests":10,"repository":{"@type":"repository","id":123,"slug":"owner/my-project"},"request":{"@type":"request","id":999,"message":"Triggered via API","branch":"main"}}
   */
  async triggerBuild(slug, branch, message, config) {
    const logTag = '[triggerBuild]'

    return await this.#apiRequest({
      logTag,
      path: `/repo/${ this.#encodeSlug(slug) }/requests`,
      method: 'post',
      body: {
        request: clean({
          branch,
          message,
          config,
        }),
      },
    })
  }

  /**
   * @operationName List Build Jobs
   * @category Jobs
   * @description Lists all jobs belonging to a build, identified by the build's numeric ID.
   * @route GET /build/jobs
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"Number","label":"Build ID","name":"buildId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the build whose jobs to list."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"jobs","jobs":[{"@type":"job","id":789,"number":"12.1","state":"passed","started_at":"2024-01-01T00:00:00Z","finished_at":"2024-01-01T00:02:00Z"}]}
   */
  async listBuildJobs(buildId) {
    const logTag = '[listBuildJobs]'

    return await this.#apiRequest({
      logTag,
      path: `/build/${ encodeURIComponent(buildId) }/jobs`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Job
   * @category Jobs
   * @description Retrieves a single job by its numeric ID, including its state, timing, and the build it belongs to.
   * @route GET /job
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"Number","label":"Job ID","name":"jobId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the job."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"job","id":789,"number":"12.1","state":"passed","queue":"builds.gce","started_at":"2024-01-01T00:00:00Z","finished_at":"2024-01-01T00:02:00Z","build":{"@type":"build","id":456}}
   */
  async getJob(jobId) {
    const logTag = '[getJob]'

    return await this.#apiRequest({
      logTag,
      path: `/job/${ encodeURIComponent(jobId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Restart Job
   * @category Jobs
   * @description Restarts a single job by its numeric ID, re-running only that job.
   * @route POST /job/restart
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"Number","label":"Job ID","name":"jobId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the job to restart."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"pending","state_change":"restart","job":{"@type":"job","id":789,"number":"12.1","state":"created"}}
   */
  async restartJob(jobId) {
    const logTag = '[restartJob]'

    return await this.#apiRequest({
      logTag,
      path: `/job/${ encodeURIComponent(jobId) }/restart`,
      method: 'post',
    })
  }

  /**
   * @operationName Cancel Job
   * @category Jobs
   * @description Cancels a single running or queued job by its numeric ID.
   * @route POST /job/cancel
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"Number","label":"Job ID","name":"jobId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the job to cancel."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"pending","state_change":"cancel","job":{"@type":"job","id":789,"number":"12.1","state":"canceled"}}
   */
  async cancelJob(jobId) {
    const logTag = '[cancelJob]'

    return await this.#apiRequest({
      logTag,
      path: `/job/${ encodeURIComponent(jobId) }/cancel`,
      method: 'post',
    })
  }

  /**
   * @operationName Get Job Log
   * @category Jobs
   * @description Retrieves the raw text log for a single job by its numeric ID. Returns the full accumulated build output for that job.
   * @route GET /job/log
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"Number","label":"Job ID","name":"jobId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the job whose log to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":789,"log":"$ echo hello\nhello\nDone. Your build exited with 0.\n"}
   */
  async getJobLog(jobId) {
    const logTag = '[getJobLog]'
    const bytes = await this.#apiRequest({
      logTag,
      path: `/job/${ encodeURIComponent(jobId) }/log.txt`,
      method: 'get',
      raw: true,
    })

    const log = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes)

    return { jobId, log }
  }

  /**
   * @operationName List Environment Variables
   * @category Environment Variables
   * @description Lists the environment variables configured for a repository. Values of private (non-public) variables are not returned.
   * @route GET /repo/env-vars
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"String","label":"Repository Slug","name":"slug","required":true,"description":"Repository identifier in the form owner/name."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"env_vars","env_vars":[{"@type":"env_var","id":"a1b2","name":"API_KEY","public":false,"branch":null}]}
   */
  async listEnvVars(slug) {
    const logTag = '[listEnvVars]'

    return await this.#apiRequest({
      logTag,
      path: `/repo/${ this.#encodeSlug(slug) }/env_vars`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Environment Variable
   * @category Environment Variables
   * @description Creates an environment variable for a repository. Mark it Public to expose the value in the build environment and logs; keep it private (default) to hide the value. Optionally scope the variable to a single branch.
   * @route POST /repo/env-vars
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"String","label":"Repository Slug","name":"slug","required":true,"description":"Repository identifier in the form owner/name."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the environment variable, e.g. API_KEY."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"Value of the environment variable."}
   * @paramDef {"type":"Boolean","label":"Public","name":"isPublic","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, the value is visible in the build environment and logs. Defaults to private (hidden)."}
   * @paramDef {"type":"String","label":"Branch","name":"branch","description":"Optional branch name to scope the variable to. Leave empty to apply to all branches."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"env_var","id":"a1b2","name":"API_KEY","public":false,"branch":null}
   */
  async createEnvVar(slug, name, value, isPublic, branch) {
    const logTag = '[createEnvVar]'

    return await this.#apiRequest({
      logTag,
      path: `/repo/${ this.#encodeSlug(slug) }/env_vars`,
      method: 'post',
      body: {
        'env_var.name': name,
        'env_var.value': value,
        'env_var.public': Boolean(isPublic),
        ...(branch ? { 'env_var.branch': branch } : {}),
      },
    })
  }

  /**
   * @operationName Delete Environment Variable
   * @category Environment Variables
   * @description Deletes a single environment variable from a repository by its ID. Use List Environment Variables to find the ID.
   * @route DELETE /repo/env-var
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"String","label":"Repository Slug","name":"slug","required":true,"description":"Repository identifier in the form owner/name."}
   * @paramDef {"type":"String","label":"Environment Variable ID","name":"envVarId","required":true,"description":"ID of the environment variable to delete, as returned by List Environment Variables."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"envVarId":"a1b2"}
   */
  async deleteEnvVar(slug, envVarId) {
    const logTag = '[deleteEnvVar]'

    await this.#apiRequest({
      logTag,
      path: `/repo/${ this.#encodeSlug(slug) }/env_var/${ encodeURIComponent(envVarId) }`,
      method: 'delete',
    })

    return { deleted: true, envVarId }
  }

  /**
   * @operationName List Branches
   * @category Branches & Caches
   * @description Lists the branches known to Travis CI for a repository, including each branch's most recent build.
   * @route GET /repo/branches
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"String","label":"Repository Slug","name":"slug","required":true,"description":"Repository identifier in the form owner/name."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"branches","branches":[{"@type":"branch","name":"main","default_branch":true,"last_build":{"@type":"build","id":456,"state":"passed"}}]}
   */
  async listBranches(slug) {
    const logTag = '[listBranches]'

    return await this.#apiRequest({
      logTag,
      path: `/repo/${ this.#encodeSlug(slug) }/branches`,
      method: 'get',
    })
  }

  /**
   * @operationName List Caches
   * @category Branches & Caches
   * @description Lists the caches stored for a repository, including their branch, size, and last modified time.
   * @route GET /repo/caches
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @paramDef {"type":"String","label":"Repository Slug","name":"slug","required":true,"description":"Repository identifier in the form owner/name."}
   *
   * @returns {Object}
   * @sampleResult {"@type":"caches","caches":[{"@type":"cache","branch":"main","size":1048576,"last_modified":"2024-01-01T00:00:00Z"}]}
   */
  async listCaches(slug) {
    const logTag = '[listCaches]'

    return await this.#apiRequest({
      logTag,
      path: `/repo/${ this.#encodeSlug(slug) }/caches`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Current User
   * @category User
   * @description Retrieves the authenticated user associated with the API token. Useful for verifying that the token and domain are configured correctly.
   * @route GET /user
   * @appearanceColor #3EAAAF #6ED0D4
   *
   * @returns {Object}
   * @sampleResult {"@type":"user","id":42,"login":"octocat","name":"The Octocat","is_syncing":false,"synced_at":"2024-01-01T00:00:00Z"}
   */
  async getCurrentUser() {
    const logTag = '[getCurrentUser]'

    return await this.#apiRequest({
      logTag,
      path: '/user',
      method: 'get',
    })
  }
}

Flowrunner.ServerCode.addService(TravisCIService, [
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Travis CI API token. Find it in Travis CI under Settings -> API authentication -> your API token.',
  },
  {
    name: 'domain',
    displayName: 'Domain',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    required: true,
    shared: false,
    defaultValue: 'travis-ci.com',
    options: ['travis-ci.com', 'travis-ci.org'],
    hint: 'Use travis-ci.com for private and public repositories. travis-ci.org is the legacy platform.',
  },
])
