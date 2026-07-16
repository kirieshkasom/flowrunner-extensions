'use strict'

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const API_BASE_URL = 'https://api.spotify.com/v1'

const DEFAULT_SCOPE_LIST = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-library-read',
  'user-library-modify',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-top-read',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_LIMIT = 20

const SEARCH_TYPE_OPTIONS = {
  'Track': 'track',
  'Album': 'album',
  'Artist': 'artist',
  'Playlist': 'playlist',
  'Show': 'show',
  'Episode': 'episode',
  'Audiobook': 'audiobook',
}

const TOP_TYPE_OPTIONS = {
  'Artists': 'artists',
  'Tracks': 'tracks',
}

const TIME_RANGE_OPTIONS = {
  'Last 4 Weeks': 'short_term',
  'Last 6 Months': 'medium_term',
  'All Time': 'long_term',
}

const INCLUDE_GROUPS_OPTIONS = {
  'Album': 'album',
  'Single': 'single',
  'Appears On': 'appears_on',
  'Compilation': 'compilation',
}

const logger = {
  info: (...args) => console.log('[Spotify] info:', ...args),
  debug: (...args) => console.log('[Spotify] debug:', ...args),
  error: (...args) => console.log('[Spotify] error:', ...args),
  warn: (...args) => console.log('[Spotify] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Spotify
 * @integrationIcon /icon.svg
 **/
class SpotifyService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.request.headers['oauth-access-token'] }`,
          'Content-Type': 'application/json',
        })
        .query(query || {})

      const response = body !== undefined ? await request.send(body) : await request

      // Many Spotify write/player endpoints return 204 No Content with an empty body.
      // Normalize those to a consistent success object.
      return isEmptyResponse(response) ? { status: 'success' } : response
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Spotify API error: ${ message }`)
    }
  }

  // Spotify errors are shaped as { error: { status, message } } for the Web API, or
  // { error, error_description } for the auth server.
  #extractError(error) {
    const body = error.body

    if (body) {
      if (body.error && typeof body.error === 'object') {
        const status = body.error.status ? ` (status ${ body.error.status })` : ''
        const reason = body.error.reason ? ` [${ body.error.reason }]` : ''

        return `${ body.error.message || 'Request failed' }${ status }${ reason }`
      }

      if (body.error_description) {
        return body.error_description
      }

      if (typeof body.error === 'string') {
        return body.error
      }

      if (body.message) {
        return body.message
      }
    }

    return error.message
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Extracts a bare Spotify object id from either a raw id, a spotify: URI, or an open.spotify.com URL.
  #extractId(value, type) {
    if (!value) {
      return value
    }

    const trimmed = String(value).trim()
    const uriMatch = trimmed.match(new RegExp(`spotify:${ type }:([a-zA-Z0-9]+)`))

    if (uriMatch) {
      return uriMatch[1]
    }

    const urlMatch = trimmed.match(new RegExp(`${ type }/([a-zA-Z0-9]+)`))

    if (urlMatch) {
      return urlMatch[1]
    }

    return trimmed
  }

  // Normalizes a track reference to a full "spotify:track:ID" URI.
  #toTrackUri(value) {
    if (!value) {
      return value
    }

    const trimmed = String(value).trim()

    if (trimmed.startsWith('spotify:')) {
      return trimmed
    }

    return `spotify:track:${ this.#extractId(trimmed, 'track') }`
  }

  // ============================================= OAUTH ================================================

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
    params.append('state', `flowrunner_${ Date.now() }`)

    const connectionURL = `${ AUTHORIZE_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  #basicAuthHeader() {
    const encoded = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return {
      'Authorization': `Basic ${ encoded }`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
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
    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)

    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set(this.#basicAuthHeader())
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'Spotify Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(`${ API_BASE_URL }/me`)
        .set({ 'Authorization': `Bearer ${ tokenResponse.access_token }` })

      connectionIdentityName = userData.display_name || userData.email || userData.id || connectionIdentityName

      if (Array.isArray(userData.images) && userData.images.length) {
        connectionIdentityImageURL = userData.images[0]?.url || null
      }
    } catch (error) {
      logger.error(`[executeCallback] /me error: ${ error.message }`)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
      userData,
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
      const params = new URLSearchParams()

      params.append('grant_type', 'refresh_token')
      params.append('refresh_token', refreshToken)

      const { access_token, expires_in, refresh_token } = await Flowrunner.Request.post(TOKEN_URL)
        .set(this.#basicAuthHeader())
        .send(params.toString())

      return {
        token: access_token,
        expirationInSeconds: expires_in,
        // Spotify frequently omits a new refresh token on refresh; keep the existing one.
        refreshToken: refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getPlaylistsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the retrieved playlists by name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset (as a string) from a previous response, used to retrieve the next page of playlists."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Playlists Dictionary
   * @description Lists the current user's playlists (owned and followed) for selection in dependent parameters. Returns the playlist name as the label and the playlist id as the value.
   * @route POST /get-playlists-dictionary
   * @paramDef {"type":"getPlaylistsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Road Trip","value":"37i9dQZF1DX0XUsuxWHRQd","note":"42 tracks"}],"cursor":"20"}
   */
  async getPlaylistsDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = cursor ? parseInt(cursor, 10) || 0 : 0
    const limit = 50

    const response = await this.#apiRequest({
      logTag: 'getPlaylistsDictionary',
      url: `${ API_BASE_URL }/me/playlists`,
      query: { limit, offset },
    })

    const items = Array.isArray(response.items) ? response.items : []

    const filtered = search
      ? items.filter(pl => pl?.name && pl.name.toLowerCase().includes(search.toLowerCase()))
      : items

    return {
      cursor: response.next ? String(offset + limit) : undefined,
      items: filtered.map(pl => ({
        label: pl.name,
        value: pl.id,
        note: pl.tracks?.total !== undefined ? `${ pl.tracks.total } tracks` : (pl.owner?.display_name || ''),
      })),
    }
  }

  // ============================================= SEARCH ==============================================

  /**
   * @description Searches the Spotify catalog for tracks, albums, artists, playlists, shows, episodes, or audiobooks matching a query. Select one or more item types to search across. Supports an optional market (country code) and a result limit per type. Returns Spotify's search response keyed by type (e.g. "tracks", "albums"), each with its own paging object.
   *
   * @route GET /search
   * @operationName Search
   * @category Search
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search keywords. Supports Spotify field filters such as 'artist:', 'album:', 'year:', and 'genre:' (e.g. 'remaster%20track:Doxy artist:Miles Davis')."}
   * @paramDef {"type":"Array<String>","label":"Types","name":"types","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Track","Album","Artist","Playlist","Show","Episode","Audiobook"]}},"description":"One or more catalog item types to search for. At least one is required."}
   * @paramDef {"type":"String","label":"Market","name":"market","description":"Optional ISO 3166-1 alpha-2 country code (e.g. 'US') to return content available in that market."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return per item type. Range: 1-50. Default: 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The index of the first result to return, used for pagination. Default: 0."}
   *
   * @returns {Object}
   * @sampleResult {"tracks":{"href":"https://api.spotify.com/v1/search?query=...","items":[{"id":"11dFghVXANMlKmJXsNCbNl","name":"Cut To The Feeling","uri":"spotify:track:11dFghVXANMlKmJXsNCbNl","artists":[{"name":"Carly Rae Jepsen"}]}],"limit":20,"offset":0,"total":118}}
   */
  async search(query, types, market, limit, offset) {
    if (!query) {
      throw new Error('"Query" is required')
    }

    const typeList = (Array.isArray(types) ? types : [types])
      .filter(Boolean)
      .map(t => this.#resolveChoice(t, SEARCH_TYPE_OPTIONS))

    if (!typeList.length) {
      throw new Error('At least one "Type" is required')
    }

    return this.#apiRequest({
      logTag: 'search',
      url: `${ API_BASE_URL }/search`,
      query: {
        q: query,
        type: typeList.join(','),
        market,
        limit: limit || DEFAULT_LIMIT,
        offset: offset || undefined,
      },
    })
  }

  // ============================================= CATALOG =============================================

  /**
   * @description Retrieves catalog information for a single track by its Spotify id, URI, or URL. Returns full track details including name, artists, album, duration, popularity, preview URL, and external ids.
   *
   * @route GET /get-track
   * @operationName Get Track
   * @category Catalog
   *
   * @paramDef {"type":"String","label":"Track","name":"trackId","required":true,"description":"The Spotify track id, URI ('spotify:track:...'), or open.spotify.com URL."}
   * @paramDef {"type":"String","label":"Market","name":"market","description":"Optional ISO 3166-1 alpha-2 country code (e.g. 'US') to apply Track Relinking and market availability."}
   *
   * @returns {Object}
   * @sampleResult {"id":"11dFghVXANMlKmJXsNCbNl","name":"Cut To The Feeling","uri":"spotify:track:11dFghVXANMlKmJXsNCbNl","duration_ms":207959,"popularity":63,"artists":[{"name":"Carly Rae Jepsen"}],"album":{"name":"Cut To The Feeling"}}
   */
  async getTrack(trackId, market) {
    if (!trackId) {
      throw new Error('"Track" is required')
    }

    return this.#apiRequest({
      logTag: 'getTrack',
      url: `${ API_BASE_URL }/tracks/${ this.#extractId(trackId, 'track') }`,
      query: { market },
    })
  }

  /**
   * @description Retrieves catalog information for a single album by its Spotify id, URI, or URL. Returns album details including name, artists, release date, total tracks, images, genres, label, and the first page of its tracks.
   *
   * @route GET /get-album
   * @operationName Get Album
   * @category Catalog
   *
   * @paramDef {"type":"String","label":"Album","name":"albumId","required":true,"description":"The Spotify album id, URI ('spotify:album:...'), or open.spotify.com URL."}
   * @paramDef {"type":"String","label":"Market","name":"market","description":"Optional ISO 3166-1 alpha-2 country code (e.g. 'US') to apply market availability."}
   *
   * @returns {Object}
   * @sampleResult {"id":"4aawyAB9vmqN3uQ7FjRGTy","name":"Global Warming","uri":"spotify:album:4aawyAB9vmqN3uQ7FjRGTy","release_date":"2012-11-16","total_tracks":18,"artists":[{"name":"Pitbull"}]}
   */
  async getAlbum(albumId, market) {
    if (!albumId) {
      throw new Error('"Album" is required')
    }

    return this.#apiRequest({
      logTag: 'getAlbum',
      url: `${ API_BASE_URL }/albums/${ this.#extractId(albumId, 'album') }`,
      query: { market },
    })
  }

  /**
   * @description Retrieves the tracks of an album, paginated. Returns simplified track objects (without full album/popularity detail) plus a paging object with total and next offset.
   *
   * @route GET /get-album-tracks
   * @operationName Get Album Tracks
   * @category Catalog
   *
   * @paramDef {"type":"String","label":"Album","name":"albumId","required":true,"description":"The Spotify album id, URI ('spotify:album:...'), or open.spotify.com URL."}
   * @paramDef {"type":"String","label":"Market","name":"market","description":"Optional ISO 3166-1 alpha-2 country code (e.g. 'US') to apply market availability."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tracks to return. Range: 1-50. Default: 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The index of the first track to return, used for pagination. Default: 0."}
   *
   * @returns {Object}
   * @sampleResult {"href":"https://api.spotify.com/v1/albums/4aawyAB9vmqN3uQ7FjRGTy/tracks","items":[{"id":"1tqTUB6Wr5vLd6l45k6b5t","name":"11:59PM","track_number":1,"uri":"spotify:track:1tqTUB6Wr5vLd6l45k6b5t"}],"limit":20,"offset":0,"total":18}
   */
  async getAlbumTracks(albumId, market, limit, offset) {
    if (!albumId) {
      throw new Error('"Album" is required')
    }

    return this.#apiRequest({
      logTag: 'getAlbumTracks',
      url: `${ API_BASE_URL }/albums/${ this.#extractId(albumId, 'album') }/tracks`,
      query: {
        market,
        limit: limit || DEFAULT_LIMIT,
        offset: offset || undefined,
      },
    })
  }

  /**
   * @description Retrieves catalog information for a single artist by their Spotify id, URI, or URL. Returns artist details including name, genres, popularity, follower count, and images.
   *
   * @route GET /get-artist
   * @operationName Get Artist
   * @category Catalog
   *
   * @paramDef {"type":"String","label":"Artist","name":"artistId","required":true,"description":"The Spotify artist id, URI ('spotify:artist:...'), or open.spotify.com URL."}
   *
   * @returns {Object}
   * @sampleResult {"id":"0TnOYISbd1XYRBk9myaseg","name":"Pitbull","uri":"spotify:artist:0TnOYISbd1XYRBk9myaseg","genres":["dance pop","miami hip hop"],"popularity":82,"followers":{"total":9500000}}
   */
  async getArtist(artistId) {
    if (!artistId) {
      throw new Error('"Artist" is required')
    }

    return this.#apiRequest({
      logTag: 'getArtist',
      url: `${ API_BASE_URL }/artists/${ this.#extractId(artistId, 'artist') }`,
    })
  }

  /**
   * @description Retrieves an artist's top tracks for a given market. A market is required by Spotify for this endpoint. Returns up to 10 full track objects ordered by popularity.
   *
   * @route GET /get-artist-top-tracks
   * @operationName Get Artist Top Tracks
   * @category Catalog
   *
   * @paramDef {"type":"String","label":"Artist","name":"artistId","required":true,"description":"The Spotify artist id, URI ('spotify:artist:...'), or open.spotify.com URL."}
   * @paramDef {"type":"String","label":"Market","name":"market","required":true,"defaultValue":"US","description":"An ISO 3166-1 alpha-2 country code (e.g. 'US'). Required by Spotify for this endpoint."}
   *
   * @returns {Object}
   * @sampleResult {"tracks":[{"id":"0TnOYISbd1XYRBk9myaseg","name":"Timber","uri":"spotify:track:0TnOYISbd1XYRBk9myaseg","popularity":78,"artists":[{"name":"Pitbull"}]}]}
   */
  async getArtistTopTracks(artistId, market) {
    if (!artistId) {
      throw new Error('"Artist" is required')
    }

    return this.#apiRequest({
      logTag: 'getArtistTopTracks',
      url: `${ API_BASE_URL }/artists/${ this.#extractId(artistId, 'artist') }/top-tracks`,
      query: { market: market || 'US' },
    })
  }

  /**
   * @description Retrieves the albums released by an artist, paginated. Optionally filter by album group (Album, Single, Appears On, Compilation). Returns simplified album objects plus a paging object.
   *
   * @route GET /get-artist-albums
   * @operationName Get Artist Albums
   * @category Catalog
   *
   * @paramDef {"type":"String","label":"Artist","name":"artistId","required":true,"description":"The Spotify artist id, URI ('spotify:artist:...'), or open.spotify.com URL."}
   * @paramDef {"type":"Array<String>","label":"Include Groups","name":"includeGroups","uiComponent":{"type":"DROPDOWN","options":{"values":["Album","Single","Appears On","Compilation"]}},"description":"Optional album groups to include. When omitted, all groups are returned."}
   * @paramDef {"type":"String","label":"Market","name":"market","description":"Optional ISO 3166-1 alpha-2 country code (e.g. 'US') to apply market availability."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of albums to return. Range: 1-50. Default: 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The index of the first album to return, used for pagination. Default: 0."}
   *
   * @returns {Object}
   * @sampleResult {"href":"https://api.spotify.com/v1/artists/0TnOYISbd1XYRBk9myaseg/albums","items":[{"id":"4aawyAB9vmqN3uQ7FjRGTy","name":"Global Warming","album_group":"album","uri":"spotify:album:4aawyAB9vmqN3uQ7FjRGTy"}],"limit":20,"offset":0,"total":30}
   */
  async getArtistAlbums(artistId, includeGroups, market, limit, offset) {
    if (!artistId) {
      throw new Error('"Artist" is required')
    }

    const groups = (Array.isArray(includeGroups) ? includeGroups : (includeGroups ? [includeGroups] : []))
      .filter(Boolean)
      .map(g => this.#resolveChoice(g, INCLUDE_GROUPS_OPTIONS))

    return this.#apiRequest({
      logTag: 'getArtistAlbums',
      url: `${ API_BASE_URL }/artists/${ this.#extractId(artistId, 'artist') }/albums`,
      query: {
        include_groups: groups.length ? groups.join(',') : undefined,
        market,
        limit: limit || DEFAULT_LIMIT,
        offset: offset || undefined,
      },
    })
  }

  // ============================================ PLAYLISTS ============================================

  /**
   * @description Retrieves the playlists owned or followed by the current user, paginated. Returns simplified playlist objects plus a paging object with total and next offset.
   *
   * @route GET /get-current-user-playlists
   * @operationName Get Current User Playlists
   * @category Playlists
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of playlists to return. Range: 1-50. Default: 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The index of the first playlist to return, used for pagination. Default: 0."}
   *
   * @returns {Object}
   * @sampleResult {"href":"https://api.spotify.com/v1/me/playlists","items":[{"id":"37i9dQZF1DX0XUsuxWHRQd","name":"RapCaviar","uri":"spotify:playlist:37i9dQZF1DX0XUsuxWHRQd","public":true,"tracks":{"total":50}}],"limit":20,"offset":0,"total":9}
   */
  async getCurrentUserPlaylists(limit, offset) {
    return this.#apiRequest({
      logTag: 'getCurrentUserPlaylists',
      url: `${ API_BASE_URL }/me/playlists`,
      query: {
        limit: limit || DEFAULT_LIMIT,
        offset: offset || undefined,
      },
    })
  }

  /**
   * @description Retrieves a playlist by its Spotify id, URI, or URL, including its name, owner, description, images, follower count, and the first page of tracks. Optionally restrict to a market or select specific fields.
   *
   * @route GET /get-playlist
   * @operationName Get Playlist
   * @category Playlists
   *
   * @paramDef {"type":"String","label":"Playlist","name":"playlistId","required":true,"dictionary":"getPlaylistsDictionary","description":"The Spotify playlist id, URI ('spotify:playlist:...'), or open.spotify.com URL. Select one of your playlists or enter an id directly."}
   * @paramDef {"type":"String","label":"Market","name":"market","description":"Optional ISO 3166-1 alpha-2 country code (e.g. 'US') to apply market availability."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Optional comma-separated list of fields to return (Spotify field filter syntax, e.g. 'name,tracks.items(track(name,uri))'). When omitted, all fields are returned."}
   *
   * @returns {Object}
   * @sampleResult {"id":"37i9dQZF1DX0XUsuxWHRQd","name":"RapCaviar","uri":"spotify:playlist:37i9dQZF1DX0XUsuxWHRQd","description":"New music from...","owner":{"display_name":"Spotify"},"tracks":{"total":50}}
   */
  async getPlaylist(playlistId, market, fields) {
    if (!playlistId) {
      throw new Error('"Playlist" is required')
    }

    return this.#apiRequest({
      logTag: 'getPlaylist',
      url: `${ API_BASE_URL }/playlists/${ this.#extractId(playlistId, 'playlist') }`,
      query: { market, fields },
    })
  }

  /**
   * @description Retrieves the items (tracks and episodes) of a playlist, paginated. Returns playlist track objects (each wrapping the track plus added_at and added_by) and a paging object. Optionally filter fields or restrict to a market.
   *
   * @route GET /get-playlist-items
   * @operationName Get Playlist Items
   * @category Playlists
   *
   * @paramDef {"type":"String","label":"Playlist","name":"playlistId","required":true,"dictionary":"getPlaylistsDictionary","description":"The Spotify playlist id, URI ('spotify:playlist:...'), or open.spotify.com URL."}
   * @paramDef {"type":"String","label":"Market","name":"market","description":"Optional ISO 3166-1 alpha-2 country code (e.g. 'US') to apply market availability."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Optional comma-separated list of fields to return (Spotify field filter syntax, e.g. 'items(added_at,track(name,uri))'). When omitted, all fields are returned."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of items to return. Range: 1-50. Default: 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The index of the first item to return, used for pagination. Default: 0."}
   *
   * @returns {Object}
   * @sampleResult {"href":"https://api.spotify.com/v1/playlists/37i9dQZF1DX0XUsuxWHRQd/tracks","items":[{"added_at":"2020-01-01T00:00:00Z","track":{"id":"11dFghVXANMlKmJXsNCbNl","name":"Cut To The Feeling","uri":"spotify:track:11dFghVXANMlKmJXsNCbNl"}}],"limit":20,"offset":0,"total":50}
   */
  async getPlaylistItems(playlistId, market, fields, limit, offset) {
    if (!playlistId) {
      throw new Error('"Playlist" is required')
    }

    return this.#apiRequest({
      logTag: 'getPlaylistItems',
      url: `${ API_BASE_URL }/playlists/${ this.#extractId(playlistId, 'playlist') }/tracks`,
      query: {
        market,
        fields,
        limit: limit || DEFAULT_LIMIT,
        offset: offset || undefined,
      },
    })
  }

  /**
   * @description Creates a new playlist for a user (defaults to the current user when no user id is provided). The current user becomes the owner. Requires the 'playlist-modify-public' scope for public playlists and 'playlist-modify-private' for private ones. Returns the newly created playlist object including its id and URI.
   *
   * @route POST /create-playlist
   * @operationName Create Playlist
   * @category Playlists
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name for the new playlist. Names do not need to be unique."}
   * @paramDef {"type":"Boolean","label":"Public","name":"isPublic","uiComponent":{"type":"CHECKBOX"},"description":"Whether the playlist is public (visible on the user's profile). Default: true."}
   * @paramDef {"type":"Boolean","label":"Collaborative","name":"collaborative","uiComponent":{"type":"CHECKBOX"},"description":"Whether the playlist is collaborative (other users can modify it). Requires the playlist to be private. Default: false."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description displayed in Spotify clients."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"Optional Spotify user id to create the playlist for. Defaults to the connected user. You must be authorized to create playlists for the given user."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7d2D2S200NyUE5KYs80PwO","name":"My New Playlist","uri":"spotify:playlist:7d2D2S200NyUE5KYs80PwO","public":false,"collaborative":false,"owner":{"id":"exampleuser"},"tracks":{"total":0}}
   */
  async createPlaylist(name, isPublic, collaborative, description, userId) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    const ownerId = userId || await this.#getCurrentUserId()

    const body = { name }

    if (isPublic !== undefined) {
      body.public = isPublic
    }

    if (collaborative !== undefined) {
      body.collaborative = collaborative
    }

    if (description !== undefined) {
      body.description = description
    }

    return this.#apiRequest({
      logTag: 'createPlaylist',
      method: 'post',
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(ownerId) }/playlists`,
      body,
    })
  }

  /**
   * @description Adds one or more tracks to a playlist. Accepts track ids, URIs, or URLs, which are normalized to 'spotify:track:...' URIs. Optionally inserts them at a specific position (otherwise appended to the end). Requires the appropriate 'playlist-modify' scope. Returns the playlist's new snapshot id.
   *
   * @route POST /add-items-to-playlist
   * @operationName Add Items to Playlist
   * @category Playlists
   *
   * @paramDef {"type":"String","label":"Playlist","name":"playlistId","required":true,"dictionary":"getPlaylistsDictionary","description":"The Spotify playlist id, URI ('spotify:playlist:...'), or open.spotify.com URL to add tracks to."}
   * @paramDef {"type":"Array<String>","label":"Tracks","name":"tracks","required":true,"description":"Track ids, URIs ('spotify:track:...'), or URLs to add. Maximum 100 per request."}
   * @paramDef {"type":"Number","label":"Position","name":"position","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional zero-based index at which to insert the tracks. When omitted, tracks are appended to the end."}
   *
   * @returns {Object}
   * @sampleResult {"snapshot_id":"abc123snapshot"}
   */
  async addItemsToPlaylist(playlistId, tracks, position) {
    if (!playlistId) {
      throw new Error('"Playlist" is required')
    }

    const uris = (Array.isArray(tracks) ? tracks : [tracks]).filter(Boolean).map(t => this.#toTrackUri(t))

    if (!uris.length) {
      throw new Error('At least one track is required')
    }

    const body = { uris }

    if (position !== undefined && position !== null) {
      body.position = position
    }

    return this.#apiRequest({
      logTag: 'addItemsToPlaylist',
      method: 'post',
      url: `${ API_BASE_URL }/playlists/${ this.#extractId(playlistId, 'playlist') }/tracks`,
      body,
    })
  }

  /**
   * @description Removes all occurrences of one or more tracks from a playlist. Accepts track ids, URIs, or URLs, which are normalized to 'spotify:track:...' URIs. Requires the appropriate 'playlist-modify' scope. Returns the playlist's new snapshot id.
   *
   * @route DELETE /remove-items-from-playlist
   * @operationName Remove Items from Playlist
   * @category Playlists
   *
   * @paramDef {"type":"String","label":"Playlist","name":"playlistId","required":true,"dictionary":"getPlaylistsDictionary","description":"The Spotify playlist id, URI ('spotify:playlist:...'), or open.spotify.com URL to remove tracks from."}
   * @paramDef {"type":"Array<String>","label":"Tracks","name":"tracks","required":true,"description":"Track ids, URIs ('spotify:track:...'), or URLs to remove. All occurrences of each are removed. Maximum 100 per request."}
   * @paramDef {"type":"String","label":"Snapshot ID","name":"snapshotId","description":"Optional playlist snapshot id against which to perform the removal, for concurrency safety."}
   *
   * @returns {Object}
   * @sampleResult {"snapshot_id":"abc123snapshot"}
   */
  async removeItemsFromPlaylist(playlistId, tracks, snapshotId) {
    if (!playlistId) {
      throw new Error('"Playlist" is required')
    }

    const trackObjects = (Array.isArray(tracks) ? tracks : [tracks])
      .filter(Boolean)
      .map(t => ({ uri: this.#toTrackUri(t) }))

    if (!trackObjects.length) {
      throw new Error('At least one track is required')
    }

    const body = { tracks: trackObjects }

    if (snapshotId) {
      body.snapshot_id = snapshotId
    }

    return this.#apiRequest({
      logTag: 'removeItemsFromPlaylist',
      method: 'delete',
      url: `${ API_BASE_URL }/playlists/${ this.#extractId(playlistId, 'playlist') }/tracks`,
      body,
    })
  }

  /**
   * @description Updates the details (name, public/private, collaborative flag, and description) of an existing playlist owned by the current user. Only provided fields are changed. Requires the appropriate 'playlist-modify' scope. Returns a success status (Spotify returns no content).
   *
   * @route PUT /update-playlist-details
   * @operationName Update Playlist Details
   * @category Playlists
   *
   * @paramDef {"type":"String","label":"Playlist","name":"playlistId","required":true,"dictionary":"getPlaylistsDictionary","description":"The Spotify playlist id, URI ('spotify:playlist:...'), or open.spotify.com URL to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional new name for the playlist."}
   * @paramDef {"type":"Boolean","label":"Public","name":"isPublic","uiComponent":{"type":"CHECKBOX"},"description":"Optional new public/private setting. Set true to make the playlist public."}
   * @paramDef {"type":"Boolean","label":"Collaborative","name":"collaborative","uiComponent":{"type":"CHECKBOX"},"description":"Optional collaborative setting. A collaborative playlist must be private (Public set to false)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional new description displayed in Spotify clients."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async updatePlaylistDetails(playlistId, name, isPublic, collaborative, description) {
    if (!playlistId) {
      throw new Error('"Playlist" is required')
    }

    const body = {}

    if (name !== undefined) {
      body.name = name
    }

    if (isPublic !== undefined) {
      body.public = isPublic
    }

    if (collaborative !== undefined) {
      body.collaborative = collaborative
    }

    if (description !== undefined) {
      body.description = description
    }

    if (!Object.keys(body).length) {
      throw new Error('At least one field to update is required')
    }

    return this.#apiRequest({
      logTag: 'updatePlaylistDetails',
      method: 'put',
      url: `${ API_BASE_URL }/playlists/${ this.#extractId(playlistId, 'playlist') }`,
      body,
    })
  }

  // ============================================= LIBRARY ============================================

  /**
   * @description Retrieves the tracks saved in the current user's "Liked Songs" library, paginated. Requires the 'user-library-read' scope. Returns saved track objects (each wrapping the track plus added_at) and a paging object.
   *
   * @route GET /get-saved-tracks
   * @operationName Get Saved Tracks
   * @category Library
   *
   * @paramDef {"type":"String","label":"Market","name":"market","description":"Optional ISO 3166-1 alpha-2 country code (e.g. 'US') to apply market availability."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tracks to return. Range: 1-50. Default: 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The index of the first track to return, used for pagination. Default: 0."}
   *
   * @returns {Object}
   * @sampleResult {"href":"https://api.spotify.com/v1/me/tracks","items":[{"added_at":"2020-01-01T00:00:00Z","track":{"id":"11dFghVXANMlKmJXsNCbNl","name":"Cut To The Feeling","uri":"spotify:track:11dFghVXANMlKmJXsNCbNl"}}],"limit":20,"offset":0,"total":120}
   */
  async getSavedTracks(market, limit, offset) {
    return this.#apiRequest({
      logTag: 'getSavedTracks',
      url: `${ API_BASE_URL }/me/tracks`,
      query: {
        market,
        limit: limit || DEFAULT_LIMIT,
        offset: offset || undefined,
      },
    })
  }

  /**
   * @description Saves one or more tracks to the current user's "Liked Songs" library. Accepts track ids, URIs, or URLs. Requires the 'user-library-modify' scope. Returns a success status (Spotify returns no content).
   *
   * @route PUT /save-tracks
   * @operationName Save Tracks
   * @category Library
   *
   * @paramDef {"type":"Array<String>","label":"Tracks","name":"tracks","required":true,"description":"Track ids, URIs ('spotify:track:...'), or URLs to save. Maximum 50 per request."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async saveTracks(tracks) {
    const ids = this.#toTrackIds(tracks)

    return this.#apiRequest({
      logTag: 'saveTracks',
      method: 'put',
      url: `${ API_BASE_URL }/me/tracks`,
      query: { ids: ids.join(',') },
    })
  }

  /**
   * @description Removes one or more tracks from the current user's "Liked Songs" library. Accepts track ids, URIs, or URLs. Requires the 'user-library-modify' scope. Returns a success status (Spotify returns no content).
   *
   * @route DELETE /remove-saved-tracks
   * @operationName Remove Saved Tracks
   * @category Library
   *
   * @paramDef {"type":"Array<String>","label":"Tracks","name":"tracks","required":true,"description":"Track ids, URIs ('spotify:track:...'), or URLs to remove. Maximum 50 per request."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async removeSavedTracks(tracks) {
    const ids = this.#toTrackIds(tracks)

    return this.#apiRequest({
      logTag: 'removeSavedTracks',
      method: 'delete',
      url: `${ API_BASE_URL }/me/tracks`,
      query: { ids: ids.join(',') },
    })
  }

  #toTrackIds(tracks) {
    const ids = (Array.isArray(tracks) ? tracks : [tracks])
      .filter(Boolean)
      .map(t => this.#extractId(t, 'track'))

    if (!ids.length) {
      throw new Error('At least one track is required')
    }

    return ids
  }

  // ============================================== PLAYER ============================================

  /**
   * @description Retrieves the current playback state of the connected user, including the active device, currently playing track or episode, shuffle/repeat state, and progress. Requires Spotify Premium and the 'user-read-playback-state' scope. Returns an empty success status when nothing is playing.
   *
   * @route GET /get-playback-state
   * @operationName Get Playback State
   * @category Player
   *
   * @paramDef {"type":"String","label":"Market","name":"market","description":"Optional ISO 3166-1 alpha-2 country code (e.g. 'US') to apply Track Relinking."}
   *
   * @returns {Object}
   * @sampleResult {"device":{"id":"abc","name":"My Computer","type":"Computer","volume_percent":65},"is_playing":true,"progress_ms":12000,"item":{"id":"11dFghVXANMlKmJXsNCbNl","name":"Cut To The Feeling"}}
   */
  async getPlaybackState(market) {
    return this.#apiRequest({
      logTag: 'getPlaybackState',
      url: `${ API_BASE_URL }/me/player`,
      query: { market },
    })
  }

  /**
   * @description Retrieves the track or episode currently playing for the connected user. Requires the 'user-read-currently-playing' scope. Returns an empty success status when nothing is playing.
   *
   * @route GET /get-currently-playing
   * @operationName Get Currently Playing
   * @category Player
   *
   * @paramDef {"type":"String","label":"Market","name":"market","description":"Optional ISO 3166-1 alpha-2 country code (e.g. 'US') to apply Track Relinking."}
   *
   * @returns {Object}
   * @sampleResult {"is_playing":true,"progress_ms":12000,"item":{"id":"11dFghVXANMlKmJXsNCbNl","name":"Cut To The Feeling","uri":"spotify:track:11dFghVXANMlKmJXsNCbNl"}}
   */
  async getCurrentlyPlaying(market) {
    return this.#apiRequest({
      logTag: 'getCurrentlyPlaying',
      url: `${ API_BASE_URL }/me/player/currently-playing`,
      query: { market },
    })
  }

  /**
   * @description Starts or resumes playback on the user's active or a specified device. Provide either a context URI (album, artist, or playlist) or a list of track URIs. Requires Spotify Premium and the 'user-modify-playback-state' scope. Returns a success status (Spotify returns no content).
   *
   * @route PUT /start-playback
   * @operationName Start or Resume Playback
   * @category Player
   *
   * @paramDef {"type":"String","label":"Context URI","name":"contextUri","description":"Optional Spotify URI of an album, artist, or playlist to play (e.g. 'spotify:album:...'). Mutually exclusive with Track URIs."}
   * @paramDef {"type":"Array<String>","label":"Track URIs","name":"trackUris","description":"Optional track ids, URIs, or URLs to play. Ignored when a Context URI is provided."}
   * @paramDef {"type":"Number","label":"Position (ms)","name":"positionMs","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional position in milliseconds to start playback from within the first track."}
   * @paramDef {"type":"String","label":"Device ID","name":"deviceId","description":"Optional target device id. When omitted, playback targets the user's currently active device."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async startPlayback(contextUri, trackUris, positionMs, deviceId) {
    const body = {}

    if (contextUri) {
      body.context_uri = contextUri
    } else if (trackUris && (Array.isArray(trackUris) ? trackUris.length : trackUris)) {
      body.uris = (Array.isArray(trackUris) ? trackUris : [trackUris]).filter(Boolean).map(t => this.#toTrackUri(t))
    }

    if (positionMs !== undefined && positionMs !== null) {
      body.position_ms = positionMs
    }

    return this.#apiRequest({
      logTag: 'startPlayback',
      method: 'put',
      url: `${ API_BASE_URL }/me/player/play`,
      query: { device_id: deviceId },
      body: Object.keys(body).length ? body : {},
    })
  }

  /**
   * @description Pauses playback on the user's active or a specified device. Requires Spotify Premium and the 'user-modify-playback-state' scope. Returns a success status (Spotify returns no content).
   *
   * @route PUT /pause-playback
   * @operationName Pause Playback
   * @category Player
   *
   * @paramDef {"type":"String","label":"Device ID","name":"deviceId","description":"Optional target device id. When omitted, the currently active device is used."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async pausePlayback(deviceId) {
    return this.#apiRequest({
      logTag: 'pausePlayback',
      method: 'put',
      url: `${ API_BASE_URL }/me/player/pause`,
      query: { device_id: deviceId },
    })
  }

  /**
   * @description Skips to the next track in the user's playback queue. Requires Spotify Premium and the 'user-modify-playback-state' scope. Returns a success status (Spotify returns no content).
   *
   * @route POST /skip-to-next
   * @operationName Skip to Next
   * @category Player
   *
   * @paramDef {"type":"String","label":"Device ID","name":"deviceId","description":"Optional target device id. When omitted, the currently active device is used."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async skipToNext(deviceId) {
    return this.#apiRequest({
      logTag: 'skipToNext',
      method: 'post',
      url: `${ API_BASE_URL }/me/player/next`,
      query: { device_id: deviceId },
    })
  }

  /**
   * @description Skips to the previous track in the user's playback queue. Requires Spotify Premium and the 'user-modify-playback-state' scope. Returns a success status (Spotify returns no content).
   *
   * @route POST /skip-to-previous
   * @operationName Skip to Previous
   * @category Player
   *
   * @paramDef {"type":"String","label":"Device ID","name":"deviceId","description":"Optional target device id. When omitted, the currently active device is used."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async skipToPrevious(deviceId) {
    return this.#apiRequest({
      logTag: 'skipToPrevious',
      method: 'post',
      url: `${ API_BASE_URL }/me/player/previous`,
      query: { device_id: deviceId },
    })
  }

  /**
   * @description Sets the playback volume for the user's active or a specified device. Requires Spotify Premium and the 'user-modify-playback-state' scope. Returns a success status (Spotify returns no content).
   *
   * @route PUT /set-volume
   * @operationName Set Volume
   * @category Player
   *
   * @paramDef {"type":"Number","label":"Volume Percent","name":"volumePercent","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The volume level to set, from 0 to 100."}
   * @paramDef {"type":"String","label":"Device ID","name":"deviceId","description":"Optional target device id. When omitted, the currently active device is used."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async setVolume(volumePercent, deviceId) {
    if (volumePercent === undefined || volumePercent === null) {
      throw new Error('"Volume Percent" is required')
    }

    return this.#apiRequest({
      logTag: 'setVolume',
      method: 'put',
      url: `${ API_BASE_URL }/me/player/volume`,
      query: {
        volume_percent: volumePercent,
        device_id: deviceId,
      },
    })
  }

  /**
   * @description Transfers playback to a different device, optionally starting playback immediately. Requires Spotify Premium and the 'user-modify-playback-state' scope. Returns a success status (Spotify returns no content).
   *
   * @route PUT /transfer-playback
   * @operationName Transfer Playback
   * @category Player
   *
   * @paramDef {"type":"String","label":"Device ID","name":"deviceId","required":true,"description":"The id of the device to transfer playback to."}
   * @paramDef {"type":"Boolean","label":"Play","name":"play","uiComponent":{"type":"CHECKBOX"},"description":"Whether to start playback on the new device. Set true to ensure playback continues; false (default) keeps the current play/pause state."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async transferPlayback(deviceId, play) {
    if (!deviceId) {
      throw new Error('"Device ID" is required')
    }

    const body = { device_ids: [deviceId] }

    if (play !== undefined) {
      body.play = play
    }

    return this.#apiRequest({
      logTag: 'transferPlayback',
      method: 'put',
      url: `${ API_BASE_URL }/me/player`,
      body,
    })
  }

  // ============================================== USER =============================================

  /**
   * @description Retrieves the profile of the connected Spotify user, including display name, email (if the 'user-read-email' scope was granted), country, product tier (e.g. 'premium'), follower count, and profile images. Useful as a connection check.
   *
   * @route GET /get-current-user-profile
   * @operationName Get Current User Profile
   * @category User
   *
   * @returns {Object}
   * @sampleResult {"id":"exampleuser","display_name":"Example User","email":"user@example.com","country":"US","product":"premium","followers":{"total":10},"images":[{"url":"https://i.scdn.co/image/abc"}]}
   */
  async getCurrentUserProfile() {
    return this.#apiRequest({
      logTag: 'getCurrentUserProfile',
      url: `${ API_BASE_URL }/me`,
    })
  }

  /**
   * @description Retrieves the current user's top artists or top tracks over a chosen time range. Requires the 'user-top-read' scope. Returns a paging object of full artist or track objects ordered by affinity.
   *
   * @route GET /get-top-items
   * @operationName Get User Top Items
   * @category User
   *
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"defaultValue":"Tracks","uiComponent":{"type":"DROPDOWN","options":{"values":["Artists","Tracks"]}},"description":"Whether to return the user's top artists or top tracks."}
   * @paramDef {"type":"String","label":"Time Range","name":"timeRange","defaultValue":"Last 6 Months","uiComponent":{"type":"DROPDOWN","options":{"values":["Last 4 Weeks","Last 6 Months","All Time"]}},"description":"The affinity time window. 'Last 4 Weeks' (short_term), 'Last 6 Months' (medium_term), or 'All Time' (long_term). Default: 'Last 6 Months'."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of items to return. Range: 1-50. Default: 20."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The index of the first item to return, used for pagination. Default: 0."}
   *
   * @returns {Object}
   * @sampleResult {"href":"https://api.spotify.com/v1/me/top/tracks","items":[{"id":"11dFghVXANMlKmJXsNCbNl","name":"Cut To The Feeling","uri":"spotify:track:11dFghVXANMlKmJXsNCbNl","popularity":63}],"limit":20,"offset":0,"total":50}
   */
  async getTopItems(type, timeRange, limit, offset) {
    const resolvedType = this.#resolveChoice(type || 'Tracks', TOP_TYPE_OPTIONS)

    return this.#apiRequest({
      logTag: 'getTopItems',
      url: `${ API_BASE_URL }/me/top/${ resolvedType }`,
      query: {
        time_range: this.#resolveChoice(timeRange, TIME_RANGE_OPTIONS),
        limit: limit || DEFAULT_LIMIT,
        offset: offset || undefined,
      },
    })
  }

  // Resolves the connected user's Spotify id (needed for playlist creation).
  async #getCurrentUserId() {
    const me = await this.#apiRequest({
      logTag: 'getCurrentUserId',
      url: `${ API_BASE_URL }/me`,
    })

    if (!me?.id) {
      throw new Error('Unable to resolve the current Spotify user id')
    }

    return me.id
  }
}

Flowrunner.ServerCode.addService(SpotifyService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client ID of your Spotify app from https://developer.spotify.com/dashboard.',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Secret of your Spotify app from https://developer.spotify.com/dashboard.',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      result[key] = data[key]
    }
  })

  return result
}

function isEmptyResponse(response) {
  if (response === undefined || response === null || response === '') {
    return true
  }

  return typeof response === 'object' && !Buffer.isBuffer(response) && Object.keys(response).length === 0
}
