# FlowRunner Extension Code Structure and Architecture Guide

This document provides a comprehensive guide to FlowRunner Extension code structure, patterns, and implementation examples. This sample service demonstrates all key concepts and serves as a reference for service development.

## Table of Contents

1. [Service Structure Overview](#service-structure-overview)
2. [Class Declaration and Configuration](#class-declaration-and-configuration)
3. [Core Infrastructure Methods](#core-infrastructure-methods)
4. [OAuth2 Integration Methods](#oauth2-integration-methods)
5. [Dictionary Methods](#dictionary-methods)
6. [Action Methods](#action-methods)
7. [Trigger Systems](#trigger-systems)
8. [Sample Result Loaders](#sample-result-loaders)
9. [Service Registration](#service-registration)
10. [Development Patterns](#development-patterns)

## Service Structure Overview

Every FlowRunner Extension service follows a consistent structure with the following components:

### 1. Dependencies and Constants

```javascript
// External utilities and helper functions
const { generateCodeVerifier, generateCodeChallenge, searchFilter } = require('./utils')

// Service-specific API endpoints
const OAUTH_BASE_URL = 'https://airtable.com/oauth2/v1'
const API_BASE_URL = 'https://api.airtable.com/v0'

// OAuth scopes configuration
const DEFAULT_SCOPE_LIST = [
  'schema.bases:read',
  'user.email:read',
  'webhook:manage',
  'schema.bases:write',
  'data.records:read',
  'data.records:write',
  'data.recordComments:read',
  'data.recordComments:write',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')
```

### 2. Logging Infrastructure

```javascript
// Standardized logging pattern for all services
const logger = {
  info: (...args) => console.log('[Airtable Service] info:', ...args),
  debug: (...args) => console.log('[Airtable Service] debug:', ...args),
  error: (...args) => console.log('[Airtable Service] error:', ...args),
  warn: (...args) => console.log('[Airtable Service] warn:', ...args),
}
```

### 3. Error Handling Classes

```javascript
// Custom error class for consistent error handling
class ResponseError extends Error {
  constructor(message, httpStatusCode, data) {
    super(message)
    this.message = message
    this.httpStatusCode = httpStatusCode
    this.data = data
  }

  toJSON() {
    return {
      message: this.message,
      httpStatusCode: this.httpStatusCode,
      data: this.data,
    }
  }
}
```

## Class Declaration and Configuration

### Service Class Declaration

```javascript
/**
 * Service-level JSDoc annotations define core service properties
 * @requireOAuth - Indicates OAuth2 authentication required
 * @integrationName - Display name in the FlowRunner UI
 * @integrationTriggersScope - Trigger scope (SINGLE_APP or ALL_APPS)
 * @integrationIcon - Icon path matching the actual file in public/ (/icon.png|.svg|.webp|.jpeg)
 * @usesFileStorage - REQUIRED whenever the service calls the Files API (this.flowrunner.Files.*)
 **/
class Airtable {
  constructor(config) {
    // Initialize service with configuration items
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }
}
```

## Core Infrastructure Methods

### HTTP Request Handler

```javascript
/**
 * Centralized API request handler with error processing
 * @private - Internal method not exposed as API endpoint
 */
async #apiRequest({ url, method, body, query, logTag }) {
  method = method || 'get'

  try {
    logger.debug(`${logTag} - api request: [${method}::${url}] q=[${JSON.stringify(query)}]`)

    return await Flowrunner.Request[method](url)
      .set(this.#getAccessTokenHeader())
      .query(query)
      .send(body)
  } catch (error) {
    error = this.#parseExternalError(error)
    logger.error(`${logTag} - error: ${error.message}`)
    throw error
  }
}
```

> **Note:** The chained `.send(body)` pattern above works when body is always passed (even as `undefined`).
> When body is **conditional** (e.g., form data vs JSON), use early returns instead —
> `request.send(body)` returns a new promise and calling it without `return await` discards the body:
> ```javascript
> // ✅ Correct conditional pattern:
> if (body) {
>   return await request.send(body)
> }
> return await request
> ```

### Error Parsing

```javascript
/**
 * Transform external service errors to standardized format
 * Each service implements its own error parsing logic
 */
#parseExternalError(error) {
  if (error.body?.error) {
    const airtableError = error
    const airtableErrorBody = error.body?.error

    delete airtableError.headers // Clean logs

    let errorMessage = airtableErrorBody

    if (typeof airtableErrorBody === 'object') {
      errorMessage = airtableErrorBody.message || airtableErrorBody.type
    }

    return new ResponseError(`[AirtableError]: ${errorMessage}`, airtableError.status, {
      type: airtableErrorBody.type,
    })
  }

  return error
}
```

### Authentication Headers

```javascript
// OAuth access token header for API requests
#getAccessTokenHeader(accessToken) {
  return {
    Authorization: `Bearer ${accessToken || this.request.headers['oauth-access-token']}`,
  }
}

// Client credentials header for OAuth token requests
#getSecretTokenHeader() {
  const token = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
  return {
    Authorization: `Basic ${token}`,
  }
}
```

## OAuth2 Integration Methods

Services requiring OAuth2 must implement three system methods:

### 1. Authorization URL Generation

```javascript
/**
 * @operationName Get OAuth2 Connection URL
 * @registerAs SYSTEM - System method for OAuth flow
 * @route GET /getOAuth2ConnectionURL
 */
async getOAuth2ConnectionURL() {
  const params = new URLSearchParams()

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)

  params.append('client_id', this.clientId)
  params.append('response_type', 'code')
  params.append('scope', this.scopes)
  params.append('code_challenge', codeChallenge)
  params.append('code_challenge_method', 'S256')
  params.append('state', codeVerifier)

  return `${OAUTH_BASE_URL}/authorize?${params.toString()}`
}
```

### 2. Token Refresh

```javascript
/**
 * @typedef {Object} refreshToken_ResultObject
 * @property {String} token - New access token
 * @property {String} refreshToken - New refresh token
 * @property {Number} [expirationInSeconds] - Token expiration time
 */

/**
 * @operationName Refresh Token
 * @registerAs SYSTEM
 * @route PUT /refreshToken
 * @param {String} refreshToken
 * @returns {refreshToken_ResultObject}
 */
async refreshToken(refreshToken) {
  const params = new URLSearchParams()
  params.append('grant_type', 'refresh_token')
  params.append('refresh_token', refreshToken)

  try {
    const response = await Flowrunner.Request.post(`${OAUTH_BASE_URL}/token`)
      .set(this.#getSecretTokenHeader())
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    return {
      token: response.access_token,
      expirationInSeconds: response.expires_in,
      refreshToken: response.refresh_token || refreshToken,
    }
  } catch (error) {
    error = this.#parseExternalError(error)
    logger.error(`refreshToken: ${error.message}`)
    throw error
  }
}
```

### 3. OAuth Callback Handler

```javascript
/**
 * @typedef {Object} executeCallback_ResultObject
 * @property {String} token - Access token
 * @property {String} [refreshToken] - Refresh token
 * @property {Number} [expirationInSeconds] - Token expiration
 * @property {Object} [userData] - User information
 * @property {Boolean} [overwrite] - Whether to overwrite existing connection
 * @property {String} connectionIdentityName - Display name for connection
 * @property {String} [connectionIdentityImageURL] - User avatar URL
 */

/**
 * @operationName Execute Callback
 * @registerAs SYSTEM
 * @route POST /executeCallback
 * @param {Object} callbackObject - OAuth callback data
 * @returns {executeCallback_ResultObject}
 */
async executeCallback(callbackObject) {
  // Exchange authorization code for access token
  const params = new URLSearchParams()
  params.append('grant_type', 'authorization_code')
  params.append('client_secret', this.clientSecret)
  params.append('code', callbackObject.code)
  params.append('redirect_uri', callbackObject.redirectURI)
  params.append('code_verifier', callbackObject['state'])

  let codeExchangeResponse = {}

  try {
    codeExchangeResponse = await Flowrunner.Request.post(`${OAUTH_BASE_URL}/token`)
      .set(this.#getSecretTokenHeader())
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())
  } catch (error) {
    error = this.#parseExternalError(error)
    logger.error(`[executeCallback] codeExchangeResponse error: ${error.message}`)
    return {}
  }

  // Fetch user information
  let userInfo = {}
  try {
    userInfo = await Flowrunner.Request.get(`${API_BASE_URL}/meta/whoami`)
      .set(this.#getAccessTokenHeader(codeExchangeResponse['access_token']))
  } catch (error) {
    error = this.#parseExternalError(error)
    logger.error(`[executeCallback] userInfo error: ${error.message}`)
    return {}
  }

  return {
    token: codeExchangeResponse['access_token'],
    expirationInSeconds: codeExchangeResponse['expires_in'],
    refreshToken: codeExchangeResponse['refresh_token'],
    connectionIdentityName: userInfo.email || 'Unknown Airtable Account',
    connectionIdentityImageURL: null,
    overwrite: true,
    userData: userInfo,
  }
}
```

## Dictionary Methods

Dictionary methods provide dynamic options for parameter dropdowns and **MUST be fully documented as Actions** since they can be called independently by AI agents.

### Standard Dictionary Response Types

```javascript
/**
 * @typedef {Object} DictionaryItem
 * @property {String} label - Display text in UI
 * @property {any} value - Actual value to use
 * @property {String} note - Additional info shown in UI
 */

/**
 * @typedef {Object} DictionaryResponse
 * @property {Array<DictionaryItem>} items - List of options
 * @property {String} cursor - Pagination cursor for next page
 */
```

### Dictionary Method Documentation Requirements

**ALL Dictionary methods MUST include these JSDoc annotations to function as Actions:**

- `@operationName` - Clear operation name for AI agents
- `@description` - Comprehensive description of what the method does
- `@route` - HTTP method and endpoint (POST for complex payloads)
- `@sampleResult` - Sample response for documentation
- `@paramDef` - Single payload parameter with typedef reference

### Simple Dictionary Example

```javascript
/**
 * @typedef {Object} getBasesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter bases by their name or ID. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor to retrieve the next page of results from the API."}
 */

/**
 * @registerAs DICTIONARY
 * @operationName Get Bases Dictionary
 * @description Retrieves a list of accessible Airtable bases that can be used for base selection in other operations.
 *
 * @route POST /get-bases-dictionary
 *
 * @paramDef {"type":"getBasesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering bases."}
 *
 * @sampleResult {"items":[{"label":"My Base","note":"ID: appXXXXXXXXXXXXXX","value":"appXXXXXXXXXXXXXX"}],"cursor":"itrXXXXXXXXXXXXXX/recXXXXXXXXXXXXXX"}
 * @returns {DictionaryResponse}
 */
async getBasesDictionary({ search, cursor }) {
  const { bases, offset } = await this.#apiRequest({
    logTag: 'getBasesDictionary',
    url: `${API_BASE_URL}/meta/bases`,
    query: { offset: cursor },
  })

  const filteredBases = search ? searchFilter(bases, ['id', 'name'], search) : bases

  return {
    cursor: offset,
    items: filteredBases.map(({ id, name }) => ({
      label: name || '[empty]',
      note: `ID: ${id}`,
      value: id,
    })),
  }
}
```

### Dictionary with Dependencies

For dictionaries that require specific criteria (like dependent parameters), use nested typedef structures:

```javascript
/**
 * Define criteria object first - contains all required parameters for the dictionary
 * @typedef {Object} getTablesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"description":"Unique identifier of the Airtable base for which to list tables."}
 */

/**
 * Define the main payload object - contains search, cursor, and criteria
 * @typedef {Object} getTablesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tables by their name or ID. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor to retrieve the next page of results from the API."}
 * @paramDef {"type":"getTablesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the specific Airtable base for table retrieval."}
 */

/**
 * @registerAs DICTIONARY
 * @operationName Get Tables Dictionary
 * @description Retrieves a list of tables from the specified Airtable base. This dictionary depends on a base ID being selected first.
 *
 * @route POST /get-tables-dictionary
 *
 * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Contains base ID and optional search string for retrieving and filtering tables."}
 *
 * @sampleResult {"items":[{"label":"Tasks","note":"ID: tbl7bQ6QQHL6zqBq1","value":"tbl7bQ6QQHL6zqBq1"}],"cursor":null}
 * @returns {DictionaryResponse}
 */
async getTablesDictionary({ search, cursor, criteria: { baseId } }) {
  const { tables } = await this.#apiRequest({
    logTag: 'getTablesDictionary',
    url: `${API_BASE_URL}/meta/bases/${baseId}/tables`,
  })

  const filteredTables = search ? searchFilter(tables, ['id', 'name'], search) : tables

  return {
    cursor: null, // Most table listings don't require pagination
    items: filteredTables.map(({ id, name }) => ({
      label: name || '[empty]',
      note: `ID: ${id}`,
      value: id,
    })),
  }
}
```

### Dictionary Payload Structure Rules

**CRITICAL REQUIREMENTS for Dictionary Method Payloads:**

1. **Single Parameter**: Dictionary methods accept exactly ONE parameter named `payload`
2. **Payload Type**: The payload parameter must reference a typedef: `{methodName}__payload`
3. **Typedef Structure**: Each payload typedef must define all accepted parameters using `@paramDef`
4. **Criteria Object**: For dependent dictionaries, include a `criteria` parameter with its own typedef: `{methodName}__payloadCriteria`
5. **Standard Parameters**: Always include `search` and `cursor` parameters even if not used
6. **Nested Typedefs**: Define criteria typedef first, then payload typedef that references it

## Action Methods

Action methods are the main API endpoints that users can call:

### Simple Action Example

```javascript
/**
 * @description Returns the list of bases. Helpful when need to get baseId by its name.
 *
 * @route GET /getBases - HTTP method and endpoint
 * @operationName Get Bases - Display name in FlowRunner UI
 *
 * @appearanceColor #25B5F8 #FFBE00 - Two hex colors for UI appearance
 *
 * @executionTimeoutInSeconds 120 - Extended timeout if needed
 * @requiredOauth2Scopes schema.bases:read - Required OAuth scopes
 *
 * @returns {Array} Returns the list of bases the token can access, 1000 bases at a time.
 * @sampleResult [{"id":"example_id_ICXNqxSDhG","name":"Example Name","permissionLevel":"create"},{"id":"example_id_5uCNmRmfl6","name":"Example Name 2","permissionLevel":"edit"}]
 */
async getBases() {
  const result = await this.#apiRequest({
    logTag: 'getBases',
    url: `${API_BASE_URL}/meta/bases`,
  })

  return result.bases
}
```

### Action with Parameters

```javascript
/**
 * @description Creates a new table and returns the schema for the newly created table.
 *
 * @route POST /createTable
 * @operationName Create Table
 *
 * @appearanceColor #25B5F8 #FFBE00
 *
 * @executionTimeoutInSeconds 120
 * @requiredOauth2Scopes schema.bases:write
 *
 * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the base where the table will be created."}
 * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The name of the table to be created."}
 * @paramDef {"type":"Array<Object>","label":"Fields","name":"fields","required":true,"description":"An array of fields, where each field is an object containing field name and type."}
 * @paramDef {"type":"String","label":"Description","name":"description","description":"The description of the created table."}
 *
 * @returns {Object} The response from the Airtable API with the created table details.
 * @sampleResult {"description":"Example Description","fields":[{"description":"Example Field Description","id":"example_id_field_1","name":"Example Name","type":"singleLineText"}],"id":"example_id_table_1","name":"Example Table Name","primaryFieldId":"example_id_field_1","views":[{"id":"example_id_view_1","name":"Example View Name","type":"grid"}]}
 */
async createTable(baseId, tableName, description, fields) {
  if (!Array.isArray(fields)) {
    fields = []
  }

  return this.#apiRequest({
    logTag: 'createTable',
    url: `${API_BASE_URL}/meta/bases/${baseId}/tables`,
    method: 'post',
    body: {
      name: tableName,
      description: description || '',
      fields,
    },
  })
}
```

## Trigger Systems

### Polling Trigger System

Polling triggers check for new data at regular intervals:

#### Trigger Handler Method

```javascript
/**
 * System method that routes trigger events to specific trigger methods
 * @registerAs SYSTEM
 * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
 * @returns {Object}
 */
async handleTriggerPollingForEvent(invocation) {
  return this[invocation.eventName](invocation)
}
```

#### Polling Trigger Implementation

```javascript
/**
 * @operationName On New Record
 * @description Will check for new records at the selected interval. Polling interval can be customized (minimum 30 seconds).
 * @registerAs POLLING_TRIGGER
 *
 * @route POST /onNewRecord
 * @executionTimeoutInSeconds 120
 * @appearanceColor #25B5F8 #FFBE00
 *
 * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the base where the table to monitor for new records is located."}
 * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID or name of the table to monitor for new records."}
 *
 * @returns {Object} Return new record
 * @sampleResultLoader { "methodName":"onNewOrUpdatedRecord_SampleResultLoader", "dependsOn":["baseId", "tableIdOrName"] }
 */
async onNewRecord(invocation) {
  const { baseId, tableIdOrName } = invocation.triggerData

  const createdColumn = await this.#getCreatedColumnName(baseId, tableIdOrName)
  const records = await this.#getLatestRecords(baseId, tableIdOrName, createdColumn)

  // Learning mode: return sample data for trigger setup
  if (invocation.learningMode) {
    return {
      events: [records[0]],
      state: null,
    }
  }

  // First run: initialize state without triggering
  if (!invocation.state?.records) {
    return {
      events: [],
      state: { records },
    }
  }

  // Compare with previous state to find new records
  const prevRecords = new Set(invocation.state.records.map(({ id }) => id))
  const newRecords = records.filter((record) => !prevRecords.has(record.id))

  return {
    events: newRecords,
    state: { records },
  }
}
```

## Sample Result Loaders

Sample result loaders provide dynamic sample data based on parameter values:

```javascript
/**
 * @registerAs SAMPLE_RESULT_LOADER
 *
 * @route POST /onNewOrUpdatedRecord_SampleResultLoader
 * @param {Object} payload - Contains criteria with parameter values
 */
async onNewOrUpdatedRecord_SampleResultLoader({ criteria }) {
  const { baseId, tableIdOrName } = criteria

  const result = await this.#apiRequest({
    logTag: 'onNewOrUpdatedRecord_SampleResultLoader',
    url: `${API_BASE_URL}/${baseId}/${tableIdOrName}`,
    query: { pageSize: 1 },
  })

  const record = (result?.records || [])[0]

  if (record) {
    // Ensure all table fields are represented in sample
    const table = await this.#getTableSchema(baseId, tableIdOrName)
    const tableFields = table?.fields || []

    tableFields.forEach((field) => {
      if (!(field.name in record.fields)) {
        record.fields[field.name] = null
      }
    })
  }

  return record || {}
}
```

## Service Registration

```javascript
// Register service with FlowRunner and define configuration items
Flowrunner.ServerCode.addService(Airtable, [
  {
    displayName: 'Client Id',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientId',
    hint: 'Your OAuth 2.0 Client ID from the Airtable Developer Hub (Create and manage OAuth integrations).',
  },
  {
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientSecret',
    hint: 'Your OAuth 2.0 Client Secret from the Airtable Developer Hub (Required for secure authentication).',
  },
])
```

## Development Patterns

### Method Registration Types

- **`DICTIONARY`** - Provides dynamic options for parameters. **MUST be fully documented as Actions** with complete JSDoc annotations including `@operationName`, `@description`, `@route`, `@paramDef`, and `@sampleResult`
- **`SYSTEM`** - Internal system methods (OAuth, triggers)
- **`POLLING_TRIGGER`** - Periodic data checking triggers
- **`REALTIME_TRIGGER`** - Webhook-based triggers
- **`SAMPLE_RESULT_LOADER`** - Dynamic sample result generation

### Parameter Definition Patterns

- **`@paramDef`** - JSON string defining parameter properties
- **`dictionary`** - Links parameter to dictionary method
- **`dependsOn`** - Array of parameter names this depends on
- **`required`** - Boolean indicating if parameter is mandatory

### JSDoc Return Type Patterns

- **`@returns {TypeName}`** - Correct format for return types (do NOT use `Promise.<TypeName>`)
- **Example**: Use `@returns {PdfResponse}` instead of `@returns {Promise.<PdfResponse>}`
- **Rationale**: All FlowRunner methods are inherently async, Promise wrapper is redundant

### Error Handling Best Practices

1. Use try-catch blocks for external API calls
2. Parse and normalize external service errors
3. Provide meaningful error messages
4. Log errors with appropriate context
5. Don't expose sensitive information in error messages

### Authentication Patterns

1. **OAuth2 Services**: Implement getOAuth2ConnectionURL, executeCallback, refreshToken
2. **API Key Services**: Use service configuration for credentials
3. **Token Management**: Use this.#getAccessToken() pattern for OAuth services

### Logging Guidelines

1. Use consistent log tags for method identification
2. Include relevant context (method name, parameters)
3. Log API requests and responses for debugging
4. Avoid logging sensitive data (tokens, secrets)
5. Use appropriate log levels (debug, info, warn, error)

This comprehensive structure ensures services are well-organized, maintainable, and provide excellent developer experience for AI Agent Tool integration.
