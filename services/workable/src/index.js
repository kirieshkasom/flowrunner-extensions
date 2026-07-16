'use strict'

const logger = {
  info: (...args) => console.log('[Workable] info:', ...args),
  debug: (...args) => console.log('[Workable] debug:', ...args),
  error: (...args) => console.log('[Workable] error:', ...args),
  warn: (...args) => console.log('[Workable] warn:', ...args),
}

// Drop undefined/null/empty entries so we never send blank query params or body keys the API
// would reject. Applied to every outbound query object and to constructed candidate payloads.
function clean(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const result = {}

  for (const key of Object.keys(obj)) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

// Map a friendly dropdown label back to the API token. Options expose human-readable labels; this
// resolves the selection to the value Workable expects. Pass-through when no mapping entry exists
// (so a free-typed value or an already-correct token still works).
function resolveChoice(value, mapping) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
}

// Friendly label -> Workable API value maps for fixed enums (transcribed from the SPI v3 spec).
const JOB_STATE_LABELS = {
  Draft: 'draft',
  Published: 'published',
  Closed: 'closed',
  Archived: 'archived',
}

// Candidate lifecycle state on the candidate object / GET /candidates filter.
const CANDIDATE_STATE_LABELS = {
  Active: 'active',
  Disqualified: 'disqualified',
  Hired: 'hired',
}

class WorkablePolling {
  // Compute { events, state } for one polling cycle. Workable returns candidates newest-first when
  // ordered by created_at; we emit any candidate whose id we have not seen and advance the
  // high-water mark to the newest created_at observed.
  static diff(candidates, state) {
    const ordered = [...candidates].sort((a, b) => {
      const at = new Date(a.created_at || 0).getTime()
      const bt = new Date(b.created_at || 0).getTime()

      return at - bt
    })

    // First cycle establishes a baseline and emits nothing.
    if (!state || !state.lastCreatedAt) {
      const newest = ordered[ordered.length - 1]

      return {
        events: [],
        state: {
          lastCreatedAt: newest ? newest.created_at : new Date().toISOString(),
          seenIds: WorkablePolling.boundSeen(ordered.map(c => c.id)),
        },
      }
    }

    const seen = new Set(state.seenIds || [])
    const fresh = ordered.filter(c => c.id && !seen.has(c.id))

    let lastCreatedAt = state.lastCreatedAt

    for (const candidate of ordered) {
      if (candidate.created_at && new Date(candidate.created_at).getTime() > new Date(lastCreatedAt).getTime()) {
        lastCreatedAt = candidate.created_at
      }
    }

    return {
      events: fresh,
      state: {
        lastCreatedAt,
        seenIds: WorkablePolling.boundSeen([...(state.seenIds || []), ...ordered.map(c => c.id)]),
      },
    }
  }

  // Cap the carried seen-id set so state never grows without bound (keeps the newest ids).
  static boundSeen(ids) {
    const unique = [...new Set(ids.filter(Boolean))]

    return unique.slice(Math.max(0, unique.length - 500))
  }
}

/**
 * @integrationName Workable
 * @integrationIcon /icon.png
 * @integrationTriggersScope ALL_APPS
 */
class Workable {
  constructor(config) {
    this.subdomain = config.subdomain
    this.accessToken = config.accessToken
  }

  // Base URL is per-account: https://{subdomain}.workable.com/spi/v3
  #baseUrl() {
    return `https://${ this.subdomain }.workable.com/spi/v3`
  }

  // Single private request helper - all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode || error.body?.status
      // Workable surfaces errors as { error: "..." } or { validation_errors: {...} }.
      const validation = error.body?.validation_errors
      const apiMessage = error.body?.error ||
        (validation ? JSON.stringify(validation) : undefined) ||
        error.message

      const detail = [status ? `(${ status })` : null, apiMessage].filter(Boolean).join(' ')

      logger.error(`${ logTag } - failed: ${ detail }`)

      throw new Error(`Workable API error: ${ detail }`)
    }
  }

  // ============================================== JOBS ==============================================

  /**
   * @operationName List Jobs
   * @category Jobs
   * @description Lists jobs in the Workable account with optional filtering by state and creation date. Returns paginated job objects including title, shortcode, department, location, and state. Use a job's shortcode with Get Job, Get Job Members, Get Job Stages, and Create Candidate.
   * @route GET /jobs
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Published","Closed","Archived"]}},"description":"Filter jobs by lifecycle state. Leave empty to return jobs in all states."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return only jobs created at or after this timestamp (ISO 8601)."}
   * @paramDef {"type":"String","label":"Since ID","name":"sinceId","description":"Return jobs with an id greater than or equal to this value (forward pagination cursor from paging.next)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of jobs to return per page (default 50, max 100)."}
   * @returns {Object}
   * @sampleResult {"jobs":[{"id":"19782","title":"Software Engineer","full_title":"Software Engineer - Engineering","shortcode":"GHI789","code":null,"state":"published","department":"Engineering","url":"https://acme.workable.com/jobs/19782","application_url":"https://acme.workable.com/j/GHI789/candidates/new","location":{"country":"United States","city":"New York"},"created_at":"2026-01-10T09:00:00Z"}],"paging":{"next":"https://acme.workable.com/spi/v3/jobs?since_id=19782"}}
   */
  async listJobs(state, createdAfter, sinceId, limit) {
    return await this.#apiRequest({
      logTag: '[listJobs]',
      url: `${ this.#baseUrl() }/jobs`,
      query: {
        state: resolveChoice(state, JOB_STATE_LABELS),
        created_after: createdAfter,
        since_id: sinceId,
        limit: limit || undefined,
      },
    })
  }

  /**
   * @operationName Get Job
   * @category Jobs
   * @description Retrieves the full details of a single job by its shortcode, including title, description, requirements, department, location, salary, and current state.
   * @route GET /jobs/{shortcode}
   * @paramDef {"type":"String","label":"Job Shortcode","name":"shortcode","required":true,"dictionary":"getJobsDictionary","description":"The job's shortcode (e.g. GHI789). Search and select a job or type a shortcode directly."}
   * @returns {Object}
   * @sampleResult {"id":"19782","title":"Software Engineer","full_title":"Software Engineer - Engineering","shortcode":"GHI789","state":"published","department":"Engineering","url":"https://acme.workable.com/jobs/19782","application_url":"https://acme.workable.com/j/GHI789/candidates/new","location":{"country":"United States","city":"New York"},"full_description":"<p>We are hiring...</p>","created_at":"2026-01-10T09:00:00Z"}
   */
  async getJob(shortcode) {
    return await this.#apiRequest({
      logTag: '[getJob]',
      url: `${ this.#baseUrl() }/jobs/${ encodeURIComponent(shortcode) }`,
    })
  }

  /**
   * @operationName Get Job Members
   * @category Jobs
   * @description Lists the hiring team members associated with a specific job, including recruiters, hiring managers, and reviewers with their roles. Use member ids for assignment and private comments.
   * @route GET /jobs/{shortcode}/members
   * @paramDef {"type":"String","label":"Job Shortcode","name":"shortcode","required":true,"dictionary":"getJobsDictionary","description":"The job's shortcode (e.g. GHI789). Search and select a job or type a shortcode directly."}
   * @returns {Object}
   * @sampleResult {"members":[{"id":"5f8d0c1e2a","name":"Jane Doe","email":"jane@acme.com","role":"admin","headline":"Talent Lead"}]}
   */
  async getJobMembers(shortcode) {
    return await this.#apiRequest({
      logTag: '[getJobMembers]',
      url: `${ this.#baseUrl() }/jobs/${ encodeURIComponent(shortcode) }/members`,
    })
  }

  /**
   * @operationName Get Job Stages
   * @category Jobs
   * @description Lists the hiring pipeline stages configured for a specific job, in pipeline order. Each stage includes its name, slug, and kind (sourced, applied, interview, offer, hired). Use a stage slug with Move Candidate to Stage.
   * @route GET /jobs/{shortcode}/stages
   * @paramDef {"type":"String","label":"Job Shortcode","name":"shortcode","required":true,"dictionary":"getJobsDictionary","description":"The job's shortcode (e.g. GHI789). Search and select a job or type a shortcode directly."}
   * @returns {Object}
   * @sampleResult {"stages":[{"slug":"sourced","name":"Sourced","kind":"sourced","position":1},{"slug":"applied","name":"Applied","kind":"applied","position":2},{"slug":"phone_screen","name":"Phone Screen","kind":"interview","position":3}]}
   */
  async getJobStages(shortcode) {
    return await this.#apiRequest({
      logTag: '[getJobStages]',
      url: `${ this.#baseUrl() }/jobs/${ encodeURIComponent(shortcode) }/stages`,
    })
  }

  // =========================================== CANDIDATES ===========================================

  /**
   * @operationName List Candidates
   * @category Candidates
   * @description Lists candidates across the account or within a specific job, with filtering by state and creation date. Supports pagination via since_id and time-window filtering via created_after. Returns candidate objects including name, email, current stage, and job.
   * @route GET /candidates
   * @paramDef {"type":"String","label":"Job Shortcode","name":"shortcode","dictionary":"getJobsDictionary","description":"Limit results to candidates of a single job. Search and select a job, type a shortcode, or leave empty for all jobs."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Disqualified","Hired"]}},"description":"Filter candidates by lifecycle state. Leave empty for all states."}
   * @paramDef {"type":"String","label":"Since ID","name":"sinceId","description":"Return candidates with an id greater than or equal to this value (forward pagination cursor)."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return only candidates created at or after this timestamp (ISO 8601)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of candidates to return per page (default 50, max 100)."}
   * @returns {Object}
   * @sampleResult {"candidates":[{"id":"3f7a9c2e1b","name":"John Smith","firstname":"John","lastname":"Smith","email":"john@example.com","job":{"shortcode":"GHI789","title":"Software Engineer"},"stage":"applied","disqualified":false,"created_at":"2026-06-01T12:00:00Z"}],"paging":{"next":"https://acme.workable.com/spi/v3/candidates?since_id=3f7a9c2e1b"}}
   */
  async listCandidates(shortcode, state, sinceId, createdAfter, limit) {
    return await this.#apiRequest({
      logTag: '[listCandidates]',
      url: `${ this.#baseUrl() }/candidates`,
      query: {
        shortcode,
        state: resolveChoice(state, CANDIDATE_STATE_LABELS),
        since_id: sinceId,
        created_after: createdAfter,
        limit: limit || undefined,
      },
    })
  }

  /**
   * @operationName Get Candidate
   * @category Candidates
   * @description Retrieves the full profile of a single candidate by id, including contact details, current stage, job, resume and cover letter, tags, and disqualification status.
   * @route GET /candidates/{id}
   * @paramDef {"type":"String","label":"Candidate ID","name":"id","required":true,"description":"The candidate's unique id (from List Candidates or Create Candidate)."}
   * @returns {Object}
   * @sampleResult {"candidate":{"id":"3f7a9c2e1b","name":"John Smith","firstname":"John","lastname":"Smith","email":"john@example.com","phone":"+15551234567","job":{"shortcode":"GHI789","title":"Software Engineer"},"stage":"applied","disqualified":false,"resume_url":"https://acme.workable.com/api/v3/candidates/3f7a9c2e1b/resume","created_at":"2026-06-01T12:00:00Z"}}
   */
  async getCandidate(id) {
    return await this.#apiRequest({
      logTag: '[getCandidate]',
      url: `${ this.#baseUrl() }/candidates/${ encodeURIComponent(id) }`,
    })
  }

  /**
   * @operationName Create Candidate
   * @category Candidates
   * @description Creates a candidate and adds them to a job (by shortcode). Provide the candidate's name plus optional contact details, resume URL, and cover letter. Sourced defaults to true (the candidate is uploaded to the sourced stage); set Sourced to false to treat them as an inbound applicant, which triggers Workable's applicant thank-you email.
   * @route POST /jobs/{shortcode}/candidates
   * @paramDef {"type":"String","label":"Job Shortcode","name":"shortcode","required":true,"dictionary":"getJobsDictionary","description":"The job to add the candidate to. Search and select a job or type a shortcode directly."}
   * @paramDef {"type":"String","label":"Full Name","name":"name","description":"Candidate full name. Provide either this or First Name + Last Name."}
   * @paramDef {"type":"String","label":"First Name","name":"firstname","description":"Candidate first name (used together with Last Name if Full Name is not provided)."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","description":"Candidate last name (used together with First Name if Full Name is not provided)."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Candidate email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Candidate phone number."}
   * @paramDef {"type":"String","label":"Resume URL","name":"resumeUrl","description":"Publicly accessible URL of the candidate's resume. Workable fetches and attaches it."}
   * @paramDef {"type":"String","label":"Cover Letter","name":"coverLetter","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Cover letter text for the candidate."}
   * @paramDef {"type":"Boolean","label":"Sourced","name":"sourced","uiComponent":{"type":"CHECKBOX"},"description":"Defaults to true (uploaded to the sourced stage). Set to false to treat the candidate as an inbound applicant, which triggers Workable's applicant thank-you email."}
   * @returns {Object}
   * @sampleResult {"status":"created","candidate":{"id":"3f7a9c2e1b","name":"John Smith","email":"john@example.com","job":{"shortcode":"GHI789","title":"Software Engineer"},"stage":"sourced","created_at":"2026-06-01T12:00:00Z"}}
   */
  async createCandidate(shortcode, name, firstname, lastname, email, phone, resumeUrl, coverLetter, sourced) {
    const candidate = clean({
      name,
      firstname,
      lastname,
      email,
      phone,
      resume_url: resumeUrl,
      cover_letter: coverLetter,
    })

    return await this.#apiRequest({
      logTag: '[createCandidate]',
      url: `${ this.#baseUrl() }/jobs/${ encodeURIComponent(shortcode) }/candidates`,
      method: 'post',
      body: clean({
        candidate,
        sourced: sourced === undefined ? undefined : Boolean(sourced),
      }),
    })
  }

  /**
   * @operationName Update Candidate
   * @category Candidates
   * @description Updates editable fields on an existing candidate, such as name, email, phone, headline, summary, address, and social profiles. Only the fields you provide are changed.
   * @route PATCH /candidates/{id}
   * @paramDef {"type":"String","label":"Candidate ID","name":"id","required":true,"description":"The candidate's unique id."}
   * @paramDef {"type":"String","label":"First Name","name":"firstname","description":"Updated first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","description":"Updated last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Updated email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number."}
   * @paramDef {"type":"String","label":"Headline","name":"headline","description":"Updated professional headline."}
   * @paramDef {"type":"String","label":"Summary","name":"summary","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated candidate summary."}
   * @paramDef {"type":"String","label":"Address","name":"address","description":"Updated postal address."}
   * @returns {Object}
   * @sampleResult {"status":"updated","candidate":{"id":"3f7a9c2e1b","firstname":"Jonathan","lastname":"Smith","email":"jonathan@example.com","headline":"Senior Software Engineer"}}
   */
  async updateCandidate(id, firstname, lastname, email, phone, headline, summary, address) {
    const candidate = clean({
      firstname,
      lastname,
      email,
      phone,
      headline,
      summary,
      address,
    })

    return await this.#apiRequest({
      logTag: '[updateCandidate]',
      url: `${ this.#baseUrl() }/candidates/${ encodeURIComponent(id) }`,
      method: 'patch',
      body: { candidate },
    })
  }

  /**
   * @operationName Move Candidate to Stage
   * @category Candidates
   * @description Moves a candidate to a different stage in their job's hiring pipeline by target stage slug. Retrieve valid slugs with Get Job Stages for the candidate's job. A member id (the person performing the move) is required by the Workable API.
   * @route POST /candidates/{id}/move
   * @paramDef {"type":"String","label":"Candidate ID","name":"id","required":true,"description":"The candidate's unique id."}
   * @paramDef {"type":"String","label":"Member ID","name":"memberId","required":true,"dictionary":"getMembersDictionary","description":"Id of the member performing the move (required). Search and select an account member, or type a member id."}
   * @paramDef {"type":"String","label":"Target Stage Slug","name":"targetStage","required":true,"description":"Slug of the destination stage (e.g. phone_screen). Get valid slugs from Get Job Stages."}
   * @returns {Object}
   * @sampleResult {"status":"moved","candidate":{"id":"3f7a9c2e1b","stage":"phone_screen"}}
   */
  async moveCandidateToStage(id, memberId, targetStage) {
    return await this.#apiRequest({
      logTag: '[moveCandidateToStage]',
      url: `${ this.#baseUrl() }/candidates/${ encodeURIComponent(id) }/move`,
      method: 'post',
      body: clean({ member_id: memberId, target_stage: targetStage }),
    })
  }

  /**
   * @operationName Disqualify Candidate
   * @category Candidates
   * @description Disqualifies a candidate, removing them from active consideration, with an optional disqualification reason. A member id (the person performing the disqualification) is required by the Workable API. The candidate can later be brought back with Revert Candidate.
   * @route POST /candidates/{id}/disqualify
   * @paramDef {"type":"String","label":"Candidate ID","name":"id","required":true,"description":"The candidate's unique id."}
   * @paramDef {"type":"String","label":"Member ID","name":"memberId","required":true,"dictionary":"getMembersDictionary","description":"Id of the member performing the disqualification (required). Search and select an account member, or type a member id."}
   * @paramDef {"type":"String","label":"Disqualification Reason","name":"disqualificationReason","description":"Optional reason for disqualification (e.g. 'Not enough experience')."}
   * @returns {Object}
   * @sampleResult {"status":"disqualified","candidate":{"id":"3f7a9c2e1b","disqualified":true,"disqualification_reason":"Not enough experience"}}
   */
  async disqualifyCandidate(id, memberId, disqualificationReason) {
    return await this.#apiRequest({
      logTag: '[disqualifyCandidate]',
      url: `${ this.#baseUrl() }/candidates/${ encodeURIComponent(id) }/disqualify`,
      method: 'post',
      body: clean({ member_id: memberId, disqualification_reason: disqualificationReason }),
    })
  }

  /**
   * @operationName Revert Candidate
   * @category Candidates
   * @description Reverts a previously disqualified candidate back to active status in their current stage.
   * @route POST /candidates/{id}/revert
   * @paramDef {"type":"String","label":"Candidate ID","name":"id","required":true,"description":"The candidate's unique id."}
   * @paramDef {"type":"String","label":"Member ID","name":"memberId","dictionary":"getMembersDictionary","description":"Optional id of the member performing the revert. Search and select an account member, or type a member id."}
   * @returns {Object}
   * @sampleResult {"status":"reverted","candidate":{"id":"3f7a9c2e1b","disqualified":false}}
   */
  async revertCandidate(id, memberId) {
    return await this.#apiRequest({
      logTag: '[revertCandidate]',
      url: `${ this.#baseUrl() }/candidates/${ encodeURIComponent(id) }/revert`,
      method: 'post',
      body: clean({ member_id: memberId }),
    })
  }

  /**
   * @operationName Copy Candidate to Job
   * @category Candidates
   * @description Copies an existing candidate into another job's pipeline, keeping the candidate on the original job. Optionally target a specific stage in the destination job. A member id (the person performing the copy) is required by the Workable API. To move the candidate off the original job instead, use Relocate Candidate to Job.
   * @route POST /candidates/{id}/copy
   * @paramDef {"type":"String","label":"Candidate ID","name":"id","required":true,"description":"The candidate's unique id."}
   * @paramDef {"type":"String","label":"Member ID","name":"memberId","required":true,"dictionary":"getMembersDictionary","description":"Id of the member performing the copy (required). Search and select an account member, or type a member id."}
   * @paramDef {"type":"String","label":"Target Job Shortcode","name":"targetJobShortcode","required":true,"dictionary":"getJobsDictionary","description":"The job to copy the candidate into. Search and select a job or type a shortcode."}
   * @paramDef {"type":"String","label":"Target Stage","name":"targetStage","description":"Optional destination stage slug in the target job. Get valid slugs from Get Job Stages."}
   * @returns {Object}
   * @sampleResult {"status":"copied","candidate":{"id":"3f7a9c2e1b","job":{"shortcode":"JKL012"},"stage":"applied"}}
   */
  async copyCandidateToJob(id, memberId, targetJobShortcode, targetStage) {
    return await this.#apiRequest({
      logTag: '[copyCandidateToJob]',
      url: `${ this.#baseUrl() }/candidates/${ encodeURIComponent(id) }/copy`,
      method: 'post',
      body: clean({
        member_id: memberId,
        target_job_shortcode: targetJobShortcode,
        target_stage: targetStage,
      }),
    })
  }

  /**
   * @operationName Relocate Candidate to Job
   * @category Candidates
   * @description Relocates an existing candidate into another job's pipeline, moving them off the original job. Optionally target a specific stage in the destination job. A member id (the person performing the relocation) is required by the Workable API. To keep the candidate on the original job instead, use Copy Candidate to Job.
   * @route POST /candidates/{id}/relocate
   * @paramDef {"type":"String","label":"Candidate ID","name":"id","required":true,"description":"The candidate's unique id."}
   * @paramDef {"type":"String","label":"Member ID","name":"memberId","required":true,"dictionary":"getMembersDictionary","description":"Id of the member performing the relocation (required). Search and select an account member, or type a member id."}
   * @paramDef {"type":"String","label":"Target Job Shortcode","name":"targetJobShortcode","required":true,"dictionary":"getJobsDictionary","description":"The job to relocate the candidate into. Search and select a job or type a shortcode."}
   * @paramDef {"type":"String","label":"Target Stage","name":"targetStage","description":"Optional destination stage slug in the target job. Get valid slugs from Get Job Stages."}
   * @returns {Object}
   * @sampleResult {"status":"relocated","candidate":{"id":"3f7a9c2e1b","job":{"shortcode":"JKL012"},"stage":"applied"}}
   */
  async relocateCandidateToJob(id, memberId, targetJobShortcode, targetStage) {
    return await this.#apiRequest({
      logTag: '[relocateCandidateToJob]',
      url: `${ this.#baseUrl() }/candidates/${ encodeURIComponent(id) }/relocate`,
      method: 'post',
      body: clean({
        member_id: memberId,
        target_job_shortcode: targetJobShortcode,
        target_stage: targetStage,
      }),
    })
  }

  // ======================================= COMMENTS & RATINGS =======================================

  /**
   * @operationName Create Comment
   * @category Comments & Ratings
   * @description Adds a comment to a candidate's timeline. A member id (the comment's author) is required by the Workable API. By default the comment is visible to all admins and can be restricted to specific roles via the Visible To Roles list; comments are always visible to admins regardless.
   * @route POST /candidates/{id}/comments
   * @paramDef {"type":"String","label":"Candidate ID","name":"id","required":true,"description":"The candidate's unique id."}
   * @paramDef {"type":"String","label":"Member ID","name":"memberId","required":true,"dictionary":"getMembersDictionary","description":"Id of the member authoring the comment (required). Search and select an account member, or type a member id."}
   * @paramDef {"type":"String","label":"Comment","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The comment text to post to the candidate's timeline."}
   * @paramDef {"type":"Array<String>","label":"Visible To Roles","name":"policy","uiComponent":{"type":"DROPDOWN","options":{"values":["Admin","Recruiting Admin","Hiring Manager","Recruiter","Reviewer","Simple"]}},"description":"Optional list of member roles allowed to see the comment. Leave empty to use Workable's default visibility. Comments are always visible to admins regardless of this setting."}
   * @returns {Object}
   * @sampleResult {"comment":{"id":"c_88213","body":"Strong technical background","created_at":"2026-06-02T10:00:00Z"}}
   */
  async createComment(id, memberId, body, policy) {
    const policyMap = {
      Admin: 'admin',
      'Recruiting Admin': 'recruiting_admin',
      'Hiring Manager': 'hiring_manager',
      Recruiter: 'recruiter',
      Reviewer: 'reviewer',
      Simple: 'simple',
    }
    const roles = Array.isArray(policy) ? policy.map(role => resolveChoice(role, policyMap)).filter(Boolean) : undefined

    const comment = clean({
      body,
      policy: roles && roles.length ? roles : undefined,
    })

    return await this.#apiRequest({
      logTag: '[createComment]',
      url: `${ this.#baseUrl() }/candidates/${ encodeURIComponent(id) }/comments`,
      method: 'post',
      body: clean({ member_id: memberId, comment }),
    })
  }

  /**
   * @operationName Create Rating
   * @category Comments & Ratings
   * @description Adds a rating (evaluation) to a candidate using Workable's scale/grade model with an optional comment. Choose a rating scale (Thumbs, Stars, or Numbers) and a grade whose valid range depends on the scale: Thumbs 0-2 (negative/positive/definite), Stars 0-4 (one to five stars), Numbers 0-9 (1 to 10 out of 10). A member id (the person providing the rating) is required by the Workable API.
   * @route POST /candidates/{id}/ratings
   * @paramDef {"type":"String","label":"Candidate ID","name":"id","required":true,"description":"The candidate's unique id."}
   * @paramDef {"type":"String","label":"Member ID","name":"memberId","required":true,"dictionary":"getMembersDictionary","description":"Id of the member providing the rating (required). Search and select an account member, or type a member id."}
   * @paramDef {"type":"String","label":"Scale","name":"scale","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Thumbs","Stars","Numbers"]}},"description":"Rating scale type. Thumbs uses grade 0-2, Stars uses grade 0-4, Numbers uses grade 0-9."}
   * @paramDef {"type":"Number","label":"Grade","name":"grade","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric grade for the selected scale: Thumbs 0-2 (0 negative, 1 positive, 2 definite), Stars 0-4 (one to five stars), Numbers 0-9 (1 to 10 out of 10)."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional comment explaining the rating."}
   * @returns {Object}
   * @sampleResult {"rating":{"id":"r_5521","scale":"thumbs","grade":2,"comment":"Great culture fit","created_at":"2026-06-02T11:00:00Z"}}
   */
  async createRating(id, memberId, scale, grade, comment) {
    return await this.#apiRequest({
      logTag: '[createRating]',
      url: `${ this.#baseUrl() }/candidates/${ encodeURIComponent(id) }/ratings`,
      method: 'post',
      body: clean({
        member_id: memberId,
        scale: resolveChoice(scale, { Thumbs: 'thumbs', Stars: 'stars', Numbers: 'numbers' }),
        grade: grade === undefined || grade === null ? undefined : Number(grade),
        comment,
      }),
    })
  }

  // ======================================= MEMBERS & RECRUITERS =======================================

  /**
   * @operationName List Members
   * @category Members & Recruiters
   * @description Lists all members (users) of the Workable account, including their id, name, email, and role. Use member ids for assignment and private comments.
   * @route GET /members
   * @returns {Object}
   * @sampleResult {"members":[{"id":"5f8d0c1e2a","name":"Jane Doe","email":"jane@acme.com","role":"admin","headline":"Talent Lead"}]}
   */
  async listMembers() {
    return await this.#apiRequest({
      logTag: '[listMembers]',
      url: `${ this.#baseUrl() }/members`,
    })
  }

  /**
   * @operationName List Recruiters
   * @category Members & Recruiters
   * @description Lists the recruiters in the Workable account, including their id, name, and email. Recruiters are the subset of members who can be assigned candidates.
   * @route GET /recruiters
   * @returns {Object}
   * @sampleResult {"recruiters":[{"id":"5f8d0c1e2a","name":"Jane Doe","email":"jane@acme.com"}]}
   */
  async listRecruiters() {
    return await this.#apiRequest({
      logTag: '[listRecruiters]',
      url: `${ this.#baseUrl() }/recruiters`,
    })
  }

  // ============================================ STAGES ============================================

  /**
   * @operationName List Stages
   * @category Stages
   * @description Lists the account-wide hiring pipeline stages, in order, each with its name, slug, and kind (sourced, applied, interview, offer, hired). For job-specific stages, use Get Job Stages instead.
   * @route GET /stages
   * @returns {Object}
   * @sampleResult {"stages":[{"slug":"sourced","name":"Sourced","kind":"sourced","position":1},{"slug":"applied","name":"Applied","kind":"applied","position":2},{"slug":"hired","name":"Hired","kind":"hired","position":9}]}
   */
  async listStages() {
    return await this.#apiRequest({
      logTag: '[listStages]',
      url: `${ this.#baseUrl() }/stages`,
    })
  }

  // ============================================ ACTIVITIES ============================================

  /**
   * @operationName List Candidate Activities
   * @category Candidates
   * @description Lists the timeline activities for a candidate - stage moves, comments, ratings, emails, and disqualifications - in reverse chronological order. Use this as an audit trail of everything that has happened to a candidate.
   * @route GET /candidates/{id}/activities
   * @paramDef {"type":"String","label":"Candidate ID","name":"id","required":true,"description":"The candidate's unique id."}
   * @returns {Object}
   * @sampleResult {"activities":[{"id":"a_1002","action":"moved","stage_name":"Phone Screen","body":"Moved to Phone Screen","created_at":"2026-06-02T12:00:00Z"},{"id":"a_1001","action":"commented","body":"Strong candidate","created_at":"2026-06-02T10:00:00Z"}]}
   */
  async listCandidateActivities(id) {
    return await this.#apiRequest({
      logTag: '[listCandidateActivities]',
      url: `${ this.#baseUrl() }/candidates/${ encodeURIComponent(id) }/activities`,
    })
  }

  // ============================================= ACCOUNT =============================================

  /**
   * @operationName Get Account
   * @category Account
   * @description Retrieves the Workable account details for the connected subdomain and token, including account name and subdomain. Use this as a connection check to verify credentials.
   * @route GET /accounts
   * @returns {Object}
   * @sampleResult {"name":"Acme Inc","subdomain":"acme","summary":"Acme hiring account"}
   */
  async getAccount() {
    return await this.#apiRequest({
      logTag: '[getAccount]',
      url: `${ this.#baseUrl() }/accounts`,
    })
  }

  // =========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} getJobsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter jobs by title. Filtering is performed on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (a since_id value) for retrieving the next page of jobs."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Jobs Dictionary
   * @description Provides a searchable list of published and draft jobs for selecting a job in dependent parameters. The option value is the job shortcode expected by job and candidate operations.
   * @route POST /get-jobs-dictionary
   * @paramDef {"type":"getJobsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing jobs."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Software Engineer","value":"GHI789","note":"Engineering - published"}],"cursor":null}
   */
  async getJobsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getJobsDictionary]',
      url: `${ this.#baseUrl() }/jobs`,
      query: {
        limit: 100,
        since_id: cursor || undefined,
      },
    })

    const jobs = response.jobs || []
    const term = (search || '').trim().toLowerCase()

    const filtered = term
      ? jobs.filter(job => `${ job.title || '' } ${ job.full_title || '' } ${ job.shortcode || '' }`.toLowerCase().includes(term))
      : jobs

    return {
      items: filtered.map(job => ({
        label: job.title || job.full_title || job.shortcode,
        value: job.shortcode,
        note: [job.department, job.state].filter(Boolean).join(' - ') || undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getMembersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter members by name or email. Filtering is performed on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (a since_id value) for retrieving the next page of members."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Members Dictionary
   * @description Provides a searchable list of account members for selecting the member performing an action (move, disqualify, comment, copy, relocate). The option value is the member id expected by those operations.
   * @route POST /get-members-dictionary
   * @paramDef {"type":"getMembersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing members."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"5f8d0c1e2a","note":"jane@acme.com - admin"}],"cursor":null}
   */
  async getMembersDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getMembersDictionary]',
      url: `${ this.#baseUrl() }/members`,
      query: {
        limit: 100,
        since_id: cursor || undefined,
      },
    })

    const members = response.members || []
    const term = (search || '').trim().toLowerCase()

    const filtered = term
      ? members.filter(member => `${ member.name || '' } ${ member.email || '' }`.toLowerCase().includes(term))
      : members

    return {
      items: filtered.map(member => ({
        label: member.name || member.email || member.id,
        value: member.id,
        note: [member.email, member.role].filter(Boolean).join(' - ') || undefined,
      })),
      cursor: null,
    }
  }

  // ============================================= TRIGGERS =============================================

  /**
   * @registerAs POLLING_TRIGGER
   * @operationName On New Candidate
   * @category Triggers
   * @description Fires when a new candidate is added to the account, optionally scoped to a single job. Each cycle fetches candidates newest-first and emits the raw candidate objects it has not seen before. The first cycle establishes a baseline and emits nothing; later cycles emit one event per new candidate.
   * @route POST /on-new-candidate
   * @paramDef {"type":"String","label":"Job Shortcode","name":"shortcode","dictionary":"getJobsDictionary","description":"Limit the trigger to new candidates of a single job. Leave empty to watch all jobs."}
   * @returns {Object}
   * @sampleResult {"id":"3f7a9c2e1b","name":"John Smith","firstname":"John","lastname":"Smith","email":"john@example.com","job":{"shortcode":"GHI789","title":"Software Engineer"},"stage":"applied","disqualified":false,"created_at":"2026-06-01T12:00:00Z"}
   */
  async onNewCandidate(invocation) {
    const state = (invocation && invocation.state) || null
    const shortcode = invocation && invocation.parameters && invocation.parameters.shortcode

    // Only look back a bounded window from the last seen point so the payload stays small; on the
    // baseline cycle we still page enough to seed the seen-id set.
    const createdAfter = state && state.lastCreatedAt ? state.lastCreatedAt : undefined

    const candidates = await this.#fetchCandidatesForTrigger(shortcode, createdAfter)

    return WorkablePolling.diff(candidates, state)
  }

  // Page through GET /candidates for one polling cycle, oldest cursor forward, capped so a runaway
  // account can't stall a cycle.
  async #fetchCandidatesForTrigger(shortcode, createdAfter) {
    const all = []
    let sinceId
    let pages = 0

    for (;;) {
      const response = await this.#apiRequest({
        logTag: '[onNewCandidate]',
        url: `${ this.#baseUrl() }/candidates`,
        query: {
          shortcode,
          created_after: createdAfter,
          since_id: sinceId,
          limit: 100,
        },
      })

      const candidates = response.candidates || []

      all.push(...candidates)
      pages += 1

      const next = response.paging && response.paging.next

      if (!next || candidates.length === 0 || pages >= 10) {
        break
      }

      // Extract the since_id cursor from the paging.next URL.
      const match = /[?&]since_id=([^&]+)/.exec(next)

      if (!match) {
        break
      }

      sinceId = decodeURIComponent(match[1])
    }

    return all
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }
}

Flowrunner.ServerCode.addService(Workable, [
  {
    name: 'subdomain',
    displayName: 'Subdomain',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: "Your Workable subdomain — e.g. 'acme' for acme.workable.com.",
  },
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Workable → Settings → Integrations → Access Token → Generate new token. Copy it immediately (shown only once). Sent as a Bearer token. Account access tokens are scoped to this subdomain; partner tokens are for multi-account partner integrations and require a subdomain per call.',
  },
])
