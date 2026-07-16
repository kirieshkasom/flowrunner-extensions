const logger = {
  info: (...args) => console.log('[Onfleet] info:', ...args),
  debug: (...args) => console.log('[Onfleet] debug:', ...args),
  error: (...args) => console.log('[Onfleet] error:', ...args),
  warn: (...args) => console.log('[Onfleet] warn:', ...args),
}

const API_BASE_URL = 'https://onfleet.com/api/v2'

// Onfleet task states are integers: 0 unassigned, 1 assigned, 2 active, 3 completed.
const TASK_STATE_MAP = {
  Unassigned: 0,
  Assigned: 1,
  Active: 2,
  Completed: 3,
}

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
 * @integrationName Onfleet
 * @integrationIcon /icon.png
 */
class OnfleetService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Onfleet uses HTTP Basic auth: the API key is the username, the password is empty.
  #authHeader() {
    const token = Buffer.from(`${ this.apiKey }:`).toString('base64')

    return `Basic ${ token }`
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': this.#authHeader(),
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      // Onfleet errors are shaped { message: { error, message, cause, request } }.
      const errBody = error.body || {}
      const onfleetMessage = errBody.message
      const status = error.status || error.statusCode

      let detail

      if (onfleetMessage && typeof onfleetMessage === 'object') {
        detail = [onfleetMessage.message, onfleetMessage.cause].filter(Boolean).join(' - ')
      } else {
        detail = onfleetMessage || error.message
      }

      const suffix = status ? ` (status ${ status })` : ''
      logger.error(`${ logTag } - failed: ${ detail }${ suffix }`)
      throw new Error(`Onfleet API error: ${ detail }${ suffix }`)
    }
  }

  // Resolves a friendly DROPDOWN label to its API value; passes through unknown values.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Builds a destination payload: either an existing destination ID (string) or an
  // inline object with an address and/or [longitude, latitude] location.
  #buildDestination(destinationId, address, coordinates, destinationNotes) {
    if (destinationId) {
      return destinationId
    }

    const destination = {}
    const cleanedAddress = clean(address)

    if (cleanedAddress && Object.keys(cleanedAddress).length > 0) {
      destination.address = cleanedAddress
    }

    if (Array.isArray(coordinates) && coordinates.length === 2) {
      destination.location = coordinates.map(Number)
    }

    if (destinationNotes) {
      destination.notes = destinationNotes
    }

    return Object.keys(destination).length > 0 ? destination : undefined
  }

  // Builds a recipients array from an existing recipient ID or an inline {name, phone, notes}.
  #buildRecipients(recipientId, recipientName, recipientPhone, recipientNotes) {
    if (recipientId) {
      return [recipientId]
    }

    if (recipientName || recipientPhone) {
      return [clean({ name: recipientName, phone: recipientPhone, notes: recipientNotes })]
    }

    return undefined
  }

  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a delivery task, the core unit of work in Onfleet. A task has one destination and (optionally) one recipient. Provide the destination either by referencing an existing Destination ID, or inline via a structured address and/or [longitude, latitude] coordinates. Provide the recipient either by an existing Recipient ID or inline via name and phone. Optionally assign the task to a worker, team, or container, set pickup/dropoff time windows (completeAfter/completeBefore), add notes and quantity, or enable auto-assignment.
   * @route POST /tasks
   * @appearanceColor #6C5CE7 #A29BFE
   *
   * @paramDef {"type":"String","label":"Destination ID","name":"destinationId","description":"ID of an existing destination to reuse (from Create Destination). Leave empty to create the destination inline from Address and/or Coordinates below."}
   * @paramDef {"type":"Object","label":"Address","name":"address","description":"Inline destination address. Fields: number, street, city, state, postalCode, country, apartment, name, unparsed (a single free-form address string as an alternative to structured fields)."}
   * @paramDef {"type":"Array<Number>","label":"Coordinates","name":"coordinates","description":"Inline destination coordinates as [longitude, latitude] (longitude first). Optional if an address is provided."}
   * @paramDef {"type":"String","label":"Destination Notes","name":"destinationNotes","description":"Notes attached to the inline destination (e.g. gate code, delivery instructions)."}
   * @paramDef {"type":"String","label":"Recipient ID","name":"recipientId","description":"ID of an existing recipient. Leave empty to create the recipient inline from the name and phone below."}
   * @paramDef {"type":"String","label":"Recipient Name","name":"recipientName","description":"Inline recipient full name. Used only when Recipient ID is empty."}
   * @paramDef {"type":"String","label":"Recipient Phone","name":"recipientPhone","description":"Inline recipient phone number in international format, e.g. +14155550100. Used only when Recipient ID is empty."}
   * @paramDef {"type":"String","label":"Recipient Notes","name":"recipientNotes","description":"Notes about the inline recipient."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes for the task, shown to the assigned worker."}
   * @paramDef {"type":"String","label":"Complete After","name":"completeAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Earliest time the task should be completed. ISO 8601 timestamp or Unix milliseconds."}
   * @paramDef {"type":"String","label":"Complete Before","name":"completeBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Latest time the task should be completed (deadline). ISO 8601 timestamp or Unix milliseconds."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units for capacity planning."}
   * @paramDef {"type":"Boolean","label":"Pickup Task","name":"pickupTask","uiComponent":{"type":"CHECKBOX"},"description":"Whether this task is a pickup (true) rather than a dropoff (false)."}
   * @paramDef {"type":"String","label":"Worker ID","name":"workerId","dictionary":"getWorkersDictionary","description":"Worker to assign this task to. Leave empty to keep the task unassigned or use auto-dispatch."}
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","dictionary":"getTeamsDictionary","description":"Team to assign this task to (used together with Auto Assign for team-level dispatch)."}
   * @paramDef {"type":"Boolean","label":"Auto Assign","name":"autoAssign","uiComponent":{"type":"CHECKBOX"},"description":"When true, Onfleet automatically assigns the task to the best available worker (uses distance-based auto-assignment)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"11z4Ho0aiRnJ8TVfXA8kj5Xd","shortId":"a13282ee","state":0,"completeAfter":1699488000000,"notes":"Leave at front desk","destination":{"id":"3yFsCFBWnW~Dj3Bwc4NgGP4C","address":{"number":"543","street":"Howard Street","city":"San Francisco","state":"California","country":"United States"},"location":[-122.3971609,37.7877216]},"recipients":[{"id":"7Wb3TdPmdozTWm1Ex2PLpNBc","name":"Jane Doe","phone":"+14155550100"}],"worker":null,"team":null,"trackingURL":"https://onf.lt/a13282ee"}
   */
  async createTask(destinationId, address, coordinates, destinationNotes, recipientId, recipientName, recipientPhone, recipientNotes, notes, completeAfter, completeBefore, quantity, pickupTask, workerId, teamId, autoAssign) {
    const logTag = '[createTask]'

    const body = clean({
      destination: this.#buildDestination(destinationId, address, coordinates, destinationNotes),
      recipients: this.#buildRecipients(recipientId, recipientName, recipientPhone, recipientNotes),
      notes,
      completeAfter: this.#toEpochMs(completeAfter),
      completeBefore: this.#toEpochMs(completeBefore),
      quantity,
      pickupTask,
      container: workerId ? { type: 'WORKER', worker: workerId } : (teamId ? { type: 'TEAM', team: teamId } : undefined),
      autoAssign: autoAssign ? { mode: 'distance' } : undefined,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks`,
      method: 'post',
      body,
    })
  }

  // Accepts ISO 8601 strings or numeric epoch values and returns Unix milliseconds.
  #toEpochMs(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    if (typeof value === 'number') {
      return value
    }

    const asNumber = Number(value)

    if (!Number.isNaN(asNumber) && String(asNumber) === String(value).trim()) {
      return asNumber
    }

    const parsed = Date.parse(value)

    return Number.isNaN(parsed) ? undefined : parsed
  }

  /**
   * @operationName Get Task
   * @category Tasks
   * @description Retrieves a single task by its Onfleet ID, including its state, destination, recipients, assignment, timing windows, and tracking URL.
   * @route GET /tasks/{id}
   * @appearanceColor #6C5CE7 #A29BFE
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The Onfleet task ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"11z4Ho0aiRnJ8TVfXA8kj5Xd","shortId":"a13282ee","state":1,"completeAfter":1699488000000,"destination":{"id":"3yFsCFBWnW~Dj3Bwc4NgGP4C","address":{"street":"Howard Street","city":"San Francisco","state":"California"}},"recipients":[{"id":"7Wb3TdPmdozTWm1Ex2PLpNBc","name":"Jane Doe","phone":"+14155550100"}],"worker":"apaïR7Nao8I2fCFTLHEZzUXÝ","trackingURL":"https://onf.lt/a13282ee"}
   */
  async getTask(taskId) {
    const logTag = '[getTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks/${ encodeURIComponent(taskId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Task by Short ID
   * @category Tasks
   * @description Retrieves a task using its human-readable short ID (the 8-character code shown in tracking URLs and the dashboard) instead of the full Onfleet ID.
   * @route GET /tasks/shortId/{shortId}
   * @appearanceColor #6C5CE7 #A29BFE
   *
   * @paramDef {"type":"String","label":"Short ID","name":"shortId","required":true,"description":"The task's 8-character short ID, e.g. a13282ee."}
   *
   * @returns {Object}
   * @sampleResult {"id":"11z4Ho0aiRnJ8TVfXA8kj5Xd","shortId":"a13282ee","state":1,"trackingURL":"https://onf.lt/a13282ee","recipients":[{"name":"Jane Doe","phone":"+14155550100"}]}
   */
  async getTaskByShortId(shortId) {
    const logTag = '[getTaskByShortId]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks/shortId/${ encodeURIComponent(shortId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Tasks
   * @category Tasks
   * @description Lists tasks within a time range, optionally filtered by state. Results are paginated via a lastId cursor returned by the previous page. The From time is required by Onfleet; To defaults to the current time.
   * @route GET /tasks
   * @appearanceColor #6C5CE7 #A29BFE
   *
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the time range (based on task creation/completion). ISO 8601 timestamp or Unix milliseconds."}
   * @paramDef {"type":"String","label":"To","name":"to","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the time range. ISO 8601 timestamp or Unix milliseconds. Defaults to now."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Unassigned","Assigned","Active","Completed"]}},"description":"Filter tasks by state. Leave empty to include all states."}
   * @paramDef {"type":"String","label":"Last ID","name":"lastId","description":"Pagination cursor from the previous page's lastId field."}
   *
   * @returns {Object}
   * @sampleResult {"lastId":"cbAfIHrvFroYODvBmrCsf92W","tasks":[{"id":"11z4Ho0aiRnJ8TVfXA8kj5Xd","shortId":"a13282ee","state":3,"trackingURL":"https://onf.lt/a13282ee","recipients":[{"name":"Jane Doe"}]}]}
   */
  async listTasks(from, to, state, lastId) {
    const logTag = '[listTasks]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks/all`,
      method: 'get',
      query: {
        from: this.#toEpochMs(from),
        to: this.#toEpochMs(to),
        state: this.#resolveChoice(state, TASK_STATE_MAP),
        lastId,
      },
    })
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Updates fields on an existing task, such as notes, timing windows, quantity, or recipient assignment. Only the provided fields are changed. Completed tasks cannot be updated.
   * @route PUT /tasks/{id}
   * @appearanceColor #6C5CE7 #A29BFE
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The Onfleet task ID to update."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Replacement notes for the task."}
   * @paramDef {"type":"String","label":"Complete After","name":"completeAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New earliest completion time. ISO 8601 or Unix milliseconds."}
   * @paramDef {"type":"String","label":"Complete Before","name":"completeBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New latest completion time (deadline). ISO 8601 or Unix milliseconds."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New unit quantity for capacity planning."}
   *
   * @returns {Object}
   * @sampleResult {"id":"11z4Ho0aiRnJ8TVfXA8kj5Xd","shortId":"a13282ee","state":1,"notes":"Updated: ring twice","completeBefore":1699502400000,"quantity":2}
   */
  async updateTask(taskId, notes, completeAfter, completeBefore, quantity) {
    const logTag = '[updateTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks/${ encodeURIComponent(taskId) }`,
      method: 'put',
      body: clean({
        notes,
        completeAfter: this.#toEpochMs(completeAfter),
        completeBefore: this.#toEpochMs(completeBefore),
        quantity,
      }),
    })
  }

  /**
   * @operationName Complete Task
   * @category Tasks
   * @description Force-completes a task on behalf of the assigned worker (the task must be in the active state). Set Success to true for a successful delivery or false to mark it as failed/unable to complete, and optionally attach completion notes.
   * @route POST /tasks/{id}/complete
   * @appearanceColor #6C5CE7 #A29BFE
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The Onfleet task ID to complete. Must be in the active state."}
   * @paramDef {"type":"Boolean","label":"Success","name":"success","required":true,"uiComponent":{"type":"CHECKBOX"},"description":"Whether the task was completed successfully (true) or failed (false)."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Completion notes recorded against the task."}
   *
   * @returns {Object}
   * @sampleResult {"id":"11z4Ho0aiRnJ8TVfXA8kj5Xd","shortId":"a13282ee","state":3,"completionDetails":{"success":true,"notes":"Delivered to front desk","time":1699491600000}}
   */
  async completeTask(taskId, success, notes) {
    const logTag = '[completeTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks/${ encodeURIComponent(taskId) }/complete`,
      method: 'post',
      body: {
        completionDetails: clean({
          success: Boolean(success),
          notes,
        }),
      },
    })
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @description Permanently deletes a task. Only tasks that have not yet been completed can be deleted.
   * @route DELETE /tasks/{id}
   * @appearanceColor #6C5CE7 #A29BFE
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The Onfleet task ID to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"11z4Ho0aiRnJ8TVfXA8kj5Xd"}
   */
  async deleteTask(taskId) {
    const logTag = '[deleteTask]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks/${ encodeURIComponent(taskId) }`,
      method: 'delete',
    })

    return { success: true, id: taskId }
  }

  /**
   * @operationName List Workers
   * @category Workers
   * @description Lists all workers (drivers) in the organization, including their name, phone, assigned teams, vehicle, and current on-duty status.
   * @route GET /workers
   * @appearanceColor #00B894 #55EFC4
   *
   * @paramDef {"type":"String","label":"Team IDs","name":"teams","description":"Comma-separated team IDs to filter workers by team membership."}
   * @paramDef {"type":"Boolean","label":"Include Analytics","name":"analytics","uiComponent":{"type":"CHECKBOX"},"description":"Include per-worker analytics (distances, durations) in the response."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"apaïR7Nao8I2fCFTLHEZzUXÝ","name":"Ari Kalinovsky","phone":"+14155550120","teams":["nz1nHwjvyfLnqQCba7Sabvy8"],"onDuty":true,"vehicle":{"type":"CAR","description":"Blue Prius"}}]
   */
  async listWorkers(teams, analytics) {
    const logTag = '[listWorkers]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workers`,
      method: 'get',
      query: {
        teams,
        analytics: analytics ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Get Worker
   * @category Workers
   * @description Retrieves a single worker by ID, including profile, teams, vehicle, on-duty status, and (if on a task) current location.
   * @route GET /workers/{id}
   * @appearanceColor #00B894 #55EFC4
   *
   * @paramDef {"type":"String","label":"Worker ID","name":"workerId","required":true,"dictionary":"getWorkersDictionary","description":"The Onfleet worker ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"apaïR7Nao8I2fCFTLHEZzUXÝ","name":"Ari Kalinovsky","phone":"+14155550120","teams":["nz1nHwjvyfLnqQCba7Sabvy8"],"onDuty":true,"vehicle":{"type":"CAR"}}
   */
  async getWorker(workerId) {
    const logTag = '[getWorker]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workers/${ encodeURIComponent(workerId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Worker
   * @category Workers
   * @description Creates a new worker (driver). Requires a name, a phone number in international format, and at least one team. Optionally provide a vehicle. The worker receives an SMS invite to the Onfleet driver app.
   * @route POST /workers
   * @appearanceColor #00B894 #55EFC4
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Worker's full name."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":true,"description":"Worker's phone in international format, e.g. +14155550120. Used to invite them to the driver app."}
   * @paramDef {"type":"Array<String>","label":"Team IDs","name":"teams","required":true,"description":"IDs of the teams this worker belongs to (at least one required)."}
   * @paramDef {"type":"String","label":"Vehicle Type","name":"vehicleType","uiComponent":{"type":"DROPDOWN","options":{"values":["Car","Motorcycle","Bicycle","Truck"]}},"description":"The worker's vehicle type."}
   * @paramDef {"type":"String","label":"Vehicle Description","name":"vehicleDescription","description":"Free-form vehicle description, e.g. 'Blue Toyota Prius'."}
   * @paramDef {"type":"String","label":"License Plate","name":"licensePlate","description":"Vehicle license plate number."}
   *
   * @returns {Object}
   * @sampleResult {"id":"apaïR7Nao8I2fCFTLHEZzUXÝ","name":"Ari Kalinovsky","phone":"+14155550120","teams":["nz1nHwjvyfLnqQCba7Sabvy8"],"vehicle":{"type":"CAR","description":"Blue Toyota Prius","licensePlate":"7XER187"}}
   */
  async createWorker(name, phone, teams, vehicleType, vehicleDescription, licensePlate) {
    const logTag = '[createWorker]'

    const vehicle = clean({
      type: this.#resolveChoice(vehicleType, { Car: 'CAR', Motorcycle: 'MOTORCYCLE', Bicycle: 'BICYCLE', Truck: 'TRUCK' }),
      description: vehicleDescription,
      licensePlate,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workers`,
      method: 'post',
      body: clean({
        name,
        phone,
        teams: Array.isArray(teams) ? teams : (teams ? [teams] : undefined),
        vehicle: vehicle && Object.keys(vehicle).length > 0 ? vehicle : undefined,
      }),
    })
  }

  /**
   * @operationName Update Worker
   * @category Workers
   * @description Updates an existing worker's name, team memberships, or vehicle. Only the provided fields are changed. The worker's phone number cannot be changed via this operation.
   * @route PUT /workers/{id}
   * @appearanceColor #00B894 #55EFC4
   *
   * @paramDef {"type":"String","label":"Worker ID","name":"workerId","required":true,"dictionary":"getWorkersDictionary","description":"The Onfleet worker ID to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New full name for the worker."}
   * @paramDef {"type":"Array<String>","label":"Team IDs","name":"teams","description":"New complete list of team IDs the worker belongs to (replaces existing teams)."}
   * @paramDef {"type":"String","label":"Vehicle Type","name":"vehicleType","uiComponent":{"type":"DROPDOWN","options":{"values":["Car","Motorcycle","Bicycle","Truck"]}},"description":"New vehicle type for the worker."}
   * @paramDef {"type":"String","label":"Vehicle Description","name":"vehicleDescription","description":"New free-form vehicle description."}
   *
   * @returns {Object}
   * @sampleResult {"id":"apaïR7Nao8I2fCFTLHEZzUXÝ","name":"Ari K.","teams":["nz1nHwjvyfLnqQCba7Sabvy8"],"vehicle":{"type":"BICYCLE"}}
   */
  async updateWorker(workerId, name, teams, vehicleType, vehicleDescription) {
    const logTag = '[updateWorker]'

    const vehicle = clean({
      type: this.#resolveChoice(vehicleType, { Car: 'CAR', Motorcycle: 'MOTORCYCLE', Bicycle: 'BICYCLE', Truck: 'TRUCK' }),
      description: vehicleDescription,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workers/${ encodeURIComponent(workerId) }`,
      method: 'put',
      body: clean({
        name,
        teams: Array.isArray(teams) ? teams : undefined,
        vehicle: vehicle && Object.keys(vehicle).length > 0 ? vehicle : undefined,
      }),
    })
  }

  /**
   * @operationName Delete Worker
   * @category Workers
   * @description Permanently removes a worker from the organization. Any tasks currently assigned to them become unassigned.
   * @route DELETE /workers/{id}
   * @appearanceColor #00B894 #55EFC4
   *
   * @paramDef {"type":"String","label":"Worker ID","name":"workerId","required":true,"dictionary":"getWorkersDictionary","description":"The Onfleet worker ID to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"apaïR7Nao8I2fCFTLHEZzUXÝ"}
   */
  async deleteWorker(workerId) {
    const logTag = '[deleteWorker]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workers/${ encodeURIComponent(workerId) }`,
      method: 'delete',
    })

    return { success: true, id: workerId }
  }

  /**
   * @operationName Get Worker Schedule
   * @category Workers
   * @description Retrieves a worker's schedule: the days they are scheduled to work along with shift start times, durations, and timezone.
   * @route GET /workers/{id}/schedule
   * @appearanceColor #00B894 #55EFC4
   *
   * @paramDef {"type":"String","label":"Worker ID","name":"workerId","required":true,"dictionary":"getWorkersDictionary","description":"The Onfleet worker ID."}
   *
   * @returns {Object}
   * @sampleResult {"entries":[{"date":"2026-07-14","timezone":"America/Los_Angeles","shifts":[[1699488000000,28800000]]}]}
   */
  async getWorkerSchedule(workerId) {
    const logTag = '[getWorkerSchedule]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workers/${ encodeURIComponent(workerId) }/schedule`,
      method: 'get',
    })
  }

  /**
   * @operationName List Teams
   * @category Teams
   * @description Lists all teams in the organization, including their name, member worker IDs, associated hub, and enabled self-assignment settings.
   * @route GET /teams
   * @appearanceColor #0984E3 #74B9FF
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"nz1nHwjvyfLnqQCba7Sabvy8","name":"Downtown Couriers","workers":["apaïR7Nao8I2fCFTLHEZzUXÝ"],"hub":"P3Tj8Qv~4qWk5Qm2m~","managers":[]}]
   */
  async listTeams() {
    const logTag = '[listTeams]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Team
   * @category Teams
   * @description Retrieves a single team by ID, including its member workers, associated hub, and managers.
   * @route GET /teams/{id}
   * @appearanceColor #0984E3 #74B9FF
   *
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The Onfleet team ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"nz1nHwjvyfLnqQCba7Sabvy8","name":"Downtown Couriers","workers":["apaïR7Nao8I2fCFTLHEZzUXÝ"],"hub":"P3Tj8Qv~4qWk5Qm2m~","managers":[]}
   */
  async getTeam(teamId) {
    const logTag = '[getTeam]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams/${ encodeURIComponent(teamId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Team
   * @category Teams
   * @description Creates a new team. Requires a name; optionally seed it with worker IDs and an associated hub.
   * @route POST /teams
   * @appearanceColor #0984E3 #74B9FF
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the team."}
   * @paramDef {"type":"Array<String>","label":"Worker IDs","name":"workers","description":"IDs of workers to add to the team."}
   * @paramDef {"type":"String","label":"Hub ID","name":"hub","description":"ID of the hub associated with this team."}
   *
   * @returns {Object}
   * @sampleResult {"id":"nz1nHwjvyfLnqQCba7Sabvy8","name":"Downtown Couriers","workers":["apaïR7Nao8I2fCFTLHEZzUXÝ"],"hub":"P3Tj8Qv~4qWk5Qm2m~","managers":[]}
   */
  async createTeam(name, workers, hub) {
    const logTag = '[createTeam]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams`,
      method: 'post',
      body: clean({
        name,
        workers: Array.isArray(workers) ? workers : (workers ? [workers] : []),
        hub,
      }),
    })
  }

  /**
   * @operationName Get Team's Tasks
   * @category Teams
   * @description Retrieves the tasks currently associated with a team's worklist (unassigned tasks in the team plus tasks assigned to the team's workers). Supports optional time-range filtering.
   * @route GET /teams/{id}/tasks
   * @appearanceColor #0984E3 #74B9FF
   *
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The Onfleet team ID."}
   * @paramDef {"type":"String","label":"From","name":"from","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the time range. ISO 8601 or Unix milliseconds."}
   * @paramDef {"type":"String","label":"To","name":"to","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the time range. ISO 8601 or Unix milliseconds."}
   *
   * @returns {Object}
   * @sampleResult {"tasks":[{"id":"11z4Ho0aiRnJ8TVfXA8kj5Xd","shortId":"a13282ee","state":1,"trackingURL":"https://onf.lt/a13282ee"}]}
   */
  async getTeamTasks(teamId, from, to) {
    const logTag = '[getTeamTasks]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams/${ encodeURIComponent(teamId) }/tasks`,
      method: 'get',
      query: {
        from: this.#toEpochMs(from),
        to: this.#toEpochMs(to),
      },
    })
  }

  /**
   * @operationName Auto-Dispatch Team
   * @category Teams
   * @description Triggers Onfleet's automatic dispatch for a team, assigning the team's unassigned tasks to its available on-duty workers and optimizing their routes. Returns a dispatch ID for tracking.
   * @route POST /teams/{id}/dispatch
   * @appearanceColor #0984E3 #74B9FF
   *
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The Onfleet team ID to dispatch."}
   *
   * @returns {Object}
   * @sampleResult {"dispatch":"a13282ee-9f21-4b7c-8f2a-1c3d5e7f9a0b"}
   */
  async autoDispatchTeam(teamId) {
    const logTag = '[autoDispatchTeam]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams/${ encodeURIComponent(teamId) }/dispatch`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Create Destination
   * @category Destinations
   * @description Creates a reusable destination that can be referenced by ID when creating tasks. Provide a structured address and/or explicit [longitude, latitude] coordinates. Reusing destinations avoids re-geocoding the same location.
   * @route POST /destinations
   * @appearanceColor #E17055 #FAB1A0
   *
   * @paramDef {"type":"Object","label":"Address","name":"address","description":"Structured address. Fields: number, street, city, state, postalCode, country, apartment, name, unparsed (a single free-form address string as an alternative to structured fields)."}
   * @paramDef {"type":"Array<Number>","label":"Coordinates","name":"coordinates","description":"[longitude, latitude] (longitude first). Optional when an address is provided; Onfleet geocodes the address otherwise."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes attached to the destination, e.g. access instructions."}
   *
   * @returns {Object}
   * @sampleResult {"id":"3yFsCFBWnW~Dj3Bwc4NgGP4C","address":{"number":"543","street":"Howard Street","city":"San Francisco","state":"California","country":"United States"},"location":[-122.3971609,37.7877216],"notes":"Gate code 1234"}
   */
  async createDestination(address, coordinates, notes) {
    const logTag = '[createDestination]'

    const body = clean({
      address: clean(address),
      location: (Array.isArray(coordinates) && coordinates.length === 2) ? coordinates.map(Number) : undefined,
      notes,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/destinations`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Destination
   * @category Destinations
   * @description Retrieves a destination by ID, including its resolved address and [longitude, latitude] coordinates.
   * @route GET /destinations/{id}
   * @appearanceColor #E17055 #FAB1A0
   *
   * @paramDef {"type":"String","label":"Destination ID","name":"destinationId","required":true,"description":"The Onfleet destination ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"3yFsCFBWnW~Dj3Bwc4NgGP4C","address":{"number":"543","street":"Howard Street","city":"San Francisco","state":"California"},"location":[-122.3971609,37.7877216]}
   */
  async getDestination(destinationId) {
    const logTag = '[getDestination]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/destinations/${ encodeURIComponent(destinationId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Recipient
   * @category Recipients
   * @description Creates a reusable recipient (the end customer receiving a delivery). Requires a name and a phone number in international format. Recipients can then be referenced by ID or looked up by name/phone when creating tasks.
   * @route POST /recipients
   * @appearanceColor #FDCB6E #FFEAA7
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Recipient's full name."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":true,"description":"Recipient's phone in international format, e.g. +14155550100."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes about the recipient."}
   * @paramDef {"type":"Boolean","label":"Skip SMS Notifications","name":"skipSMSNotifications","uiComponent":{"type":"CHECKBOX"},"description":"When true, the recipient will not receive Onfleet SMS notifications."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7Wb3TdPmdozTWm1Ex2PLpNBc","name":"Jane Doe","phone":"+14155550100","notes":"Prefers contactless delivery","skipSMSNotifications":false}
   */
  async createRecipient(name, phone, notes, skipSMSNotifications) {
    const logTag = '[createRecipient]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/recipients`,
      method: 'post',
      body: clean({
        name,
        phone,
        notes,
        skipSMSNotifications: skipSMSNotifications ? true : undefined,
      }),
    })
  }

  /**
   * @operationName Get Recipient by Name
   * @category Recipients
   * @description Looks up a recipient by their exact full name (case-insensitive). Returns the matching recipient record.
   * @route GET /recipients/name/{name}
   * @appearanceColor #FDCB6E #FFEAA7
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The recipient's exact full name to look up."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7Wb3TdPmdozTWm1Ex2PLpNBc","name":"Jane Doe","phone":"+14155550100"}
   */
  async getRecipientByName(name) {
    const logTag = '[getRecipientByName]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/recipients/name/${ encodeURIComponent(name) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Recipient by Phone
   * @category Recipients
   * @description Looks up a recipient by their phone number. Returns the matching recipient record.
   * @route GET /recipients/phone/{phone}
   * @appearanceColor #FDCB6E #FFEAA7
   *
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":true,"description":"The recipient's phone number in international format, e.g. +14155550100."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7Wb3TdPmdozTWm1Ex2PLpNBc","name":"Jane Doe","phone":"+14155550100"}
   */
  async getRecipientByPhone(phone) {
    const logTag = '[getRecipientByPhone]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/recipients/phone/${ encodeURIComponent(phone) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Recipient
   * @category Recipients
   * @description Updates an existing recipient's name, phone, notes, or SMS notification preference. Only the provided fields are changed.
   * @route PUT /recipients/{id}
   * @appearanceColor #FDCB6E #FFEAA7
   *
   * @paramDef {"type":"String","label":"Recipient ID","name":"recipientId","required":true,"description":"The Onfleet recipient ID to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New full name for the recipient."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number in international format."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New notes about the recipient."}
   * @paramDef {"type":"Boolean","label":"Skip SMS Notifications","name":"skipSMSNotifications","uiComponent":{"type":"CHECKBOX"},"description":"Whether to suppress Onfleet SMS notifications for this recipient."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7Wb3TdPmdozTWm1Ex2PLpNBc","name":"Jane Doe","phone":"+14155550111","notes":"New number"}
   */
  async updateRecipient(recipientId, name, phone, notes, skipSMSNotifications) {
    const logTag = '[updateRecipient]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/recipients/${ encodeURIComponent(recipientId) }`,
      method: 'put',
      body: clean({
        name,
        phone,
        notes,
        skipSMSNotifications: typeof skipSMSNotifications === 'boolean' ? skipSMSNotifications : undefined,
      }),
    })
  }

  /**
   * @operationName List Hubs
   * @category Hubs
   * @description Lists the organization's hubs (physical dispatch locations such as warehouses or stores) with their name, address, and coordinates. Hub IDs can be used when creating teams.
   * @route GET /hubs
   * @appearanceColor #636E72 #B2BEC3
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"P3Tj8Qv~4qWk5Qm2m~","name":"Main Warehouse","address":{"street":"55 Green Street","city":"San Francisco","state":"California"},"location":[-122.4001,37.7900]}]
   */
  async listHubs() {
    const logTag = '[listHubs]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/hubs`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Organization Details
   * @category Organization
   * @description Retrieves details about the authenticated organization (name, email, timezone, country, and enabled features). Useful as a connection check to confirm the API key is valid.
   * @route GET /organization
   * @appearanceColor #636E72 #B2BEC3
   *
   * @returns {Object}
   * @sampleResult {"id":"yAM*fDkztrT3gUcz9mNDgNOL","name":"Acme Deliveries","email":"ops@acme.com","country":"United States","timezone":"America/Los_Angeles","delegateeIds":[]}
   */
  async getOrganizationDetails() {
    const logTag = '[getOrganizationDetails]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/organization`,
      method: 'get',
    })
  }

  /**
   * @typedef {Object} getWorkersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter workers by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Onfleet returns all workers in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Workers Dictionary
   * @description Provides a selectable list of workers (drivers) for assigning tasks or looking up a worker. The option value is the Onfleet worker ID.
   * @route POST /get-workers-dictionary
   * @paramDef {"type":"getWorkersDictionary__payload","label":"Payload","name":"payload","description":"Optional search text used to filter workers by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Ari Kalinovsky","value":"apaïR7Nao8I2fCFTLHEZzUXÝ","note":"+14155550120"}],"cursor":null}
   */
  async getWorkersDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getWorkersDictionary]'

    const workers = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workers`,
      method: 'get',
    })

    const list = Array.isArray(workers) ? workers : []
    const term = (search || '').trim().toLowerCase()

    const filtered = term ? list.filter(w => (w.name || '').toLowerCase().includes(term)) : list

    return {
      items: filtered.map(worker => ({
        label: worker.name || worker.id,
        value: worker.id,
        note: worker.phone || undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getTeamsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter teams by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Onfleet returns all teams in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Teams Dictionary
   * @description Provides a selectable list of teams for assigning tasks, dispatching, or lookups. The option value is the Onfleet team ID.
   * @route POST /get-teams-dictionary
   * @paramDef {"type":"getTeamsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text used to filter teams by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Downtown Couriers","value":"nz1nHwjvyfLnqQCba7Sabvy8","note":"3 workers"}],"cursor":null}
   */
  async getTeamsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getTeamsDictionary]'

    const teams = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams`,
      method: 'get',
    })

    const list = Array.isArray(teams) ? teams : []
    const term = (search || '').trim().toLowerCase()

    const filtered = term ? list.filter(t => (t.name || '').toLowerCase().includes(term)) : list

    return {
      items: filtered.map(team => ({
        label: team.name || team.id,
        value: team.id,
        note: Array.isArray(team.workers) ? `${ team.workers.length } workers` : undefined,
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(OnfleetService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Onfleet API key. Create one in Onfleet → Settings → API → create an API Key. It is sent via HTTP Basic auth as the username with an empty password.',
  },
])
