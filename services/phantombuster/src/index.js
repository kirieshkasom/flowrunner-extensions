const logger = {
  info: (...args) => console.log('[Phantombuster] info:', ...args),
  debug: (...args) => console.log('[Phantombuster] debug:', ...args),
  error: (...args) => console.log('[Phantombuster] error:', ...args),
  warn: (...args) => console.log('[Phantombuster] warn:', ...args),
}

const API_BASE_URL = 'https://api.phantombuster.com/api/v2'

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
 * @integrationName Phantombuster
 * @integrationIcon /icon.png
 */
class PhantombusterService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  /**
   * Single private request helper. All Phantombuster API calls go through here.
   * Flowrunner.Request returns the response body directly on success.
   */
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'X-Phantombuster-Key-1': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.error || error.body?.message || error.message

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`Phantombuster API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  #parseArgument(argument, label) {
    if (argument === undefined || argument === null || argument === '') {
      return undefined
    }

    if (typeof argument === 'object') {
      return argument
    }

    try {
      return JSON.parse(argument)
    } catch (error) {
      throw new Error(`Phantombuster API error: ${ label } must be a valid JSON object. ${ error.message }`)
    }
  }

  /**
   * @operationName List Agents
   * @category Agents
   * @description Lists all agents (phantoms) in your Phantombuster organization. Each agent is a configured automation that scrapes or automates a task. Returns each agent's id, name, script id, launch settings, and last-run metadata. Use an agent id with Launch Agent to start a run.
   * @route GET /agents/fetch-all
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"1234567890123456","name":"LinkedIn Profile Scraper","scriptId":9876,"orgId":42,"nbLaunches":128,"lastEndMessage":"Execution finished","lastEndStatus":"finished"}]
   */
  async listAgents() {
    return await this.#apiRequest({
      logTag: '[listAgents]',
      url: `${ API_BASE_URL }/agents/fetch-all`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Agent
   * @category Agents
   * @description Fetches a single agent (phantom) by its id, including its configuration, launch arguments, script id, and last-run status. Use this to inspect an agent before launching it.
   * @route GET /agents/fetch
   *
   * @paramDef {"type":"String","label":"Agent ID","name":"id","required":true,"dictionary":"getAgentsDictionary","description":"The id of the agent to fetch. Select an agent from the list or paste an id directly."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890123456","name":"LinkedIn Profile Scraper","scriptId":9876,"orgId":42,"argument":"{\"sessionCookie\":\"...\"}","nbLaunches":128,"lastEndStatus":"finished"}
   */
  async getAgent(id) {
    return await this.#apiRequest({
      logTag: '[getAgent]',
      url: `${ API_BASE_URL }/agents/fetch`,
      method: 'get',
      query: { id },
    })
  }

  /**
   * @operationName Launch Agent
   * @category Agents
   * @description Launches an agent (phantom) to run in a new container. Optionally pass an argument object to override the agent's saved input configuration for this run, a bonus argument merged on top, and saveArgument to persist the argument as the agent's default. Returns the containerId of the started run. The agent runs asynchronously - poll Get Agent Output or Get Container until it finishes, then use Get Container Result Object to retrieve the scraped data.
   * @route POST /agents/launch
   *
   * @paramDef {"type":"String","label":"Agent ID","name":"id","required":true,"dictionary":"getAgentsDictionary","description":"The id of the agent (phantom) to launch. Select an agent from the list or paste an id directly."}
   * @paramDef {"type":"Object","label":"Argument","name":"argument","description":"Optional JSON object overriding the agent's input configuration for this run (agent-specific fields, e.g. session cookie, spreadsheet URL, number of profiles). Accepts a JSON object or a JSON string."}
   * @paramDef {"type":"Object","label":"Bonus Argument","name":"bonusArgument","description":"Optional JSON object merged on top of the argument for this run only, without being saved. Useful for one-off overrides. Accepts a JSON object or a JSON string."}
   * @paramDef {"type":"Boolean","label":"Save Argument","name":"saveArgument","uiComponent":{"type":"CHECKBOX"},"description":"When true, persists the supplied argument as the agent's default configuration for future runs. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"containerId":"7654321098765432"}
   */
  async launchAgent(id, argument, bonusArgument, saveArgument) {
    const body = clean({
      id,
      argument: this.#parseArgument(argument, 'Argument'),
      bonusArgument: this.#parseArgument(bonusArgument, 'Bonus Argument'),
      saveArgument: saveArgument === undefined ? undefined : Boolean(saveArgument),
    })

    return await this.#apiRequest({
      logTag: '[launchAgent]',
      url: `${ API_BASE_URL }/agents/launch`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Agent Output
   * @category Agents
   * @description Returns the current or latest run output for an agent: console/progress output, run status, progress percentage, and the resultObject (structured JSON result) when available. Use this to poll an in-progress launch until its status is finished, then read the resultObject. The output mode controls how much is returned.
   * @route GET /agents/fetch-output
   *
   * @paramDef {"type":"String","label":"Agent ID","name":"id","required":true,"dictionary":"getAgentsDictionary","description":"The id of the agent whose output to fetch. Select an agent from the list or paste an id directly."}
   * @paramDef {"type":"String","label":"Mode","name":"mode","uiComponent":{"type":"DROPDOWN","options":{"values":["Most Recent","Last Finished"]}},"description":"Which run's output to return: the most recent (possibly still running) or the last finished run. Defaults to Most Recent."}
   *
   * @returns {Object}
   * @sampleResult {"status":"finished","containerId":"7654321098765432","progress":{"progress":1,"label":"Done"},"output":"Scraping 20 profiles...\nExecution finished","resultObject":"[{\"profileUrl\":\"https://linkedin.com/in/jane\",\"name\":\"Jane Doe\"}]"}
   */
  async getAgentOutput(id, mode) {
    const resolvedMode = this.#resolveChoice(mode, {
      'Most Recent': 'most-recent',
      'Last Finished': 'last-finished',
    })

    return await this.#apiRequest({
      logTag: '[getAgentOutput]',
      url: `${ API_BASE_URL }/agents/fetch-output`,
      method: 'get',
      query: { id, mode: resolvedMode },
    })
  }

  /**
   * @operationName Abort Agent
   * @category Agents
   * @description Aborts the currently running container(s) of an agent, stopping the automation immediately. Use this to cancel a run that is stuck or no longer needed. Returns the number of containers that were stopped.
   * @route POST /agents/abort
   *
   * @paramDef {"type":"String","label":"Agent ID","name":"id","required":true,"dictionary":"getAgentsDictionary","description":"The id of the agent whose running containers to abort. Select an agent from the list or paste an id directly."}
   *
   * @returns {Object}
   * @sampleResult {"nbAborted":1}
   */
  async abortAgent(id) {
    return await this.#apiRequest({
      logTag: '[abortAgent]',
      url: `${ API_BASE_URL }/agents/abort`,
      method: 'post',
      body: { id },
    })
  }

  /**
   * @operationName Get Container
   * @category Containers
   * @description Fetches a single container by its id. A container represents one run (execution) of an agent. Returns the run's status (running, finished, etc.), launch metadata, and timing. Use this to poll a specific run started by Launch Agent until it finishes.
   * @route GET /containers/fetch
   *
   * @paramDef {"type":"String","label":"Container ID","name":"id","required":true,"description":"The id of the container (run) to fetch, as returned by Launch Agent."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7654321098765432","agentId":"1234567890123456","status":"finished","lastEndStatus":"finished","launchType":"manually","launchDate":1720000000000}
   */
  async getContainer(id) {
    return await this.#apiRequest({
      logTag: '[getContainer]',
      url: `${ API_BASE_URL }/containers/fetch`,
      method: 'get',
      query: { id },
    })
  }

  /**
   * @operationName Get Container Result Object
   * @category Containers
   * @description Returns the structured JSON result object produced by a container run - this is the scraped/automated data (e.g. the list of profiles, posts, or leads the phantom collected). This is the key operation for retrieving results after a run finishes. Call it with the containerId from Launch Agent once Get Container or Get Agent Output reports status finished.
   * @route GET /containers/fetch-result-object
   *
   * @paramDef {"type":"String","label":"Container ID","name":"id","required":true,"description":"The id of the container (run) whose result object to fetch, as returned by Launch Agent."}
   *
   * @returns {Object}
   * @sampleResult {"resultObject":"[{\"profileUrl\":\"https://linkedin.com/in/jane\",\"name\":\"Jane Doe\",\"company\":\"Acme\"}]"}
   */
  async getContainerResultObject(id) {
    return await this.#apiRequest({
      logTag: '[getContainerResultObject]',
      url: `${ API_BASE_URL }/containers/fetch-result-object`,
      method: 'get',
      query: { id },
    })
  }

  /**
   * @operationName List Agent Containers
   * @category Containers
   * @description Lists all containers (runs) for a given agent, most recent first, including each run's id, status, and timing. Use this to find past runs of an agent and retrieve their results with Get Container Result Object.
   * @route GET /containers/fetch-all
   *
   * @paramDef {"type":"String","label":"Agent ID","name":"agentId","required":true,"dictionary":"getAgentsDictionary","description":"The id of the agent whose containers (runs) to list. Select an agent from the list or paste an id directly."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"7654321098765432","agentId":"1234567890123456","status":"finished","lastEndStatus":"finished","launchDate":1720000000000}]
   */
  async listAgentContainers(agentId) {
    return await this.#apiRequest({
      logTag: '[listAgentContainers]',
      url: `${ API_BASE_URL }/containers/fetch-all`,
      method: 'get',
      query: { agentId },
    })
  }

  /**
   * @operationName Get Organization Resources
   * @category Organization
   * @description Returns your Phantombuster organization's resource usage and limits, including execution time, storage, and email quotas. Useful as a connection check to confirm the API key is valid and to monitor remaining quota before launching agents.
   * @route GET /orgs/fetch-resources
   *
   * @returns {Object}
   * @sampleResult {"executionTimeUsed":3600,"executionTimeLimit":36000,"storageUsed":104857600,"storageLimit":1073741824,"emailsSent":12,"emailsLimit":100}
   */
  async getOrganizationResources() {
    return await this.#apiRequest({
      logTag: '[getOrganizationResources]',
      url: `${ API_BASE_URL }/orgs/fetch-resources`,
      method: 'get',
    })
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @typedef {Object} getAgentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter agents by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Phantombuster returns all agents in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Agents Dictionary
   * @description Provides a selectable list of the agents (phantoms) in your Phantombuster organization for choosing an agent id in the agent and container operations. The option value is the agent id; the label is the agent name.
   * @route POST /get-agents-dictionary
   * @paramDef {"type":"getAgentsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text used to filter agents by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"LinkedIn Profile Scraper","value":"1234567890123456","note":"128 launches"}],"cursor":null}
   */
  async getAgentsDictionary(payload) {
    const { search } = payload || {}

    const agents = await this.#apiRequest({
      logTag: '[getAgentsDictionary]',
      url: `${ API_BASE_URL }/agents/fetch-all`,
      method: 'get',
    })

    const list = Array.isArray(agents) ? agents : []
    const term = (search || '').trim().toLowerCase()

    const filtered = term
      ? list.filter(agent => (agent.name || '').toLowerCase().includes(term))
      : list

    return {
      items: filtered.map(agent => ({
        label: agent.name || String(agent.id),
        value: String(agent.id),
        note: agent.nbLaunches !== undefined ? `${ agent.nbLaunches } launches` : undefined,
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(PhantombusterService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Phantombuster API key, sent as the X-Phantombuster-Key-1 header. Find it in Phantombuster under Workspace settings > API key (Org API key).',
  },
])
