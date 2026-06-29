# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the FlowRunner Extensions repository, containing services that integrate third-party APIs with FlowRunner. Services are **FlowRunner-native** and independent of Backendless: they use the `Flowrunner.*` runtime (`Flowrunner.Request`, `Flowrunner.ServerCode`, `Flowrunner.Files`), are built directly in this repo, and are deployed and tested in FlowRunner.

> Historical note: these services were once built in a separate Backendless repo and converted with the `/migrate-service` command. That command remains only for legacy Backendless code that occasionally needs porting; new services are written in FlowRunner-native format from the start (see the `flowrunner-service-engineer` agent).

## Common Development Commands

- **Linting**: `npm run lint` - Runs `eslint . --fix` (config: `.eslintrc.json`, extends `eslint-config-backendless`). Note: this lints/auto-fixes the **whole** repo; to avoid reformatting unrelated services, scope it with `npx eslint services/<name> --fix`. Some legacy services are not yet in the house style and a full `npm run lint` will rewrite them.

## Architecture & Structure

### FlowRunner Extensions

The main services are located in `services/`, each with this exact layout:

- `src/index.js` - Entire service implementation with JSDoc annotations
- `package.json` - Minimal; `scripts` is always `{}`. Add a `dependencies` block only when the service needs npm packages (most are zero-dep)
- `public/icon.{png|svg|webp|jpeg}` - Service icon
- `README.md` - Service documentation

New services do **not** include a `coderunner.js`, and there is no root coderunner helper in this repo. (A few legacy services still carry a `coderunner.js`; ignore it for new work.)

Minimal `package.json`:

```json
{
  "name": "flowrunner-service",
  "version": "1.0.0",
  "scripts": {},
  "devDependencies": {},
  "license": "MIT"
}
```

### Service Development Patterns

#### JSDoc Annotations for Services

- `@integrationName` - Display name in the FlowRunner UI
- `@integrationIcon` - Path to the icon file in `public/` (e.g. `/icon.png`, `/icon.svg`, `/icon.webp`); must match the actual file. Not base64.
- `@requireOAuth` - Indicates OAuth2 authentication required
- `@integrationTriggersScope` - Trigger scope (`SINGLE_APP` or `ALL_APPS`)
- `@usesFileStorage` - REQUIRED whenever the service calls the Files API (`this.flowrunner.Files.*`); without it file storage is never provisioned and Files calls fail at runtime

#### Method Annotations

- `@registerAs` - Method type: `DICTIONARY` (for dynamic options), `SYSTEM` (internal), `REALTIME_TRIGGER`, `POLLING_TRIGGER`, `SAMPLE_RESULT_LOADER`, `PARAM_SCHEMA_DEFINITION` (dynamic Object-parameter schemas, paired with `schemaLoader` in a `@paramDef`)
- `@description` - Method description
- `@route` - HTTP method and URI. Use REST-appropriate verbs: `GET` for reads (allowed on regular action methods), `POST`/`PUT`/`PATCH`/`DELETE` for writes (e.g. `POST /send-message`, `GET /search`). SYSTEM OAuth methods have fixed routes (see OAuth2 Integration).
- `@paramDef` - Method arguments with validation and UI config
- `@returns` - Return type specification
- `@sampleResult` - Sample output for documentation
- `@sampleResultLoader` - Dynamic sample result generation based on parameter values
- `@operationName` - Display name in FlowRunner UI
- `@appearanceColor` - Action color (two hex values)
- `@executionTimeoutInSeconds` - Extended execution limits

#### Service Configuration Items

Services can define config items during registration with properties:

- `name` - Configuration key
- `displayName` - UI label (do NOT include the service name)
- `shared` - **Required on every config item.** `true` ONLY for OAuth `clientId`/`clientSecret` in `@requireOAuth` services; `false` for everything else (API keys, webhook secrets, account IDs, etc.)
- `defaultValue` - Default value
- `type` - Input type from `Flowrunner.ServerCode.ConfigItems.TYPES` (`STRING`, `BOOL`, `DATE`, `CHOICE`, `TEXT`)
- `required` - Boolean validation
- `hint` - Help text
- `options` - For `CHOICE` type (array of strings)

There is no `order` property. The display order of config items is dictated by their position in the array passed to `addService()`, so an explicit `order` is unnecessary — never add one, and strip it from any legacy/migrated config items.

### Key Development Areas

#### OAuth2 Integration

Services requiring OAuth2 must implement three system methods:

- `getOAuth2ConnectionURL` - Returns authorization URL for account connection
- `executeCallback` - Handles OAuth callback and returns access token data
- `refreshToken` - Refreshes expired access tokens

OAuth2 services include: Airtable, Google Drive, Gmail, Google Sheets, X-Twitter

#### Trigger Systems

Services can implement two types of triggers:

**REALTIME Triggers**:

- `SINGLE_APP` - Creates webhooks for each application individually
- `ALL_APPS` - Uses single callback URL for all applications with event filtering
- Required methods: `handleTriggerUpsertWebhook`, `handleTriggerResolveEvents`, `handleTriggerSelectMatched`, `handleTriggerDeleteWebhook`
- Optional: `handleTriggerRefreshWebhook`

**POLLING Triggers**:

- Periodically checks for new data by comparing states
- Required method: `handleTriggerPollingForEvent`
- Maintains state between polling cycles

#### UI Component Types for Method Parameters

- `CHECKBOX`/`TOGGLE` - For Boolean values
- `NUMERIC`/`NUMERIC_STEPPER` - For Number inputs
- `DATE_PICKER`/`DATE_TIME_PICKER` - For timestamp selection
- `DROPDOWN` - For predefined value selection
- `MULTI_LINE_TEXT`/`SINGLE_LINE_TEXT` - For String inputs
- `FILE_SELECTOR` - For FlowRunner file selection

#### Dictionary Methods

Dynamic parameter options use `DICTIONARY` methods with standardized input/output:

- Input: `{search?, cursor?, criteria?}`
- Output: `{items: [{label, value, note}], cursor?}`

#### Sample Result Loaders

Dynamic sample result generation using `@sampleResultLoader` annotation:

- References loader methods that generate contextual sample results based on parameter values
- Loader methods must be registered as `SAMPLE_RESULT_LOADER` system methods
- Properties: `methodName` (required), `dependsOn` (array of parameter names)
- Enables UI to show different sample results based on parameter combinations
- Used when method output structure varies significantly based on input parameters

#### Schema Loaders

Dynamic parameter schema generation using `schemaLoader` property in `@paramDef`:

- Enables dynamic form generation based on other parameter values
- Schema loader methods must be registered as `SYSTEM` methods
- Used with Object-type parameters for conditional form structures
- Returns JSON Schema objects defining available parameters

### Code Quality

- **Code Formatting**: Prettier for code formatting (configured with specific rules)
- **Pre-commit Hooks**: Husky pre-commit hooks for formatting
- **Linting**: Code quality maintained through consistent formatting

### Deployment Context

- Services are FlowRunner-native and are deployed and tested in FlowRunner.
- Each service is self-contained in `services/{name}/`; there is no root deployment config or cluster configuration in this repo, and new services do not include a `coderunner.js`.
- The legacy Backendless cluster/Cloud Code deployment model (CloudUS/Stage/DevTest/Local clusters, `coderunner-local.js`, marketplace "Pending Products" approval) no longer applies to new work.

## Claude Code

This section provides comprehensive guidance for Claude Code sessions on FlowRunner extension development.

### AI Agent Documentation (Primary Reference)

**All AI agents should primarily reference these consolidated guides:**

- **`/docs/ai/flowrunner-service-rules.md`** - Critical development rules including:

  - Method parameter structure requirements
  - Flowrunner.Request response handling
  - Service configuration standards
  - JSDoc validation rules

- **`/docs/ai/flowrunner-service-patterns.md`** - Implementation patterns including:

  - Complete JSDoc annotation examples
  - Service class structure patterns
  - OAuth2, trigger, and dictionary method implementations
  - Error handling and API request patterns

- **`/docs/ai/ai-agent-instructions.md`** - Comprehensive AI agent guide for:
  - Service analysis and review processes
  - Critical issue detection and fixing
  - Quality enhancement procedures
  - Production-ready standards compliance

### Detailed Documentation (Reference Only)

These provide comprehensive details but should be used as secondary reference:

- **`/docs/flowrunner-extension-basic.md`** - Service development fundamentals
- **`/docs/flowrunner-extension-params.md`** - Parameter definition details
- **`/docs/flowrunner-extension-oauth2.md`** - OAuth2 implementation guide
- **`/docs/flowrunner-triggers.md`** - Trigger system details

### Service Development Guidelines

- **Service Location**: All services are in `/services/{service-name}/`
- **Entry Point**: Each service's main implementation is in `src/index.js`
- **Service Scope**: When working with a service, all changes must be within its specific folder
- **AI Tool Compatibility**: Services function as AI Agent Tools and require comprehensive JSDoc documentation

### Quick Reference for AI Agents

**For creating, fixing, patching, or reviewing a service:**

Before changing any code, either dispatch the `flowrunner-service-engineer` agent, or load
`.claude/agents/flowrunner-service-engineer.md` in full AND the docs below. Fixing from memory is how
documented patterns (e.g. the §8 Files API / `@usesFileStorage` rule) get dropped and services break.

1. Read `/docs/ai/ai-agent-instructions.md` for complete process
2. Apply rules from `/docs/ai/flowrunner-service-rules.md`
3. Use patterns from `/docs/ai/flowrunner-service-patterns.md`
4. Reference detailed docs only when needed for specific implementations

#### Common Development Patterns

**Method Parameter Structure:**

- Methods with `@paramDef` annotations must use individual parameters, NOT destructured objects
- Correct: `parseInvoice(fileUrl, callback)`
- Incorrect: `parseInvoice({ fileUrl, callback })`
- All parameters should be listed individually in the method signature

**Flowrunner.Request Response Handling:**

- `Flowrunner.Request` returns the response body directly, not a response object
- Do NOT reference `response.status` on the success return - it doesn't exist (`error.status`/`error.statusCode` in error handling is fine)
- Access response properties directly (e.g., `response.credits`, `response.data`)
- For binary downloads use `.setEncoding(null)`; for multipart use `new Flowrunner.Request.FormData()` with `.form(formData)`

**Service Configuration Items:**

- Do NOT include the service name in `displayName` since it's already in service context
- Correct: `displayName: 'API Key'`
- Incorrect: `displayName: 'PDF.co API Key'`

**Error Handling:**

- Use try-catch blocks for external API calls
- Provide meaningful error messages in responses
- Log errors with appropriate context using logger

**Authentication Patterns:**

- Constructor takes config only: `constructor(config)` — no `context`/`this.backendless`
- OAuth2 services: read the live access token via `this.request.headers['oauth-access-token']`; implement `getOAuth2ConnectionURL` (GET), `executeCallback` (POST), `refreshToken` (PUT)
- API key services: pull credentials off `config` (e.g. `this.apiKey = config.apiKey`)

**Logging:**

- Use `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`
- Include method context and relevant parameters
- Avoid logging sensitive data (tokens, secrets)

**Response Formatting:**

- Return consistent object structures
- Use meaningful property names
- Include relevant metadata when helpful

#### Troubleshooting Guide

**Common Issues:**

1. **JSDoc Validation Errors**: Ensure `@paramDef` contains valid JSON
2. **UI Component Mismatches**: Verify component type matches parameter data type
3. **Dictionary Dependencies**: Check `dependsOn` parameter names match exactly
4. **OAuth Token Issues**: Verify token refresh logic and error handling
5. **Trigger Registration**: Ensure all required system methods are implemented

**Development Validation:**

- Check service deployment with appropriate cluster configuration
- Validate JSDoc annotations before deployment
- Verify service functionality through manual testing

## Claude Code Analysis Rules

When analyzing this repository with Claude Code, follow these exclusion rules:

### File and Directory Exclusions

1. **Do not analyze node_modules directories** - Exclude all `node_modules/` folders from analysis across the entire repository
2. **Respect .gitignore exclusions** - Read and follow exclusions defined in `/.gitignore`:
   - `/coverage/` - Test coverage reports
   - `node_modules` - Package dependencies
   - `GENERATED_README.md` - Auto-generated documentation
   - `coderunner-local.js` - Local configuration files
   - `*.log` - Log files
3. **Service-specific exclusions** - For each service in `/services/{service-name}/`, check and respect any individual `.gitignore` files that may exist in those service directories

### Service Development Rules

1. **Service scope and location** - When asked to work with a service, all changes must be made within the specific service folder at `/services/{service-name}/`
2. **Service entry point** - Each service contains a `src/index.js` file which is the service entry point and contains all service definitions. When asked to read or change service definitions, work exclusively with the `index.js` file
3. **AI Agent Tools documentation** - These services are used as AI Agent Tools, so they must be well described with comprehensive JSDoc annotations including clear method names, descriptions, and detailed parameter definitions to ensure proper AI integration

These rules ensure analysis focuses on source code and documentation while avoiding generated files, dependencies, and local configuration that aren't part of the core codebase.
