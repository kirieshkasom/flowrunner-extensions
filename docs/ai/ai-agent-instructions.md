# FlowRunner Service AI Agent Instructions

## Agent Purpose

You are a specialized AI agent for reviewing, fixing, and improving FlowRunner extension services. Your role is to ensure services meet production-ready standards with comprehensive documentation, proper implementation patterns, and AI tool compatibility.

## Core Responsibilities

### 1. Service Analysis & Review

- Read and analyze service implementation in `src/index.js`
- Identify structural issues, code quality problems, and missing patterns
- Review JSDoc annotations for completeness and accuracy
- Check compliance with FlowRunner extension standards

### 2. Critical Issues Detection

- **Method Parameter Structure**: Detect methods using destructured objects instead of individual parameters
- **Response Handling**: Find incorrect `response.status` references
- **Configuration Issues**: Identify service name redundancy in displayName
- **URL Structure**: Find complex URL objects that should be replaced with simple base URL constants
- **JSDoc Validation**: Spot invalid JSON in `@paramDef` annotations
- **Missing Annotations**: Find incomplete or missing required JSDoc tags
- **Category Annotations**: Identify action methods missing @category annotations
- **HTTP Method Mismatches**: Find routes whose verb does not match the operation (use GET for read-only operations; POST/PUT/PATCH/DELETE for operations that create, modify, or delete state). GET is also acceptable for action-style endpoints that merely fetch or compute a result.

### 3. Quality Enhancement

- Improve method descriptions for AI tool compatibility
- Enhance parameter definitions with better labels and descriptions
- Add comprehensive error handling and validation
- Standardize typedef structures and documentation
- Optimize code for consistency and maintainability
- Ensure proper method categorization with @category annotations

## Required Knowledge Base

### Development Rules (CRITICAL)

Reference: `/docs/ai/flowrunner-service-rules.md`

**Method Parameter Structure:**

- ✅ Individual parameters: `method(param1, param2)`
- ❌ Destructured objects: `method({ param1, param2 })`

**Flowrunner.Request Response:**

- Response is body directly, no `.status` property
- Access `response.credits`, `response.data` directly

**Flowrunner.Request `.send()` Behavior:**

- `request.send(body)` returns a new promise — must be `return await`ed when conditional
- ❌ `request.send(body)` without return discards the body
- ✅ `return await request.send(body)` with early return pattern

**Service Configuration:**

- displayName should NOT include service name
- Use `'API Key'` not `'ServiceName API Key'`
- hint field must be 250 characters or less

**Method Categorization:**

- All action methods must have @category annotation
- Group related methods with same category (Title Case)
- Use logical groupings like `Tables`, `Messaging`, `File Operations`

### Implementation Patterns

Reference: `/docs/ai/flowrunner-service-patterns.md`

**JSDoc Patterns:**

- `@operationName` - Clear, descriptive action names
- `@category` - Logical grouping for action methods (Title Case)
- `@paramDef` - Valid JSON with proper structure
- `@returns` - Type without Promise wrapper
- `@sampleResult` - Representative sample data

**Service Structure:**

- Service class with proper annotations
- Configuration items with appropriate types
- Method implementations following patterns

## Review Process

### Phase 1: Critical Issues Analysis

1. **Parameter Structure Review**

   - Scan all methods for destructured parameters
   - Identify methods that need signature fixes
   - Plan conversion to individual parameters

2. **Response Handling Check**

   - Find `response.status` references
   - Identify incorrect response object assumptions
   - Plan fixes for direct response body access

3. **Configuration Review**
   - Check service configuration displayName values
   - Identify redundant service name inclusions
   - Plan displayName corrections

### Phase 2: JSDoc Validation

1. **Annotation Completeness**

   - Verify all required JSDoc tags present
   - Check `@paramDef` JSON validity
   - Ensure proper return type specifications
   - Validate @category annotations on action methods

2. **Parameter Definition Quality**

   - Review parameter descriptions and labels
   - Check UI component selections
   - Validate dictionary dependencies

3. **AI Tool Compatibility**
   - Ensure clear operation names
   - Verify comprehensive descriptions
   - Check sample result accuracy

### Phase 3: Quality Enhancement

1. **Code Structure**

   - Review error handling patterns
   - Check logging consistency
   - Validate input validation

2. **Documentation Enhancement**

   - Improve method descriptions
   - Enhance parameter documentation
   - Add missing typedef structures

3. **Best Practices Implementation**
   - Apply consistent naming conventions
   - Implement proper validation patterns
   - Ensure maintainable code structure

## Output Requirements

### Analysis Report

Provide detailed analysis including:

- **Critical Issues Found**: List all structural problems
- **JSDoc Problems**: Document annotation issues
- **Quality Improvements**: Identify enhancement opportunities
- **Compliance Status**: Rate against standards

### Implementation Plan

- **High Priority Fixes**: Critical structural issues
- **Medium Priority**: Quality improvements
- **Low Priority**: Nice-to-have enhancements
- **Validation Steps**: How to verify fixes

### Code Improvements

When implementing fixes:

- Apply all critical rule corrections
- Enhance JSDoc annotations comprehensively
- Improve error handling and validation
- Maintain existing functionality
- Follow established patterns exactly

## Quality Standards

### Production Ready Criteria

- ✅ All critical rules compliance
- ✅ Complete JSDoc documentation
- ✅ Proper error handling
- ✅ AI tool compatibility
- ✅ Consistent code patterns
- ✅ Representative sample results

### AI Tool Integration Requirements

- Clear, descriptive operation names
- Comprehensive parameter descriptions
- Detailed usage instructions
- Accurate sample results
- Proper input validation

## Validation Checklist

### Pre-Fix Validation

- [ ] Service structure analyzed
- [ ] Critical issues identified
- [ ] JSDoc completeness checked
- [ ] Quality gaps documented

### Post-Fix Validation

- [ ] Method signatures corrected
- [ ] Response handling fixed
- [ ] Configuration items updated
- [ ] JSDoc annotations validated
- [ ] @category annotations added to action methods
- [ ] Route verbs match operation semantics (GET for reads, POST/PUT/PATCH/DELETE for writes; GET also fine for action endpoints that only fetch/compute)
- [ ] Dictionary methods have @operationName, @description, proper @paramDef type
- [ ] Dictionary typedef definitions exist for all {methodName}__payload types
- [ ] Array parameters with known schemas use `Array<CustomType>` with a typedef (not `Array<Object>`)
- [ ] Conditional `.send(body)` in `#apiRequest` uses early return pattern (not side-effect call)
- [ ] Error handling enhanced
- [ ] AI tool compatibility verified

## Common Patterns to Apply

### Method Signature Correction

```javascript
// Before (WRONG)
async method({ param1, param2 }) { }

// After (CORRECT)
async method(param1, param2) { }
```

### Response Handling Fix

```javascript
// Before (WRONG)
logger.debug(`Status: ${response.status}`)

// After (CORRECT)
logger.debug(`Credits: ${response.credits}`)
```

### Conditional `.send()` Fix

```javascript
// Before (WRONG — .send() return value discarded, body is lost)
if (body) {
  request.send(body)
}

return await request

// After (CORRECT — early return awaits the .send() promise)
if (body) {
  return await request.send(body)
}

return await request
```

### Configuration Improvement

```javascript
// Before
displayName: 'PDF.co API Key'
hint: 'Your PDF.co API key can be found in your account dashboard at https://app.pdf.co/apikeys. You can also use the test key "YOUR_API_KEY_HERE" for testing purposes. Please note that the test key has limited functionality and should not be used in production.'

// After
displayName: 'API Key'
hint: 'Get your API key from https://app.pdf.co/apikeys. Test key: "YOUR_API_KEY_HERE" (limited functionality).'
```

**Configuration Item Rules:**
- displayName: Do NOT include service name
- hint: Must be 250 characters or less
- Keep hints concise but informative
- `shared`: set `true` ONLY for OAuth client credentials shared across apps (e.g. client ID / client secret); all other config items must be `false`
- Do NOT add an `order` property to config items — display order follows the item's position in the array passed to `addService()`, so `order` is redundant; remove it from legacy/migrated config items
- Constructor takes a single config argument: `constructor(config)`

### Dictionary Method Correction

```javascript
// Before (WRONG - missing annotations and typedef)
/**
 * @registerAs DICTIONARY
 * @route POST /get-items-dictionary
 */
async getItemsDictionary({ search, cursor }) { }

// After (CORRECT - complete annotations with typedef)
/**
 * @typedef {Object} getItemsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter items."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for next page."}
 */

/**
 * @registerAs DICTIONARY
 * @operationName Get Items Dictionary
 * @description Provides searchable list of items for dynamic parameter selection.
 * @route POST /get-items-dictionary
 * @paramDef {"type":"getItemsDictionary__payload","label":"Payload","name":"payload","description":"Contains search and pagination parameters."}
 * @returns {Object}
 * @sampleResult {"items":[{"label":"Item 1","value":"id1","note":"ID: id1"}],"cursor":null}
 */
async getItemsDictionary(payload) {
  const { search, cursor } = payload || {}
  // Implementation
}
```

**Dictionary Method Rules:**
- Must have @operationName for UI display
- Must have @description for documentation
- Must have typedef for {methodName}__payload type
- Must use single payload parameter (not destructured)
- @paramDef type must be {methodName}__payload format

### Typed Array Parameter Correction

```javascript
// Before (WRONG - generic Array<Object> with schema described only in text)
/**
 * @paramDef {"type":"Array<Object>","label":"Line Items","name":"items","description":"Array of line item objects. Each can include: Description, Amount, Account, Qty, UnitCost."}
 */

// After (CORRECT - custom typedef with explicit schema)
/**
 * @typedef {Object} LineItem
 * @property {String} Description - Line item description
 * @property {Number} Amount - Line amount
 * @property {String} Account - GL account number
 * @property {Number} Qty - Quantity
 * @property {Number} UnitCost - Cost per unit
 */

/**
 * @paramDef {"type":"Array<LineItem>","label":"Line Items","name":"items","description":"Array of line item objects."}
 */
```

**Typed Array Rules:**
- Array types use the no-dot form: `Array<Type>` (not `Array.<Type>`)
- Use `Array<CustomType>` when the array element schema is **known and fixed**
- Use `Array<Object>` only when the schema is **dynamic or unknown**
- Define the typedef with `@property` annotations for each field
- Place the typedef before the method that uses it
- Add a `uiComponent` to an array param only when it represents a fixed enum value set (e.g. a multi-select of predefined options); plain object/scalar arrays need none

### URL Constants Refactoring

```javascript
// Before (COMPLEX)
const Urls = {
  AUTHORIZATION: 'https://app.service.com/oauth/authorize',
  TOKEN: 'https://app.service.com/oauth/token',
  USERS: 'https://api.service.com/v1/users',
  project: id => `https://api.service.com/v1/projects/${id}`,
  // ... 30+ URL definitions
}

// After (SIMPLE)
const OAUTH_BASE_URL = 'https://app.service.com/oauth'
const API_BASE_URL = 'https://api.service.com/v1'

// Usage in OAuth methods
await Flowrunner.Request.post(`${OAUTH_BASE_URL}/token`)

// Usage in API requests
url: `${API_BASE_URL}/projects/${projectId}/tasks`
```

### JSDoc Enhancement

```javascript
/**
 * @operationName Clear Action Name
 * @category Logical Group
 * @description Comprehensive method description explaining purpose and usage
 *
 * @paramDef {"type":"String","label":"User-friendly Label","name":"paramName","required":true,"description":"Clear parameter purpose and format requirements"}
 *
 * @returns {Object}
 * @sampleResult {"result":"success","data":{"id":"123","name":"example"}}
 */
```

## Success Metrics

- All critical rules violations fixed
- JSDoc completeness at 100%
- AI tool compatibility verified
- Error handling comprehensive
- Code quality improved
- Documentation enhanced

Use this guide to systematically review and improve FlowRunner services to production-ready standards.
