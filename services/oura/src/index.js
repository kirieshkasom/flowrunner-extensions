const logger = {
  info: (...args) => console.log('[Oura] info:', ...args),
  debug: (...args) => console.log('[Oura] debug:', ...args),
  error: (...args) => console.log('[Oura] error:', ...args),
  warn: (...args) => console.log('[Oura] warn:', ...args),
}

const API_BASE_URL = 'https://api.ouraring.com/v2'

// Collections addressable via the generic single-document endpoint.
const COLLECTION_MAP = {
  'Daily Readiness': 'daily_readiness',
  'Daily Sleep': 'daily_sleep',
  'Sleep (Detailed Periods)': 'sleep',
  'Daily Activity': 'daily_activity',
  'Daily SpO2': 'daily_spo2',
  'Daily Stress': 'daily_stress',
  'Daily Resilience': 'daily_resilience',
  'Daily Cardiovascular Age': 'daily_cardiovascular_age',
  'Workout': 'workout',
  'Session': 'session',
  'Enhanced Tag': 'enhanced_tag',
  'Rest Mode Period': 'rest_mode_period',
  'Ring Configuration': 'ring_configuration',
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
 * @integrationName Oura
 * @integrationIcon /icon.png
 */
class OuraService {
  constructor(config) {
    this.accessToken = config.accessToken
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all Oura API calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      // Oura returns validation/auth errors as { detail: ... }.
      const detail = error.body?.detail
      const detailText = typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : undefined
      const message = detailText || error.body?.message || error.message || 'Unknown error'

      logger.error(`${ logTag } - failed (${ status || 'n/a' }): ${ message }`)

      throw new Error(`Oura API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  // Shared fetch for date-range (start_date/end_date) collections.
  async #getDateRange({ collection, startDate, endDate, nextToken, logTag }) {
    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/usercollection/${ collection }`,
      method: 'get',
      query: {
        start_date: startDate,
        end_date: endDate,
        next_token: nextToken,
      },
    })
  }

  /**
   * @operationName Get Daily Readiness
   * @category Daily Summaries
   * @description Retrieves daily readiness summaries for a date range. Each item reflects how recovered and prepared the body is for the day, including an overall readiness score and contributor breakdowns (resting heart rate, HRV balance, body temperature, recovery index, sleep balance). Results are paginated; pass the returned next_token to fetch the next page.
   * @route GET /daily-readiness
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"8f9a...","day":"2024-01-15","score":78,"temperature_deviation":-0.2,"temperature_trend_deviation":0.1,"timestamp":"2024-01-15T00:00:00+00:00","contributors":{"activity_balance":85,"body_temperature":98,"hrv_balance":72,"previous_day_activity":60,"previous_night":80,"recovery_index":90,"resting_heart_rate":88,"sleep_balance":75}}],"next_token":null}
   */
  async getDailyReadiness(startDate, endDate, nextToken) {
    return await this.#getDateRange({
      logTag: '[getDailyReadiness]',
      collection: 'daily_readiness',
      startDate,
      endDate,
      nextToken,
    })
  }

  /**
   * @operationName Get Daily Sleep
   * @category Daily Summaries
   * @description Retrieves daily sleep summaries for a date range. Each item is the aggregated sleep score for a day with contributor breakdowns (deep sleep, efficiency, latency, REM sleep, restfulness, timing, total sleep). For per-period sleep detail (multiple naps/main sleep with hypnogram), use Get Sleep Periods instead. Paginated via next_token.
   * @route GET /daily-sleep
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"a1b2...","day":"2024-01-15","score":82,"timestamp":"2024-01-15T00:00:00+00:00","contributors":{"deep_sleep":95,"efficiency":90,"latency":88,"rem_sleep":78,"restfulness":70,"timing":85,"total_sleep":80}}],"next_token":null}
   */
  async getDailySleep(startDate, endDate, nextToken) {
    return await this.#getDateRange({
      logTag: '[getDailySleep]',
      collection: 'daily_sleep',
      startDate,
      endDate,
      nextToken,
    })
  }

  /**
   * @operationName Get Sleep Periods
   * @category Sleep Detail
   * @description Retrieves detailed sleep periods for a date range. Unlike Get Daily Sleep, each item is an individual sleep session (main sleep or nap) with granular metrics: sleep phase durations (deep/light/REM/awake), efficiency, latency, average heart rate and HRV, respiratory rate, hypnogram, and 5-minute time-series data. Paginated via next_token.
   * @route GET /sleep-periods
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"c3d4...","day":"2024-01-15","type":"long_sleep","bedtime_start":"2024-01-14T23:10:00+00:00","bedtime_end":"2024-01-15T07:05:00+00:00","total_sleep_duration":26400,"deep_sleep_duration":5400,"rem_sleep_duration":6000,"light_sleep_duration":15000,"awake_time":1500,"efficiency":92,"latency":600,"average_heart_rate":54.2,"average_hrv":45,"average_breath":14.1}],"next_token":null}
   */
  async getSleepPeriods(startDate, endDate, nextToken) {
    return await this.#getDateRange({
      logTag: '[getSleepPeriods]',
      collection: 'sleep',
      startDate,
      endDate,
      nextToken,
    })
  }

  /**
   * @operationName Get Daily Activity
   * @category Daily Summaries
   * @description Retrieves daily activity summaries for a date range. Each item includes the activity score, active/total calories, equivalent walking distance, steps, MET data, sedentary/inactive/active time, and contributor breakdowns. Paginated via next_token.
   * @route GET /daily-activity
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"e5f6...","day":"2024-01-15","score":88,"active_calories":520,"total_calories":2680,"steps":10450,"equivalent_walking_distance":8200,"high_activity_time":900,"medium_activity_time":3600,"low_activity_time":14400,"sedentary_time":28800,"target_calories":500}],"next_token":null}
   */
  async getDailyActivity(startDate, endDate, nextToken) {
    return await this.#getDateRange({
      logTag: '[getDailyActivity]',
      collection: 'daily_activity',
      startDate,
      endDate,
      nextToken,
    })
  }

  /**
   * @operationName Get Daily SpO2
   * @category Daily Summaries
   * @description Retrieves daily blood oxygen saturation (SpO2) summaries for a date range. Each item includes the average overnight SpO2 percentage and a breathing disturbance index. SpO2 is only recorded on nights when the ring measured it, so some days may be absent. Paginated via next_token.
   * @route GET /daily-spo2
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"11aa...","day":"2024-01-15","spo2_percentage":{"average":97.3},"breathing_disturbance_index":4}],"next_token":null}
   */
  async getDailySpo2(startDate, endDate, nextToken) {
    return await this.#getDateRange({
      logTag: '[getDailySpo2]',
      collection: 'daily_spo2',
      startDate,
      endDate,
      nextToken,
    })
  }

  /**
   * @operationName Get Daily Stress
   * @category Daily Summaries
   * @description Retrieves daily stress summaries for a date range. Each item reports total high-stress and recovery time in seconds for the day plus a day summary classification (restored, normal, or stressful). Paginated via next_token.
   * @route GET /daily-stress
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"22bb...","day":"2024-01-15","stress_high":7200,"recovery_high":18000,"day_summary":"normal"}],"next_token":null}
   */
  async getDailyStress(startDate, endDate, nextToken) {
    return await this.#getDateRange({
      logTag: '[getDailyStress]',
      collection: 'daily_stress',
      startDate,
      endDate,
      nextToken,
    })
  }

  /**
   * @operationName Get Daily Resilience
   * @category Daily Summaries
   * @description Retrieves daily resilience summaries for a date range. Each item includes a resilience level (limited, adequate, solid, strong, exceptional) and contributor breakdowns for sleep recovery, daytime recovery, and stress. Paginated via next_token.
   * @route GET /daily-resilience
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"33cc...","day":"2024-01-15","level":"solid","contributors":{"sleep_recovery":75.5,"daytime_recovery":68.2,"stress":40.1}}],"next_token":null}
   */
  async getDailyResilience(startDate, endDate, nextToken) {
    return await this.#getDateRange({
      logTag: '[getDailyResilience]',
      collection: 'daily_resilience',
      startDate,
      endDate,
      nextToken,
    })
  }

  /**
   * @operationName Get Daily Cardiovascular Age
   * @category Daily Summaries
   * @description Retrieves daily cardiovascular age estimates for a date range. Each item reports the estimated vascular age (in years) derived from arterial stiffness and cardiovascular metrics. Values are only produced when sufficient data is available, so some days may be absent. Paginated via next_token.
   * @route GET /daily-cardiovascular-age
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"day":"2024-01-15","vascular_age":34}],"next_token":null}
   */
  async getDailyCardiovascularAge(startDate, endDate, nextToken) {
    return await this.#getDateRange({
      logTag: '[getDailyCardiovascularAge]',
      collection: 'daily_cardiovascular_age',
      startDate,
      endDate,
      nextToken,
    })
  }

  /**
   * @operationName Get Heart Rate
   * @category Time Series
   * @description Retrieves time-series heart rate samples between two ISO 8601 datetimes. Unlike the daily summary endpoints, this uses datetime bounds (not calendar dates) and returns individual bpm readings each tagged with the measurement source (awake, rest, sleep, session, workout, live). Provide full ISO 8601 timestamps, e.g. 2024-01-15T00:00:00+00:00. Paginated via next_token.
   * @route GET /heart-rate
   *
   * @paramDef {"type":"String","label":"Start Datetime","name":"startDatetime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the range (inclusive), ISO 8601 datetime, e.g. 2024-01-15T00:00:00+00:00."}
   * @paramDef {"type":"String","label":"End Datetime","name":"endDatetime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the range (inclusive), ISO 8601 datetime, e.g. 2024-01-16T00:00:00+00:00."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"bpm":58,"source":"sleep","timestamp":"2024-01-15T01:05:00+00:00"},{"bpm":72,"source":"awake","timestamp":"2024-01-15T09:12:00+00:00"}],"next_token":null}
   */
  async getHeartRate(startDatetime, endDatetime, nextToken) {
    return await this.#apiRequest({
      logTag: '[getHeartRate]',
      url: `${ API_BASE_URL }/usercollection/heartrate`,
      method: 'get',
      query: {
        start_datetime: startDatetime,
        end_datetime: endDatetime,
        next_token: nextToken,
      },
    })
  }

  /**
   * @operationName Get Workouts
   * @category Activity
   * @description Retrieves logged and auto-detected workouts for a date range. Each item includes the activity type, intensity (easy, moderate, hard), calories burned, distance, start and end datetimes, and the source (manual, autodetected, or confirmed). Paginated via next_token.
   * @route GET /workouts
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"44dd...","day":"2024-01-15","activity":"running","intensity":"moderate","calories":410.5,"distance":6200.0,"start_datetime":"2024-01-15T18:00:00+00:00","end_datetime":"2024-01-15T18:45:00+00:00","label":null,"source":"autodetected"}],"next_token":null}
   */
  async getWorkouts(startDate, endDate, nextToken) {
    return await this.#getDateRange({
      logTag: '[getWorkouts]',
      collection: 'workout',
      startDate,
      endDate,
      nextToken,
    })
  }

  /**
   * @operationName Get Sessions
   * @category Activity
   * @description Retrieves guided and unguided moment sessions (breathing, meditation, relaxation, rest) for a date range. Each item includes the session type, mood, start and end datetimes, and optional time-series data for heart rate, HRV, and motion count. Paginated via next_token.
   * @route GET /sessions
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"55ee...","day":"2024-01-15","type":"breathing","mood":"good","start_datetime":"2024-01-15T20:00:00+00:00","end_datetime":"2024-01-15T20:10:00+00:00"}],"next_token":null}
   */
  async getSessions(startDate, endDate, nextToken) {
    return await this.#getDateRange({
      logTag: '[getSessions]',
      collection: 'session',
      startDate,
      endDate,
      nextToken,
    })
  }

  /**
   * @operationName Get Enhanced Tags
   * @category Activity
   * @description Retrieves enhanced tags for a date range. Enhanced tags are user-created annotations (e.g. caffeine, alcohol, sick, travel) with an optional custom comment and a start/end datetime describing when the tagged activity or state occurred. Paginated via next_token.
   * @route GET /enhanced-tags
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"66ff...","tag_type_code":"tag_generic_caffeine","start_time":"2024-01-15T08:00:00+00:00","end_time":null,"start_day":"2024-01-15","end_day":null,"comment":"Espresso"}],"next_token":null}
   */
  async getEnhancedTags(startDate, endDate, nextToken) {
    return await this.#getDateRange({
      logTag: '[getEnhancedTags]',
      collection: 'enhanced_tag',
      startDate,
      endDate,
      nextToken,
    })
  }

  /**
   * @operationName Get Rest Mode Periods
   * @category Activity
   * @description Retrieves Rest Mode periods for a date range. Rest Mode is enabled during illness or recovery; each item includes the start and end day of the period and a list of episodes describing tags and comments logged during rest mode. Paginated via next_token.
   * @route GET /rest-mode-periods
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the range (inclusive), formatted YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"77gg...","start_day":"2024-01-10","end_day":"2024-01-13","start_time":"2024-01-10T09:00:00+00:00","end_time":"2024-01-13T21:00:00+00:00","episodes":[{"tags":["tag_generic_sick"],"timestamp":"2024-01-10T09:00:00+00:00"}]}],"next_token":null}
   */
  async getRestModePeriods(startDate, endDate, nextToken) {
    return await this.#getDateRange({
      logTag: '[getRestModePeriods]',
      collection: 'rest_mode_period',
      startDate,
      endDate,
      nextToken,
    })
  }

  /**
   * @operationName Get Ring Configuration
   * @category Account
   * @description Retrieves the user's ring configuration records. Each item describes a ring the user owns: color, design, hardware type, firmware version, and size. Not a daterange query — returns the full set of configured rings, paginated via next_token.
   * @route GET /ring-configuration
   *
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's next_token. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"88hh...","color":"stealth","design":"heritage","firmware_version":"2.8.60","hardware_type":"gen3","set_up_at":"2023-06-01T10:00:00+00:00","size":9}],"next_token":null}
   */
  async getRingConfiguration(nextToken) {
    return await this.#apiRequest({
      logTag: '[getRingConfiguration]',
      url: `${ API_BASE_URL }/usercollection/ring_configuration`,
      method: 'get',
      query: {
        next_token: nextToken,
      },
    })
  }

  /**
   * @operationName Get Personal Info
   * @category Account
   * @description Retrieves the authenticated user's personal information (age, weight, height, biological sex, and email where available). Returns a single object rather than a paginated list, making it the simplest call to verify that the access token is valid and connected.
   * @route GET /personal-info
   *
   * @returns {Object}
   * @sampleResult {"id":"99ii...","age":34,"weight":72.5,"height":1.8,"biological_sex":"male","email":"user@example.com"}
   */
  async getPersonalInfo() {
    return await this.#apiRequest({
      logTag: '[getPersonalInfo]',
      url: `${ API_BASE_URL }/usercollection/personal_info`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Single Document
   * @category Documents
   * @description Retrieves a single document by its ID from a chosen Oura collection. Select the collection type and provide the document_id (the "id" field returned by the corresponding list operation). Returns the same object shape as one element of that collection's data array. Use this to re-fetch a specific record without a date range.
   * @route GET /single-document
   *
   * @paramDef {"type":"String","label":"Collection","name":"collection","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Daily Readiness","Daily Sleep","Sleep (Detailed Periods)","Daily Activity","Daily SpO2","Daily Stress","Daily Resilience","Daily Cardiovascular Age","Workout","Session","Enhanced Tag","Rest Mode Period","Ring Configuration"]}},"description":"The Oura collection the document belongs to."}
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The document's id (the \"id\" value from the matching list operation)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"8f9a...","day":"2024-01-15","score":78,"timestamp":"2024-01-15T00:00:00+00:00"}
   */
  async getSingleDocument(collection, documentId) {
    const resolvedCollection = this.#resolveChoice(collection, COLLECTION_MAP)

    return await this.#apiRequest({
      logTag: '[getSingleDocument]',
      url: `${ API_BASE_URL }/usercollection/${ resolvedCollection }/${ encodeURIComponent(documentId) }`,
      method: 'get',
    })
  }
}

Flowrunner.ServerCode.addService(OuraService, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Oura Personal Access Token. In Oura, go to cloud.ouraring.com > Personal Access Tokens and create a token. Sent as the Authorization: Bearer header.',
  },
])
