'use strict'

const API_BASE_URL = 'https://www.strava.com/api/v3'
const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize'
const TOKEN_URL = 'https://www.strava.com/oauth/token'

const DEFAULT_SCOPE = 'read,activity:read_all,activity:write,profile:read_all'

const logger = {
  info: (...args) => console.log('[Strava] info:', ...args),
  debug: (...args) => console.log('[Strava] debug:', ...args),
  error: (...args) => console.log('[Strava] error:', ...args),
  warn: (...args) => console.log('[Strava] warn:', ...args),
}

// Friendly label -> Strava SportType API value. Labels are the human-readable form
// shown in DROPDOWNs; values are the exact enum tokens the Strava API expects.
const SPORT_TYPE_MAP = {
  'Run': 'Run',
  'Trail Run': 'TrailRun',
  'Virtual Run': 'VirtualRun',
  'Ride': 'Ride',
  'Mountain Bike Ride': 'MountainBikeRide',
  'Gravel Ride': 'GravelRide',
  'E-Bike Ride': 'EBikeRide',
  'E-Mountain Bike Ride': 'EMountainBikeRide',
  'Virtual Ride': 'VirtualRide',
  'Swim': 'Swim',
  'Walk': 'Walk',
  'Hike': 'Hike',
  'Alpine Ski': 'AlpineSki',
  'Backcountry Ski': 'BackcountrySki',
  'Nordic Ski': 'NordicSki',
  'Snowboard': 'Snowboard',
  'Snowshoe': 'Snowshoe',
  'Ice Skate': 'IceSkate',
  'Inline Skate': 'InlineSkate',
  'Roller Ski': 'RollerSki',
  'Canoeing': 'Canoeing',
  'Kayaking': 'Kayaking',
  'Rowing': 'Rowing',
  'Stand Up Paddling': 'StandUpPaddling',
  'Surfing': 'Surfing',
  'Kitesurf': 'Kitesurf',
  'Windsurf': 'Windsurf',
  'Sail': 'Sail',
  'Golf': 'Golf',
  'Soccer': 'Soccer',
  'Tennis': 'Tennis',
  'Pickleball': 'Pickleball',
  'Squash': 'Squash',
  'Racquetball': 'Racquetball',
  'Table Tennis': 'TableTennis',
  'Badminton': 'Badminton',
  'Rock Climbing': 'RockClimbing',
  'Skateboard': 'Skateboard',
  'Elliptical': 'Elliptical',
  'Stair Stepper': 'StairStepper',
  'Weight Training': 'WeightTraining',
  'Crossfit': 'Crossfit',
  'High Intensity Interval Training': 'HighIntensityIntervalTraining',
  'Pilates': 'Pilates',
  'Yoga': 'Yoga',
  'Handcycle': 'Handcycle',
  'Wheelchair': 'Wheelchair',
  'Velomobile': 'Velomobile',
  'Workout': 'Workout',
}

const EXPLORE_ACTIVITY_TYPE_MAP = {
  'Running': 'running',
  'Riding': 'riding',
}

function cleanupObject(source) {
  if (!source) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== null && value !== '')
  )
}

/**
 * @requireOAuth
 * @integrationName Strava
 * @integrationIcon /icon.svg
 **/
class StravaService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  // Single private request helper — all authenticated Strava API calls go through here.
  async #apiRequest({ url, method = 'get', body, query, form, logTag }) {
    method = method.toLowerCase()

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .query(cleanupObject(query))

      if (form !== undefined) {
        return await request
          .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
          .send(new URLSearchParams(cleanupObject(form)).toString())
      }

      return body !== undefined
        ? await request.set({ 'Content-Type': 'application/json' }).send(body)
        : await request
    } catch (error) {
      const responseBody = error.body || {}
      const fieldErrors = Array.isArray(responseBody.errors)
        ? responseBody.errors
          .map(e => `${ e.resource || '' }.${ e.field || '' }: ${ e.code || '' }`.replace(/^\.|: $/g, ''))
          .filter(Boolean)
          .join('; ')
        : ''
      const baseMessage = responseBody.message || error.message || 'Unknown error'
      const message = fieldErrors ? `${ baseMessage } (${ fieldErrors })` : baseMessage

      logger.error(`${ logTag } - failed [${ error.status || error.statusCode || '' }]: ${ message }`)

      throw new Error(`Strava API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ============================================ OAUTH ==============================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('approval_prompt', 'auto')

    const connectionURL = `${ AUTHORIZE_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: callbackObject.code,
        grant_type: 'authorization_code',
      }).toString())

    logger.debug(`[executeCallback] token exchange complete for athlete ${ tokenResponse.athlete?.id }`)

    const athlete = tokenResponse.athlete || {}
    const fullName = [athlete.firstname, athlete.lastname].filter(Boolean).join(' ').trim()

    return {
      token: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expirationInSeconds: this.#expiresInSeconds(tokenResponse),
      connectionIdentityName: fullName || 'Strava Account',
      connectionIdentityImageURL: athlete.profile || athlete.profile_medium || null,
      overwrite: true,
      userData: athlete,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   * @property {String} [refreshToken]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString())

      // Strava rotates the refresh token on every refresh: it returns a NEW refresh_token
      // that must replace the stored one, or the next refresh will fail.
      return {
        token: tokenResponse.access_token,
        expirationInSeconds: this.#expiresInSeconds(tokenResponse),
        refreshToken: tokenResponse.refresh_token,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.status === 400 || error.statusCode === 400) {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  // Strava returns expires_in (seconds remaining) and expires_at (unix epoch). Prefer
  // expires_in; fall back to computing it from expires_at.
  #expiresInSeconds(tokenResponse) {
    if (typeof tokenResponse.expires_in === 'number') {
      return tokenResponse.expires_in
    }

    if (typeof tokenResponse.expires_at === 'number') {
      return Math.max(0, tokenResponse.expires_at - Math.floor(Date.now() / 1000))
    }

    return undefined
  }

  // =========================================== ATHLETE ============================================

  /**
   * @operationName Get Authenticated Athlete
   * @description Retrieves the profile of the currently authenticated athlete, including id, name, city, country, sex, premium status, measurement preference, and profile images. Useful as a connection check.
   * @category Athlete
   * @route GET /athlete
   * @returns {Object}
   * @sampleResult {"id":1234567,"username":"jane_doe","firstname":"Jane","lastname":"Doe","city":"Boulder","country":"United States","sex":"F","premium":true,"profile":"https://example.com/avatar.jpg"}
   */
  async getAuthenticatedAthlete() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/athlete`,
      logTag: 'getAuthenticatedAthlete',
    })
  }

  /**
   * @operationName Get Athlete Stats
   * @description Retrieves the activity stats of an athlete by id (only available for the authenticated athlete). Returns recent, year-to-date, and all-time totals for rides, runs, and swims, plus biggest ride distance and biggest climb elevation gain.
   * @category Athlete
   * @route GET /athlete-stats
   * @paramDef {"type":"Number","label":"Athlete ID","name":"athleteId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The identifier of the athlete. Must match the authenticated athlete's id."}
   * @returns {Object}
   * @sampleResult {"biggest_ride_distance":175454.0,"biggest_climb_elevation_gain":1224.0,"recent_ride_totals":{"count":12,"distance":543210.0},"all_run_totals":{"count":320,"distance":2500000.0}}
   */
  async getAthleteStats(athleteId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/athletes/${ athleteId }/stats`,
      logTag: 'getAthleteStats',
    })
  }

  /**
   * @operationName Update Athlete
   * @description Updates the currently authenticated athlete's weight (in kilograms). Requires the profile:write scope on the connection.
   * @category Athlete
   * @route PUT /athlete
   * @paramDef {"type":"Number","label":"Weight (kg)","name":"weight","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The athlete's weight in kilograms."}
   * @returns {Object}
   * @sampleResult {"id":1234567,"firstname":"Jane","lastname":"Doe","weight":68.5}
   */
  async updateAthlete(weight) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/athlete`,
      method: 'put',
      form: { weight },
      logTag: 'updateAthlete',
    })
  }

  /**
   * @operationName List Athlete Clubs
   * @description Lists the clubs of which the currently authenticated athlete is a member, with support for pagination.
   * @category Athlete
   * @route GET /athlete-clubs
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (defaults to 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (defaults to 30)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":98765,"name":"Boulder Cyclists","sport_type":"cycling","member_count":420,"private":false}]
   */
  async listAthleteClubs(page, perPage) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/athlete/clubs`,
      query: { page, per_page: perPage },
      logTag: 'listAthleteClubs',
    })
  }

  /**
   * @operationName List Athlete Zones
   * @description Returns the authenticated athlete's heart rate and power zones. Requires the profile:read_all scope.
   * @category Athlete
   * @route GET /athlete-zones
   * @returns {Object}
   * @sampleResult {"heart_rate":{"custom_zones":false,"zones":[{"min":0,"max":115},{"min":115,"max":152}]},"power":{"zones":[{"min":0,"max":180}]}}
   */
  async listAthleteZones() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/athlete/zones`,
      logTag: 'listAthleteZones',
    })
  }

  // ========================================== ACTIVITIES ==========================================

  /**
   * @operationName List Activities
   * @description Lists activities for the authenticated athlete, most recent first. Supports time-window filtering with before/after epoch timestamps and pagination. Requires the activity:read scope (and activity:read_all for private/hidden activities).
   * @category Activities
   * @route GET /activities
   * @paramDef {"type":"Number","label":"Before (epoch seconds)","name":"before","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Only return activities that occurred before this Unix epoch timestamp (in seconds)."}
   * @paramDef {"type":"Number","label":"After (epoch seconds)","name":"after","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Only return activities that occurred after this Unix epoch timestamp (in seconds)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (defaults to 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (defaults to 30)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":9876543210,"name":"Morning Run","sport_type":"Run","distance":10234.5,"moving_time":3120,"start_date_local":"2026-07-01T07:15:00Z"}]
   */
  async listActivities(before, after, page, perPage) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/athlete/activities`,
      query: { before, after, page, per_page: perPage },
      logTag: 'listActivities',
    })
  }

  /**
   * @operationName Get Activity
   * @description Retrieves a detailed representation of a single activity by id. Optionally includes all segment efforts. The activity must be owned by the authenticated athlete or be public.
   * @category Activities
   * @route GET /activity
   * @paramDef {"type":"Number","label":"Activity ID","name":"activityId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The identifier of the activity."}
   * @paramDef {"type":"Boolean","label":"Include All Efforts","name":"includeAllEfforts","uiComponent":{"type":"CHECKBOX"},"description":"When true, includes all segment efforts in the response."}
   * @returns {Object}
   * @sampleResult {"id":9876543210,"name":"Morning Run","sport_type":"Run","distance":10234.5,"moving_time":3120,"total_elevation_gain":85.0,"average_speed":3.28}
   */
  async getActivity(activityId, includeAllEfforts) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/activities/${ activityId }`,
      query: { include_all_efforts: includeAllEfforts },
      logTag: 'getActivity',
    })
  }

  /**
   * @operationName Create Activity
   * @description Creates a manual activity for the authenticated athlete. Requires the activity:write scope. Name, sport type, local start time, and elapsed time are required; distance, description, trainer, and commute are optional.
   * @category Activities
   * @route POST /activities
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the activity."}
   * @paramDef {"type":"String","label":"Sport Type","name":"sportType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Run","Trail Run","Virtual Run","Ride","Mountain Bike Ride","Gravel Ride","E-Bike Ride","E-Mountain Bike Ride","Virtual Ride","Swim","Walk","Hike","Alpine Ski","Backcountry Ski","Nordic Ski","Snowboard","Snowshoe","Ice Skate","Inline Skate","Roller Ski","Canoeing","Kayaking","Rowing","Stand Up Paddling","Surfing","Kitesurf","Windsurf","Sail","Golf","Soccer","Tennis","Pickleball","Squash","Racquetball","Table Tennis","Badminton","Rock Climbing","Skateboard","Elliptical","Stair Stepper","Weight Training","Crossfit","High Intensity Interval Training","Pilates","Yoga","Handcycle","Wheelchair","Velomobile","Workout"]}},"description":"The sport type of the activity."}
   * @paramDef {"type":"String","label":"Start Date Local","name":"startDateLocal","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 formatted local start date and time of the activity."}
   * @paramDef {"type":"Number","label":"Elapsed Time (seconds)","name":"elapsedTime","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The total elapsed time of the activity in seconds."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"An optional description of the activity."}
   * @paramDef {"type":"Number","label":"Distance (meters)","name":"distance","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The distance of the activity in meters."}
   * @paramDef {"type":"Boolean","label":"Trainer","name":"trainer","uiComponent":{"type":"CHECKBOX"},"description":"When true, marks the activity as performed on a trainer."}
   * @paramDef {"type":"Boolean","label":"Commute","name":"commute","uiComponent":{"type":"CHECKBOX"},"description":"When true, marks the activity as a commute."}
   * @returns {Object}
   * @sampleResult {"id":9999999999,"name":"Lunch Ride","sport_type":"Ride","distance":25000.0,"elapsed_time":3600,"start_date_local":"2026-07-13T12:00:00Z"}
   */
  async createActivity(name, sportType, startDateLocal, elapsedTime, description, distance, trainer, commute) {
    const resolvedSportType = this.#resolveChoice(sportType, SPORT_TYPE_MAP)

    return this.#apiRequest({
      url: `${ API_BASE_URL }/activities`,
      method: 'post',
      form: {
        name,
        sport_type: resolvedSportType,
        start_date_local: startDateLocal,
        elapsed_time: elapsedTime,
        description,
        distance,
        trainer: trainer ? 1 : undefined,
        commute: commute ? 1 : undefined,
      },
      logTag: 'createActivity',
    })
  }

  /**
   * @operationName Update Activity
   * @description Updates an existing activity owned by the authenticated athlete. Requires the activity:write scope. Supports renaming, changing sport type, assigning gear, and toggling the commute flag.
   * @category Activities
   * @route PUT /activities/{activityId}
   * @paramDef {"type":"Number","label":"Activity ID","name":"activityId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The identifier of the activity to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"A new name for the activity."}
   * @paramDef {"type":"String","label":"Sport Type","name":"sportType","uiComponent":{"type":"DROPDOWN","options":{"values":["Run","Trail Run","Virtual Run","Ride","Mountain Bike Ride","Gravel Ride","E-Bike Ride","E-Mountain Bike Ride","Virtual Ride","Swim","Walk","Hike","Alpine Ski","Backcountry Ski","Nordic Ski","Snowboard","Snowshoe","Ice Skate","Inline Skate","Roller Ski","Canoeing","Kayaking","Rowing","Stand Up Paddling","Surfing","Kitesurf","Windsurf","Sail","Golf","Soccer","Tennis","Pickleball","Squash","Racquetball","Table Tennis","Badminton","Rock Climbing","Skateboard","Elliptical","Stair Stepper","Weight Training","Crossfit","High Intensity Interval Training","Pilates","Yoga","Handcycle","Wheelchair","Velomobile","Workout"]}},"description":"A new sport type for the activity."}
   * @paramDef {"type":"String","label":"Gear ID","name":"gearId","description":"The identifier of the gear to associate with the activity (e.g. bike or shoes)."}
   * @paramDef {"type":"Boolean","label":"Commute","name":"commute","uiComponent":{"type":"CHECKBOX"},"description":"Whether the activity is a commute."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A new description for the activity."}
   * @returns {Object}
   * @sampleResult {"id":9876543210,"name":"Evening Ride","sport_type":"Ride","commute":true,"gear_id":"b12345"}
   */
  async updateActivity(activityId, name, sportType, gearId, commute, description) {
    const resolvedSportType = this.#resolveChoice(sportType, SPORT_TYPE_MAP)

    const body = cleanupObject({
      name,
      sport_type: resolvedSportType,
      type: resolvedSportType,
      gear_id: gearId,
      commute: commute === undefined ? undefined : Boolean(commute),
      description,
    })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/activities/${ activityId }`,
      method: 'put',
      body,
      logTag: 'updateActivity',
    })
  }

  /**
   * @operationName Get Activity Comments
   * @description Retrieves the comments on a given activity. Supports cursor-based pagination and an optional page size.
   * @category Activities
   * @route GET /activity-comments
   * @paramDef {"type":"Number","label":"Activity ID","name":"activityId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The identifier of the activity."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of comments to return per page (defaults to 30)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"afterCursor","description":"Cursor of the last item in the previous page of results, used to fetch the next page."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":55,"activity_id":9876543210,"text":"Nice pace!","athlete":{"firstname":"Sam","lastname":"Lee"},"created_at":"2026-07-01T09:00:00Z"}]
   */
  async getActivityComments(activityId, pageSize, afterCursor) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/activities/${ activityId }/comments`,
      query: { page_size: pageSize, after_cursor: afterCursor },
      logTag: 'getActivityComments',
    })
  }

  /**
   * @operationName Get Activity Kudoers
   * @description Retrieves the athletes who have given kudos on a given activity, with pagination support.
   * @category Activities
   * @route GET /activity-kudos
   * @paramDef {"type":"Number","label":"Activity ID","name":"activityId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The identifier of the activity."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (defaults to 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (defaults to 30)."}
   * @returns {Array<Object>}
   * @sampleResult [{"firstname":"Sam","lastname":"Lee","city":"Denver","country":"United States"}]
   */
  async getActivityKudoers(activityId, page, perPage) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/activities/${ activityId }/kudos`,
      query: { page, per_page: perPage },
      logTag: 'getActivityKudoers',
    })
  }

  /**
   * @operationName Get Activity Laps
   * @description Retrieves the laps of a given activity, including timing, distance, average speed, and lap index for each lap.
   * @category Activities
   * @route GET /activity-laps
   * @paramDef {"type":"Number","label":"Activity ID","name":"activityId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The identifier of the activity."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":1122,"name":"Lap 1","elapsed_time":600,"distance":1609.3,"average_speed":2.68,"lap_index":1}]
   */
  async getActivityLaps(activityId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/activities/${ activityId }/laps`,
      logTag: 'getActivityLaps',
    })
  }

  // =========================================== SEGMENTS ===========================================

  /**
   * @operationName Explore Segments
   * @description Returns the top 10 segments matching a specified geographic bounding box. Bounds are given as south-west and north-east latitude/longitude corners. Optionally filter by activity type and climb category range.
   * @category Segments
   * @route GET /segments-explore
   * @paramDef {"type":"String","label":"Bounds","name":"bounds","required":true,"description":"Bounding box as comma-separated coordinates: sw_lat,sw_lng,ne_lat,ne_lng (e.g. 37.821362,-122.505373,37.842038,-122.465977)."}
   * @paramDef {"type":"String","label":"Activity Type","name":"activityType","uiComponent":{"type":"DROPDOWN","options":{"values":["Running","Riding"]}},"description":"Filter segments by activity type."}
   * @paramDef {"type":"Number","label":"Min Climb Category","name":"minCat","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The minimum climbing category (0-5)."}
   * @paramDef {"type":"Number","label":"Max Climb Category","name":"maxCat","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum climbing category (0-5)."}
   * @returns {Object}
   * @sampleResult {"segments":[{"id":229781,"name":"Hawk Hill","climb_category":1,"distance":2684.82,"avg_grade":5.7}]}
   */
  async exploreSegments(bounds, activityType, minCat, maxCat) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/segments/explore`,
      query: {
        bounds,
        activity_type: this.#resolveChoice(activityType, EXPLORE_ACTIVITY_TYPE_MAP),
        min_cat: minCat,
        max_cat: maxCat,
      },
      logTag: 'exploreSegments',
    })
  }

  /**
   * @operationName Get Segment
   * @description Retrieves the detailed representation of a segment by id, including distance, elevation, grade, effort/athlete counts, and start/end coordinates.
   * @category Segments
   * @route GET /segment
   * @paramDef {"type":"Number","label":"Segment ID","name":"segmentId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The identifier of the segment."}
   * @returns {Object}
   * @sampleResult {"id":229781,"name":"Hawk Hill","distance":2684.8,"average_grade":5.7,"maximum_grade":14.2,"effort_count":309190}
   */
  async getSegment(segmentId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/segments/${ segmentId }`,
      logTag: 'getSegment',
    })
  }

  /**
   * @operationName List Starred Segments
   * @description Lists the segments starred by the authenticated athlete, most recently starred first, with pagination support.
   * @category Segments
   * @route GET /segments-starred
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (defaults to 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (defaults to 30)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":229781,"name":"Hawk Hill","activity_type":"Ride","distance":2684.8,"starred":true}]
   */
  async listStarredSegments(page, perPage) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/segments/starred`,
      query: { page, per_page: perPage },
      logTag: 'listStarredSegments',
    })
  }

  /**
   * @operationName Get Segment Efforts
   * @description Retrieves an athlete's efforts on a given segment. Optionally filter to a date range using ISO 8601 start/end dates. Requires a Strava subscription for the authenticated athlete.
   * @category Segments
   * @route GET /segment-efforts
   * @paramDef {"type":"Number","label":"Segment ID","name":"segmentId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The identifier of the segment."}
   * @paramDef {"type":"String","label":"Start Date Local","name":"startDateLocal","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 formatted lower bound for the effort start date."}
   * @paramDef {"type":"String","label":"End Date Local","name":"endDateLocal","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 formatted upper bound for the effort start date."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (defaults to 30)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":123456789,"segment":{"id":229781,"name":"Hawk Hill"},"elapsed_time":420,"start_date_local":"2026-06-15T08:12:00Z"}]
   */
  async getSegmentEfforts(segmentId, startDateLocal, endDateLocal, perPage) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/segment_efforts`,
      query: {
        segment_id: segmentId,
        start_date_local: startDateLocal,
        end_date_local: endDateLocal,
        per_page: perPage,
      },
      logTag: 'getSegmentEfforts',
    })
  }

  // ============================================ CLUBS =============================================

  /**
   * @operationName Get Club
   * @description Retrieves a club's detailed representation by id, including name, sport type, city/state/country, member count, and privacy settings.
   * @category Clubs
   * @route GET /club
   * @paramDef {"type":"Number","label":"Club ID","name":"clubId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The identifier of the club."}
   * @returns {Object}
   * @sampleResult {"id":98765,"name":"Boulder Cyclists","sport_type":"cycling","city":"Boulder","member_count":420,"private":false}
   */
  async getClub(clubId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/clubs/${ clubId }`,
      logTag: 'getClub',
    })
  }

  /**
   * @operationName Get Club Activities
   * @description Retrieves recent activities for members of a specific club. The authenticated athlete must be a member of the club. Activities are returned in an anonymized summary form with pagination support.
   * @category Clubs
   * @route GET /club-activities
   * @paramDef {"type":"Number","label":"Club ID","name":"clubId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The identifier of the club."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (defaults to 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (defaults to 30)."}
   * @returns {Array<Object>}
   * @sampleResult [{"name":"Morning Ride","sport_type":"Ride","distance":25000.0,"moving_time":3600,"athlete":{"firstname":"Sam","lastname":"L."}}]
   */
  async getClubActivities(clubId, page, perPage) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/clubs/${ clubId }/activities`,
      query: { page, per_page: perPage },
      logTag: 'getClubActivities',
    })
  }

  /**
   * @operationName Get Club Members
   * @description Retrieves the members of a specific club. The authenticated athlete must be a member of the club. Supports pagination.
   * @category Clubs
   * @route GET /club-members
   * @paramDef {"type":"Number","label":"Club ID","name":"clubId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The identifier of the club."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (defaults to 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (defaults to 30)."}
   * @returns {Array<Object>}
   * @sampleResult [{"firstname":"Sam","lastname":"L.","membership":"member","admin":false,"owner":false}]
   */
  async getClubMembers(clubId, page, perPage) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/clubs/${ clubId }/members`,
      query: { page, per_page: perPage },
      logTag: 'getClubMembers',
    })
  }

  // ============================================= GEAR ============================================

  /**
   * @operationName Get Gear
   * @description Retrieves a piece of gear (bike or shoes) by id, including name, brand, model, distance covered, and primary status. Gear must belong to the authenticated athlete.
   * @category Gear
   * @route GET /gear
   * @paramDef {"type":"String","label":"Gear ID","name":"gearId","required":true,"description":"The identifier of the gear (e.g. b12345 for a bike or g67890 for shoes)."}
   * @returns {Object}
   * @sampleResult {"id":"b12345","name":"Road Bike","brand_name":"Specialized","model_name":"Tarmac","distance":1500000.0,"primary":true}
   */
  async getGear(gearId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/gear/${ gearId }`,
      logTag: 'getGear',
    })
  }

  // ============================================ ROUTES ===========================================

  /**
   * @operationName List Athlete Routes
   * @description Lists a given athlete's routes. Private routes are only available for the authenticated athlete. Supports pagination.
   * @category Routes
   * @route GET /athlete-routes
   * @paramDef {"type":"Number","label":"Athlete ID","name":"athleteId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The identifier of the athlete whose routes to list."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (defaults to 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (defaults to 30)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":123456,"name":"Weekend Loop","type":1,"sub_type":1,"distance":42000.0,"elevation_gain":650.0,"private":false}]
   */
  async listAthleteRoutes(athleteId, page, perPage) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/athletes/${ athleteId }/routes`,
      query: { page, per_page: perPage },
      logTag: 'listAthleteRoutes',
    })
  }

  /**
   * @operationName Get Route
   * @description Retrieves the detailed representation of a route by id, including name, type, distance, elevation gain, estimated moving time, and segment count.
   * @category Routes
   * @route GET /route
   * @paramDef {"type":"Number","label":"Route ID","name":"routeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The identifier of the route."}
   * @returns {Object}
   * @sampleResult {"id":123456,"name":"Weekend Loop","type":1,"distance":42000.0,"elevation_gain":650.0,"estimated_moving_time":7200}
   */
  async getRoute(routeId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/routes/${ routeId }`,
      logTag: 'getRoute',
    })
  }
}

Flowrunner.ServerCode.addService(StravaService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your Strava API application Client ID. Create an application at https://www.strava.com/settings/api',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your Strava API application Client Secret from https://www.strava.com/settings/api',
  },
])
