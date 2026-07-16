const { Client, Change, Attribute } = require('ldapts')

const logger = {
  info: (...args) => console.log('[LDAP] info:', ...args),
  debug: (...args) => console.log('[LDAP] debug:', ...args),
  error: (...args) => console.log('[LDAP] error:', ...args),
  warn: (...args) => console.log('[LDAP] warn:', ...args),
}

const SCOPE_MAP = { 'Base': 'base', 'One Level': 'one', 'Subtree': 'sub' }

/**
 * @integrationName LDAP
 * @integrationIcon /icon.png
 */
class LDAP {
  constructor(config) {
    this.config = config || {}

    this.url = (this.config.url || '').trim()
    this.bindDN = this.config.bindDN
    this.bindPassword = this.config.bindPassword
    this.baseDN = (this.config.baseDN || '').trim()
    // rejectUnauthorized defaults to true; only an explicit false relaxes cert checking.
    this.rejectUnauthorized = !(this.config.rejectUnauthorized === false || this.config.rejectUnauthorized === 'false')
  }

  // ==========================================================================
  //  CORE — connection lifecycle: one short-lived ldapts Client per method call.
  //  A client is created, bound with the SERVICE credentials, used and always
  //  unbound in finally. Clients are NEVER pooled or cached between invocations.
  // ==========================================================================
  async #withClient(logTag, fn) {
    const client = this.#createClient()

    try {
      logger.debug(`${ logTag } - binding to ${ this.url } as ${ this.bindDN }`)

      await client.bind(this.bindDN, this.bindPassword)

      return await fn(client)
    } catch (error) {
      this.#throwLdapError(error, logTag)
    } finally {
      try {
        await client.unbind()
      } catch (unbindError) {
        logger.warn(`${ logTag } - failed to unbind: ${ unbindError.message }`)
      }
    }
  }

  #createClient() {
    if (!this.url) {
      throw new Error('LDAP error: Server URL is required (e.g. ldap://dc.example.com:389 or ldaps://dc.example.com:636).')
    }

    return new Client({
      url: this.url,
      // tlsOptions only apply to ldaps:// connections; for plain ldap:// leave it undefined.
      tlsOptions: this.url.toLowerCase().startsWith('ldaps') ? { rejectUnauthorized: this.rejectUnauthorized } : undefined,
    })
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #resolveBaseDN(baseDN) {
    const resolved = (baseDN || '').trim() || this.baseDN

    if (!resolved) {
      throw new Error('LDAP error: no Base DN provided and no default Base DN configured in the service settings.')
    }

    return resolved
  }

  #requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`LDAP error: ${ label } is required and must be a non-empty string.`)
    }

    return value.trim()
  }

  #throwLdapError(error, logTag) {
    const parts = [error.message || String(error)]

    if (error.name && error.name !== 'Error') parts.push(`name: ${ error.name }`)
    if (error.code !== undefined && error.code !== null) parts.push(`code: ${ error.code }`)

    // Common network-level failures reaching the directory server. Give the same actionable
    // hint the database services give: the host is usually a firewall/port/URL problem.
    if (['ENETUNREACH', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND'].includes(error.code)) {
      parts.push(
        'hint: could not reach the LDAP server. Check that the Server URL host and port are correct ' +
        '(389 for ldap://, 636 for ldaps://), that the server is reachable from FlowRunner, ' +
        'and that any firewall or managed-host allowlist permits the connection.'
      )
    }

    const message = parts.join(' | ')

    logger.error(`${ logTag } - failed: ${ message }`)

    throw new Error(`LDAP error: ${ message }`)
  }

  // ==========================================================================
  //  SEARCH
  // ==========================================================================
  /**
   * @operationName Search
   * @description Searches the LDAP directory and returns matching entries. Provide a Base DN (the point in the tree to search from — defaults to the configured Base DN), a Scope, and an LDAP filter. Scope: "Base" searches only the Base DN entry itself, "One Level" searches its immediate children, "Subtree" searches the Base DN and all descendants (the default). The Filter uses standard RFC 4515 syntax, e.g. (objectClass=person), (uid=jdoe), or a compound filter (&(objectClass=person)(mail=*@example.com)); it defaults to (objectClass=*) which matches everything under the base. Each returned entry includes its dn plus the requested attributes; single-valued attributes come back as strings and multi-valued attributes as arrays. Binary attributes (e.g. objectGUID, jpegPhoto, thumbnailPhoto) come back as Buffers. Use the Attributes list to limit which attributes are returned; leave it empty for all. For result sets larger than the server limit (commonly 1000 in Active Directory) enable Paged.
   * @category Directory
   * @route POST /search
   * @appearanceColor #003366 #1B6EC2
   * @paramDef {"type":"String","label":"Base DN","name":"baseDN","description":"The DN to search from, e.g. ou=people,dc=example,dc=com. Leave empty to use the Base DN configured in the service settings."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","uiComponent":{"type":"DROPDOWN","options":{"values":["Base","One Level","Subtree"]}},"defaultValue":"Subtree","description":"How deep to search: Base (the base entry only), One Level (immediate children), or Subtree (base and all descendants)."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","defaultValue":"(objectClass=*)","description":"An RFC 4515 LDAP filter, e.g. (&(objectClass=person)(uid=jdoe)). Defaults to (objectClass=*) which matches all entries under the base."}
   * @paramDef {"type":"Array<String>","label":"Attributes","name":"attributes","description":"Specific attribute names to return (e.g. [\"cn\",\"mail\",\"memberOf\"]). Leave empty to return all attributes."}
   * @paramDef {"type":"Number","label":"Size Limit","name":"sizeLimit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of entries to return. Leave empty for the server default. Note the server may enforce its own lower limit."}
   * @paramDef {"type":"Boolean","label":"Paged","name":"paged","uiComponent":{"type":"CHECKBOX"},"description":"Enable paged results to retrieve large result sets (recommended for Active Directory when expecting more than ~1000 entries)."}
   * @returns {Object}
   * @sampleResult {"entries":[{"dn":"uid=jdoe,ou=people,dc=example,dc=com","cn":"John Doe","sn":"Doe","mail":"jdoe@example.com","objectClass":["inetOrgPerson","person"]}],"count":1}
   */
  async search(baseDN, scope, filter, attributes, sizeLimit, paged) {
    const resolvedBase = this.#resolveBaseDN(baseDN)
    const resolvedScope = this.#resolveChoice(scope, SCOPE_MAP) || 'sub'

    const options = {
      scope: resolvedScope,
      filter: (filter || '').trim() || '(objectClass=*)',
    }

    if (Array.isArray(attributes) && attributes.length) options.attributes = attributes
    if (sizeLimit !== undefined && sizeLimit !== null && sizeLimit !== '') options.sizeLimit = parseInt(sizeLimit, 10)
    if (paged === true || paged === 'true') options.paged = true

    return this.#withClient('search', async client => {
      const { searchEntries } = await client.search(resolvedBase, options)

      return { entries: searchEntries || [], count: (searchEntries || []).length }
    })
  }

  /**
   * @operationName Get Entry
   * @description Fetches a single directory entry by its exact DN. Performs a base-scoped search on the given DN with filter (objectClass=*). Returns the entry (its dn plus attributes) or null when no entry exists at that DN. Single-valued attributes come back as strings, multi-valued attributes as arrays, and binary attributes (e.g. objectGUID, jpegPhoto) as Buffers. Use the Attributes list to limit which attributes are returned.
   * @category Directory
   * @route GET /entry
   * @appearanceColor #003366 #1B6EC2
   * @paramDef {"type":"String","label":"DN","name":"dn","required":true,"description":"The full distinguished name of the entry to fetch, e.g. uid=jdoe,ou=people,dc=example,dc=com."}
   * @paramDef {"type":"Array<String>","label":"Attributes","name":"attributes","description":"Specific attribute names to return. Leave empty to return all attributes."}
   * @returns {Object}
   * @sampleResult {"entry":{"dn":"uid=jdoe,ou=people,dc=example,dc=com","cn":"John Doe","sn":"Doe","mail":"jdoe@example.com"}}
   */
  async getEntry(dn, attributes) {
    const entryDN = this.#requireNonEmptyString(dn, 'DN')

    const options = { scope: 'base', filter: '(objectClass=*)' }

    if (Array.isArray(attributes) && attributes.length) options.attributes = attributes

    return this.#withClient('getEntry', async client => {
      try {
        const { searchEntries } = await client.search(entryDN, options)

        return { entry: (searchEntries && searchEntries[0]) || null }
      } catch (error) {
        // A base-scoped search on a non-existent DN surfaces as "No Such Object" (code 32);
        // treat that as a clean "not found" rather than an error.
        if (error.code === 32) return { entry: null }

        throw error
      }
    })
  }

  // ==========================================================================
  //  ENTRIES
  // ==========================================================================
  /**
   * @operationName Add Entry
   * @description Creates a new directory entry at the given DN with the supplied attributes. Provide Attributes as a JSON object of attribute/value pairs, e.g. {"objectClass":["inetOrgPerson","person"],"cn":"John Doe","sn":"Doe","mail":"jdoe@example.com"}. Values may be a single string or an array of strings for multi-valued attributes. The objectClass attribute is required by most directories and determines which other attributes are allowed. Fails with "Already Exists" (code 68) if an entry already exists at the DN.
   * @category Entries
   * @route POST /add-entry
   * @appearanceColor #003366 #1B6EC2
   * @paramDef {"type":"String","label":"DN","name":"dn","required":true,"description":"The full DN of the entry to create, e.g. uid=jdoe,ou=people,dc=example,dc=com."}
   * @paramDef {"type":"Object","label":"Attributes","name":"attributes","required":true,"description":"Attribute/value pairs for the new entry as a JSON object, e.g. {\"objectClass\":[\"inetOrgPerson\"],\"cn\":\"John Doe\",\"sn\":\"Doe\"}. Values may be strings or arrays of strings."}
   * @returns {Object}
   * @sampleResult {"success":true,"dn":"uid=jdoe,ou=people,dc=example,dc=com"}
   */
  async addEntry(dn, attributes) {
    const entryDN = this.#requireNonEmptyString(dn, 'DN')

    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes) || !Object.keys(attributes).length) {
      throw new Error('LDAP error: Attributes must be a non-empty JSON object of attribute/value pairs.')
    }

    return this.#withClient('addEntry', async client => {
      await client.add(entryDN, attributes)

      return { success: true, dn: entryDN }
    })
  }

  /**
   * @operationName Modify Entry
   * @description Modifies the attributes of an existing entry. Provide Operations as an array of change objects, each with an operation ("add", "replace", or "delete"), the attribute name, and its values. "add" appends values to an attribute, "replace" overwrites the attribute's values entirely, and "delete" removes the given values (or, with an empty values array, the whole attribute). Example: [{"operation":"replace","attribute":"mail","values":["new@example.com"]},{"operation":"add","attribute":"memberOf","values":["cn=admins,dc=example,dc=com"]}]. Note: Active Directory password changes (unicodePwd) require special UTF-16 encoding over ldaps:// and are not handled here.
   * @category Entries
   * @route PATCH /modify-entry
   * @appearanceColor #003366 #1B6EC2
   * @paramDef {"type":"String","label":"DN","name":"dn","required":true,"description":"The full DN of the entry to modify, e.g. uid=jdoe,ou=people,dc=example,dc=com."}
   * @paramDef {"type":"Array<Object>","label":"Operations","name":"operations","required":true,"description":"An array of change objects, each {\"operation\":\"add|replace|delete\",\"attribute\":\"<name>\",\"values\":[\"<value>\"]}. Use an empty values array with delete to remove the whole attribute."}
   * @returns {Object}
   * @sampleResult {"success":true,"dn":"uid=jdoe,ou=people,dc=example,dc=com","appliedChanges":2}
   */
  async modifyEntry(dn, operations) {
    const entryDN = this.#requireNonEmptyString(dn, 'DN')

    if (!Array.isArray(operations) || !operations.length) {
      throw new Error('LDAP error: Operations must be a non-empty array of change objects.')
    }

    const changes = operations.map((op, index) => {
      const operation = op && op.operation
      const attribute = op && op.attribute

      if (!['add', 'replace', 'delete'].includes(operation)) {
        throw new Error(`LDAP error: Operations[${ index }].operation must be one of "add", "replace", or "delete".`)
      }

      if (typeof attribute !== 'string' || !attribute.trim()) {
        throw new Error(`LDAP error: Operations[${ index }].attribute is required and must be a non-empty string.`)
      }

      const rawValues = op.values === undefined || op.values === null ? [] : op.values
      const values = Array.isArray(rawValues) ? rawValues : [rawValues]

      return new Change({ operation, modification: new Attribute({ type: attribute, values }) })
    })

    return this.#withClient('modifyEntry', async client => {
      await client.modify(entryDN, changes)

      return { success: true, dn: entryDN, appliedChanges: changes.length }
    })
  }

  /**
   * @operationName Rename Entry
   * @description Renames or moves an entry by changing its DN (an LDAP ModifyDN operation). Provide the current DN and the new DN. Changing only the leftmost (RDN) component renames the entry in place (e.g. cn=Old,ou=people,dc=example,dc=com → cn=New,ou=people,dc=example,dc=com); changing the parent portion moves it to a different container (subtree move support depends on the server).
   * @category Entries
   * @route PATCH /rename-entry
   * @appearanceColor #003366 #1B6EC2
   * @paramDef {"type":"String","label":"DN","name":"dn","required":true,"description":"The current full DN of the entry, e.g. cn=Old Name,ou=people,dc=example,dc=com."}
   * @paramDef {"type":"String","label":"New DN","name":"newDN","required":true,"description":"The new full DN for the entry, e.g. cn=New Name,ou=people,dc=example,dc=com."}
   * @returns {Object}
   * @sampleResult {"success":true,"dn":"cn=New Name,ou=people,dc=example,dc=com","previousDN":"cn=Old Name,ou=people,dc=example,dc=com"}
   */
  async renameEntry(dn, newDN) {
    const entryDN = this.#requireNonEmptyString(dn, 'DN')
    const targetDN = this.#requireNonEmptyString(newDN, 'New DN')

    return this.#withClient('renameEntry', async client => {
      await client.modifyDN(entryDN, targetDN)

      return { success: true, dn: targetDN, previousDN: entryDN }
    })
  }

  /**
   * @operationName Delete Entry
   * @description Deletes the entry at the given DN. LDAP deletes are non-recursive: an entry with child entries cannot be removed until its children are deleted first (the server returns "Not Allowed On Non-Leaf"). Fails with "No Such Object" (code 32) when no entry exists at the DN.
   * @category Entries
   * @route DELETE /delete-entry
   * @appearanceColor #003366 #1B6EC2
   * @paramDef {"type":"String","label":"DN","name":"dn","required":true,"description":"The full DN of the entry to delete, e.g. uid=jdoe,ou=people,dc=example,dc=com."}
   * @returns {Object}
   * @sampleResult {"success":true,"dn":"uid=jdoe,ou=people,dc=example,dc=com"}
   */
  async deleteEntry(dn) {
    const entryDN = this.#requireNonEmptyString(dn, 'DN')

    return this.#withClient('deleteEntry', async client => {
      await client.del(entryDN)

      return { success: true, dn: entryDN }
    })
  }

  /**
   * @operationName Compare
   * @description Checks whether an entry's attribute contains a specific value, using the LDAP Compare operation. Returns a boolean matched result without transferring the attribute's value. Useful for permission/membership checks (e.g. does this entry's objectClass include "person", or does memberOf contain a given group DN) that respect server-side matching rules.
   * @category Directory
   * @route POST /compare
   * @appearanceColor #003366 #1B6EC2
   * @paramDef {"type":"String","label":"DN","name":"dn","required":true,"description":"The full DN of the entry to test, e.g. uid=jdoe,ou=people,dc=example,dc=com."}
   * @paramDef {"type":"String","label":"Attribute","name":"attribute","required":true,"description":"The attribute name to compare, e.g. objectClass or memberOf."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The value to test for, e.g. person or cn=admins,dc=example,dc=com."}
   * @returns {Object}
   * @sampleResult {"matched":true,"dn":"uid=jdoe,ou=people,dc=example,dc=com","attribute":"objectClass","value":"person"}
   */
  async compare(dn, attribute, value) {
    const entryDN = this.#requireNonEmptyString(dn, 'DN')
    const attr = this.#requireNonEmptyString(attribute, 'Attribute')

    if (value === undefined || value === null) {
      throw new Error('LDAP error: Value is required.')
    }

    return this.#withClient('compare', async client => {
      const matched = await client.compare(entryDN, attr, String(value))

      return { matched, dn: entryDN, attribute: attr, value: String(value) }
    })
  }

  // ==========================================================================
  //  AUTHENTICATION
  // ==========================================================================
  /**
   * @operationName Authenticate User
   * @description Validates a user's credentials by attempting an LDAP bind AS THAT USER — a fresh connection is opened and bound with the supplied User DN and password, separate from the service's own bind credentials. Returns {"authenticated":true} when the bind succeeds and {"authenticated":false} with the LDAP reason when the credentials are rejected (Invalid Credentials, code 49). This is the standard way to check a login: typically first Search for the user by username to obtain their DN, then call this with that DN and the password they entered. Non-authentication errors (server unreachable, no such user object) are raised as errors rather than returned as false.
   * @category Authentication
   * @route POST /authenticate-user
   * @appearanceColor #003366 #1B6EC2
   * @paramDef {"type":"String","label":"User DN","name":"userDN","required":true,"description":"The full DN of the user to authenticate, e.g. uid=jdoe,ou=people,dc=example,dc=com (Active Directory also accepts a userPrincipalName such as jdoe@example.com)."}
   * @paramDef {"type":"String","label":"User Password","name":"userPassword","required":true,"description":"The password to validate for the user."}
   * @returns {Object}
   * @sampleResult {"authenticated":true,"userDN":"uid=jdoe,ou=people,dc=example,dc=com"}
   */
  async authenticateUser(userDN, userPassword) {
    const dn = this.#requireNonEmptyString(userDN, 'User DN')

    if (typeof userPassword !== 'string' || userPassword.length === 0) {
      throw new Error('LDAP error: User Password is required.')
    }

    // Deliberately a SEPARATE client bound as the user — never the service #withClient, whose
    // client binds with the service credentials. Each call opens, binds as the user, unbinds.
    const client = this.#createClient()

    try {
      logger.debug(`authenticateUser - attempting bind as ${ dn }`)

      await client.bind(dn, userPassword)

      return { authenticated: true, userDN: dn }
    } catch (error) {
      // Invalid Credentials (49) is the expected "wrong password" outcome — return a clean
      // false rather than throwing. Everything else (unreachable server, no such DN) is a real
      // error and should surface.
      if (error.code === 49 || error.name === 'InvalidCredentialsError') {
        logger.debug(`authenticateUser - invalid credentials for ${ dn }`)

        return { authenticated: false, userDN: dn, reason: error.message || 'Invalid credentials' }
      }

      this.#throwLdapError(error, 'authenticateUser')
    } finally {
      try {
        await client.unbind()
      } catch (unbindError) {
        logger.warn(`authenticateUser - failed to unbind: ${ unbindError.message }`)
      }
    }
  }
}

Flowrunner.ServerCode.addService(LDAP, [
  {
    name: 'url',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'LDAP server URL, e.g. ldap://dc.example.com:389 for a plain connection or ldaps://dc.example.com:636 for TLS (LDAPS). Port defaults to 389 (ldap) / 636 (ldaps) if omitted.',
  },
  {
    name: 'bindDN',
    displayName: 'Bind DN',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The DN to authenticate the service as, e.g. cn=admin,dc=example,dc=com. For Active Directory a userPrincipalName (e.g. svc@example.com) also works. This account performs Search/Add/Modify/Delete operations.',
  },
  {
    name: 'bindPassword',
    displayName: 'Bind Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The password for the Bind DN account.',
  },
  {
    name: 'baseDN',
    displayName: 'Base DN',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Default search base used when an operation does not specify one, e.g. dc=example,dc=com. Optional, but recommended so Search can be run without repeating the base each time.',
  },
  {
    name: 'rejectUnauthorized',
    displayName: 'Verify TLS Certificate',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.BOOL,
    required: false,
    shared: false,
    defaultValue: true,
    hint: 'For ldaps:// connections only. When on (default), the server\'s TLS certificate must be valid and trusted. Turn off to allow self-signed or untrusted certificates (less secure — use only for trusted internal servers).',
  },
])
