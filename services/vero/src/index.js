const logger = {
  info: (...args) => console.log('[Vero] info:', ...args),
  debug: (...args) => console.log('[Vero] debug:', ...args),
  error: (...args) => console.log('[Vero] error:', ...args),
  warn: (...args) => console.log('[Vero] warn:', ...args),
}

const API_BASE_URL = 'https://api.getvero.com/api/v2'

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
 * @integrationName Vero
 * @integrationIcon /icon.png
 */
class VeroService {
  constructor(config) {
    this.authToken = config.authToken
  }

  // All Vero Track REST API calls go through here. Vero places the auth_token
  // inside the JSON request body of every call (not in an Authorization header),
  // so it is merged into the body here.
  async #apiRequest({ url, method = 'post', body, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const payload = { auth_token: this.authToken, ...(body || {}) }

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Content-Type': 'application/json' })

      const response = await request.send(payload)

      // Vero returns { status, message } on some responses; surface API-level errors.
      if (response && typeof response === 'object' && response.status && Number(response.status) >= 400) {
        throw new Error(`Vero API error (${ response.status }): ${ response.message || 'Unknown error' }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('Vero API error')) {
        throw error
      }

      const status = error.status || error.statusCode
      const message = error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Vero API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Identify User
   * @category Users
   * @description Creates or updates a user profile in Vero (the "identify" half of Vero's identify-then-track model). A user must be identified before events can be tracked against them. Provide a stable, unique user identifier and optionally an email address and a data object of custom profile properties (name, plan, signup date, etc.). Calling this again for the same id updates the stored profile.
   * @route POST /users/identify
   * @appearanceColor #5638F7 #8A6BFF
   *
   * @paramDef {"type":"String","label":"User ID","name":"id","required":true,"description":"Your unique, stable identifier for the user (e.g. your database user id). Used to reference this user in all other operations."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The user's email address. Required to send email to the user; recommended on every identify call."}
   * @paramDef {"type":"Object","label":"Data","name":"data","description":"Custom profile properties as key/value pairs (e.g. {\"first_name\":\"Jane\",\"plan\":\"pro\"}). Merged into the user's profile."}
   *
   * @returns {Object}
   * @sampleResult {"status":200,"message":"success"}
   */
  async identifyUser(id, email, data) {
    const logTag = '[identifyUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/track.json`,
      method: 'post',
      body: clean({ id, email, data }),
    })
  }

  /**
   * @operationName Update User
   * @category Users
   * @description Updates properties on an existing Vero user profile. Provide the user's id and a changes object containing only the properties to add or update; existing properties not included are left unchanged. Use Identify User to create a new profile.
   * @route PUT /users/edit
   * @appearanceColor #5638F7 #8A6BFF
   *
   * @paramDef {"type":"String","label":"User ID","name":"id","required":true,"description":"The unique identifier of the user to update (as used when the user was identified)."}
   * @paramDef {"type":"Object","label":"Changes","name":"changes","required":true,"description":"Object of profile properties to add or update, e.g. {\"plan\":\"enterprise\",\"last_login\":\"2024-01-01\"}."}
   *
   * @returns {Object}
   * @sampleResult {"status":200,"message":"success"}
   */
  async updateUser(id, changes) {
    const logTag = '[updateUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/edit.json`,
      method: 'put',
      body: clean({ id, changes }),
    })
  }

  /**
   * @operationName Edit User Tags
   * @category Users
   * @description Adds and/or removes tags on a Vero user, used for segmenting and targeting customers. Provide the user's id and a list of tags to add and/or a list of tags to remove. Tags that are added and already present, or removed and not present, are ignored.
   * @route PUT /users/tags/edit
   * @appearanceColor #5638F7 #8A6BFF
   *
   * @paramDef {"type":"String","label":"User ID","name":"id","required":true,"description":"The unique identifier of the user whose tags are being edited."}
   * @paramDef {"type":"Array<String>","label":"Add Tags","name":"add","description":"Tags to add to the user, e.g. [\"trial\",\"newsletter\"]."}
   * @paramDef {"type":"Array<String>","label":"Remove Tags","name":"remove","description":"Tags to remove from the user, e.g. [\"trial\"]."}
   *
   * @returns {Object}
   * @sampleResult {"status":200,"message":"success"}
   */
  async editUserTags(id, add, remove) {
    const logTag = '[editUserTags]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/tags/edit.json`,
      method: 'put',
      body: clean({ id, add, remove }),
    })
  }

  /**
   * @operationName Unsubscribe User
   * @category Users
   * @description Unsubscribes a user from all email communications in Vero. The user profile is retained but no further campaign or transactional email is sent to them until they are resubscribed. Provide the user's id.
   * @route POST /users/unsubscribe
   * @appearanceColor #5638F7 #8A6BFF
   *
   * @paramDef {"type":"String","label":"User ID","name":"id","required":true,"description":"The unique identifier of the user to unsubscribe."}
   *
   * @returns {Object}
   * @sampleResult {"status":200,"message":"success"}
   */
  async unsubscribeUser(id) {
    const logTag = '[unsubscribeUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/unsubscribe.json`,
      method: 'post',
      body: clean({ id }),
    })
  }

  /**
   * @operationName Resubscribe User
   * @category Users
   * @description Resubscribes a previously unsubscribed user, re-enabling email communications in Vero. Provide the user's id.
   * @route POST /users/resubscribe
   * @appearanceColor #5638F7 #8A6BFF
   *
   * @paramDef {"type":"String","label":"User ID","name":"id","required":true,"description":"The unique identifier of the user to resubscribe."}
   *
   * @returns {Object}
   * @sampleResult {"status":200,"message":"success"}
   */
  async resubscribeUser(id) {
    const logTag = '[resubscribeUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/resubscribe.json`,
      method: 'post',
      body: clean({ id }),
    })
  }

  /**
   * @operationName Delete User
   * @category Users
   * @description Permanently deletes a user profile and its associated data from Vero. This cannot be undone. Provide the user's id.
   * @route POST /users/delete
   * @appearanceColor #5638F7 #8A6BFF
   *
   * @paramDef {"type":"String","label":"User ID","name":"id","required":true,"description":"The unique identifier of the user to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":200,"message":"success"}
   */
  async deleteUser(id) {
    const logTag = '[deleteUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/delete.json`,
      method: 'post',
      body: clean({ id }),
    })
  }

  /**
   * @operationName Reidentify User
   * @category Users
   * @description Changes the identifier of an existing Vero user from their current id to a new id, preserving the profile, events, and history. Commonly used to migrate a user from a temporary/anonymous id to a permanent one after signup. Provide the current id and the new id.
   * @route PUT /users/reidentify
   * @appearanceColor #5638F7 #8A6BFF
   *
   * @paramDef {"type":"String","label":"Current User ID","name":"id","required":true,"description":"The user's current unique identifier."}
   * @paramDef {"type":"String","label":"New User ID","name":"newId","required":true,"description":"The new unique identifier to assign to the user going forward."}
   *
   * @returns {Object}
   * @sampleResult {"status":200,"message":"success"}
   */
  async reidentifyUser(id, newId) {
    const logTag = '[reidentifyUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/reidentify.json`,
      method: 'put',
      body: clean({ id, new_id: newId }),
    })
  }

  /**
   * @operationName Track Event
   * @category Events
   * @description Tracks an event performed by a user (the "track" half of Vero's identify-then-track model), which can trigger behavioral email campaigns. Identify the user with an id and/or email in the identity object; if the user does not yet exist they are created from that identity. Provide an event name and optionally a data object of event properties and an extras object of Vero-specific options.
   * @route POST /events/track
   * @appearanceColor #5638F7 #8A6BFF
   *
   * @paramDef {"type":"String","label":"User ID","name":"id","description":"The unique identifier of the user who performed the event. Provide id and/or email to identify the user."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The email address of the user who performed the event. Provide id and/or email to identify the user."}
   * @paramDef {"type":"String","label":"Event Name","name":"eventName","required":true,"description":"The name of the event, e.g. \"purchased_item\" or \"viewed_page\"."}
   * @paramDef {"type":"Object","label":"Data","name":"data","description":"Event properties as key/value pairs, e.g. {\"product\":\"Widget\",\"amount\":29.99}. Available for use in email templates."}
   * @paramDef {"type":"Object","label":"Extras","name":"extras","description":"Optional Vero-specific options for the event, e.g. delivery scheduling settings."}
   *
   * @returns {Object}
   * @sampleResult {"status":200,"message":"success"}
   */
  async trackEvent(id, email, eventName, data, extras) {
    const logTag = '[trackEvent]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events/track.json`,
      method: 'post',
      body: clean({
        identity: clean({ id, email }),
        event_name: eventName,
        data,
        extras,
      }),
    })
  }
}

Flowrunner.ServerCode.addService(VeroService, [
  {
    name: 'authToken',
    displayName: 'Auth Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Vero API v2 auth token. Find it in Vero → Project → Settings → Auth Token. Sent in the JSON body of every request.',
  },
])
