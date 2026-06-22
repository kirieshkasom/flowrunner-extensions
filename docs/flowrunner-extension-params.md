# FlowRunner Parameter Definition Reference

> **Note**: For AI agents working on service review/improvement, use the consolidated guides in `/docs/ai/` folder as primary reference. This document provides detailed reference information.

## Parameter Definition Overview

**Critical**: All `@paramDef` annotations must contain valid JSON without syntax errors, trailing commas, or unquoted keys.

## Table of Contents

- [Overview](#overview)
- [@paramDef Properties Reference](#paramdef-properties-reference)
- [Basic Parameter Types](#basic-parameter-types)
- [UI Component Configuration](#ui-component-configuration)
- [Dictionary Integration](#dictionary-integration)
- [Parameter Validation](#parameter-validation)
- [Schema Loaders](#schema-loaders)
- [Advanced Patterns](#advanced-patterns)
- [Best Practices](#best-practices)
- [Sample Result Loaders](#sample-result-loaders)
- [Complete Examples](#complete-examples)

## Overview

FlowRunner extensions use JSDoc annotations to define method parameters that generate dynamic UI forms and provide validation. There are two main annotation types:

- `@param` - Standard JSDoc parameter documentation (used in OAuth and system methods)
- `@paramDef` - Defines parameters for FlowRunner UI generation with rich metadata

## @paramDef Properties Reference

The `@paramDef` annotation accepts a JSON object with the following properties:

### Core Properties

- **`type`** (required) - The parameter data type. Supported values:

  - `"String"` - Text input
  - `"Boolean"` - True/false values
  - `"Number"` - Numeric input
  - `"Array"` or `"Array<Type>"` - Arrays of values (e.g., `"Array<String>"`)
  - `"Object"` - Complex object structures
  - Custom types defined with `@typedef`

- **`name`** (required) - The parameter name used in the method signature and request payload. Must be a valid JavaScript identifier using camelCase.

- **`label`** (optional) - Display name shown in the UI. If not provided, the `name` is used. Should be user-friendly (e.g., "Channel ID" instead of "channelId").

- **`description`** (optional) - Detailed explanation of the parameter's purpose, format requirements, or usage notes. Displayed as help text in the UI.

- **`required`** (optional) - Boolean indicating if the parameter is mandatory. Default is `false`. When `true`, the UI prevents form submission without this field.

### UI Configuration

- **`uiComponent`** (optional) - Specifies the UI component type and configuration. Object with:
  - `type` - Component type: `"TOGGLE"`, `"DROPDOWN"`, `"MULTI_LINE_TEXT"`, `"NUMERIC_STEPPER"`, `"DATE_PICKER"`, `"FILE_SELECTOR"`, `"SINGLE_LINE_TEXT"` (default)
  - `options` - Component-specific options (e.g., dropdown values)
  - Additional component-specific properties (min, max, etc.)

### Dynamic Behavior

- **`dictionary`** (optional) - Name of a dictionary method that provides dynamic options for this parameter. The method must be registered with `@registerAs DICTIONARY`.

- **`dependsOn`** (optional) - Array of parameter names that this parameter depends on. The parameter is only shown/enabled when dependent parameters have values. Used with dictionaries for hierarchical data.

- **`schemaLoader`** (optional) - Name of a schema loader method that dynamically generates the parameter schema based on other parameter values. Used with Object-type parameters for dynamic forms.

### Advanced Properties

- **`defaultValue`** (optional) - Default value for the parameter when not provided by the user.

- **`validation`** (optional) - Additional validation rules beyond the basic `required` flag. Can include format patterns, value ranges, etc.

### Example with All Properties

```jsdoc
/**
 * @paramDef {
 *   "type": "String",
 *   "name": "channelId",
 *   "label": "Slack Channel",
 *   "description": "The Slack channel where the message will be sent. Use # for public channels or @ for direct messages.",
 *   "required": true,
 *   "dictionary": "getChannelsDictionary",
 *   "dependsOn": ["workspaceId"],
 *   "uiComponent": {
 *     "type": "DROPDOWN",
 *     "options": {"searchable": true}
 *   }
 * }
 */
```

## Basic Parameter Types

### String Parameters

Used for text inputs, IDs, URLs, and general text data.

```jsdoc
/**
 * @paramDef {"type":"String","label":"Channel Name","name":"channelName","required":true,"description":"The name of the Slack channel"}
 */
```

### Boolean Parameters

Used for toggle switches and true/false options.

```jsdoc
/**
 * @paramDef {"type":"Boolean","label":"Send as Bot","name":"sendAsBot","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Whether to send message as a bot"}
 */
```

### Number Parameters

Used for numeric inputs, counts, limits, and measurements.

```jsdoc
/**
 * @paramDef {"type":"Number","label":"Duration","name":"duration","required":false,"description":"Meeting duration in minutes, up to 720 minutes"}
 */
```

### Array Parameters

Used for lists of items or multiple selections.

Add a `uiComponent` to an array parameter **only when its values are an enum** (a fixed, known set of options), using a `DROPDOWN` with nested `options.values`. Free-form arrays — such as labels, ids, recipients, or locations — must **not** have a `uiComponent`; the user enters values directly.

Enum array (fixed set of options):

```jsdoc
/**
 * @paramDef {"type":"Array<String>","label":"Job Roles","name":"jobRoles","uiComponent":{"type":"DROPDOWN","options":{"values":["engineering","marketing","sales"]}}}
 */
```

Free-form array (no `uiComponent`):

```jsdoc
/**
 * @paramDef {"type":"Array<String>","label":"Recipients","name":"recipients","description":"List of recipient email addresses"}
 */
```

### Object Parameters

Used for complex structured data or dynamic schemas.

```jsdoc
/**
 * @paramDef {"type":"Object","label":"Model Settings","name":"modelSettings","required":false,"dependsOn":["model"],"schemaLoader":"createModelSettingsSchemaLoader"}
 */
```

## UI Component Configuration

### Toggle Components

For Boolean parameters that should display as switches.

```jsdoc
/**
 * @paramDef {"type":"Boolean","label":"Include Attachments","name":"includeAttachments","uiComponent":{"type":"TOGGLE"}}
 */
```

### Dropdown Components

For selection from predefined options.

```jsdoc
/**
 * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["low","medium","high","critical"]}}}
 */
```

**Friendly labels + code mapping.** A static dropdown submits the displayed string verbatim — there
is no separate label/value. So the `values` must be friendly, human-readable strings (never raw API
tokens), and the method code maps each to the API value. Use the nested plain-string form only — never
a top-level `[{label,value}]` array and never objects nested inside `values`.

When the friendly label already equals the API value (e.g. `["low","medium","high"]`), no mapping is
needed. When they differ (e.g. display `Read` but send `pull`), map in the method with a small helper:

```js
#resolveChoice(value, mapping) {
  if (value === undefined || value === null) return undefined
  return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
}
```

```jsdoc
/**
 * @paramDef {"type":"String","label":"Permission","name":"permission","uiComponent":{"type":"DROPDOWN","options":{"values":["Read","Write","Admin"]}},"description":"Access level to grant."}
 */
```
```js
// in the method body
const body = { permission: this.#resolveChoice(permission, { Read: 'pull', Write: 'push', Admin: 'admin' }) }
```

### Multi-line Text Areas

For longer text inputs like messages or descriptions.

```jsdoc
/**
 * @paramDef {"type":"String","label":"Message","name":"messageText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message content"}
 */
```

### Numeric Steppers

For number inputs with increment/decrement controls.

```jsdoc
/**
 * @paramDef {"type":"Number","label":"Number of Images","name":"numberOfImages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of images to generate (1-10)"}
 */
```

### Date Pickers

For date and time selection.

```jsdoc
/**
 * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Format: YYYY-MM-DD"}
 */
```

### File Selectors

For selecting files from FlowRunner File Service.

```jsdoc
/**
 * @paramDef {"type":"String","label":"File Path","name":"filePath","uiComponent":{"type":"FILE_SELECTOR"},"description":"Path to file in FlowRunner storage"}
 */
```

## Dictionary Integration

Dictionaries provide dynamic options for parameters, populated from external services or databases.

### Basic Dictionary Usage

```jsdoc
/**
 * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"Select a Slack channel"}
 */
```

### Dictionary with Dependencies

Parameters can depend on other parameters to provide contextual options.

```jsdoc
/**
 * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"Sheet within the selected document"}
 */
```

### Multi-level Dependencies

Complex dependency chains for hierarchical data.

```jsdoc
/**
 * @paramDef {"type":"String","label":"Column","name":"column","required":true,"dictionary":"getSheetColumnsDictionary","dependsOn":["documentId","sheetId"],"description":"Column within the selected sheet"}
 */
```

### Dictionary Payload Types

Define typed payloads for dictionary methods.

```jsdoc
/**
 * @paramDef {"type":"getChannelsDictionary__payload","label":"Payload","name":"payload","description":"Contains search and pagination parameters"}
 */
```

## Parameter Validation

### Required Parameters

Mark parameters as mandatory for form validation.

```jsdoc
/**
 * @paramDef {"type":"String","label":"Event Type","name":"eventType","required":true,"description":"Event type is mandatory"}
 */
```

### Conditional Requirements

Parameters can become required based on other parameter values.

```jsdoc
/**
 * @paramDef {"type":"String","label":"Bot Name","name":"botName","required":false,"description":"Required when 'Send as Bot' is enabled"}
 */
```

### Parameter Dependencies

Ensure parameters are filled in the correct order.

```jsdoc
/**
 * @paramDef {"type":"String","label":"Thread ID","name":"threadId","dependsOn":["channelId"],"dictionary":"getThreadsDictionary","description":"Thread within the selected channel"}
 */
```

## Schema Loaders

Schema loaders enable dynamic parameter schemas based on other parameter values.

### Basic Schema Loader

```jsdoc
/**
 * @paramDef {"type":"Object","label":"Model Settings","name":"modelSettings","dependsOn":["model"],"schemaLoader":"createModelSettingsSchemaLoader","description":"Model-specific configuration"}
 */
```

### Schema Loader Registration

Schema loaders must be registered as system methods.

```jsdoc
/**
 * @registerAs SYSTEM
 * @paramDef {"type":"String","name":"model","required":true}
 * @returns {Object}
 */
async createModelSettingsSchemaLoader({ model }) {
  switch (model) {
    case 'dall-e-3':
      return {
        type: 'object',
        properties: {
          style: { type: 'string', enum: ['vivid', 'natural'] },
          quality: { type: 'string', enum: ['standard', 'hd'] }
        }
      }
    case 'dall-e-2':
      return {
        type: 'object',
        properties: {
          response_format: { type: 'string', enum: ['url', 'b64_json'] }
        }
      }
    default:
      return { type: 'object', properties: {} }
  }
}
```

## Advanced Patterns

### Complex Dependency Chains

```jsdoc
/**
 * @paramDef {"type":"String","label":"Size","name":"size","dependsOn":["model"],"dictionary":"getSizeOptionsDictionary","description":"Available sizes depend on selected model"}
 * @paramDef {"type":"String","label":"Quality","name":"quality","dependsOn":["model"],"dictionary":"getQualityOptionsDictionary","description":"Quality options vary by model"}
 */
```

### Conditional UI Display

Parameters that appear/disappear based on other selections.

```jsdoc
/**
 * @paramDef {"type":"Boolean","label":"Use Advanced Options","name":"useAdvanced","uiComponent":{"type":"TOGGLE"}}
 * @paramDef {"type":"Object","label":"Advanced Settings","name":"advancedSettings","dependsOn":["useAdvanced"],"description":"Shown only when advanced options enabled"}
 */
```

### Array Parameters with Complex Options

A `uiComponent` belongs on an array parameter only when the values form an enum (fixed known set). The example below is valid because the industries are a fixed list.

```jsdoc
/**
 * @paramDef {"type":"Array<String>","label":"Company Industries","name":"industries","uiComponent":{"type":"DROPDOWN","options":{"values":["technology","healthcare","finance","manufacturing","retail","education"]}}}
 */
```

### Custom Type Definitions

Define complex object structures with typedef and reference them as parameter types.

#### Single Object Parameter

```jsdoc
/**
 * @typedef {Object} MessagePayload
 * @property {String} channel - Target channel ID
 * @property {String} text - Message text content
 * @property {Array} attachments - Message attachments
 * @property {Boolean} sendAsBot - Send as bot flag
 */

/**
 * @paramDef {"type":"MessagePayload","label":"Message Data","name":"messageData","description":"Complete message configuration"}
 */
```

#### Typed Array Parameter

When a method accepts an array of objects with a known schema, define a typedef for the array element type and reference it with `Array<TypeName>`. This provides a clear schema for AI agents and documentation tools, instead of the generic `Array<Object>`.

```jsdoc
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
 * @paramDef {"type":"Array<BillDetailLine>","label":"Detail Lines","name":"detailLines","description":"Array of bill detail line objects."}
 */
```

**When to use `Array<CustomType>` vs `Array<Object>`:**

- Use `Array<CustomType>` when the object schema is **known and fixed** — the typedef documents the exact fields, types, and descriptions for each property
- Use `Array<Object>` when the object schema is **dynamic or unknown** — the structure varies based on context or external configuration

## Best Practices

### 1. Consistent Naming Conventions

- Use camelCase for parameter names: `channelId`, `messageText`, `sendAsBot`
- Use descriptive labels: "Channel ID" instead of just "Channel"
- Keep names consistent across similar parameters in different methods

### 2. Comprehensive Descriptions

Always provide clear, helpful descriptions that explain:

- What the parameter does
- Expected format or constraints
- When the parameter is used

```jsdoc
/**
 * @paramDef {"type":"String","label":"Start Date","name":"startDate","description":"Meeting start date in YYYY-MM-DD format. Must be in the future and before end date."}
 */
```

### 3. Appropriate UI Components

Choose UI components that match the data type and user experience:

- `TOGGLE` for Boolean values
- `DROPDOWN` for predefined options
- `MULTI_LINE_TEXT` for longer text content
- `NUMERIC_STEPPER` for numeric ranges

### 4. Proper Validation

Use validation appropriately:

- Mark truly required parameters with `"required":true`
- Use `dependsOn` for parameters that need context
- Provide meaningful error messages in descriptions

### 5. Dictionary Best Practices

- Use consistent naming for dictionary methods: `getChannelsDictionary`, `getUsersDictionary`
- Implement proper dependency chains for hierarchical data
- Provide search and pagination support in dictionary methods

### 6. Schema Loader Guidelines

- Use schema loaders for truly dynamic parameter structures
- Keep schema loaders simple and focused
- Register schema loaders as SYSTEM methods
- Handle all possible input values gracefully

## Sample Result Loaders

Sample result loaders enable dynamic sample result generation based on parameter values, providing contextual examples in the UI instead of static `@sampleResult` values.

### Basic Sample Result Loader

```jsdoc
/**
 * @operationName Generate Text
 * @description Generates text using AI models
 *
 * @paramDef {"type":"Boolean","label":"Include Metadata","name":"includeMeta","uiComponent":{"type":"TOGGLE"},"description":"Include AI model metadata in response"}
 * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text prompt for generation"}
 *
 * @sampleResultLoader { "methodName":"generateText_SampleResultLoader", "dependsOn":["includeMeta"] }
 */
async generateText(prompt, includeMeta) {
  // Implementation
}
```

### Sample Result Loader Implementation

Sample result loaders must be registered as `SAMPLE_RESULT_LOADER` system methods:

```jsdoc
/**
 * @registerAs SAMPLE_RESULT_LOADER
 * @route POST /generateText_SampleResultLoader
 * @param {Object} payload
 */
async generateText_SampleResultLoader({ criteria }) {
  const { includeMeta } = criteria

  if (includeMeta) {
    return {
      lc: 1,
      kwargs: {
        usage_metadata: {
          total_tokens: 170,
          output_tokens: 82,
          input_token_details: {
            cache_read: 0,
            cache_creation: 88
          }
        },
        content: "Generated text response with metadata"
      }
    }
  }

  return "Simple generated text response"
}
```

### Advanced Sample Result Loader

For complex parameter dependencies and structure variations:

```jsdoc
/**
 * @operationName Generate Structured Text
 * @description Generates text with specific structure
 *
 * @paramDef {"type":"Object","label":"Response Structure","name":"structure","required":true,"schemaLoader":"createStructureSchema","description":"JSON schema for response structure"}
 * @paramDef {"type":"String","label":"Content Type","name":"contentType","required":true,"dictionary":"getContentTypesDictionary","description":"Type of content to generate"}
 *
 * @sampleResultLoader { "methodName":"generateStructuredText_SampleResultLoader", "dependsOn":["structure"] }
 */
async generateStructuredText(structure, contentType, prompt) {
  // Implementation
}
```

```jsdoc
/**
 * @registerAs SAMPLE_RESULT_LOADER
 * @route POST /generateStructuredText_SampleResultLoader
 * @param {Object} payload
 */
async generateStructuredText_SampleResultLoader({ criteria }) {
  const { structure } = criteria

  // Return the structure itself as the sample, showing the expected format
  return structure || {
    title: "Sample Title",
    description: "Sample description",
    tags: ["sample", "example"]
  }
}
```

### Sample Result Loader Properties

The `@sampleResultLoader` annotation accepts a JSON object with:

- **`methodName`** (required) - Name of the loader method that generates the sample result
- **`dependsOn`** (optional) - Array of parameter names that affect the sample result structure

### Sample Result Loader Best Practices

1. **Parameter-based variation** - Show different sample results based on key parameters that affect output structure
2. **Realistic examples** - Provide sample data that accurately represents actual service responses
3. **Handle all cases** - Ensure the loader method handles all possible parameter combinations gracefully
4. **Consistent naming** - Use `{methodName}_SampleResultLoader` naming convention for loader methods
5. **System registration** - Always register loader methods with `@registerAs SAMPLE_RESULT_LOADER`

### When to Use Sample Result Loaders

Use sample result loaders when:

- Method output structure varies significantly based on parameters
- Static `@sampleResult` doesn't provide adequate examples for all use cases
- Users need to understand how different parameter values affect the response format
- Complex objects or arrays with dynamic schemas are returned

## Complete Examples

### Basic Service Method

```jsdoc
/**
 * @operationName Send Channel Message
 * @description Sends a message to a Slack channel
 *
 * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"The Slack channel to send the message to"}
 * @paramDef {"type":"String","label":"Message","name":"messageText","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message content to send"}
 * @paramDef {"type":"Boolean","label":"Send as Bot","name":"sendAsBot","uiComponent":{"type":"TOGGLE"},"description":"Send the message as a bot user"}
 * @paramDef {"type":"String","label":"Bot Name","name":"botName","description":"Name of the bot (required when 'Send as Bot' is enabled)"}
 *
 * @returns {Object}
 * @sampleResult {"ok":true,"message_id":"1234567890.123456","channel":"C1234567890"}
 */
async sendChannelMessage(channelId, messageText, sendAsBot, botName) {
  // Implementation
}
```

### Advanced Method with Schema Loader

```jsdoc
/**
 * @operationName Generate AI Image
 * @description Generates images using AI models with dynamic configuration
 *
 * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the image to generate"}
 * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"AI model to use for generation"}
 * @paramDef {"type":"String","label":"Size","name":"size","dependsOn":["model"],"dictionary":"getSizeOptionsDictionary","description":"Image size (options depend on selected model)"}
 * @paramDef {"type":"Object","label":"Advanced Settings","name":"modelSettings","dependsOn":["model"],"schemaLoader":"createModelSettingsSchemaLoader","description":"Advanced model-specific configuration"}
 *
 * @returns {Object}
 * @sampleResult {"images":[{"url":"https://example.com/image1.png"}],"model":"dall-e-3","size":"1024x1024"}
 */
async generateImage(prompt, model, size, modelSettings) {
  // Implementation
}
```

### Dictionary Method

```jsdoc
/**
 * @registerAs DICTIONARY
 * @description Provides dynamic list of available channels
 *
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter channels by name"}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor"}
 *
 * @returns {Object}
 */
async getChannelsDictionary({ search, cursor }) {
  const channels = await this.fetchChannels({ search, cursor })

  return {
    items: channels.map(channel => ({
      label: `#${channel.name}`,
      value: channel.id,
      note: `ID: ${channel.id}`
    })),
    cursor: channels.nextCursor
  }
}
```

This comprehensive guide covers all patterns and best practices found across the FlowRunner extension services. Use these patterns to create consistent, user-friendly, and robust parameter definitions in your own services.
