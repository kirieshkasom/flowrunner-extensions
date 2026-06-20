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

### 4. Simplify `package.json`
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

### 5. Leave these files unchanged
- `coderunner.js` — uses shared `../../coderunner` helper, no changes needed
- `public/` directory — icons and static assets, keep as-is

### 6. Update the README via the `readme-maintainer` agent
After the code migration is complete and verified, you MUST dispatch the `readme-maintainer` agent for the service (via the Task/Agent tool, `subagent_type: readme-maintainer`). Migration changes the public surface (runtime rename, config `shared` flags), so the README must be regenerated to match — never hand-edit it here and never skip this step. If the service has no `README.md` yet, the agent creates it; if it exists, the agent updates it.

## Validation Checklist
After migration, verify:
- [ ] No remaining `Backendless` references in `src/index.js`
- [ ] All config items in `addService()` have the `shared` property
- [ ] `shared` values are correct (true only for OAuth, false otherwise)
- [ ] `package.json` matches the flowrunner format
- [ ] `readme-maintainer` agent was run and `README.md` exists and reflects the migrated service

## Reference Services
- **OAuth service example**: `services/airtable/src/index.js` — uses `@requireOAuth`, `shared: true` on clientId/clientSecret
- **API key service example**: `services/brevo/src/index.js` — no OAuth, `shared: false` on apiKey

$ARGUMENTS