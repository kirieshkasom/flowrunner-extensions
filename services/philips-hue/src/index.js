const logger = {
  info: (...args) => console.log('[Philips Hue] info:', ...args),
  debug: (...args) => console.log('[Philips Hue] debug:', ...args),
  error: (...args) => console.log('[Philips Hue] error:', ...args),
  warn: (...args) => console.log('[Philips Hue] warn:', ...args),
}

/**
 * @integrationName Philips Hue
 * @integrationIcon /icon.svg
 */
class PhilipsHueService {
  constructor(config) {
    this.bridgeIp = config.bridgeIp
    this.applicationKey = config.applicationKey
  }

  #baseUrl() {
    return `https://${ this.bridgeIp }/clip/v2`
  }

  // Single private request helper — all external calls go through here.
  // The Hue Bridge presents a self-signed TLS certificate on the local network;
  // the FlowRunner runtime must be able to reach the bridge IP and accept it.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'hue-application-key': this.applicationKey,
          'Content-Type': 'application/json',
        })
        .query(query || {})

      const response = body !== undefined ? await request.send(body) : await request

      return this.#unwrap(response)
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Philips Hue API error: ${ message }`)
    }
  }

  // CLIP v2 responses are shaped { errors: [], data: [...] }.
  // A non-empty errors array indicates a failed operation; unwrap data otherwise.
  #unwrap(response) {
    if (response && Array.isArray(response.errors) && response.errors.length > 0) {
      const joined = response.errors
        .map(err => err && err.description ? err.description : JSON.stringify(err))
        .join('; ')

      throw new Error(`Philips Hue API error: ${ joined }`)
    }

    return response && response.data !== undefined ? response.data : response
  }

  #extractError(error) {
    if (error && typeof error.message === 'string' && error.message.startsWith('Philips Hue API error:')) {
      return error.message.replace('Philips Hue API error: ', '')
    }

    const bodyErrors = error && error.body && Array.isArray(error.body.errors) ? error.body.errors : null

    if (bodyErrors && bodyErrors.length > 0) {
      return bodyErrors
        .map(err => err && err.description ? err.description : JSON.stringify(err))
        .join('; ')
    }

    return (error && (error.body?.message || error.message)) || 'Unknown error'
  }

  // Build a CLIP v2 light/grouped_light state body from individually supplied fields.
  #buildLightStateBody({ on, brightness, colorX, colorY, mirek, duration }) {
    const body = {}

    if (on !== undefined && on !== null) {
      body.on = { on: Boolean(on) }
    }

    if (brightness !== undefined && brightness !== null) {
      body.dimming = { brightness: Number(brightness) }
    }

    if ((colorX !== undefined && colorX !== null) || (colorY !== undefined && colorY !== null)) {
      body.color = { xy: { x: Number(colorX), y: Number(colorY) } }
    }

    if (mirek !== undefined && mirek !== null) {
      body.color_temperature = { mirek: Number(mirek) }
    }

    if (duration !== undefined && duration !== null) {
      body.dynamics = { duration: Number(duration) }
    }

    return body
  }

  /**
   * @operationName Get Lights
   * @category Lights
   * @description Retrieves all light resources known to the Hue Bridge, including on/off state, brightness (dimming), color (xy), color temperature (mirek), and supported capabilities. Each light has a unique rid (UUID) used to address it in Get Light and Set Light State.
   * @route GET /lights
   * @returns {Array}
   * @sampleResult {"data":[{"id":"3a9c...","type":"light","metadata":{"name":"Living Room Lamp"},"on":{"on":true},"dimming":{"brightness":80.0},"color_temperature":{"mirek":366}}]}
   */
  async getLights() {
    return await this.#apiRequest({
      logTag: '[getLights]',
      url: `${ this.#baseUrl() }/resource/light`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Light
   * @category Lights
   * @description Retrieves a single light resource by its rid (UUID). Returns full state including on/off, dimming brightness, color, and color temperature.
   * @route GET /lights/{id}
   * @paramDef {"type":"String","label":"Light ID","name":"id","required":true,"dictionary":"getLightsDictionary","description":"The rid (UUID) of the light. Select from the list or paste a light rid."}
   * @returns {Array}
   * @sampleResult {"data":[{"id":"3a9c...","type":"light","metadata":{"name":"Living Room Lamp"},"on":{"on":true},"dimming":{"brightness":80.0}}]}
   */
  async getLight(id) {
    return await this.#apiRequest({
      logTag: '[getLight]',
      url: `${ this.#baseUrl() }/resource/light/${ id }`,
      method: 'get',
    })
  }

  /**
   * @operationName Set Light State
   * @category Lights
   * @description Updates the state of a single light identified by its rid (UUID). Any combination of fields may be provided: power (on), brightness (0-100 percent), color as CIE xy chromaticity coordinates, color temperature in mirek (153 cool ≈ 6500K to 500 warm ≈ 2000K), and a transition duration in milliseconds. Only the supplied fields are sent to the bridge. Setting color and color temperature together is not recommended; the bridge applies the last effective value.
   * @route PUT /lights/{id}
   * @paramDef {"type":"String","label":"Light ID","name":"id","required":true,"dictionary":"getLightsDictionary","description":"The rid (UUID) of the light to update."}
   * @paramDef {"type":"Boolean","label":"On","name":"on","uiComponent":{"type":"TOGGLE"},"description":"Turn the light on (true) or off (false). Leave unset to keep the current power state."}
   * @paramDef {"type":"Number","label":"Brightness","name":"brightness","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Brightness as a percentage from 0 to 100. Leave unset to keep the current brightness."}
   * @paramDef {"type":"Number","label":"Color X","name":"colorX","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"CIE color space X chromaticity coordinate (0.0-1.0). Provide together with Color Y to set color."}
   * @paramDef {"type":"Number","label":"Color Y","name":"colorY","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"CIE color space Y chromaticity coordinate (0.0-1.0). Provide together with Color X to set color."}
   * @paramDef {"type":"Number","label":"Color Temperature (mirek)","name":"mirek","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Color temperature in mirek from 153 (cool ≈ 6500K) to 500 (warm ≈ 2000K). Leave unset to keep the current color temperature."}
   * @paramDef {"type":"Number","label":"Transition Duration (ms)","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Transition time in milliseconds for the state change (e.g. 400). Leave unset for the bridge default."}
   * @returns {Array}
   * @sampleResult {"data":[{"rid":"3a9c...","rtype":"light"}]}
   */
  async setLightState(id, on, brightness, colorX, colorY, mirek, duration) {
    const body = this.#buildLightStateBody({ on, brightness, colorX, colorY, mirek, duration })

    return await this.#apiRequest({
      logTag: '[setLightState]',
      url: `${ this.#baseUrl() }/resource/light/${ id }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Get Grouped Lights
   * @category Grouped Lights
   * @description Retrieves all grouped_light resources. A grouped light aggregates the on/off and dimming state of the lights in a room or zone, letting you control them together. Each has a unique rid (UUID).
   * @route GET /grouped-lights
   * @returns {Array}
   * @sampleResult {"data":[{"id":"7d2e...","type":"grouped_light","on":{"on":true},"dimming":{"brightness":65.0}}]}
   */
  async getGroupedLights() {
    return await this.#apiRequest({
      logTag: '[getGroupedLights]',
      url: `${ this.#baseUrl() }/resource/grouped_light`,
      method: 'get',
    })
  }

  /**
   * @operationName Set Grouped Light
   * @category Grouped Lights
   * @description Updates a grouped_light resource by its rid (UUID), applying the change to all lights in the associated room or zone at once. Accepts the same fields as Set Light State: power (on), brightness (0-100 percent), color xy, color temperature (mirek 153-500), and transition duration in milliseconds. Only supplied fields are sent.
   * @route PUT /grouped-lights/{id}
   * @paramDef {"type":"String","label":"Grouped Light ID","name":"id","required":true,"description":"The rid (UUID) of the grouped_light to update. Obtain it from Get Grouped Lights, or from a room/zone's services list."}
   * @paramDef {"type":"Boolean","label":"On","name":"on","uiComponent":{"type":"TOGGLE"},"description":"Turn the group on (true) or off (false). Leave unset to keep the current power state."}
   * @paramDef {"type":"Number","label":"Brightness","name":"brightness","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Brightness as a percentage from 0 to 100. Leave unset to keep the current brightness."}
   * @paramDef {"type":"Number","label":"Color X","name":"colorX","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"CIE color space X chromaticity coordinate (0.0-1.0). Provide together with Color Y to set color."}
   * @paramDef {"type":"Number","label":"Color Y","name":"colorY","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"CIE color space Y chromaticity coordinate (0.0-1.0). Provide together with Color X to set color."}
   * @paramDef {"type":"Number","label":"Color Temperature (mirek)","name":"mirek","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Color temperature in mirek from 153 (cool ≈ 6500K) to 500 (warm ≈ 2000K). Leave unset to keep the current color temperature."}
   * @paramDef {"type":"Number","label":"Transition Duration (ms)","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Transition time in milliseconds for the state change (e.g. 400). Leave unset for the bridge default."}
   * @returns {Array}
   * @sampleResult {"data":[{"rid":"7d2e...","rtype":"grouped_light"}]}
   */
  async setGroupedLight(id, on, brightness, colorX, colorY, mirek, duration) {
    const body = this.#buildLightStateBody({ on, brightness, colorX, colorY, mirek, duration })

    return await this.#apiRequest({
      logTag: '[setGroupedLight]',
      url: `${ this.#baseUrl() }/resource/grouped_light/${ id }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Get Rooms
   * @category Rooms & Zones
   * @description Retrieves all room resources. A room groups devices by physical location and references a grouped_light service used to control all its lights together. Each room has a unique rid (UUID).
   * @route GET /rooms
   * @returns {Array}
   * @sampleResult {"data":[{"id":"91af...","type":"room","metadata":{"name":"Living Room","archetype":"living_room"},"children":[{"rid":"...","rtype":"device"}],"services":[{"rid":"7d2e...","rtype":"grouped_light"}]}]}
   */
  async getRooms() {
    return await this.#apiRequest({
      logTag: '[getRooms]',
      url: `${ this.#baseUrl() }/resource/room`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Room
   * @category Rooms & Zones
   * @description Retrieves a single room resource by its rid (UUID), including its child devices and the grouped_light service used to control the room.
   * @route GET /rooms/{id}
   * @paramDef {"type":"String","label":"Room ID","name":"id","required":true,"description":"The rid (UUID) of the room. Obtain it from Get Rooms."}
   * @returns {Array}
   * @sampleResult {"data":[{"id":"91af...","type":"room","metadata":{"name":"Living Room","archetype":"living_room"},"services":[{"rid":"7d2e...","rtype":"grouped_light"}]}]}
   */
  async getRoom(id) {
    return await this.#apiRequest({
      logTag: '[getRoom]',
      url: `${ this.#baseUrl() }/resource/room/${ id }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Zones
   * @category Rooms & Zones
   * @description Retrieves all zone resources. A zone is a flexible grouping of lights that, unlike a room, is not tied to physical location and can span multiple rooms. Each zone references a grouped_light service and has a unique rid (UUID).
   * @route GET /zones
   * @returns {Array}
   * @sampleResult {"data":[{"id":"c40b...","type":"zone","metadata":{"name":"Downstairs","archetype":"other"},"services":[{"rid":"...","rtype":"grouped_light"}]}]}
   */
  async getZones() {
    return await this.#apiRequest({
      logTag: '[getZones]',
      url: `${ this.#baseUrl() }/resource/zone`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Scenes
   * @category Scenes
   * @description Retrieves all scene resources. A scene stores a set of light states for a room or zone and can be recalled to apply them all at once. Use a scene's rid (UUID) with Activate Scene.
   * @route GET /scenes
   * @returns {Array}
   * @sampleResult {"data":[{"id":"5e1f...","type":"scene","metadata":{"name":"Relax"},"group":{"rid":"91af...","rtype":"room"}}]}
   */
  async getScenes() {
    return await this.#apiRequest({
      logTag: '[getScenes]',
      url: `${ this.#baseUrl() }/resource/scene`,
      method: 'get',
    })
  }

  /**
   * @operationName Activate Scene
   * @category Scenes
   * @description Activates (recalls) a scene by its rid (UUID), applying its stored light states to the associated room or zone. Sends a recall action of "active".
   * @route PUT /scenes/{id}/activate
   * @paramDef {"type":"String","label":"Scene ID","name":"id","required":true,"description":"The rid (UUID) of the scene to activate. Obtain it from Get Scenes."}
   * @returns {Array}
   * @sampleResult {"data":[{"rid":"5e1f...","rtype":"scene"}]}
   */
  async activateScene(id) {
    return await this.#apiRequest({
      logTag: '[activateScene]',
      url: `${ this.#baseUrl() }/resource/scene/${ id }`,
      method: 'put',
      body: { recall: { action: 'active' } },
    })
  }

  /**
   * @operationName Get Devices
   * @category Devices & Sensors
   * @description Retrieves all device resources connected to the Hue Bridge (lights, sensors, switches, plugs, etc.). Each device lists its product metadata and the service resources (light, motion, temperature, etc.) it exposes, addressed by rid (UUID).
   * @route GET /devices
   * @returns {Array}
   * @sampleResult {"data":[{"id":"a1b2...","type":"device","metadata":{"name":"Hallway Sensor","archetype":"unknown_archetype"},"product_data":{"product_name":"Hue motion sensor"},"services":[{"rid":"...","rtype":"motion"}]}]}
   */
  async getDevices() {
    return await this.#apiRequest({
      logTag: '[getDevices]',
      url: `${ this.#baseUrl() }/resource/device`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Motion Sensors
   * @category Devices & Sensors
   * @description Retrieves all motion sensor resources, each reporting whether motion is currently detected along with enablement state. Each motion resource has a unique rid (UUID) and links back to its owning device.
   * @route GET /motion-sensors
   * @returns {Array}
   * @sampleResult {"data":[{"id":"f0e1...","type":"motion","enabled":true,"motion":{"motion":false,"motion_valid":true}}]}
   */
  async getMotionSensors() {
    return await this.#apiRequest({
      logTag: '[getMotionSensors]',
      url: `${ this.#baseUrl() }/resource/motion`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Temperature
   * @category Devices & Sensors
   * @description Retrieves all temperature sensor resources, each reporting the current temperature in degrees Celsius. Each temperature resource has a unique rid (UUID) and links back to its owning device.
   * @route GET /temperature
   * @returns {Array}
   * @sampleResult {"data":[{"id":"b2c3...","type":"temperature","enabled":true,"temperature":{"temperature":21.5,"temperature_valid":true}}]}
   */
  async getTemperature() {
    return await this.#apiRequest({
      logTag: '[getTemperature]',
      url: `${ this.#baseUrl() }/resource/temperature`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Light Level
   * @category Devices & Sensors
   * @description Retrieves all light_level sensor resources, each reporting the ambient light level (in lux-derived units) measured by the sensor. Each resource has a unique rid (UUID) and links back to its owning device.
   * @route GET /light-level
   * @returns {Array}
   * @sampleResult {"data":[{"id":"d4e5...","type":"light_level","enabled":true,"light":{"light_level":12345,"light_level_valid":true}}]}
   */
  async getLightLevel() {
    return await this.#apiRequest({
      logTag: '[getLightLevel]',
      url: `${ this.#baseUrl() }/resource/light_level`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Bridge
   * @category Bridge
   * @description Retrieves the Hue Bridge resource, including its bridge_id and owning device reference. Useful as a connection check to confirm the bridge IP, application key, and TLS reachability are correctly configured.
   * @route GET /bridge
   * @returns {Array}
   * @sampleResult {"data":[{"id":"e6f7...","type":"bridge","bridge_id":"001788fffe...","time_zone":{"time_zone":"Europe/London"}}]}
   */
  async getBridge() {
    return await this.#apiRequest({
      logTag: '[getBridge]',
      url: `${ this.#baseUrl() }/resource/bridge`,
      method: 'get',
    })
  }

  /**
   * @typedef {Object} getLightsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter lights by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The Hue Bridge returns all lights in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lights Dictionary
   * @description Provides a selectable list of the bridge's lights for parameters that require a light rid (UUID). The option value is the light rid; the label is the light's configured name.
   * @route POST /get-lights-dictionary
   * @paramDef {"type":"getLightsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text to filter lights by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Living Room Lamp","value":"3a9c...","note":"light"}],"cursor":null}
   */
  async getLightsDictionary(payload) {
    const { search } = payload || {}

    const lights = await this.#apiRequest({
      logTag: '[getLightsDictionary]',
      url: `${ this.#baseUrl() }/resource/light`,
      method: 'get',
    })

    const list = Array.isArray(lights) ? lights : []
    const term = (search || '').trim().toLowerCase()

    const items = list
      .map(light => {
        const name = light && light.metadata && light.metadata.name ? light.metadata.name : light.id

        return {
          label: name,
          value: light.id,
          note: 'light',
        }
      })
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(PhilipsHueService, [
  {
    name: 'bridgeIp',
    displayName: 'Bridge IP Address',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Hue Bridge IP address on the local network, e.g. 192.168.1.2. The FlowRunner runtime must be able to reach this address; the bridge uses a self-signed TLS certificate.',
  },
  {
    name: 'applicationKey',
    displayName: 'Application Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Hue application key / username, sent as the hue-application-key header. Press the bridge link button, then POST to https://{bridgeIp}/api with {"devicetype":"app#name","generateclientkey":true} to create one.',
  },
])
