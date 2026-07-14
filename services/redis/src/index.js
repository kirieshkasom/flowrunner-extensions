const { createClient } = require('redis')

const logger = {
  info: (...args) => console.log('[Redis] info:', ...args),
  debug: (...args) => console.log('[Redis] debug:', ...args),
  error: (...args) => console.log('[Redis] error:', ...args),
  warn: (...args) => console.log('[Redis] warn:', ...args),
}

const DEFAULT_PORT = 6379
const DEFAULT_CONNECTION_TIMEOUT_SECONDS = 10
const DEFAULT_FIND_KEYS_LIMIT = 100

// ============================================================================
//  TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} SortedSetMember
 * @paramDef {"type":"Number","label":"Score","name":"score","required":true,"description":"Numeric score used to order the member within the sorted set."}
 * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The member value to store."}
 */

/**
 * @integrationName Redis
 * @integrationIcon /icon.svg
 */
class Redis {
  constructor(config) {
    this.config = config || {}

    this.connectionString = (this.config.connectionString || '').trim()
    this.host = this.config.host
    this.port = parseInt(this.config.port, 10) || DEFAULT_PORT
    this.username = (this.config.username || '').trim()
    this.password = this.config.password
    this.tls = this.config.tls === true || this.config.tls === 'true'

    const database = parseInt(this.config.database, 10)

    this.database = Number.isInteger(database) ? database : undefined

    const timeoutSeconds = parseInt(this.config.connectionTimeoutSeconds, 10)

    this.connectTimeoutMs = (timeoutSeconds > 0 ? timeoutSeconds : DEFAULT_CONNECTION_TIMEOUT_SECONDS) * 1000
  }

  // ==========================================================================
  //  CORE — connection lifecycle: one short-lived client per method call.
  //  A client is created, an error listener is attached BEFORE connecting
  //  (node-redis emits 'error' events that crash the process without one),
  //  the command runs, and the connection is always closed in finally.
  //  Connections are NEVER cached between invocations.
  // ==========================================================================
  async #withClient(logTag, fn) {
    const client = createClient(this.#buildClientConfig(logTag))

    client.on('error', error => logger.warn(`${ logTag } - client error: ${ error.message }`))

    try {
      logger.debug(`${ logTag } - connecting to ${ this.#connectionLabel() }`)

      await client.connect()

      return await fn(client)
    } catch (error) {
      this.#throwRedisError(error, logTag)
    } finally {
      if (client.isOpen) {
        try {
          await client.quit()
        } catch (quitError) {
          logger.warn(`${ logTag } - graceful quit failed, forcing disconnect: ${ quitError.message }`)

          try {
            await client.disconnect()
          } catch (disconnectError) {
            logger.warn(`${ logTag } - failed to close connection: ${ disconnectError.message }`)
          }
        }
      }
    }
  }

  // A Connection String, when set, wins over the individual fields and its scheme
  // (redis:// vs rediss://) controls TLS. The TLS toggle only ADDS the
  // managed-provider-friendly TLS socket options on top; when the toggle is off
  // the URI's own scheme stays in charge.
  #buildClientConfig(logTag) {
    // reconnectStrategy: false — connections are single-use, so fail fast instead
    // of entering node-redis's reconnect loop when the socket drops.
    const socket = {
      connectTimeout: this.connectTimeoutMs,
      reconnectStrategy: false,
      ...(this.tls ? { tls: true, rejectUnauthorized: false } : {}),
    }

    if (this.connectionString) {
      return { url: this.connectionString, socket }
    }

    if (!this.host) {
      logger.error(`${ logTag } - incomplete connection configuration`)

      throw new Error(
        'Redis error: incomplete connection configuration. ' +
        'Provide a Connection String (e.g. redis://default:password@redis.example.com:6379), ' +
        'or fill in at least Host (plus Port/Username/Password as needed) in the service configuration.'
      )
    }

    return {
      socket: { ...socket, host: this.host, port: this.port },
      ...(this.username ? { username: this.username } : {}),
      ...(this.password ? { password: this.password } : {}),
      ...(this.database !== undefined ? { database: this.database } : {}),
    }
  }

  // Human-readable connection target for logs. Never includes credentials: the
  // connection string embeds the password, so only its host part is extracted.
  #connectionLabel() {
    if (this.connectionString) {
      const withoutScheme = this.connectionString.replace(/^[a-z]+:\/\//i, '')
      const hostPart = (withoutScheme.includes('@') ? withoutScheme.split('@').pop() : withoutScheme).split(/[/?]/)[0]

      return hostPart ? `${ hostPart } (connection string)` : 'connection string'
    }

    return `${ this.host }:${ this.port }${ this.database !== undefined ? `/${ this.database }` : '' }`
  }

  #throwRedisError(error, logTag) {
    const parts = [error.message]

    if (error.code) parts.push(`code: ${ error.code }`)

    // ENETUNREACH against an IPv6 address means the host resolved to IPv6 only and this
    // environment has no IPv6 route. Point the user at an IPv4-compatible endpoint
    // instead of leaving them with a bare ENETUNREACH.
    if (error.code === 'ENETUNREACH' && String(error.address || '').includes(':')) {
      parts.push(
        'hint: the Redis host resolved to an IPv6-only address and this environment has no IPv6 connectivity. ' +
        'Use an IPv4-compatible hostname or endpoint for your Redis server.'
      )
    }

    // A reset/abruptly-closed socket right after connecting is the classic symptom of
    // talking plaintext to a TLS-only endpoint - the default for managed Redis.
    const looksLikeTlsMismatch = error.code === 'ECONNRESET' || /socket closed/i.test(String(error.message || ''))

    if (looksLikeTlsMismatch && !this.tls && !this.connectionString.startsWith('rediss://')) {
      parts.push(
        'hint: managed Redis providers (Upstash, DigitalOcean, ElastiCache with in-transit encryption, Redis Cloud) ' +
        'usually require TLS - use a rediss:// connection string or enable the Use TLS toggle.'
      )
    }

    const message = parts.join(' | ')

    logger.error(`${ logTag } - failed: ${ message }`)

    throw new Error(`Redis error: ${ message }`)
  }

  #requireKey(key) {
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('Key is required and must be a non-empty string.')
    }

    return key
  }

  #requireNonEmptyArray(value, label) {
    if (!Array.isArray(value) || !value.length) {
      throw new Error(`${ label } must be a non-empty array.`)
    }

    return value
  }

  // Redis stores strings: pass strings through, stringify numbers/booleans,
  // and JSON-encode objects/arrays so structured values survive the round trip.
  #toRedisString(value) {
    if (typeof value === 'string') return value
    if (value === undefined || value === null) return ''
    if (typeof value === 'object') return JSON.stringify(value)

    return String(value)
  }

  #toInt(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback

    const parsed = parseInt(value, 10)

    if (Number.isNaN(parsed)) {
      throw new Error(`Expected an integer but received: ${ JSON.stringify(value) }`)
    }

    return parsed
  }

  // ==========================================================================
  //  STRINGS
  // ==========================================================================
  /**
   * @operationName Set Value
   * @description Stores a string value under a key (SET). Optionally sets a time-to-live in seconds (EX) and/or writes only when the key does not already exist (NX). Non-string values are stored as JSON. Returns whether the value was actually written - with "Only If Not Exists" enabled, "set" is false when the key already existed.
   * @category Strings
   * @route POST /set-value
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The key to store the value under."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The value to store. Objects and arrays are stored as JSON strings."}
   * @paramDef {"type":"Number","label":"TTL (seconds)","name":"ttlSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Time-to-live in seconds after which the key expires automatically. Leave empty for no expiration."}
   * @paramDef {"type":"Boolean","label":"Only If Not Exists","name":"ifNotExists","uiComponent":{"type":"CHECKBOX"},"defaultValue":false,"description":"When enabled, the value is written only if the key does not already exist (SET NX) - useful for locks and idempotency guards."}
   * @returns {Object}
   * @sampleResult {"key":"session:42","set":true}
   */
  async setValue(key, value, ttlSeconds, ifNotExists) {
    this.#requireKey(key)

    const ttl = this.#toInt(ttlSeconds, undefined)
    const options = {
      ...(ttl > 0 ? { EX: ttl } : {}),
      ...(ifNotExists === true || ifNotExists === 'true' ? { NX: true } : {}),
    }

    return this.#withClient('setValue', async client => {
      const result = await client.set(key, this.#toRedisString(value), options)

      return { key, set: result === 'OK' }
    })
  }

  /**
   * @operationName Get Value
   * @description Reads the string value stored at a key (GET). Returns the value as a string, or null when the key does not exist, together with an "exists" flag.
   * @category Strings
   * @route GET /get-value
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The key to read."}
   * @returns {Object}
   * @sampleResult {"key":"session:42","value":"active","exists":true}
   */
  async getValue(key) {
    this.#requireKey(key)

    return this.#withClient('getValue', async client => {
      const value = await client.get(key)

      return { key, value, exists: value !== null }
    })
  }

  /**
   * @operationName Increment
   * @description Atomically increments the number stored at a key and returns the new value. Integer amounts use INCRBY; fractional amounts use INCRBYFLOAT. A missing key is treated as 0, so this also initializes counters. Fails if the key holds a non-numeric value.
   * @category Strings
   * @route POST /increment
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The counter key to increment."}
   * @paramDef {"type":"Number","label":"By","name":"by","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Amount to increment by (default 1). Fractional values are supported."}
   * @returns {Object}
   * @sampleResult {"key":"page:views","value":42}
   */
  async increment(key, by) {
    this.#requireKey(key)

    const amount = by === undefined || by === null || by === '' ? 1 : Number(by)

    if (!Number.isFinite(amount)) {
      throw new Error(`Increment amount must be a finite number, received: ${ JSON.stringify(by) }`)
    }

    return this.#withClient('increment', async client => {
      const result = Number.isInteger(amount)
        ? await client.incrBy(key, amount)
        : await client.incrByFloat(key, amount)

      return { key, value: Number(result) }
    })
  }

  /**
   * @operationName Decrement
   * @description Atomically decrements the number stored at a key and returns the new value. Integer amounts use DECRBY; fractional amounts use INCRBYFLOAT with a negated amount. A missing key is treated as 0. Fails if the key holds a non-numeric value.
   * @category Strings
   * @route POST /decrement
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The counter key to decrement."}
   * @paramDef {"type":"Number","label":"By","name":"by","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Amount to decrement by (default 1). Fractional values are supported."}
   * @returns {Object}
   * @sampleResult {"key":"inventory:sku-7","value":11}
   */
  async decrement(key, by) {
    this.#requireKey(key)

    const amount = by === undefined || by === null || by === '' ? 1 : Number(by)

    if (!Number.isFinite(amount)) {
      throw new Error(`Decrement amount must be a finite number, received: ${ JSON.stringify(by) }`)
    }

    return this.#withClient('decrement', async client => {
      const result = Number.isInteger(amount)
        ? await client.decrBy(key, amount)
        : await client.incrByFloat(key, -amount)

      return { key, value: Number(result) }
    })
  }

  // ==========================================================================
  //  KEYS
  // ==========================================================================
  /**
   * @operationName Delete Keys
   * @description Deletes one or more keys (DEL) of any data type and returns how many of them actually existed and were removed. Keys that do not exist are ignored.
   * @category Keys
   * @route DELETE /delete-keys
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"Array<String>","label":"Keys","name":"keys","required":true,"description":"The keys to delete (e.g. [\"session:42\", \"cache:user:7\"])."}
   * @returns {Object}
   * @sampleResult {"deletedCount":2}
   */
  async deleteKeys(keys) {
    this.#requireNonEmptyArray(keys, 'Keys')

    return this.#withClient('deleteKeys', async client => {
      const deletedCount = await client.del(keys)

      return { deletedCount }
    })
  }

  /**
   * @operationName Key Exists
   * @description Checks how many of the given keys exist (EXISTS). Returns the number that exist, the number checked, and whether all of them exist. Passing the same key twice counts it twice, matching Redis semantics.
   * @category Keys
   * @route GET /key-exists
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"Array<String>","label":"Keys","name":"keys","required":true,"description":"The keys to check (e.g. [\"session:42\"])."}
   * @returns {Object}
   * @sampleResult {"existingCount":1,"checkedCount":2,"allExist":false}
   */
  async keyExists(keys) {
    this.#requireNonEmptyArray(keys, 'Keys')

    return this.#withClient('keyExists', async client => {
      const existingCount = await client.exists(keys)

      return { existingCount, checkedCount: keys.length, allExist: existingCount === keys.length }
    })
  }

  /**
   * @operationName Set Expiration
   * @description Sets a time-to-live in seconds on an existing key (EXPIRE), after which Redis deletes it automatically. Returns whether the expiration was applied - "applied" is false when the key does not exist. Use Remove Expiration to make a key persistent again.
   * @category Keys
   * @route POST /set-expiration
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The key to set the expiration on."}
   * @paramDef {"type":"Number","label":"TTL (seconds)","name":"ttlSeconds","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Time-to-live in seconds. Must be a positive integer."}
   * @returns {Object}
   * @sampleResult {"key":"session:42","applied":true}
   */
  async setExpiration(key, ttlSeconds) {
    this.#requireKey(key)

    const ttl = this.#toInt(ttlSeconds, undefined)

    if (!(ttl > 0)) {
      throw new Error('TTL (seconds) must be a positive integer. To remove an expiration, use the Remove Expiration operation.')
    }

    return this.#withClient('setExpiration', async client => {
      const applied = await client.expire(key, ttl)

      return { key, applied: Boolean(applied) }
    })
  }

  /**
   * @operationName Remove Expiration
   * @description Removes the time-to-live from a key (PERSIST) so it no longer expires. Returns whether an expiration was actually removed - "removed" is false when the key does not exist or had no expiration.
   * @category Keys
   * @route POST /remove-expiration
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The key to make persistent."}
   * @returns {Object}
   * @sampleResult {"key":"session:42","removed":true}
   */
  async removeExpiration(key) {
    this.#requireKey(key)

    return this.#withClient('removeExpiration', async client => {
      const removed = await client.persist(key)

      return { key, removed: Boolean(removed) }
    })
  }

  /**
   * @operationName Get TTL
   * @description Returns the remaining time-to-live of a key in seconds (TTL). Raw Redis semantics are preserved in "ttlSeconds": -1 means the key exists but has no expiration, -2 means the key does not exist; convenience flags "exists" and "hasExpiration" are included.
   * @category Keys
   * @route GET /get-ttl
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The key to inspect."}
   * @returns {Object}
   * @sampleResult {"key":"session:42","ttlSeconds":3600,"exists":true,"hasExpiration":true}
   */
  async getTtl(key) {
    this.#requireKey(key)

    return this.#withClient('getTtl', async client => {
      const ttlSeconds = await client.ttl(key)

      return { key, ttlSeconds, exists: ttlSeconds !== -2, hasExpiration: ttlSeconds >= 0 }
    })
  }

  /**
   * @operationName Find Keys
   * @description Finds keys matching a glob-style pattern (e.g. user:*, cache:??) using incremental SCAN iteration, which is safe for production databases - unlike the blocking KEYS command, it never freezes the server. Results are capped at the given limit (default 100); "limitReached" indicates more matching keys may exist.
   * @category Keys
   * @route GET /find-keys
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Pattern","name":"pattern","defaultValue":"*","description":"Glob-style match pattern (e.g. user:*, session:??, *cache*). Defaults to * (all keys)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Maximum number of keys to return (default 100)."}
   * @returns {Object}
   * @sampleResult {"keys":["user:1","user:2"],"count":2,"limitReached":false}
   */
  async findKeys(pattern, limit) {
    const match = typeof pattern === 'string' && pattern.trim() ? pattern : '*'
    const max = this.#toInt(limit, DEFAULT_FIND_KEYS_LIMIT)

    if (!(max > 0)) {
      throw new Error('Limit must be a positive integer.')
    }

    return this.#withClient('findKeys', async client => {
      const keys = []
      let limitReached = false

      for await (const key of client.scanIterator({ MATCH: match, COUNT: 100 })) {
        keys.push(key)

        if (keys.length >= max) {
          limitReached = true
          break
        }
      }

      return { keys, count: keys.length, limitReached }
    })
  }

  // ==========================================================================
  //  HASHES
  // ==========================================================================
  /**
   * @operationName Set Hash Fields
   * @description Sets one or more fields on a hash from a JSON object of field/value pairs (HSET), creating the hash if it does not exist. Existing fields are overwritten. Object and array values are stored as JSON strings. Returns the number of NEW fields added (overwritten fields do not count).
   * @category Hashes
   * @route POST /set-hash-fields
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The hash key to write to."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Field/value pairs to set as a JSON object (e.g. {\"name\":\"Ada\",\"email\":\"ada@example.com\"})."}
   * @returns {Object}
   * @sampleResult {"key":"user:7","addedFields":2}
   */
  async setHashFields(key, fields) {
    this.#requireKey(key)

    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !Object.keys(fields).length) {
      throw new Error('Fields must be a non-empty object of field/value pairs.')
    }

    const values = {}

    for (const [field, value] of Object.entries(fields)) {
      values[field] = this.#toRedisString(value)
    }

    return this.#withClient('setHashFields', async client => {
      const addedFields = await client.hSet(key, values)

      return { key, addedFields }
    })
  }

  /**
   * @operationName Get Hash Field
   * @description Reads a single field from a hash (HGET). Returns the field value as a string, or null when the hash or the field does not exist, together with an "exists" flag.
   * @category Hashes
   * @route GET /get-hash-field
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The hash key to read from."}
   * @paramDef {"type":"String","label":"Field","name":"field","required":true,"description":"The field name to read."}
   * @returns {Object}
   * @sampleResult {"key":"user:7","field":"email","value":"ada@example.com","exists":true}
   */
  async getHashField(key, field) {
    this.#requireKey(key)

    if (typeof field !== 'string' || !field.trim()) {
      throw new Error('Field is required and must be a non-empty string.')
    }

    return this.#withClient('getHashField', async client => {
      const value = await client.hGet(key, field)

      return { key, field, value: value === undefined ? null : value, exists: value !== undefined && value !== null }
    })
  }

  /**
   * @operationName Get Hash
   * @description Reads all fields and values of a hash (HGETALL) as a JSON object. A missing key returns an empty object with "exists" set to false.
   * @category Hashes
   * @route GET /get-hash
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The hash key to read."}
   * @returns {Object}
   * @sampleResult {"key":"user:7","fields":{"name":"Ada","email":"ada@example.com"},"fieldCount":2,"exists":true}
   */
  async getHash(key) {
    this.#requireKey(key)

    return this.#withClient('getHash', async client => {
      const fields = await client.hGetAll(key)
      const fieldCount = Object.keys(fields).length

      return { key, fields, fieldCount, exists: fieldCount > 0 }
    })
  }

  /**
   * @operationName Delete Hash Fields
   * @description Removes one or more fields from a hash (HDEL) and returns how many were actually removed. Fields that do not exist are ignored; the hash itself is deleted when its last field is removed.
   * @category Hashes
   * @route DELETE /delete-hash-fields
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The hash key to remove fields from."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","required":true,"description":"The field names to remove (e.g. [\"email\", \"phone\"])."}
   * @returns {Object}
   * @sampleResult {"key":"user:7","deletedCount":1}
   */
  async deleteHashFields(key, fields) {
    this.#requireKey(key)
    this.#requireNonEmptyArray(fields, 'Fields')

    return this.#withClient('deleteHashFields', async client => {
      const deletedCount = await client.hDel(key, fields)

      return { key, deletedCount }
    })
  }

  // ==========================================================================
  //  LISTS
  // ==========================================================================
  /**
   * @operationName Push To List
   * @description Appends one or more values to a list (LPUSH for the left/head side, RPUSH for the right/tail side), creating the list if it does not exist. Object and array values are stored as JSON strings. Returns the new length of the list.
   * @category Lists
   * @route POST /push-to-list
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The list key to push to."}
   * @paramDef {"type":"Array<String>","label":"Values","name":"values","required":true,"description":"The values to push, in order (e.g. [\"job-1\", \"job-2\"])."}
   * @paramDef {"type":"String","label":"Side","name":"side","uiComponent":{"type":"DROPDOWN","options":{"values":["Left","Right"]}},"defaultValue":"Right","description":"Which end of the list to push to: Left (head, LPUSH) or Right (tail, RPUSH)."}
   * @returns {Object}
   * @sampleResult {"key":"queue:jobs","length":5}
   */
  async pushToList(key, values, side) {
    this.#requireKey(key)
    this.#requireNonEmptyArray(values, 'Values')

    const items = values.map(value => this.#toRedisString(value))

    return this.#withClient('pushToList', async client => {
      const length = side === 'Left' ? await client.lPush(key, items) : await client.rPush(key, items)

      return { key, length }
    })
  }

  /**
   * @operationName Pop From List
   * @description Removes and returns elements from one end of a list (LPOP for the left/head side, RPOP for the right/tail side). When Count is provided, up to that many elements are popped at once. Always returns a "values" array - empty when the list does not exist or is already empty.
   * @category Lists
   * @route POST /pop-from-list
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The list key to pop from."}
   * @paramDef {"type":"String","label":"Side","name":"side","uiComponent":{"type":"DROPDOWN","options":{"values":["Left","Right"]}},"defaultValue":"Left","description":"Which end of the list to pop from: Left (head, LPOP) or Right (tail, RPOP)."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of elements to pop at once. Leave empty to pop a single element."}
   * @returns {Object}
   * @sampleResult {"key":"queue:jobs","values":["job-1"],"poppedCount":1}
   */
  async popFromList(key, side, count) {
    this.#requireKey(key)

    const popCount = this.#toInt(count, undefined)

    if (popCount !== undefined && !(popCount > 0)) {
      throw new Error('Count must be a positive integer when provided.')
    }

    return this.#withClient('popFromList', async client => {
      let popped

      if (popCount !== undefined) {
        popped = side === 'Right' ? await client.rPopCount(key, popCount) : await client.lPopCount(key, popCount)
      } else {
        popped = side === 'Right' ? await client.rPop(key) : await client.lPop(key)
      }

      const values = popped === null ? [] : Array.isArray(popped) ? popped : [popped]

      return { key, values, poppedCount: values.length }
    })
  }

  /**
   * @operationName Get List Range
   * @description Reads a range of elements from a list by index (LRANGE) without removing them. Indexes are zero-based; negative indexes count from the end (-1 is the last element). The defaults (0 to -1) return the entire list. A missing key returns an empty array.
   * @category Lists
   * @route GET /get-list-range
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The list key to read."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"Zero-based start index (default 0). Negative values count from the end."}
   * @paramDef {"type":"Number","label":"Stop","name":"stop","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":-1,"description":"Inclusive end index (default -1, the last element). Negative values count from the end."}
   * @returns {Object}
   * @sampleResult {"key":"queue:jobs","values":["job-1","job-2","job-3"],"count":3}
   */
  async getListRange(key, start, stop) {
    this.#requireKey(key)

    return this.#withClient('getListRange', async client => {
      const values = await client.lRange(key, this.#toInt(start, 0), this.#toInt(stop, -1))

      return { key, values, count: values.length }
    })
  }

  /**
   * @operationName List Length
   * @description Returns the number of elements in a list (LLEN). A missing key returns 0. Fails if the key holds a value of another type.
   * @category Lists
   * @route GET /list-length
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The list key to measure."}
   * @returns {Object}
   * @sampleResult {"key":"queue:jobs","length":3}
   */
  async listLength(key) {
    this.#requireKey(key)

    return this.#withClient('listLength', async client => {
      const length = await client.lLen(key)

      return { key, length }
    })
  }

  // ==========================================================================
  //  SETS
  // ==========================================================================
  /**
   * @operationName Add To Set
   * @description Adds one or more members to a set (SADD), creating the set if it does not exist. Duplicate members are ignored. Returns the number of members that were actually added (excluding those already present).
   * @category Sets
   * @route POST /add-to-set
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The set key to add members to."}
   * @paramDef {"type":"Array<String>","label":"Members","name":"members","required":true,"description":"The members to add (e.g. [\"user-1\", \"user-2\"])."}
   * @returns {Object}
   * @sampleResult {"key":"online:users","addedCount":2}
   */
  async addToSet(key, members) {
    this.#requireKey(key)
    this.#requireNonEmptyArray(members, 'Members')

    const items = members.map(member => this.#toRedisString(member))

    return this.#withClient('addToSet', async client => {
      const addedCount = await client.sAdd(key, items)

      return { key, addedCount }
    })
  }

  /**
   * @operationName Get Set Members
   * @description Returns all members of a set (SMEMBERS). Member order is not guaranteed. A missing key returns an empty array. For very large sets, consider that all members are returned in a single response.
   * @category Sets
   * @route GET /get-set-members
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The set key to read."}
   * @returns {Object}
   * @sampleResult {"key":"online:users","members":["user-1","user-2"],"count":2}
   */
  async getSetMembers(key) {
    this.#requireKey(key)

    return this.#withClient('getSetMembers', async client => {
      const members = await client.sMembers(key)

      return { key, members, count: members.length }
    })
  }

  /**
   * @operationName Remove From Set
   * @description Removes one or more members from a set (SREM) and returns how many were actually removed. Members that are not in the set are ignored; the set itself is deleted when its last member is removed.
   * @category Sets
   * @route DELETE /remove-from-set
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The set key to remove members from."}
   * @paramDef {"type":"Array<String>","label":"Members","name":"members","required":true,"description":"The members to remove (e.g. [\"user-1\"])."}
   * @returns {Object}
   * @sampleResult {"key":"online:users","removedCount":1}
   */
  async removeFromSet(key, members) {
    this.#requireKey(key)
    this.#requireNonEmptyArray(members, 'Members')

    return this.#withClient('removeFromSet', async client => {
      const removedCount = await client.sRem(key, members.map(member => this.#toRedisString(member)))

      return { key, removedCount }
    })
  }

  // ==========================================================================
  //  SORTED SETS
  // ==========================================================================
  /**
   * @operationName Add To Sorted Set
   * @description Adds one or more members with numeric scores to a sorted set (ZADD), creating the set if it does not exist. Members already present have their score updated instead. Returns the number of NEW members added (score updates do not count).
   * @category Sorted Sets
   * @route POST /add-to-sorted-set
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The sorted set key to add members to."}
   * @paramDef {"type":"Array<SortedSetMember>","label":"Members","name":"members","required":true,"description":"Members with scores to add (e.g. [{\"score\":100,\"value\":\"player-1\"},{\"score\":85,\"value\":\"player-2\"}])."}
   * @returns {Object}
   * @sampleResult {"key":"leaderboard","addedCount":2}
   */
  async addToSortedSet(key, members) {
    this.#requireKey(key)
    this.#requireNonEmptyArray(members, 'Members')

    const entries = members.map((member, index) => {
      const score = Number(member && member.score)

      if (!Number.isFinite(score)) {
        throw new Error(`Members[${ index }] must have a finite numeric "score".`)
      }

      if (member.value === undefined || member.value === null || member.value === '') {
        throw new Error(`Members[${ index }] must have a non-empty "value".`)
      }

      return { score, value: this.#toRedisString(member.value) }
    })

    return this.#withClient('addToSortedSet', async client => {
      const addedCount = await client.zAdd(key, entries)

      return { key, addedCount }
    })
  }

  /**
   * @operationName Get Sorted Range
   * @description Reads a range of members from a sorted set by rank (ZRANGE). Ranks are zero-based in ascending score order; negative ranks count from the end, so the defaults (0 to -1) return the whole set. Enable "With Scores" to return [{value, score}] objects instead of plain strings, and "Reverse" to read in descending score order (requires Redis 6.2+).
   * @category Sorted Sets
   * @route GET /get-sorted-range
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The sorted set key to read."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"Zero-based start rank (default 0). Negative values count from the end."}
   * @paramDef {"type":"Number","label":"Stop","name":"stop","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":-1,"description":"Inclusive end rank (default -1, the last member). Negative values count from the end."}
   * @paramDef {"type":"Boolean","label":"With Scores","name":"withScores","uiComponent":{"type":"CHECKBOX"},"defaultValue":false,"description":"When enabled, each member is returned as an object with \"value\" and \"score\" instead of a plain string."}
   * @paramDef {"type":"Boolean","label":"Reverse","name":"reverse","uiComponent":{"type":"CHECKBOX"},"defaultValue":false,"description":"When enabled, members are returned in descending score order (highest first). Requires Redis 6.2 or newer."}
   * @returns {Object}
   * @sampleResult {"key":"leaderboard","members":[{"value":"player-1","score":100},{"value":"player-2","score":85}],"count":2}
   */
  async getSortedRange(key, start, stop, withScores, reverse) {
    this.#requireKey(key)

    const from = this.#toInt(start, 0)
    const to = this.#toInt(stop, -1)
    const options = reverse === true || reverse === 'true' ? { REV: true } : undefined
    const scored = withScores === true || withScores === 'true'

    return this.#withClient('getSortedRange', async client => {
      const members = scored
        ? await client.zRangeWithScores(key, from, to, options)
        : await client.zRange(key, from, to, options)

      return { key, members, count: members.length }
    })
  }

  // ==========================================================================
  //  PUB/SUB
  // ==========================================================================
  /**
   * @operationName Publish Message
   * @description Publishes a message to a Pub/Sub channel (PUBLISH) and returns how many subscribers received it. Redis Pub/Sub is fire-and-forget: a receiver count of 0 means nothing was listening at that moment and the message is gone. Objects are sent as JSON strings. This operation only publishes - subscribing requires a long-lived connection and is not supported.
   * @category Pub/Sub
   * @route POST /publish-message
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Channel","name":"channel","required":true,"description":"The channel to publish to (e.g. notifications)."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message payload. Objects and arrays are sent as JSON strings."}
   * @returns {Object}
   * @sampleResult {"channel":"notifications","receiverCount":3}
   */
  async publishMessage(channel, message) {
    if (typeof channel !== 'string' || !channel.trim()) {
      throw new Error('Channel is required and must be a non-empty string.')
    }

    return this.#withClient('publishMessage', async client => {
      const receiverCount = await client.publish(channel, this.#toRedisString(message))

      return { channel, receiverCount }
    })
  }

  // ==========================================================================
  //  SERVER
  // ==========================================================================
  /**
   * @operationName Get Server Info
   * @description Retrieves server statistics via the INFO command, parsed into an object keyed by section (server, clients, memory, persistence, stats, replication, cpu, keyspace, ...). Keyspace entries are parsed further into {keys, expires, avgTtl} per database. Useful for health checks, memory monitoring and database sizing.
   * @category Server
   * @route GET /server-info
   * @appearanceColor #DC382C #A41E11
   * @returns {Object}
   * @sampleResult {"server":{"redis_version":"7.2.4","uptime_in_seconds":"86400"},"memory":{"used_memory_human":"1.05M"},"stats":{"total_connections_received":"120"},"keyspace":{"db0":{"keys":42,"expires":3,"avgTtl":36000}}}
   */
  async getServerInfo() {
    return this.#withClient('getServerInfo', async client => {
      const info = await client.info()

      return this.#parseInfo(info)
    })
  }

  // Parses raw INFO output ("# Section" headers followed by key:value lines)
  // into { section: { key: value } }. Keyspace db lines ("keys=1,expires=0,avg_ttl=0")
  // are parsed further into numeric objects.
  #parseInfo(text) {
    const sections = {}
    let current = null

    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.trim()

      if (!line) continue

      if (line.startsWith('#')) {
        current = line.slice(1).trim().toLowerCase()
        sections[current] = {}
        continue
      }

      const separatorIndex = line.indexOf(':')

      if (separatorIndex === -1 || !current) continue

      const field = line.slice(0, separatorIndex)
      const value = line.slice(separatorIndex + 1)

      if (current === 'keyspace') {
        const dbStats = {}

        for (const pair of value.split(',')) {
          const [statName, statValue] = pair.split('=')

          if (statName === 'keys') dbStats.keys = Number(statValue)
          else if (statName === 'expires') dbStats.expires = Number(statValue)
          else if (statName === 'avg_ttl') dbStats.avgTtl = Number(statValue)
          else if (statName) dbStats[statName] = statValue
        }

        sections[current][field] = dbStats
      } else {
        sections[current][field] = value
      }
    }

    return sections
  }

  // ==========================================================================
  //  ADVANCED
  // ==========================================================================
  /**
   * @operationName Execute Command
   * @description Advanced escape hatch: executes any raw Redis command by name with string arguments (e.g. command "GETRANGE" with args ["mykey", "0", "5"], or "JSON.GET" for module commands). All arguments are sent as strings, exactly as on the redis-cli command line. Returns the raw reply, which may be a string, number, array, or null depending on the command. Prefer the dedicated operations when one exists; commands that block or subscribe (BLPOP, SUBSCRIBE, MONITOR) must not be used here.
   * @category Advanced
   * @route POST /execute-command
   * @appearanceColor #DC382C #A41E11
   * @paramDef {"type":"String","label":"Command","name":"command","required":true,"description":"The Redis command name (e.g. GETRANGE, SETRANGE, ZSCORE, JSON.GET)."}
   * @paramDef {"type":"Array<String>","label":"Arguments","name":"args","description":"Command arguments as strings, in order (e.g. [\"mykey\", \"0\", \"5\"])."}
   * @returns {Object}
   * @sampleResult {"result":"OK"}
   */
  async executeCommand(command, args) {
    if (typeof command !== 'string' || !command.trim()) {
      throw new Error('Command is required and must be a non-empty string.')
    }

    const commandArgs = Array.isArray(args) ? args.map(arg => this.#toRedisString(arg)) : []

    return this.#withClient('executeCommand', async client => {
      const result = await client.sendCommand([command.trim(), ...commandArgs])

      return { result: result === undefined ? null : result }
    })
  }
}

Flowrunner.ServerCode.addService(Redis, [
  {
    name: 'connectionString',
    displayName: 'Connection String',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Full Redis connection URI, e.g. redis://default:password@redis.example.com:6379 - most managed providers (Upstash, Redis Cloud, DigitalOcean, Heroku) supply one. Use the rediss:// scheme for TLS (required by most managed providers). A database number may be appended as a path (e.g. .../2). When set, it takes precedence and the Host/Port/Username/Password/Database fields below are ignored. Special characters in the password must be URL-encoded; if that is a problem, use the individual fields instead.',
  },
  {
    name: 'host',
    displayName: 'Host',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Hostname or IP address of the Redis server (e.g. redis.example.com). Required unless a Connection String is provided. The server must be reachable from FlowRunner.',
  },
  {
    name: 'port',
    displayName: 'Port',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '6379',
    hint: 'TCP port of the Redis server. The default is 6379. Ignored when a Connection String is provided.',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'ACL username. Leave empty for the implicit "default" user (typical for password-only setups). Ignored when a Connection String is provided.',
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Password (AUTH) for the Redis server or ACL user. Leave empty when the server requires no authentication. Ignored when a Connection String is provided.',
  },
  {
    name: 'database',
    displayName: 'Database',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Logical database number to SELECT (0-15 on a default server). Leave empty for database 0. Ignored when a Connection String is provided - append the number to the URI path instead (e.g. .../2).',
  },
  {
    name: 'tls',
    displayName: 'Use TLS',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.BOOL,
    required: false,
    shared: false,
    defaultValue: false,
    hint: 'Enable TLS-encrypted connections (the rediss:// protocol). Required by most managed Redis providers (Upstash, Redis Cloud, DigitalOcean, ElastiCache with in-transit encryption). Certificate verification is relaxed to support managed providers\' certificates. With a Connection String, enabling this adds TLS on top of the URI; when off, the URI\'s own scheme (redis:// or rediss://) stays in charge.',
  },
  {
    name: 'connectionTimeoutSeconds',
    displayName: 'Connection Timeout (seconds)',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '10',
    hint: 'How long to wait when establishing a connection before failing. Defaults to 10 seconds.',
  },
])
