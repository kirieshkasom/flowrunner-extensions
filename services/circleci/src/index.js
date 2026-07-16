const logger = {
  info: (...args) => console.log('[CircleCI] info:', ...args),
  debug: (...args) => console.log('[CircleCI] debug:', ...args),
  error: (...args) => console.log('[CircleCI] error:', ...args),
  warn: (...args) => console.log('[CircleCI] warn:', ...args),
}

const API_BASE_URL = 'https://circleci.com/api/v2'

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
 * @integrationName CircleCI
 * @integrationIcon /icon.svg
 */
class CircleCIService {
  constructor(config) {
    this.apiToken = config.apiToken
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Circle-Token': this.apiToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.message || error.message

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`CircleCI API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  // ---------------------------------------------------------------------------
  // Pipelines
  // ---------------------------------------------------------------------------

  /**
   * @operationName Trigger Pipeline
   * @category Pipelines
   * @description Triggers a new pipeline on a CircleCI project. Provide the project slug in the form vcs-slug/org-name/repo-name (e.g. gh/acme/app) or circleci/{orgId}/{projectId}. You may target a specific branch OR tag (not both), and pass pipeline parameters as a JSON object to override config parameters. Returns the created pipeline's id, number, state, and creation time.
   * @route POST /trigger-pipeline
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"description":"Project slug: vcs-slug/org-name/repo-name (e.g. gh/acme/app) or circleci/{orgId}/{projectId}."}
   * @paramDef {"type":"String","label":"Branch","name":"branch","description":"The branch to build (e.g. main). Mutually exclusive with Tag."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"The tag to build. Mutually exclusive with Branch."}
   * @paramDef {"type":"Object","label":"Parameters","name":"parameters","description":"Optional JSON object of pipeline parameters to pass to the pipeline (keys must be defined in the project config)."}
   * @returns {Object}
   * @sampleResult {"id":"5c5f5b6e-1234-4a3b-9c2d-abcdef012345","state":"pending","number":25,"created_at":"2026-07-14T10:15:00Z"}
   */
  async triggerPipeline(projectSlug, branch, tag, parameters) {
    return await this.#apiRequest({
      logTag: '[triggerPipeline]',
      url: `${ API_BASE_URL }/project/${ encodeURIComponent(projectSlug) }/pipeline`,
      method: 'post',
      body: clean({
        branch,
        tag,
        parameters: parameters || undefined,
      }),
    })
  }

  /**
   * @operationName Get Pipeline
   * @category Pipelines
   * @description Retrieves a single pipeline by its unique CircleCI pipeline ID (UUID). Returns full pipeline details including state, number, trigger information, and the VCS commit that triggered it.
   * @route GET /get-pipeline
   * @paramDef {"type":"String","label":"Pipeline ID","name":"pipelineId","required":true,"description":"The unique UUID of the pipeline."}
   * @returns {Object}
   * @sampleResult {"id":"5c5f5b6e-1234-4a3b-9c2d-abcdef012345","errors":[],"project_slug":"gh/acme/app","updated_at":"2026-07-14T10:16:00Z","number":25,"state":"created","created_at":"2026-07-14T10:15:00Z","trigger":{"type":"api","actor":{"login":"jane","avatar_url":"https://..."}},"vcs":{"origin_repository_url":"https://github.com/acme/app","branch":"main","revision":"abc123"}}
   */
  async getPipeline(pipelineId) {
    return await this.#apiRequest({
      logTag: '[getPipeline]',
      url: `${ API_BASE_URL }/pipeline/${ encodeURIComponent(pipelineId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Pipeline by Number
   * @category Pipelines
   * @description Retrieves a pipeline by its sequential pipeline number within a specific project. Provide the project slug and the pipeline number. Returns the same detailed pipeline object as Get Pipeline.
   * @route GET /get-pipeline-by-number
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"description":"Project slug: vcs-slug/org-name/repo-name (e.g. gh/acme/app)."}
   * @paramDef {"type":"Number","label":"Pipeline Number","name":"pipelineNumber","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The sequential pipeline number within the project."}
   * @returns {Object}
   * @sampleResult {"id":"5c5f5b6e-1234-4a3b-9c2d-abcdef012345","project_slug":"gh/acme/app","number":25,"state":"created","created_at":"2026-07-14T10:15:00Z","vcs":{"branch":"main","revision":"abc123"}}
   */
  async getPipelineByNumber(projectSlug, pipelineNumber) {
    return await this.#apiRequest({
      logTag: '[getPipelineByNumber]',
      url: `${ API_BASE_URL }/project/${ encodeURIComponent(projectSlug) }/pipeline/${ encodeURIComponent(pipelineNumber) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Project Pipelines
   * @category Pipelines
   * @description Lists all pipelines for a project, most recent first. Optionally filter by branch. Results are paginated: pass the next_page_token from a previous response as Page Token to fetch the next page.
   * @route GET /list-project-pipelines
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"description":"Project slug: vcs-slug/org-name/repo-name (e.g. gh/acme/app)."}
   * @paramDef {"type":"String","label":"Branch","name":"branch","description":"Optional branch name to filter pipelines by."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token (next_page_token) from a previous response."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"5c5f5b6e-1234-4a3b-9c2d-abcdef012345","number":25,"state":"created","created_at":"2026-07-14T10:15:00Z","vcs":{"branch":"main","revision":"abc123"}}],"next_page_token":"eyJvIjoxfQ"}
   */
  async listProjectPipelines(projectSlug, branch, pageToken) {
    return await this.#apiRequest({
      logTag: '[listProjectPipelines]',
      url: `${ API_BASE_URL }/project/${ encodeURIComponent(projectSlug) }/pipeline`,
      method: 'get',
      query: {
        branch,
        'page-token': pageToken,
      },
    })
  }

  /**
   * @operationName List My Pipelines
   * @category Pipelines
   * @description Lists the pipelines in a project that were triggered by the current user (owner of the API token). Results are paginated via the Page Token parameter.
   * @route GET /list-my-pipelines
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"description":"Project slug: vcs-slug/org-name/repo-name (e.g. gh/acme/app)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token (next_page_token) from a previous response."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"5c5f5b6e-1234-4a3b-9c2d-abcdef012345","number":25,"state":"created","created_at":"2026-07-14T10:15:00Z","vcs":{"branch":"main"}}],"next_page_token":"eyJvIjoxfQ"}
   */
  async listMyPipelines(projectSlug, pageToken) {
    return await this.#apiRequest({
      logTag: '[listMyPipelines]',
      url: `${ API_BASE_URL }/project/${ encodeURIComponent(projectSlug) }/pipeline/mine`,
      method: 'get',
      query: {
        'page-token': pageToken,
      },
    })
  }

  /**
   * @operationName Get Pipeline Config
   * @category Pipelines
   * @description Retrieves the configuration for a pipeline by its ID, including the original source config and the compiled config that CircleCI actually ran (with any setup-workflow configs).
   * @route GET /get-pipeline-config
   * @paramDef {"type":"String","label":"Pipeline ID","name":"pipelineId","required":true,"description":"The unique UUID of the pipeline."}
   * @returns {Object}
   * @sampleResult {"source":"version: 2.1\njobs:\n  build:\n    ...","compiled":"version: 2\njobs:\n  build:\n    ...","setup-config":"","compiled-setup-config":""}
   */
  async getPipelineConfig(pipelineId) {
    return await this.#apiRequest({
      logTag: '[getPipelineConfig]',
      url: `${ API_BASE_URL }/pipeline/${ encodeURIComponent(pipelineId) }/config`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Pipeline Workflows
   * @category Pipelines
   * @description Lists the workflows belonging to a pipeline, identified by pipeline ID. Each workflow includes its id, name, status, and timing. Results are paginated via the Page Token parameter.
   * @route GET /get-pipeline-workflows
   * @paramDef {"type":"String","label":"Pipeline ID","name":"pipelineId","required":true,"description":"The unique UUID of the pipeline."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token (next_page_token) from a previous response."}
   * @returns {Object}
   * @sampleResult {"items":[{"pipeline_id":"5c5f5b6e-1234-4a3b-9c2d-abcdef012345","id":"c9e2a1f0-2222-4b3c-8d4e-112233445566","name":"build-and-test","status":"success","pipeline_number":25,"created_at":"2026-07-14T10:15:05Z","stopped_at":"2026-07-14T10:18:00Z"}],"next_page_token":null}
   */
  async getPipelineWorkflows(pipelineId, pageToken) {
    return await this.#apiRequest({
      logTag: '[getPipelineWorkflows]',
      url: `${ API_BASE_URL }/pipeline/${ encodeURIComponent(pipelineId) }/workflow`,
      method: 'get',
      query: {
        'page-token': pageToken,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Workflows
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Workflow
   * @category Workflows
   * @description Retrieves a single workflow by its unique ID (UUID). Returns the workflow's name, status, associated pipeline, and timing details.
   * @route GET /get-workflow
   * @paramDef {"type":"String","label":"Workflow ID","name":"workflowId","required":true,"description":"The unique UUID of the workflow."}
   * @returns {Object}
   * @sampleResult {"pipeline_id":"5c5f5b6e-1234-4a3b-9c2d-abcdef012345","id":"c9e2a1f0-2222-4b3c-8d4e-112233445566","name":"build-and-test","project_slug":"gh/acme/app","status":"success","started_by":"jane","pipeline_number":25,"created_at":"2026-07-14T10:15:05Z","stopped_at":"2026-07-14T10:18:00Z"}
   */
  async getWorkflow(workflowId) {
    return await this.#apiRequest({
      logTag: '[getWorkflow]',
      url: `${ API_BASE_URL }/workflow/${ encodeURIComponent(workflowId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Workflow Jobs
   * @category Workflows
   * @description Lists all jobs in a workflow, identified by workflow ID. Each job includes its id, name, job_number, type, status, and dependencies. Results are paginated via the Page Token parameter.
   * @route GET /get-workflow-jobs
   * @paramDef {"type":"String","label":"Workflow ID","name":"workflowId","required":true,"description":"The unique UUID of the workflow."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token (next_page_token) from a previous response."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"a1b2c3d4-3333-4c4d-9e5f-223344556677","name":"build","job_number":42,"type":"build","status":"success","started_at":"2026-07-14T10:15:10Z","stopped_at":"2026-07-14T10:16:30Z","dependencies":[]}],"next_page_token":null}
   */
  async getWorkflowJobs(workflowId, pageToken) {
    return await this.#apiRequest({
      logTag: '[getWorkflowJobs]',
      url: `${ API_BASE_URL }/workflow/${ encodeURIComponent(workflowId) }/job`,
      method: 'get',
      query: {
        'page-token': pageToken,
      },
    })
  }

  /**
   * @operationName Cancel Workflow
   * @category Workflows
   * @description Cancels a running workflow by its unique ID. Returns a confirmation message. Only workflows that are still running can be cancelled.
   * @route POST /cancel-workflow
   * @paramDef {"type":"String","label":"Workflow ID","name":"workflowId","required":true,"description":"The unique UUID of the workflow to cancel."}
   * @returns {Object}
   * @sampleResult {"message":"Accepted."}
   */
  async cancelWorkflow(workflowId) {
    return await this.#apiRequest({
      logTag: '[cancelWorkflow]',
      url: `${ API_BASE_URL }/workflow/${ encodeURIComponent(workflowId) }/cancel`,
      method: 'post',
    })
  }

  /**
   * @operationName Rerun Workflow
   * @category Workflows
   * @description Reruns a workflow by its unique ID. Set "From Failed" to true to rerun only the failed jobs (and everything downstream); leave false to rerun the entire workflow from the start. Returns the ID of the newly created workflow.
   * @route POST /rerun-workflow
   * @paramDef {"type":"String","label":"Workflow ID","name":"workflowId","required":true,"description":"The unique UUID of the workflow to rerun."}
   * @paramDef {"type":"Boolean","label":"From Failed","name":"fromFailed","uiComponent":{"type":"TOGGLE"},"description":"If true, rerun only the failed jobs. If false, rerun the whole workflow from the start."}
   * @returns {Object}
   * @sampleResult {"workflow_id":"d4e5f6a7-4444-4d5e-af6a-334455667788"}
   */
  async rerunWorkflow(workflowId, fromFailed) {
    return await this.#apiRequest({
      logTag: '[rerunWorkflow]',
      url: `${ API_BASE_URL }/workflow/${ encodeURIComponent(workflowId) }/rerun`,
      method: 'post',
      body: clean({
        from_failed: fromFailed === undefined ? undefined : Boolean(fromFailed),
      }),
    })
  }

  // ---------------------------------------------------------------------------
  // Jobs
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Job Details
   * @category Jobs
   * @description Retrieves details of a single job within a project by its job number. Returns the job's name, status, timing, executor, and the workflow/pipeline it belongs to.
   * @route GET /get-job-details
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"description":"Project slug: vcs-slug/org-name/repo-name (e.g. gh/acme/app)."}
   * @paramDef {"type":"Number","label":"Job Number","name":"jobNumber","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The job number within the project."}
   * @returns {Object}
   * @sampleResult {"web_url":"https://app.circleci.com/pipelines/gh/acme/app/25/workflows/c9e2a1f0/jobs/42","project":{"slug":"gh/acme/app","name":"app"},"number":42,"name":"build","status":"success","started_at":"2026-07-14T10:15:10Z","stopped_at":"2026-07-14T10:16:30Z","duration":80000}
   */
  async getJobDetails(projectSlug, jobNumber) {
    return await this.#apiRequest({
      logTag: '[getJobDetails]',
      url: `${ API_BASE_URL }/project/${ encodeURIComponent(projectSlug) }/job/${ encodeURIComponent(jobNumber) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Cancel Job
   * @category Jobs
   * @description Cancels a running job within a project by its job number. Returns a confirmation message. Only jobs that are still running can be cancelled.
   * @route POST /cancel-job
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"description":"Project slug: vcs-slug/org-name/repo-name (e.g. gh/acme/app)."}
   * @paramDef {"type":"Number","label":"Job Number","name":"jobNumber","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The job number within the project to cancel."}
   * @returns {Object}
   * @sampleResult {"message":"Job cancelled successfully."}
   */
  async cancelJob(projectSlug, jobNumber) {
    return await this.#apiRequest({
      logTag: '[cancelJob]',
      url: `${ API_BASE_URL }/project/${ encodeURIComponent(projectSlug) }/job/${ encodeURIComponent(jobNumber) }/cancel`,
      method: 'post',
    })
  }

  /**
   * @operationName Get Job Artifacts
   * @category Jobs
   * @description Lists the artifacts produced by a job within a project, identified by job number. Each artifact includes its relative path, parallel-run node index, and a download URL (append the API token when fetching).
   * @route GET /get-job-artifacts
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"description":"Project slug: vcs-slug/org-name/repo-name (e.g. gh/acme/app)."}
   * @paramDef {"type":"Number","label":"Job Number","name":"jobNumber","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The job number within the project."}
   * @returns {Object}
   * @sampleResult {"items":[{"path":"tmp/artifact.txt","node_index":0,"url":"https://circle-artifacts.com/0/tmp/artifact.txt"}],"next_page_token":null}
   */
  async getJobArtifacts(projectSlug, jobNumber) {
    return await this.#apiRequest({
      logTag: '[getJobArtifacts]',
      url: `${ API_BASE_URL }/project/${ encodeURIComponent(projectSlug) }/${ encodeURIComponent(jobNumber) }/artifacts`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Test Metadata
   * @category Jobs
   * @description Retrieves test metadata for a job within a project, identified by job number. Returns each test's name, class, file, result, run time, and any failure message. Requires the job to upload test results via the store_test_results step.
   * @route GET /get-test-metadata
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"description":"Project slug: vcs-slug/org-name/repo-name (e.g. gh/acme/app)."}
   * @paramDef {"type":"Number","label":"Job Number","name":"jobNumber","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The job number within the project."}
   * @returns {Object}
   * @sampleResult {"items":[{"message":"","source":"junit","run_time":0.234,"file":"src/app.test.js","result":"success","name":"renders header","classname":"AppTest"}],"next_page_token":null}
   */
  async getTestMetadata(projectSlug, jobNumber) {
    return await this.#apiRequest({
      logTag: '[getTestMetadata]',
      url: `${ API_BASE_URL }/project/${ encodeURIComponent(projectSlug) }/${ encodeURIComponent(jobNumber) }/tests`,
      method: 'get',
    })
  }

  // ---------------------------------------------------------------------------
  // Project
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Project
   * @category Project
   * @description Retrieves details of a project by its slug, including the project name, organization, VCS information, and default branch.
   * @route GET /get-project
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"description":"Project slug: vcs-slug/org-name/repo-name (e.g. gh/acme/app)."}
   * @returns {Object}
   * @sampleResult {"slug":"gh/acme/app","name":"app","id":"e0f1a2b3-5555-4e6f-b07a-445566778899","organization_name":"acme","organization_slug":"gh/acme","organization_id":"f1a2b3c4-6666-4f70-c18b-556677889900","vcs_info":{"vcs_url":"https://github.com/acme/app","provider":"GitHub","default_branch":"main"}}
   */
  async getProject(projectSlug) {
    return await this.#apiRequest({
      logTag: '[getProject]',
      url: `${ API_BASE_URL }/project/${ encodeURIComponent(projectSlug) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Env Vars
   * @category Project
   * @description Lists the environment variables for a project. Values are masked by CircleCI (only the last four characters are shown). Results are paginated via the Page Token parameter.
   * @route GET /list-env-vars
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"description":"Project slug: vcs-slug/org-name/repo-name (e.g. gh/acme/app)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token (next_page_token) from a previous response."}
   * @returns {Object}
   * @sampleResult {"items":[{"name":"API_KEY","value":"xxxx1234"}],"next_page_token":null}
   */
  async listEnvVars(projectSlug, pageToken) {
    return await this.#apiRequest({
      logTag: '[listEnvVars]',
      url: `${ API_BASE_URL }/project/${ encodeURIComponent(projectSlug) }/envvar`,
      method: 'get',
      query: {
        'page-token': pageToken,
      },
    })
  }

  /**
   * @operationName Create Env Var
   * @category Project
   * @description Creates (or overwrites) an environment variable on a project. Provide the variable name and its plaintext value; CircleCI stores it encrypted and returns the value masked. Overwrites any existing variable with the same name.
   * @route POST /create-env-var
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"description":"Project slug: vcs-slug/org-name/repo-name (e.g. gh/acme/app)."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The environment variable name (e.g. API_KEY)."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The plaintext value to store. It will be encrypted at rest and masked in responses."}
   * @returns {Object}
   * @sampleResult {"name":"API_KEY","value":"xxxx1234","created_at":"2026-07-14T10:20:00Z"}
   */
  async createEnvVar(projectSlug, name, value) {
    return await this.#apiRequest({
      logTag: '[createEnvVar]',
      url: `${ API_BASE_URL }/project/${ encodeURIComponent(projectSlug) }/envvar`,
      method: 'post',
      body: {
        name,
        value,
      },
    })
  }

  /**
   * @operationName Delete Env Var
   * @category Project
   * @description Deletes an environment variable from a project by name. Returns a confirmation message.
   * @route DELETE /delete-env-var
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"description":"Project slug: vcs-slug/org-name/repo-name (e.g. gh/acme/app)."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the environment variable to delete."}
   * @returns {Object}
   * @sampleResult {"message":"Deleted successfully."}
   */
  async deleteEnvVar(projectSlug, name) {
    return await this.#apiRequest({
      logTag: '[deleteEnvVar]',
      url: `${ API_BASE_URL }/project/${ encodeURIComponent(projectSlug) }/envvar/${ encodeURIComponent(name) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Checkout Keys
   * @category Project
   * @description Lists the checkout keys (deploy keys / user keys) configured for a project. Each key includes its type, public key, fingerprint, whether it is preferred, and creation time. Private keys are never returned.
   * @route GET /list-checkout-keys
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"description":"Project slug: vcs-slug/org-name/repo-name (e.g. gh/acme/app)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token (next_page_token) from a previous response."}
   * @returns {Object}
   * @sampleResult {"items":[{"public_key":"ssh-rsa AAAA...","type":"deploy-key","fingerprint":"c9:0c:...","preferred":true,"created_at":"2026-06-01T09:00:00Z"}],"next_page_token":null}
   */
  async listCheckoutKeys(projectSlug, pageToken) {
    return await this.#apiRequest({
      logTag: '[listCheckoutKeys]',
      url: `${ API_BASE_URL }/project/${ encodeURIComponent(projectSlug) }/checkout-key`,
      method: 'get',
      query: {
        'page-token': pageToken,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Me
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Current User
   * @category Account
   * @description Retrieves information about the user whose API token is configured. Useful as a connection/authentication check. Returns the user id, login, and name.
   * @route GET /get-current-user
   * @returns {Object}
   * @sampleResult {"id":"a2b3c4d5-7777-4081-d29c-667788990011","login":"jane","name":"Jane Doe"}
   */
  async getCurrentUser() {
    return await this.#apiRequest({
      logTag: '[getCurrentUser]',
      url: `${ API_BASE_URL }/me`,
      method: 'get',
    })
  }
}

Flowrunner.ServerCode.addService(CircleCIService, [
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your CircleCI Personal API Token, sent as the Circle-Token header. Create one in CircleCI under User Settings > Personal API Tokens.',
  },
])
