# Migrate Backendless Service to Flowrunner Format

You are a migration agent. Your job is to migrate a Backendless service to the Flowrunner format.

The user will provide a service name (e.g. `brevo`, `twilio`). The service is located at `services/<name>/`.

## Migration Steps

### 1. Read the source files
- Read `services/<name>/src/index.js`
- Read `services/<name>/package.json`
- Read `services/<name>/coderunner.js` (if exists)

### 2. Global rename in `src/index.js`
Replace ALL occurrences of `Backendless` with `Flowrunner`:
- `Backendless.Request` → `Flowrunner.Request`
- `Backendless.ServerCode.addService(...)` → `Flowrunner.ServerCode.addService(...)`
- `Backendless.ServerCode.ConfigItems.TYPES.*` → `Flowrunner.ServerCode.ConfigItems.TYPES.*`
- Any other `Backendless.*` references

### 3. Add `shared` property to all config items
Every config item in the `addService()` call MUST have a `shared` property:
- `shared: true` — ONLY for OAuth-related config items (clientId, clientSecret) used in services with `@requireOAuth` annotation
- `shared: false` — for API keys and ALL other non-OAuth config items

### 4. Normalize DROPDOWN `@paramDef` options
Legacy Backendless services often declare DROPDOWN options as a top-level array of `{label,value}`
objects, or as objects nested inside `values`. FlowRunner-native services use friendly plain-string
labels and map them to API values in code. For every `@paramDef` containing `"type":"DROPDOWN"`:
- Rewrite the options to the nested plain-string form, using the existing `label`s as the option
  strings (same order): `"options":[{"label":"Read","value":"pull"}]` → `"options":{"values":["Read"]}`.
- In the method body/query, map the friendly label → API value via a private helper:
  ```js
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined
    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }
  ```
  Derive each mapping directly from the original `label→value` pairs (e.g. `{ Read:'pull' }`). When
  label === value for all options, emit plain strings and add no mapping; when any differs (incl.
  case-only), add a full mapping. This is a lossless transform — never invent values.

### 5. Simplify `package.json`
Replace contents with the standard flowrunner format:
```json
{
  "name": "flowrunner-service",
  "version": "1.0.0",
  "scripts": {},
  "devDependencies": {},
  "license": "MIT"
}
```

### 6. Delete the legacy `coderunner.js`
FlowRunner-native services do NOT use a `coderunner.js` — it is a legacy Backendless deployment file and there is no root `../../coderunner` helper in this repo (the `require` it does is dead). If `services/<name>/coderunner.js` exists, delete it. Use `git rm services/<name>/coderunner.js` when the file is tracked, otherwise plain `rm`.

### 7. Leave these files unchanged
- `public/` directory — icons and static assets, keep as-is

### 8. Update the README via the `readme-maintainer` agent
After the code migration is complete and verified, you MUST dispatch the `readme-maintainer` agent for the service (via the Task/Agent tool, `subagent_type: readme-maintainer`). Migration changes the public surface (runtime rename, config `shared` flags), so the README must be regenerated to match — never hand-edit it here and never skip this step. If the service has no `README.md` yet, the agent creates it; if it exists, the agent updates it.

## Validation Checklist
After migration, verify:
- [ ] No remaining `Backendless` references in `src/index.js`
- [ ] All config items in `addService()` have the `shared` property
- [ ] `shared` values are correct (true only for OAuth, false otherwise)
- [ ] No DROPDOWN `@paramDef` uses the `[{label,value}]` array or object-in-`values` form — all use friendly plain-string `options:{values:[...]}` with label→value mapping in code (`grep -nE '"options":\[' src/index.js` returns nothing)
- [ ] `package.json` matches the flowrunner format
- [ ] `coderunner.js` has been deleted (no longer present in the service folder)
- [ ] `readme-maintainer` agent was run and `README.md` exists and reflects the migrated service

## Reference Services
- **OAuth service example**: `services/airtable/src/index.js` — uses `@requireOAuth`, `shared: true` on clientId/clientSecret
- **API key service example**: `services/brevo/src/index.js` — no OAuth, `shared: false` on apiKey

$ARGUMENTS