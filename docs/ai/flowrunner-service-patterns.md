# FlowRunner Service Implementation Patterns

## Service Class Structure

```javascript
/**
 * @integrationName Service Display Name
 * @integrationIcon /service-icon.png
 * @requireOAuth (optional - for OAuth2 services)
 */
class ServiceName {
  // Service implementation
}

// @integrationIcon must point at a real file in the service's public/ folder
// (e.g. public/service-icon.png). There is no fixed "/icon.png" convention.

Flowrunner.ServerCode.addService(ServiceName, [
  {
    name: 'configKey',
    displayName: 'Display Label', // No service name prefix
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false, // shared: true only for OAuth client credentials; otherwise false
    hint: 'Configuration description',
  },
])
```

## Method Patterns

### Action Method (Standard)

```javascript
/**
 * @operationName User-friendly Action Name
 * @description Clear method description
 * @route POST /method-endpoint
 *
 * @paramDef {"type":"String","label":"Parameter Label","name":"paramName","required":true,"description":"Parameter purpose"}
 * @paramDef {"type":"Boolean","label":"Option","name":"optionFlag","uiComponent":{"type":"TOGGLE"},"description":"Toggle description"}
 *
 * @returns {Object}
 * @sampleResult {"result":"success","data":{"id":"123"}}
 */
async methodName(paramName, optionFlag) {
  // Individual parameters, not destructured object
  try {
    // Implementation
    return result
  } catch (error) {
    logger.error(`[methodName] Error: ${error.message}`)
    throw error
  }
}
```

### Dictionary Method

**IMPORTANT: Dictionary methods require typedef definitions and single payload parameter!**

```javascript
// First, define the typedef for the payload type (place after class declaration)
/**
 * @typedef {Object} getOptionsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter options. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */

// Then implement the dictionary method
/**
 * @registerAs DICTIONARY
 * @operationName Get Options Dictionary
 * @description Provides dynamic options for parameter selection
 * @route GET /get-options-dictionary
 * @paramDef {"type":"getOptionsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering options."}
 * @returns {Object}
 * @sampleResult {"items":[{"label":"Option 1","value":"opt1","note":"ID: opt1"}],"cursor":null}
 */
async getOptionsDictionary(payload) {
  // Dictionary methods use single payload parameter (NOT destructured)
  const { search, cursor } = payload || {}
  const items = await this.fetchOptions({ search, cursor })

  return {
    items: items.map(item => ({
      label: item.displayName,
      value: item.id,
      note: `ID: ${item.id}`
    })),
    cursor: items.nextCursor
  }
}

// For dictionaries with dependencies
/**
 * @typedef {Object} getDependentOptionsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Parent ID","name":"parentId","required":true,"description":"The parent resource ID."}
 */

/**
 * @typedef {Object} getDependentOptionsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter options."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 * @paramDef {"type":"getDependentOptionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the parent resource."}
 */

/**
 * @registerAs DICTIONARY
 * @operationName Get Dependent Options Dictionary
 * @description Provides dynamic options based on parent selection
 * @route GET /get-dependent-options-dictionary
 * @paramDef {"type":"getDependentOptionsDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria for filtering dependent options."}
 * @returns {Object}
 * @sampleResult {"items":[{"label":"Sub-option 1","value":"sub1","note":"Parent: parent1"}],"cursor":null}
 */
async getDependentOptionsDictionary(payload) {
  const { search, cursor, criteria } = payload || {}
  const parentId = criteria?.parentId // Dependent parameter from criteria
  
  const items = await this.fetchDependentOptions({ parentId, search, cursor })
  
  return {
    items: items.map(item => ({
      label: item.displayName,
      value: item.id,
      note: `Parent: ${parentId}`
    })),
    cursor: items.nextCursor
  }
}
```

### OAuth2 System Methods

```javascript
/**
 * @registerAs SYSTEM
 * @route GET /getOAuth2ConnectionURL
 */
async getOAuth2ConnectionURL() {
  const params = new URLSearchParams({
    client_id: this.clientId,
    scope: 'required scopes',
    response_type: 'code'
  })
  return `${OAUTH_URL}/authorize?${params}`
}

/**
 * @registerAs SYSTEM
 * @route POST /executeCallback
 * @param {Object} callbackObject
 */
async executeCallback(callbackObject) {
  const tokenResponse = await this.exchangeCodeForToken(callbackObject.code)
  const userInfo = await this.getUserInfo(tokenResponse.access_token)

  return {
    token: tokenResponse.access_token,
    expirationInSeconds: tokenResponse.expires_in,
    refreshToken: tokenResponse.refresh_token,
    connectionIdentityName: userInfo.username,
    connectionIdentityImageURL: userInfo.avatar_url,
    overwrite: true
  }
}

/**
 * @registerAs SYSTEM
 * @route PUT /refreshToken
 * @param {String} refreshToken
 */
async refreshToken(refreshToken) {
  const response = await this.refreshAccessToken(refreshToken)
  return {
    token: response.access_token,
    expirationInSeconds: response.expires_in,
    refreshToken: response.refresh_token
  }
}

#getAccessToken() {
  return this.request.headers['oauth-access-token']
}
```

### Trigger Methods

#### REALTIME Trigger

```javascript
/**
 * @description Triggered when event occurs
 * @route POST /on-event
 * @operationName On Event
 * @registerAs REALTIME_TRIGGER
 *
 * @paramDef {"type":"String","label":"Resource","name":"resourceId","required":true,"dictionary":"getResourcesDictionary"}
 *
 * @returns {Object}
 * @sampleResult {"eventType":"created","resourceId":"123","data":{}}
 */
async onEvent() {}

/**
 * @registerAs SYSTEM
 * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
 * @returns {Object}
 */
async handleTriggerUpsertWebhook(invocation) {
  // Create webhooks or return eventScopeId
  return { webhookData: {}, eventScopeId: 'scope' }
}

/**
 * @registerAs SYSTEM
 * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
 * @returns {Object}
 */
async handleTriggerResolveEvents(invocation) {
  return {
    events: [{
      name: 'onEvent',
      data: invocation.body
    }]
  }
}

/**
 * @registerAs SYSTEM
 * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
 * @returns {Object}
 */
async handleTriggerSelectMatched(invocation) {
  return { ids: ['trigger-id-1'] }
}

/**
 * @registerAs SYSTEM
 * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
 * @returns {Object}
 */
async handleTriggerDeleteWebhook(invocation) {
  // Cleanup webhooks
  return {}
}
```

#### POLLING Trigger

```javascript
/**
 * @description Triggered when new items found. Polling interval can be customized (minimum 30 seconds).
 * @route POST /on-new-items
 * @operationName On New Items
 * @registerAs POLLING_TRIGGER
 *
 * @paramDef {"type":"String","label":"Source","name":"sourceId","required":true}
 *
 * @returns {Object}
 * @sampleResult {"id":"123","type":"item","data":{}}
 */
async onNewItems() {}

/**
 * @registerAs SYSTEM
 * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
 * @returns {Object}
 */
async handleTriggerPollingForEvent(invocation) {
  return this[invocation.eventName](invocation)
}

async onNewItems(invocation) {
  const { sourceId } = invocation.triggerData
  const currentItems = await this.fetchItems(sourceId)

  if (!invocation.state?.lastSeen) {
    return {
      events: [],
      state: { lastSeen: currentItems.map(i => i.id) }
    }
  }

  const previousIds = new Set(invocation.state.lastSeen)
  const newItems = currentItems.filter(item => !previousIds.has(item.id))

  return {
    events: newItems,
    state: { lastSeen: currentItems.map(i => i.id) }
  }
}
```

### Sample Result Loaders

```javascript
/**
 * @operationName Generate Content
 * @paramDef {"type":"Boolean","label":"Include Meta","name":"includeMeta","uiComponent":{"type":"TOGGLE"}}
 * @sampleResultLoader {"methodName":"generateContent_SampleResultLoader","dependsOn":["includeMeta"]}
 */
async generateContent(prompt, includeMeta) {
  // Implementation
}

/**
 * @registerAs SAMPLE_RESULT_LOADER
 * @route GET /generateContent_SampleResultLoader
 * @param {Object} payload
 */
async generateContent_SampleResultLoader({ criteria }) {
  const { includeMeta } = criteria

  if (includeMeta) {
    return {
      content: "Generated content",
      metadata: { tokens: 150, model: "gpt-4" }
    }
  }

  return "Simple generated content"
}
```

## Common Parameter Patterns

### Basic Types

```javascript
// String parameter
@paramDef {"type":"String","label":"Message","name":"message","required":true,"description":"Text to send"}

// Boolean with toggle
@paramDef {"type":"Boolean","label":"Send as Bot","name":"sendAsBot","uiComponent":{"type":"TOGGLE"}}

// Number with stepper
@paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"}}

// Array of strings
@paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"List of tags"}

// Dropdown with options — friendly plain-string labels (never [{label,value}] or objects-in-values).
// A dropdown submits the displayed string as-is; map label -> API value in code when they differ.
@paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["low","medium","high"]}}}
// e.g. show "Read"/"Write" but send "pull"/"push":
@paramDef {"type":"String","label":"Permission","name":"permission","uiComponent":{"type":"DROPDOWN","options":{"values":["Read","Write","Admin"]}}}
// body: { permission: this.#resolveChoice(permission, { Read:'pull', Write:'push', Admin:'admin' }) }

// Multi-line text
@paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"}}

// File selector
@paramDef {"type":"String","label":"File","name":"filePath","uiComponent":{"type":"FILE_SELECTOR"}}

// Date picker
@paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"}}
```

### Dependencies and Dictionaries

```javascript
// Parameter with dictionary
@paramDef {"type":"String","label":"Channel","name":"channelId","dictionary":"getChannelsDictionary","required":true}

// Dependent parameter
@paramDef {"type":"String","label":"Thread","name":"threadId","dictionary":"getThreadsDictionary","dependsOn":["channelId"]}

// Complex dependencies
@paramDef {"type":"String","label":"Column","name":"columnId","dictionary":"getColumnsDictionary","dependsOn":["documentId","sheetId"]}
```

### Schema Loaders

```javascript
// Dynamic object parameter
@paramDef {"type":"Object","label":"Settings","name":"settings","schemaLoader":"createSettingsSchema","dependsOn":["model"]}

/**
 * @registerAs SYSTEM
 * @paramDef {"type":"String","name":"model","required":true}
 * @returns {Object}
 */
async createSettingsSchema({ model }) {
  switch (model) {
    case 'advanced':
      return {
        type: 'object',
        properties: {
          quality: { type: 'string', enum: ['high', 'medium'] },
          format: { type: 'string', enum: ['json', 'xml'] }
        }
      }
    default:
      return { type: 'object', properties: {} }
  }
}
```

## Error Handling Pattern

```javascript
async methodName(param1, param2) {
  try {
    logger.debug(`[methodName] Starting with param1: ${param1}`)

    // Validate required parameters
    if (!param1) {
      throw new Error('param1 is required')
    }

    // API call
    const response = await Flowrunner.Request.post(url)
      .set(headers)
      .send(body)

    logger.debug(`[methodName] Success: ${response.id}`)
    return response

  } catch (error) {
    logger.error(`[methodName] Error: ${error.message}`)
    throw new Error(`Failed to execute method: ${error.message}`)
  }
}
```

## Flowrunner.Request Patterns

```javascript
// GET request
const response = await Flowrunner.Request.get(url).set({ Authorization: `Bearer ${token}` })

// POST request
const response = await Flowrunner.Request.post(url).set({ 'Content-Type': 'application/json' }).send(payload)

// Response is the body directly - no .status property
logger.debug(`Response received: ${JSON.stringify(response)}`)
```

### Conditional Body Handling

**Important:** `request.send(body)` returns a new promise. When body is conditional in `#apiRequest`, use early returns — do NOT call `.send()` as a side-effect.

```javascript
// ✅ Correct — early return when body is conditional
const request = Flowrunner.Request[method](url).set(headers).query(query)

if (body) {
  return await request.send(body)
}

return await request

// ❌ Wrong — .send() return value discarded, body is lost
const request = Flowrunner.Request[method](url).set(headers).query(query)

if (body) {
  request.send(body)  // Bug! Not awaited or returned
}

return await request  // Resolves without the body
```

## Typedef Patterns

### Return Type Typedef

```javascript
/**
 * @typedef {Object} CustomResponse
 * @property {String} id - Unique identifier
 * @property {String} name - Display name
 * @property {Boolean} active - Active status
 * @property {Array<String>} tags - Associated tags
 */

/**
 * @returns {CustomResponse}
 * @sampleResult {"id":"123","name":"Sample","active":true,"tags":["tag1"]}
 */
async getCustomData() {
  return {
    id: '123',
    name: 'Sample',
    active: true,
    tags: ['tag1']
  }
}
```

### Typed Array Parameter Typedef

When a method accepts an array of objects with a known schema, define a typedef for the element type
and reference it as `Array<TypeName>` (no dot) in the paramDef. This gives AI agents a clear schema instead of generic `Array<Object>`.

Use `Array<CustomType>` when the schema is **known and fixed**. Use `Array<Object>` when the schema is **dynamic or unknown**. Free-form array params get no `uiComponent`; add one only for enum value sets.

```javascript
/**
 * @typedef {Object} BillDetailLine
 * @property {String} Description - Line item description
 * @property {Number} Amount - Line amount
 * @property {String} Account - GL expense account number (e.g., '5100')
 * @property {String} InventoryID - Inventory item ID
 * @property {Number} Qty - Quantity
 * @property {Number} UnitCost - Cost per unit
 * @property {String} UOM - Unit of measure (e.g., 'EA', 'HR')
 */

/**
 * @operationName Create Bill
 * @category Bills
 * @description Creates a new bill with line item details.
 * @route POST /create-bill
 *
 * @paramDef {"type":"String","label":"Vendor","name":"vendor","required":true,"description":"The Vendor ID."}
 * @paramDef {"type":"Array<BillDetailLine>","label":"Detail Lines","name":"detailLines","description":"Array of bill detail line objects."}
 *
 * @returns {Object}
 * @sampleResult {"id":"000043","status":"Created"}
 */
async createBill(vendor, detailLines) {
  // detailLines arrives as an already-parsed array of objects — no JSON.parse needed
  const body = {
    Vendor: { value: vendor },
    Details: detailLines.map(line => ({
      Description: { value: line.Description },
      Amount: { value: line.Amount },
      Account: { value: line.Account },
    })),
  }

  return await this.#apiRequest({ url: `${this.apiBaseUrl}/Bill`, method: 'put', body, logTag: 'createBill' })
}
```
