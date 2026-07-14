const logger = {
  info: (...args) => console.log('[Beeminder] info:', ...args),
  debug: (...args) => console.log('[Beeminder] debug:', ...args),
  error: (...args) => console.log('[Beeminder] error:', ...args),
  warn: (...args) => console.log('[Beeminder] warn:', ...args),
}

const API_BASE_URL = 'https://www.beeminder.com/api/v1'

const GOAL_TYPE_MAP = {
  'Do More (hustler)': 'hustler',
  'Odometer (biker)': 'biker',
  'Weight Loss (fatloser)': 'fatloser',
  'Weight Gain (gainer)': 'gainer',
  'Whittle Down (inboxer)': 'inboxer',
  'Do Less (drinker)': 'drinker',
  'Custom': 'custom',
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
 * @integrationName Beeminder
 * @integrationIcon /icon.png
 */
class BeeminderService {
  constructor(config) {
    this.authToken = config.authToken
    this.username = config.username || 'me'
  }

  #user() {
    return encodeURIComponent(this.username || 'me')
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const fullQuery = clean({ ...(query || {}), auth_token: this.authToken })

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Content-Type': 'application/json' })
        .query(fullQuery)

      return body !== undefined ? await request.send(clean(body)) : await request
    } catch (error) {
      const errors = error.body?.errors
      const message = (typeof errors === 'string' ? errors : (errors && JSON.stringify(errors))) ||
        error.body?.error_message ||
        error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`Beeminder API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Get User
   * @category User
   * @description Retrieves the authenticated Beeminder user's profile, including their timezone, last-updated timestamp, urgency load, and deadbeat status (whether payment info is out of date). Set Include Associations to fetch full details for every goal in a single call; use sparingly, as it is an expensive request.
   * @route GET /users
   * @paramDef {"type":"Boolean","label":"Include Associations","name":"associations","uiComponent":{"type":"CHECKBOX"},"description":"When true, returns full information about the user and all of their goals in one response. Use sparingly. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"username":"alice","timezone":"America/Los_Angeles","updated_at":1652550000,"urgency_load":42,"deadbeat":false,"goals":["read","exercise"]}
   */
  async getUser(associations) {
    const logTag = '[getUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ this.#user() }.json`,
      method: 'get',
      query: { associations: associations ? 'true' : undefined },
    })
  }

  /**
   * @operationName List Goals
   * @category Goals
   * @description Lists all of the authenticated user's goals, sorted by urgency (most at-risk first). Each goal includes its slug, title, goal type, units, bright red line parameters, safety buffer, and pledge amount.
   * @route GET /goals
   *
   * @returns {Array<Object>}
   * @sampleResult [{"slug":"read","title":"Read More","goal_type":"hustler","gunits":"pages","goaldate":1672531200,"goalval":null,"rate":10,"pledge":5,"safebuf":3,"losedate":1652900000}]
   */
  async listGoals() {
    const logTag = '[listGoals]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ this.#user() }/goals.json`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Goal
   * @category Goals
   * @description Retrieves a single goal by its slug, including its bright red line, safety buffer, pledge, and progress metrics. Optionally include the goal's full datapoint history in the response.
   * @route GET /goal
   * @paramDef {"type":"String","label":"Goal Slug","name":"goalslug","required":true,"dictionary":"getGoalsDictionary","description":"The slug (URL identifier) of the goal to retrieve."}
   * @paramDef {"type":"Boolean","label":"Include Datapoints","name":"datapoints","uiComponent":{"type":"CHECKBOX"},"description":"When true, includes the goal's datapoints array in the response. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"slug":"read","title":"Read More","goal_type":"hustler","gunits":"pages","rate":10,"pledge":5,"safebuf":3,"losedate":1652900000,"datapoints":[{"id":"5678","value":12,"timestamp":1652500000,"daystamp":"20220514","comment":"chapter 3"}]}
   */
  async getGoal(goalslug, datapoints) {
    const logTag = '[getGoal]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ this.#user() }/goals/${ encodeURIComponent(goalslug) }.json`,
      method: 'get',
      query: { datapoints: datapoints ? 'true' : undefined },
    })
  }

  /**
   * @operationName Create Goal
   * @category Goals
   * @description Creates a new goal for the authenticated user. Requires a slug, title, goal type, and units. You must supply exactly two of Goal Date, Goal Value, and Rate; Beeminder computes the third. Goal type determines the aggregation behavior (e.g. Do More, Odometer, Weight Loss).
   * @route POST /goals
   * @paramDef {"type":"String","label":"Slug","name":"slug","required":true,"description":"URL-safe identifier for the goal (e.g. 'read-more'). Must be unique for the user."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Human-readable name for the goal."}
   * @paramDef {"type":"String","label":"Goal Type","name":"goalType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Do More (hustler)","Odometer (biker)","Weight Loss (fatloser)","Weight Gain (gainer)","Whittle Down (inboxer)","Do Less (drinker)","Custom"]}},"description":"The goal aggregation type."}
   * @paramDef {"type":"String","label":"Units","name":"gunits","required":true,"description":"The unit of measurement shown on the y-axis (e.g. 'pages', 'kg', 'hours')."}
   * @paramDef {"type":"Number","label":"Goal Date","name":"goaldate","uiComponent":{"type":"DATE_PICKER"},"description":"Target date as a Unix timestamp (seconds). Supply exactly two of Goal Date, Goal Value, and Rate."}
   * @paramDef {"type":"Number","label":"Goal Value","name":"goalval","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Target value to reach. Supply exactly two of Goal Date, Goal Value, and Rate."}
   * @paramDef {"type":"Number","label":"Rate","name":"rate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Slope of the bright red line, in units per Rate Units period. Supply exactly two of Goal Date, Goal Value, and Rate."}
   *
   * @returns {Object}
   * @sampleResult {"slug":"read-more","title":"Read More","goal_type":"hustler","gunits":"pages","rate":10,"goaldate":1672531200,"goalval":null}
   */
  async createGoal(slug, title, goalType, gunits, goaldate, goalval, rate) {
    const logTag = '[createGoal]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ this.#user() }/goals.json`,
      method: 'post',
      body: {
        slug,
        title,
        goal_type: this.#resolveChoice(goalType, GOAL_TYPE_MAP),
        gunits,
        goaldate,
        goalval,
        rate,
      },
    })
  }

  /**
   * @operationName Update Goal
   * @category Goals
   * @description Updates the mutable attributes of an existing goal, such as its title, y-axis label, secrecy, and bright red line (roadall). The goal type cannot be changed after creation.
   * @route PUT /goal
   * @paramDef {"type":"String","label":"Goal Slug","name":"goalslug","required":true,"dictionary":"getGoalsDictionary","description":"The slug of the goal to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New human-readable title for the goal."}
   * @paramDef {"type":"String","label":"Y-Axis Label","name":"yaxis","description":"New label for the graph's y-axis."}
   * @paramDef {"type":"Boolean","label":"Secret","name":"secret","uiComponent":{"type":"CHECKBOX"},"description":"When true, the goal is private (hidden from others)."}
   * @paramDef {"type":"Boolean","label":"Data Public","name":"datapublic","uiComponent":{"type":"CHECKBOX"},"description":"When true, the goal's datapoints are publicly visible."}
   *
   * @returns {Object}
   * @sampleResult {"slug":"read","title":"Read Even More","yaxis":"pages read","secret":false,"datapublic":true}
   */
  async updateGoal(goalslug, title, yaxis, secret, datapublic) {
    const logTag = '[updateGoal]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ this.#user() }/goals/${ encodeURIComponent(goalslug) }.json`,
      method: 'put',
      body: { title, yaxis, secret, datapublic },
    })
  }

  /**
   * @operationName Refresh Goal Graph
   * @category Goals
   * @description Forces Beeminder to refetch any autodata for the goal and regenerate its graph image. Returns true if the request was queued. Use conservatively, as graph regeneration is resource-intensive.
   * @route GET /refresh-goal-graph
   * @paramDef {"type":"String","label":"Goal Slug","name":"goalslug","required":true,"dictionary":"getGoalsDictionary","description":"The slug of the goal whose graph should be refreshed."}
   *
   * @returns {Boolean}
   * @sampleResult true
   */
  async refreshGoalGraph(goalslug) {
    const logTag = '[refreshGoalGraph]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ this.#user() }/goals/${ encodeURIComponent(goalslug) }/refresh_graph.json`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Datapoint
   * @category Datapoints
   * @description Adds a single datapoint to a goal. Only Value is required; Beeminder timestamps the datapoint now unless you supply a Timestamp or Daystamp. Supply a Request ID to make the call idempotent: repeating a create with the same Request ID updates the existing datapoint instead of creating a duplicate, which is essential for safe retries.
   * @route POST /datapoint
   * @paramDef {"type":"String","label":"Goal Slug","name":"goalslug","required":true,"dictionary":"getGoalsDictionary","description":"The slug of the goal to add the datapoint to."}
   * @paramDef {"type":"Number","label":"Value","name":"value","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The datapoint value."}
   * @paramDef {"type":"Number","label":"Timestamp","name":"timestamp","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Unix timestamp (seconds) for the datapoint. Defaults to now if omitted."}
   * @paramDef {"type":"String","label":"Daystamp","name":"daystamp","description":"Date of the datapoint in YYYYMMDD format. Takes precedence over Timestamp when both are given."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","description":"Optional note attached to the datapoint."}
   * @paramDef {"type":"String","label":"Request ID","name":"requestid","description":"Idempotency key. Reusing the same Request ID updates the matching datapoint instead of creating a duplicate, making retries safe."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5678","value":12,"timestamp":1652500000,"daystamp":"20220514","comment":"chapter 3","requestid":"abc-123"}
   */
  async createDatapoint(goalslug, value, timestamp, daystamp, comment, requestid) {
    const logTag = '[createDatapoint]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ this.#user() }/goals/${ encodeURIComponent(goalslug) }/datapoints.json`,
      method: 'post',
      body: { value, timestamp, daystamp, comment, requestid },
    })
  }

  /**
   * @operationName List Datapoints
   * @category Datapoints
   * @description Lists the datapoints for a goal. Supports sorting by any datapoint attribute and limiting the number of results returned.
   * @route GET /datapoints
   * @paramDef {"type":"String","label":"Goal Slug","name":"goalslug","required":true,"dictionary":"getGoalsDictionary","description":"The slug of the goal whose datapoints to list."}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Datapoint attribute to sort by, e.g. 'timestamp', 'updated_at', or 'daystamp'. Defaults to 'timestamp'."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of datapoints to return (most recent first by default)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"5678","value":12,"timestamp":1652500000,"daystamp":"20220514","comment":"chapter 3","updated_at":1652500050}]
   */
  async listDatapoints(goalslug, sort, count) {
    const logTag = '[listDatapoints]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ this.#user() }/goals/${ encodeURIComponent(goalslug) }/datapoints.json`,
      method: 'get',
      query: { sort, count },
    })
  }

  /**
   * @operationName Update Datapoint
   * @category Datapoints
   * @description Updates an existing datapoint's value, timestamp, or comment by its ID. Only the fields you provide are changed.
   * @route PUT /datapoint
   * @paramDef {"type":"String","label":"Goal Slug","name":"goalslug","required":true,"dictionary":"getGoalsDictionary","description":"The slug of the goal that owns the datapoint."}
   * @paramDef {"type":"String","label":"Datapoint ID","name":"datapointId","required":true,"description":"The ID of the datapoint to update."}
   * @paramDef {"type":"Number","label":"Value","name":"value","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New value for the datapoint."}
   * @paramDef {"type":"Number","label":"Timestamp","name":"timestamp","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New Unix timestamp (seconds) for the datapoint."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","description":"New comment for the datapoint."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5678","value":15,"timestamp":1652500000,"daystamp":"20220514","comment":"chapter 4"}
   */
  async updateDatapoint(goalslug, datapointId, value, timestamp, comment) {
    const logTag = '[updateDatapoint]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ this.#user() }/goals/${ encodeURIComponent(goalslug) }/datapoints/${ encodeURIComponent(datapointId) }.json`,
      method: 'put',
      body: { value, timestamp, comment },
    })
  }

  /**
   * @operationName Delete Datapoint
   * @category Datapoints
   * @description Permanently deletes a datapoint from a goal by its ID and returns the deleted datapoint.
   * @route DELETE /datapoint
   * @paramDef {"type":"String","label":"Goal Slug","name":"goalslug","required":true,"dictionary":"getGoalsDictionary","description":"The slug of the goal that owns the datapoint."}
   * @paramDef {"type":"String","label":"Datapoint ID","name":"datapointId","required":true,"description":"The ID of the datapoint to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5678","value":12,"timestamp":1652500000,"daystamp":"20220514","comment":"chapter 3"}
   */
  async deleteDatapoint(goalslug, datapointId) {
    const logTag = '[deleteDatapoint]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ this.#user() }/goals/${ encodeURIComponent(goalslug) }/datapoints/${ encodeURIComponent(datapointId) }.json`,
      method: 'delete',
    })
  }

  /**
   * @operationName Create Datapoints Batch
   * @category Datapoints
   * @description Creates multiple datapoints on a goal in a single request. Pass an array of datapoint objects, each supporting the same fields as a single create (value, timestamp, daystamp, comment, requestid). Returns the array of created datapoints.
   * @route POST /datapoints-batch
   * @paramDef {"type":"String","label":"Goal Slug","name":"goalslug","required":true,"dictionary":"getGoalsDictionary","description":"The slug of the goal to add the datapoints to."}
   * @paramDef {"type":"Array<Object>","label":"Datapoints","name":"datapoints","required":true,"description":"Array of datapoint objects, e.g. [{\"value\":10,\"comment\":\"day 1\"},{\"value\":12,\"daystamp\":\"20220515\"}]. Each supports value, timestamp, daystamp, comment, and requestid."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"1","value":10,"comment":"day 1"},{"id":"2","value":12,"daystamp":"20220515"}]
   */
  async createDatapointsBatch(goalslug, datapoints) {
    const logTag = '[createDatapointsBatch]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ this.#user() }/goals/${ encodeURIComponent(goalslug) }/datapoints/create_all.json`,
      method: 'post',
      body: { datapoints: JSON.stringify(datapoints) },
    })
  }

  /**
   * @operationName Charge User
   * @category Charges
   * @description Charges the authenticated user's payment method on file. Amount is in US dollars (minimum $1.00) and a note is required to explain the charge. Set Dry Run to validate the charge without actually processing it. Use with care, as this moves real money.
   * @route POST /charge
   * @paramDef {"type":"Number","label":"Amount (USD)","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to charge in US dollars. Minimum 1.00."}
   * @paramDef {"type":"String","label":"Note","name":"note","required":true,"description":"Explanation for the charge, shown to the user."}
   * @paramDef {"type":"Boolean","label":"Dry Run","name":"dryrun","uiComponent":{"type":"CHECKBOX"},"description":"When true, validates the charge without actually creating it. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9012","amount":5,"note":"Missed goal deadline","username":"alice"}
   */
  async chargeUser(amount, note, dryrun) {
    const logTag = '[chargeUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/charges.json`,
      method: 'post',
      body: {
        user_id: this.username || 'me',
        amount,
        note,
        dryrun: dryrun ? 'true' : undefined,
      },
    })
  }

  /**
   * @typedef {Object} getGoalsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter goals by slug or title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Beeminder returns all goals in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Goals Dictionary
   * @description Provides a selectable list of the authenticated user's goals for goal-slug parameters. Each option's value is the goal slug expected by the goal and datapoint operations.
   * @route POST /get-goals-dictionary
   * @paramDef {"type":"getGoalsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input for filtering goals."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Read More","value":"read","note":"hustler - pages"}],"cursor":null}
   */
  async getGoalsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getGoalsDictionary]'

    const goals = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/${ this.#user() }/goals.json`,
      method: 'get',
    })

    const term = (search || '').toLowerCase()

    const items = (Array.isArray(goals) ? goals : [])
      .filter(goal => {
        if (!term) {
          return true
        }

        return `${ goal.slug || '' } ${ goal.title || '' }`.toLowerCase().includes(term)
      })
      .map(goal => {
        const noteParts = [goal.goal_type, goal.gunits].filter(Boolean)

        return {
          label: goal.title || goal.slug,
          value: goal.slug,
          note: noteParts.join(' - ') || undefined,
        }
      })

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(BeeminderService, [
  {
    name: 'authToken',
    displayName: 'Auth Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your personal Beeminder auth token. Find it in Beeminder → Settings → account → API/apps, or at beeminder.com/api/v1/auth_token.json',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    defaultValue: 'me',
    shared: false,
    hint: "Your Beeminder username. Defaults to 'me', which resolves to the account that owns the auth token.",
  },
])
