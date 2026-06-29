# FlowRunner Service Development Rules

## Critical Development Rules

### Method Parameter Structure

- Methods with `@paramDef` annotations must use individual parameters, NOT destructured objects
- ✅ Correct: `parseInvoice(fileUrl, callback)`
- ❌ Incorrect: `parseInvoice({ fileUrl, callback })`
- All parameters must be listed individually in method signature

### Flowrunner.Request Response Handling

- `Flowrunner.Request` returns response body directly, not a response object
- ❌ Do NOT reference `response.status` - it doesn't exist
- ✅ Access properties directly: `response.credits`, `response.data`

### Binary File Download with Flowrunner.Request

- ✅ **Always use `.setEncoding(null)`** when downloading binary files (PDFs, images, documents)
- ✅ Correct: `await Flowrunner.Request.get(fileUrl).setEncoding(null)`
- ❌ Incorrect: `await Flowrunner.Request.get(fileUrl)` (will corrupt binary data)
- Example: 
```javascript
// Downloading a document/image/PDF
const documentResponse = await Flowrunner.Request.get(documentUrl).setEncoding(null)
const formData = new FormData()
formData.append('file', new Blob([documentResponse]), filename)
```

### Form Data Upload with Flowrunner.Request

- ✅ **Use `.form(formData)`** when sending FormData objects
- ✅ **Set Content-Type to 'multipart/form-data'** when using `.form()`
- ❌ **Do NOT use `.send(formData)`** for FormData - it won't work correctly
- ✅ Correct pattern:
```javascript
const formData = new FormData()
formData.append('file', new Blob([data]), filename)
const request = Flowrunner.Request.post(url)
  .set({ Authorization: 'Bearer token' })
request.form(formData)  // Use .form() for FormData
request.set({ 'Content-Type': 'multipart/form-data' })  // Set correct Content-Type
const response = await request
```
- ❌ Incorrect pattern:
```javascript
const response = await Flowrunner.Request.post(url)
  .set(headers)
  .send(formData)  // Wrong! Don't use .send() for FormData
```
- Complete example from #apiRequest:
```javascript
if (form) {
  request.form(form)
  request.set({ 'Content-Type': 'multipart/form-data' })
  return await request
} else if (body) {
  return await request.send(body)
}

return await request
```
- ⚠️ **`.send()` returns a new promise** — see [Conditional Body Handling](#conditional-body-handling-in-apirequest) below

### Service Configuration Items

- ❌ Do NOT include service name in `displayName` - it's already in context
- ✅ Correct: `displayName: 'API Key'`
- ❌ Incorrect: `displayName: 'PDF.co API Key'`
- **hint field must be 250 characters or less** - Keep hints concise and informative

### Icon File References

- ✅ **`@integrationIcon` must match the actual file in `public/`** - Confirm the real file name and extension
- ✅ Valid values: `/icon.png`, `/icon.svg`, `/icon.webp`, `/icon.jpeg` (whichever file actually exists)
- ❌ Do NOT change an existing `@integrationIcon` reference without verifying the file exists
- ❌ **Never inline the icon as a `data:` URI / base64 string** (e.g. `@integrationIcon data:image/svg+xml;base64,...`). The icon MUST be a real file in `public/` referenced by path. If you find a base64/`data:` icon, decode it and write it to `public/icon.<ext>` (extension matching the MIME type — `svg` for `image/svg+xml`, `png` for `image/png`, etc.), then point `@integrationIcon` at that file.
- ❗ Every service must have an icon file. If a service has no `@integrationIcon` and no `public/` icon at all, add one (a `public/icon.svg` placeholder is acceptable) and reference it.
- Example: If the service has `public/icon.svg`, use `@integrationIcon /icon.svg` - do not assume `/icon.png`

### Appearance Color Annotation

- ✅ **Correct format**: `@appearanceColor #1465FF #4B8FFF` (space-separated hex colors)
- ❌ **Incorrect format**: `@appearanceColor {"dark":"#1465FF","light":"#4B8FFF"}` (JSON format)
- First color is for dark theme, second is for light theme
- Example: `@appearanceColor #006BFF #0EE8F0`

### Route HTTP Method Rule

- **Use REST-appropriate verbs** - Choose the HTTP method that matches the operation's semantics
- ✅ `GET` for reads (fetching/listing/searching data) - allowed on regular action methods
- ✅ `POST` / `PUT` / `PATCH` / `DELETE` for writes (create, update, partial update, delete)
- ✅ Correct for a read method: `@route GET /searchContacts`
- ✅ Correct for a write method: `@route POST /enrichPerson`

**Rule summary:**
- `GET` → use for read operations; allowed on regular (non-SYSTEM) action methods
- `POST` / `PUT` / `PATCH` / `DELETE` → use for write operations as appropriate
- **OAuth SYSTEM methods keep fixed routes**: `getOAuth2ConnectionURL` = `GET`, `executeCallback` = `POST`, `refreshToken` = `PUT`

```javascript
// ✅ Correct - read method using GET
/**
 * @route GET /searchContacts
 */
async searchContacts(query) { }

// ✅ Correct - write method using POST
/**
 * @route POST /enrichPerson
 */
async enrichPerson(firstName, lastName, email) { }

// ✅ Correct - OAuth system method (fixed route)
/**
 * @registerAs SYSTEM
 * @route GET /getOAuth2ConnectionURL
 */
async getOAuth2ConnectionURL() { }
```

### Remove Paths Objects

- ❌ **Always remove** `Paths` objects with functions - they add unnecessary complexity
- ✅ **Use inline URL construction** directly in API calls
- ❌ Wrong pattern:
```javascript
const Paths = {
  FORM: '/forms',
  form: id => `/forms/${ id }`,
  entry: id => `/entries/${ id }`,
  formEntry: formId => `/forms/${ formId }/entries`
}

url: this.baseUrl + Paths.form(id)
```
- ✅ Correct pattern:
```javascript
// No Paths object needed - construct URLs inline
url: `${ this.baseUrl }/forms/${ id }`
url: `${ this.baseUrl }/entries/${ id }`
url: `${ this.baseUrl }/forms/${ formId }/entries`
```

### Normalize Legacy @paramDef Format

- ❌ **Always remove** legacy `@argsMappings` annotations and normalize `@paramDef` format
- ✅ **Convert to new format** with proper field names and uiComponent integration
- ❌ Legacy pattern:
```javascript
* @argsMappings {"Force":{"type":"TOGGLE"}}
* 
* @paramDef {"type":"Boolean","name":"Force","arg":"force","description":"Set to true to permanently delete."}
```
- ✅ New normalized pattern:
```javascript
* @paramDef {"type":"Boolean","label":"Force","name":"force","uiComponent":{"type":"TOGGLE"},"description":"Set to true to permanently delete."}
```
- **Transformation rules:**
  1. Remove `@argsMappings` line entirely
  2. Change `"name":"Force"` → `"label":"Force"` (display name)
  3. Change `"arg":"force"` → `"name":"force"` (parameter name)
  4. Add `"uiComponent":{"type":"TOGGLE"}` using the value from @argsMappings hashmap

### API Key Configuration Pattern

- If service requires API keys that are hardcoded in constructor, refactor to use config parameter
- ❌ Wrong pattern:
```javascript
class Asana {
  constructor() {
    this.clientId = FALLBACK_CLIENT_ID
    this.clientSecret = FALLBACK_CLIENT_SECRET
    this.scope = 'default'
  }
```
- ✅ Correct pattern:
```javascript
class Asana {
  constructor(config) {
    this.clientId = config.clientId || FALLBACK_CLIENT_ID
    this.clientSecret = config.clientSecret || FALLBACK_CLIENT_SECRET
    this.scope = 'default'
  }
```
- Add corresponding service configuration items for each API key/credential
- Keep hardcoded fallback values for backward compatibility
- Use descriptive `displayName` and `hint` properties for configuration items
- Configuration items must be defined in `Flowrunner.ServerCode.addService(ServiceClass, [configItems])` as second parameter, NOT as a method
- Example:
```javascript
Flowrunner.ServerCode.addService(ServiceClass, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true, // OAuth clientId/clientSecret in @requireOAuth services
    hint: 'OAuth2 Client ID for API integration.',
  },
])
```

### Standardized Logging Pattern

- Services must use only a standardized logger object 
- Replace all `logMessage`, `console.log`, `console.error`, etc. with the standard logger
- **For services with logger used in multiple files**: Update the central logger file (e.g., `logger.js`) to export the standardized pattern:
```javascript
const logger = {
  info: (...args) => console.log('[{Service Name} Service] info:', ...args),
  debug: (...args) => console.log('[{Service Name} Service] debug:', ...args),
  error: (...args) => console.log('[{Service Name} Service] error:', ...args),
  warn: (...args) => console.log('[{Service Name} Service] warn:', ...args),
}

module.exports = {
  logger,
}
```
- **For services with logger used only in index.js**: Define logger as a **constant outside the constructor**, not inside it:
```javascript
const logger = {
  info: (...args) => console.log('[{Service Name} Service] info:', ...args),
  debug: (...args) => console.log('[{Service Name} Service] debug:', ...args),
  error: (...args) => console.log('[{Service Name} Service] error:', ...args),
  warn: (...args) => console.log('[{Service Name} Service] warn:', ...args),
}

class ServiceName {
  constructor(config) {
    // No logger definition here
  }
  
  someMethod() {
    logger.debug('Using logger constant') // ✅ Correct
  }
}
```
- ❌ **Don't put logger in constructor**:
```javascript
class ServiceName {
  constructor(config) {
    this.logger = { ... } // ❌ Wrong - avoid this pattern
  }
}
```
- Replace `{Service Name}` with actual service name (e.g., `[Asana Service]`)
- Use appropriate log levels: `debug` for method payloads, `error` for exceptions, `warn` for non-critical issues, `info` for important operations
- Remove any previous logging patterns:
  - `const logger = Flowrunner.Logging.getLogger('Service Name')`
  - `this.logger = Flowrunner.Logging.getLogger('Service Name')`
  - `logMessage` imports/functions from utils
  - Any other custom logging implementations

### Standardized API Request Method Pattern

- Services must use a standardized `#apiRequest` private method for all external API calls
- Replace any existing methods like `#handleRequest`, `#makeRequest`, etc. with `#apiRequest`
- Standard method signature:
```javascript
async #apiRequest({ url, method, body, query, logTag }) {
  method = method || 'get'
  query = clean(query) // if clean utility is available
  
  try {
    logger.debug(`${logTag} - api request: [${method}::${url}] q=[${JSON.stringify(query)}]`)
    
    return await Flowrunner.Request[method](url)
      .set({
        // Service-specific headers (auth, content-type, etc.)
      })
      .query(query)
      .send(body)
  } catch (error) {
    this.handleError(error) // or appropriate error handling
  }
}
```
- All API calls should use: `await this.#apiRequest({ url, method, body, query, logTag })`
- Consistent parameter structure across all services
- Use appropriate `logTag` for debugging (usually the calling method name)
- Do NOT add `@private` JSDoc annotation - the `#` prefix already indicates private methods

### Conditional Body Handling in #apiRequest

- ⚠️ **`request.send(body)` returns a new promise** — you must `return await` it, not call it as a side-effect
- When body or form data is **conditional**, use an early return pattern for each branch
- ❌ **Wrong — `.send()` result is discarded, `return await request` resolves the original (body-less) request**:
```javascript
const request = Flowrunner.Request[method](url).set(headers).query(query)

if (body) {
  request.send(body)  // ❌ Return value not captured — body is lost!
}

return await request  // Resolves WITHOUT the body
```
- ✅ **Correct — early return awaits the promise returned by `.send()`**:
```javascript
const request = Flowrunner.Request[method](url).set(headers).query(query)

if (body) {
  return await request.send(body)  // ✅ Awaits the send() promise directly
}

return await request  // Only reached when there's no body
```
- ✅ **Also correct — chaining `.send()` unconditionally when body is always present**:
```javascript
return await Flowrunner.Request[method](url)
  .set(headers)
  .query(query)
  .send(body)  // ✅ Fine when body is always provided (even if undefined)
```
- The same rule applies to `.form()` — use early return when form data is conditional

### Absolute URLs in #apiRequest

- **#apiRequest method must receive absolute URLs** - Do not concatenate base URL inside the method
- **Use API_BASE_URL constant** for constructing complete URLs at call sites
- ❌ **Wrong pattern - URL concatenation inside #apiRequest**:
```javascript
async #apiRequest({ url, method, body, query, logTag }) {
  url = API_BASE_URL + url  // ❌ Don't concatenate inside method
  // rest of implementation...
}

// Called as:
await this.#apiRequest({ url: '/members/me/boards', logTag: 'getBoards' })
```
- ✅ **Correct pattern - absolute URLs at call sites**:
```javascript
async #apiRequest({ url, method, body, query, logTag }) {
  // No URL manipulation - receive complete URL directly
  method = method || 'get'
  // rest of implementation...
}

// Called as:
await this.#apiRequest({ url: `${API_BASE_URL}/members/me/boards`, logTag: 'getBoards' })
```
- **Benefits of absolute URLs**:
  - Explicit and clear what endpoint each call targets
  - Simpler #apiRequest method with no internal URL logic
  - Better debugging with full URLs visible at call sites
  - Consistent with template literal patterns

### URL Constants Pattern

- **Remove `Paths` objects entirely** - Always eliminate complex path objects with functions
- Replace complex URL objects with simple base URL constants
- Use only base URL constants:
```javascript
const OAUTH_BASE_URL = 'https://service.com/oauth'
const API_BASE_URL = 'https://api.service.com/v1'
```
- Construct URLs inline for OAuth methods:
```javascript
await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/token`)
return `${ OAUTH_BASE_URL }/authorize?${ params.toString() }`
```
- Construct URLs inline for API requests:
```javascript
const { data } = await this.#apiRequest({
  logTag: 'methodName',
  url: `${ API_BASE_URL }/endpoint/${ id }`,
})
```
- **For services with dynamic base URLs from config**: Construct full `baseUrl` in constructor, use inline paths:
```javascript
// ✅ Preferred for config-based dynamic URLs
constructor({ siteUrl, apiKey }) {
  this.baseUrl = siteUrl + '/wp-json/gf/v2'
  this.apiKey = apiKey
}

// Construct paths inline without Paths objects
url: `${ this.baseUrl }/forms/${ id }`
url: `${ this.baseUrl }/entries`
```
- **For hardcoded service URLs**: Use constants and inline construction:
```javascript
// ✅ Preferred for static service URLs
const API_BASE_URL = 'https://api.service.com/v1'

url: `${ API_BASE_URL }/endpoint/${ id }`
```
- **Remove complex URL object patterns**: Avoid `Paths` objects with functions, use inline URL construction instead
```javascript
// ❌ Avoid complex Paths objects
const Paths = {
  form: id => `/forms/${ id }`,
  entry: id => `/entries/${ id }`
}

// ✅ Use inline URL construction
url: `${ this.baseUrl }/forms/${ id }`
url: `${ this.baseUrl }/entries/${ id }`
```

### Remove Unnecessary Wrapper Functions

- **Remove wrapper functions that only make a single API call** without additional logic
- ❌ **Avoid unnecessary wrapper pattern**:
```javascript
async #getBoards() {
  return this.#apiRequest({ url: '/members/me/boards', logTag: 'getBoards' })
}

// Called as:
const boards = await this.#getBoards()
```
- ✅ **Use direct API calls instead**:
```javascript
const boards = await this.#apiRequest({ url: '/members/me/boards', logTag: 'getBoards' })
```
- **Move filter/find logic inline** where it's needed instead of separate wrapper functions
- ❌ **Avoid separate filter wrapper functions**:
```javascript
async #findBoardByName(idOrganization, name) {
  const boards = await this.#apiRequest({ url: `/organizations/${idOrganization}/boards`, logTag: 'getBoards' })
  return boards.find(board => board.name === name)
}
```
- ✅ **Use inline filter logic**:
```javascript
async findBoardByName(idOrganization, name) {
  const boards = await this.#apiRequest({ 
    url: `/organizations/${idOrganization}/boards`, 
    logTag: 'findBoardByName' 
  })
  return boards.find(board => board.name === name)
}
```
- **Keep wrapper functions only when they contain**:
  - Multiple API calls combined
  - Complex data transformation logic
  - Conditional logic beyond simple API calls
  - Error handling specific to that operation

## JSDoc Validation Rules

### Required Annotations

- `@integrationName` - Service display name
- `@description` - MANDATORY for ALL methods with @operationName - Must be comprehensive and informative**
- `@registerAs` - Method type: `DICTIONARY`, `SYSTEM`, `REALTIME_TRIGGER`, `POLLING_TRIGGER`, `SAMPLE_RESULT_LOADER`
- `@paramDef` - Must contain valid JSON, no syntax errors or trailing commas
- `@returns` - Return type without Promise wrapper
- `@sampleResult` - Static sample or use `@sampleResultLoader` (NOT for OAuth system methods)

### CRITICAL: @description Annotation Requirements

**NEVER SKIP @description ANNOTATIONS - This is essential for AI Agent Tools!**

- **MANDATORY**: Every method with `@operationName` MUST have a comprehensive `@description`
- **Quality Standards for @description**:
  - Must be 1-3 sentences that provide real value
  - Explain WHAT the method does and WHY/WHEN to use it
  - Include key capabilities, limitations, or requirements
  - Mention important features (pagination, filtering, rich text, etc.)
  - Help users who don't know the API understand the method's purpose
  
- ❌ **BAD descriptions (avoid these)**:
  - "Gets a page" (too vague)
  - "Creates database" (just repeats the name)
  - "Notion API call" (not helpful)
  - Missing descriptions entirely (CRITICAL ERROR)

- ✅ **GOOD descriptions (follow these patterns)**:
```javascript
/**
 * @operationName Create Page
 * @description Creates a new page in Notion as a child of an existing page or database. Supports rich content blocks including text, headings, lists, and embeds. The page title and content can be formatted with Notion's rich text capabilities.
 */

/**
 * @operationName Find or Create Database Item  
 * @description Searches for an existing database item by filter criteria and creates a new one if not found. Useful for maintaining unique records and preventing duplicates while ensuring data consistency.
 */
```

### @category Annotation Requirements

**@category groups related methods logically for better organization and discoverability**

- **MANDATORY for action methods**: Every method with `@operationName` (except SYSTEM, DICTIONARY, private methods, and sample result loaders) MUST have `@category`
- **Logical Grouping**: Methods that work with the same resource or feature should share the same category
- **Naming Convention**: Use Title Case (e.g., `Tables`, `Records`, `Comments`, `User Management`)
- **Consistency**: All related operations should use the same category name

- ✅ **GOOD category examples**:
```javascript
/**
 * @operationName Create Table
 * @category Tables
 * @description Creates a new data table in the database
 */

/**
 * @operationName Update Table
 * @category Tables
 * @description Updates an existing data table structure
 */

/**
 * @operationName Send Message
 * @category Messaging
 * @description Sends a message to a channel or user
 */

/**
 * @operationName Delete Message
 * @category Messaging
 * @description Deletes a message from a channel
 */
```

- ❌ **BAD category examples**:
  - Missing `@category` on action methods
  - Inconsistent category names for related methods
  - Using kebab-case instead of Title Case (`data-tables` vs `Tables`)
  - Over-specific categories that only have one method

### CRITICAL: @sampleResult Annotation Requirements

**@sampleResult provides action output samples for UI display and AI understanding**

- **MANDATORY for user-facing methods**: Every method with `@operationName` (except OAuth system methods) MUST have @sampleResult
- **Format Requirements**:
  - Must be SINGLE-LINE JSON (not multi-line)
  - Must be valid, parseable JSON or simple string
  - Should be realistic and representative of actual API responses
  - Keep concise but show key structure

- **OAuth System Methods Exception**:
  - `getOAuth2ConnectionURL` - NO @sampleResult needed
  - `executeCallback` - NO @sampleResult needed  
  - `refreshToken` - NO @sampleResult needed
  - These are internal system methods handled by the platform

- ❌ **WRONG format (multi-line)**:
```javascript
* @sampleResult {
*   "object": "page",
*   "id": "59833787-2cf9-4fdf-8782-e53db20768a5",
*   "created_time": "2022-03-01T19:05:00.000Z"
* }
```

- ✅ **CORRECT format (single-line)**:
```javascript
* @sampleResult {"object":"page","id":"59833787-2cf9-4fdf-8782-e53db20768a5","created_time":"2022-03-01T19:05:00.000Z","properties":{"title":{"title":[{"text":{"content":"Page Title"}}]}}}
```

### JSDoc Annotation Rules

- **Do NOT use `@private` annotation for `#` methods** - Methods starting with `#` are already private in JavaScript
- **DO use `@private` annotation for non-`#` methods** that should be treated as private (legacy private methods)
- **Do NOT use redundant annotations** - Avoid annotations that duplicate what's already clear from the code structure

### Parameter Definition Requirements

- `type` (required) - `String`, `Boolean`, `Number`, `Array<Type>`, `Array<CustomType>`, `Object`, custom typedef
  - **Array types use `Array<Type>` WITHOUT a dot** - e.g. `Array<String>`, `Array<Object>`, `Array<RecipientMetadata>`. Do NOT write `Array.<Type>` (with the dot).
  - **Typed arrays**: When an array parameter has a known, fixed object schema, define a `@typedef` for the element type and use `Array<TypeName>` instead of `Array<Object>`. This gives AI agents a clear schema. Use `Array<Object>` only when the schema is dynamic or unknown.
- `name` (required) - camelCase identifier
- `label` (optional) - User-friendly display name
- `required` (optional) - Boolean validation flag
- `dictionary` (optional) - String reference to DICTIONARY method
- `dependsOn` (optional) - Array of parameter dependencies
- `uiComponent` (optional) - UI component configuration object
  - **Array params get a `uiComponent` ONLY when their values are an enum (a fixed set)**. Free-form arrays (labels, ids, recipients, arbitrary strings) get NO `uiComponent`.
- **`description` (optional) - MUST be the last property** - Clear usage explanation
- **NOTE**: `min` and `max` properties are NOT supported - incorporate range information naturally into the description instead

### @paramDef Property Order Rule

- ❌ Wrong: `"description":"text","required":true`
- ✅ Correct: `"required":true,"description":"text"`
- **The `"description"` property must always be the last property in @paramDef**

## UI Component Types

- `TOGGLE` - Boolean values
- `DROPDOWN` - Predefined options nested as `"uiComponent":{"type":"DROPDOWN","options":{"values":[...]}}` — the `values` array of friendly plain-string labels lives **inside `options`**, never directly under `uiComponent` (never a `[{label,value}]` array or objects-in-`values`); map the label to the API value in code when they differ
- `MULTI_LINE_TEXT` - Long text content
- `NUMERIC_STEPPER` - Number inputs with controls (accepted for Number type parameters)
- `DATE_PICKER` - Date selection
- `FILE_SELECTOR` - FlowRunner file selection
- Default: `SINGLE_LINE_TEXT`

### Number Parameter Requirements

- **`"type":"Number"` with `"uiComponent":{"type":"NUMERIC_STEPPER"}` is correct and accepted** for Number inputs
- **Do NOT use `min` or `max` properties** - These are not supported
- **Include range information naturally in description** - e.g., "typically between 1 and 100" or "can be up to 1000 items"

## Dictionary Methods

- Must be registered as `@registerAs DICTIONARY`
- **Must have `@operationName`** - Required for display name in UI
- **Must have `@description`** - Required description of the dictionary
- **Must have `@route POST /get-[method-name-pattern]`** - All dictionary methods require POST route annotation
- **Must have `@paramDef`** with special type format: `{"type":"{methodName}__payload","label":"Payload","name":"payload","description":"..."}`
- **Must define typedef for payload type** - Each `{methodName}__payload` type must be defined with `@typedef` annotations
- **Must have `@returns {Object}`** - Required return type
- **Must have `@sampleResult`** - Required sample output with items array format
- **Must accept only ONE parameter called `payload`**
- Input payload: `{search?, cursor?, criteria?}`
- **Dependent parameters come inside `criteria` object**: `criteria.formId`, `criteria.channelId`, etc.
- Output: `{items: [{label, value, note}], cursor?}`

### Dictionary Property Format

- ❌ Wrong format: `"dictionary":{"methodName":"getChannelsDictionary"}`
- ✅ Correct format: `"dictionary":"getChannelsDictionary"`
- Dictionary property is a **string** containing just the method name

### Dictionary vs DependsOn

**CRITICAL DISTINCTION - These serve completely different purposes:**

- **`dictionary`**: References a DICTIONARY method to populate dropdown options
  - Used when you want a parameter to show a dropdown list populated by a dictionary method
  - Value is a string with the dictionary method name
  - Example: `"dictionary":"getListsDictionary"` - populates dropdown with lists

- **`dependsOn`**: Specifies field dependencies for conditional logic
  - Used when one field's value or availability depends on another field being filled
  - Value is an array of parameter names that must be filled first
  - Example: `"dependsOn":["formId"]` - this field only appears after formId is selected

### Dictionary Usage Examples

```javascript
// Simple dictionary reference (populates dropdown)
* @paramDef {"type":"String","label":"List","name":"listId","dictionary":"getListsDictionary"}

// Dictionary with field dependency (dropdown that depends on another field)
* @paramDef {"type":"String","label":"Member","name":"memberId","dictionary":"getMembersDictionary","dependsOn":["listId"]}

// Field dependency without dictionary (text field that depends on another field)
* @paramDef {"type":"String","label":"Custom Value","name":"customValue","dependsOn":["enableCustom"]}
```

**Common Mistakes to Avoid:**
- ❌ Using `"dependsOn":"getDictionaryMethod"` - dependsOn is for field names, not method names
- ❌ Using `"dictionary":["fieldName"]` - dictionary is a string method name, not an array
- ✅ Use `"dictionary":"methodName"` for dropdown population
- ✅ Use `"dependsOn":["fieldName"]` for field dependencies

### Dictionary Method Implementation

**IMPORTANT: Dictionary methods require typedef definitions for their payload types!**

```javascript
// First, define the typedef for the payload type (place after class declaration)
/**
 * @typedef {Object} getFormsListDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter forms by name. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */

// Then implement the dictionary method with proper annotations
/**
 * @registerAs DICTIONARY
 * @operationName Get Forms List Dictionary
 * @description Provides a searchable list of forms for dynamic parameter selection.
 * @route POST /get-forms-list-dictionary
 * @paramDef {"type":"getFormsListDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering forms."}
 * @returns {Object}
 * @sampleResult {"items":[{"label":"Contact Form","value":"form_123","note":"ID: form_123"}],"cursor":null}
 */
async getFormsListDictionary(payload) {
  const { search, cursor, criteria } = payload || {}
  // Implementation...
  return { items: [...], cursor: null }
}

// For dictionaries with dependencies, define typedef with criteria
/**
 * @typedef {Object} getFormEntriesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"description":"The form ID to retrieve entries from."}
 */

/**
 * @typedef {Object} getFormEntriesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter entries."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 * @paramDef {"type":"getFormEntriesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the specific form."}
 */

/**
 * @registerAs DICTIONARY
 * @operationName Get Form Entries Dictionary
 * @description Provides a searchable list of form entries for dynamic parameter selection.
 * @route POST /get-form-entries-dictionary
 * @paramDef {"type":"getFormEntriesDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria for filtering form entries."}
 * @returns {Object}
 * @sampleResult {"items":[{"label":"Entry #001","value":"entry_456","note":"Submitted: 2024-01-15"}],"cursor":null}
 */
async getFormEntriesDictionary(payload) {
  const { search, cursor, criteria } = payload || {}
  const formId = criteria?.formId // Dependent parameter comes in criteria
  // Implementation...
  return { items: [...], cursor: null }
}
```

## OAuth2 System Methods (Required)

- `getOAuth2ConnectionURL` - Authorization URL (NO @sampleResult needed)
- `executeCallback` - Token exchange and user info (NO @sampleResult needed)
- `refreshToken` - Token refresh logic (NO @sampleResult needed)

**Note**: OAuth2 system methods should NOT have @sampleResult annotations as they are internal system methods handled by the platform.

## Trigger System Methods

### REALTIME Triggers

- `handleTriggerUpsertWebhook` - Create/update webhooks
- `handleTriggerResolveEvents` - Process incoming events
- `handleTriggerSelectMatched` - Filter relevant triggers
- `handleTriggerDeleteWebhook` - Cleanup webhooks
- Optional: `handleTriggerRefreshWebhook`

### POLLING Triggers

- `handleTriggerPollingForEvent` - State-based event detection
- Include "Polling interval can be customized (minimum 30 seconds)" in description

## Code Quality Standards

- Use try-catch for external API calls
- **Do NOT wrap dictionary methods with try/catch** - Let errors propagate to FlowRunner for proper handling
- Log with context using logger methods
- Never log sensitive data (tokens, secrets)
- Return consistent object structures
- Use meaningful property names
- Follow camelCase naming conventions

## Service Architecture

- Services in `services/{service-name}/`
- Entry point: `src/index.js`
- All changes within service folder scope
- Icon file in `public/` referenced by `@integrationIcon` (see Icon File References)
- Proper error handling with meaningful messages

### Constructor Pattern

- **Use `constructor(config)` only** - The service constructor receives a single `config` argument
- ❌ Do NOT add a `context` argument or a `this.backendless` reference
- Read all credentials/settings from `config` (e.g. `config.apiKey`, `config.clientId`)

```javascript
class ServiceName {
  constructor(config) {
    this.apiKey = config.apiKey
  }
}
```

### package.json

- **Keep it minimal**:
```json
{
  "name": "flowrunner-service",
  "version": "1.0.0",
  "scripts": {},
  "devDependencies": {},
  "license": "MIT"
}
```
- **`scripts` is ALWAYS `{}`** - Do NOT add debug/deploy/coderunner/docs scripts
- Add a real `dependencies` block ONLY when the service actually needs npm packages

### coderunner.js

- **New services do NOT have a `coderunner.js`** - There is no root `coderunner` helper to extend
- Do NOT create a `coderunner.js` for new services
- A `coderunner.js` found in some services is legacy-only and not required

### Files API

- **Upload generated/fetched files with `this.flowrunner.Files.uploadFile`** and pass `generateUrl: true` to get back a URL:
```javascript
const { url } = await this.flowrunner.Files.uploadFile(buffer, {
  // ...path / name options...
  generateUrl: true,
})
```

## AI Agent Tool Requirements

- Clear, descriptive `@operationName` values
- **MANDATORY: Comprehensive `@description` annotations for EVERY method**
- Detailed parameter definitions with labels/descriptions
- Representative `@sampleResult` or `@sampleResultLoader`
- Well-documented return types and structures

## MANDATORY VERIFICATION CHECKLIST

**Before marking ANY service as "fixed", MUST verify:**

### Critical JSDoc Requirements
- [ ] **ALL methods with @operationName have @description** (NEVER skip this!)
- [ ] All @description annotations are comprehensive (1-3 informative sentences)
- [ ] **ALL action methods have @category** (except SYSTEM, DICTIONARY, private methods)
- [ ] Related methods use the same @category for logical grouping
- [ ] **ALL user-facing methods have @sampleResult** (single-line JSON format)
- [ ] **OAuth methods do NOT have @sampleResult** (getOAuth2ConnectionURL, executeCallback, refreshToken)
- [ ] All @sampleResult are single-line valid JSON (not multi-line)
- [ ] All @registerAs DICTIONARY methods have @route POST annotations
- [ ] All routes use REST-appropriate verbs (GET for reads, POST/PUT/PATCH/DELETE for writes); OAuth SYSTEM methods keep fixed routes
- [ ] All DICTIONARY methods use single "payload" parameter (not destructured)
- [ ] All @paramDef have "description" as last property
- [ ] No @argsMappings exist (should be normalized to uiComponent)
- [ ] No @private annotations on # methods

### Standardization Requirements
- [ ] Standardized logger pattern with service-specific prefix
- [ ] Standardized #apiRequest method with absolute URLs
- [ ] No Paths objects (inline URL construction only)
- [ ] No unnecessary wrapper functions (direct API calls)
- [ ] **All endpoints defined in index.js** (no external imports from constants.js)
- [ ] **Uncomment and fix service configuration items** (if commented out)
- [ ] Service config items don't include service name in displayName
- [ ] Every config item has a `shared` property (`shared:true` only for OAuth clientId/clientSecret; `shared:false` otherwise)
- [ ] Icon file reference (`@integrationIcon`) matches the actual file in public/ (/icon.png, /icon.svg, /icon.webp, /icon.jpeg)

**NEVER consider a service "fixed" without completing this FULL checklist.**

### Service Configuration Items Requirements

- **Uncomment commented configuration items** - If config items are commented out, uncomment them first, then review/fix
- **displayName format**: Do NOT include service name (✅ "Client ID" ❌ "Notion Client ID")
- **`shared` property is required on every config item**:
  - `shared: true` ONLY for OAuth `clientId` / `clientSecret` in `@requireOAuth` services
  - `shared: false` for everything else (API keys, site URLs, secrets, etc.)
- **No `order` property** - Do NOT add an `order` property to config items. Display order is dictated by the position of each item in the array passed to `addService()`, so `order` is redundant — never add it, and remove it from legacy/migrated config items.
- **Typical properties**: `name`, `displayName`, `type`, `required`, `shared`, `hint`
- **Helpful hints**: Include clear instructions with URLs when possible (max 250 characters)
- **Required validation**: Use `required: true` for essential configuration
- **Hint length limit**: Must be 250 characters or less

### All Endpoints Must Be in index.js

- **NO external endpoint imports** - Remove imports like `const { oauthToken, oauthEndpoint } = require('./constants')`
- **Define endpoints directly in index.js** - All URLs must be constants in the main service file
- ❌ **Wrong pattern**:
```javascript
const { oauthToken, oauthEndpoint, defaultScopes } = require('./constants')
```
- ✅ **Correct pattern**:
```javascript
const OAUTH_BASE_URL = 'https://api.hubapi.com/oauth'
const API_BASE_URL = 'https://api.hubapi.com'

const DEFAULT_SCOPE_LIST = [
  'oauth',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.companies.read',
  'crm.objects.companies.write',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

// Usage in methods:
// ${OAUTH_BASE_URL}/authorize
// ${OAUTH_BASE_URL}/v1/token  
// ${API_BASE_URL}/contacts/v1/contact
```
- **Benefits**: Self-contained service files, no external dependencies, easier maintenance

### REST API Services - No Separate API Files

- **REST API services must NOT use separate api.js files** - All API logic should be in the main service file
- **Use standardized #apiRequest method directly in service class** - No wrapper API client classes needed
- ❌ **Wrong pattern**:
```javascript
// Separate api.js file
const TransactionalClientApi = require('./api')

class MailchimpTransactionalService {
  constructor(config) {
    this.transactionalClientApi = new TransactionalClientApi(config.apiKey)
  }
  
  sendMessage() {
    return this.transactionalClientApi.sendMessage()
  }
}
```
- ✅ **Correct pattern**:
```javascript
// All in index.js
const API_BASE_URL = 'https://api.service.com/v1'

class MailchimpTransactionalService {
  constructor(config) {
    this.apiKey = config.apiKey
  }
  
  async #apiRequest({ url, method, body, logTag }) {
    // Standard implementation
  }
  
  sendMessage() {
    return this.#apiRequest({ url: `${API_BASE_URL}/send`, logTag: 'sendMessage' })
  }
}
```
- **Benefits**: Simpler architecture, fewer files, easier maintenance, consistent patterns across services

### OAuth Scope Format Pattern

- **Use array format for scopes** - Define scopes as an array, then join to string
- **Scopes are hardcoded, NOT configurable** - No need for scopes as a config item
- **Standard pattern**:
```javascript
const DEFAULT_SCOPE_LIST = [
  'scope1',
  'scope2',
  'scope3',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')
```
- **Constructor usage**:
```javascript
class ServiceName {
  constructor(config) {
    this.clientId = config.clientId || FALLBACK_CLIENT_ID
    this.clientSecret = config.clientSecret || FALLBACK_CLIENT_SECRET
    this.scopes = DEFAULT_SCOPE_STRING  // Hardcoded, not from config
  }
}
```
- **Configuration**: Only include `clientId` and `clientSecret` config items, NOT scopes
- **Benefits**: Readable scope list, easy to modify individual scopes, consistent format, secure permissions

### URL Construction - Use Inline When Possible

- **Prefer inline URL construction** over separate constants when URLs are used only once
- **Only create constants for reused base URLs**
- ❌ **Avoid unnecessary constants**:
```javascript
const OAUTH_ENDPOINT = `${OAUTH_BASE_URL}/oauth2/authorize`
const OAUTH_TOKEN_ENDPOINT = `${OAUTH_BASE_URL}/oauth2/token`
const OAUTH_METADATA_ENDPOINT = `${OAUTH_BASE_URL}/oauth2/metadata`

// Used only once each
return await Flowrunner.Request.post(OAUTH_TOKEN_ENDPOINT)
return `${OAUTH_ENDPOINT}?${params.toString()}`
return await Flowrunner.Request.get(OAUTH_METADATA_ENDPOINT)
```
- ✅ **Use inline construction**:
```javascript
const OAUTH_BASE_URL = 'https://login.service.com'

// Construct directly where needed
return await Flowrunner.Request.post(`${OAUTH_BASE_URL}/oauth2/token`)
return `${OAUTH_BASE_URL}/oauth2/authorize?${params.toString()}`
return await Flowrunner.Request.get(`${OAUTH_BASE_URL}/oauth2/metadata`)
```
- **Benefits**: Fewer unused constants, cleaner code, direct visibility of endpoints
