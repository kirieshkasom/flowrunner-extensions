# README Maintainer Memory

## Key File Paths
- Generation rules: `docs/ai/readme-generation-rules.md`
- Services root: `services/` (each service has `src/index.js` as entry point; folder names are bare, e.g. `slack/`, `box/`, not `slack-service/`)

## README Structure Pattern (Confirmed)
- Title: `# {Service Name} FlowRunner Extension`
- Description: 1-2 sentence overview (no "Service Description" heading)
- `## Ideal Use Cases`: bullet points of automation scenarios
- `## List of Actions`: grouped by `@category` if present, alphabetical within groups
- `## List of Triggers`: only if service has triggers (POLLING_TRIGGER or REALTIME_TRIGGER)
- `## Agent Ideas`: 2-3 cross-service workflow bullets with exact operation names
- Optional `## Authentication` + `## Configuration` sections are acceptable when a service has non-obvious config worth documenting (e.g. Deel's Production/Sandbox `environment` CHOICE item) — place them after Triggers, before Agent Ideas. Minimal siblings (airtable, brevo) skip them and just mention auth in the description.
- Character limit: 2000 max per the rules doc, but treat it as a guideline for small services. Large services exceed it in practice (recruitee ~1993 but at 100 actions; freshbooks ~90 actions also exceeds) — prioritize completeness + the required section structure over the hard cap.

## Exclusion Rules
- SYSTEM methods: never document (OAuth2 methods, schema loaders)
- DICTIONARY methods: never document as standalone operations
- SAMPLE_RESULT_LOADER methods: never document as standalone operations
- PARAM_SCHEMA_DEFINITION methods: never document as standalone operations

## Category Grouping
- When methods have `@category` annotations, use `### {Category}` subheadings under List of Actions
- Sort categories logically, actions alphabetically within each category

## README Flat List Pattern
- When category grouping is NOT used in the README (even if `@category` exists in source), list actions alphabetically as flat bullets
- Flat list is preferred when the character limit is tight; category grouping adds overhead

## Patterns Observed
- OAuth2 services have 3 SYSTEM methods: `getOAuth2ConnectionURL` (GET), `executeCallback` (POST), `refreshToken` (PUT)
- Services without triggers omit the "List of Triggers" section entirely
- Config items each carry a `shared` value (`true` only for OAuth client creds); document them by their `displayName`

## Agent Ideas Pattern
- Reference exact `@operationName` values in quotes (e.g., "Create Bill")
- Name companion services explicitly (e.g., Gmail's "Send Message")
- Each bullet is one concrete end-to-end workflow sentence
- VERIFY every cited sibling trigger/action exists in that sibling's README. Triggers are the common trap.

## Services Documented
- `fireflies-service`: 6 actions (categories: Transcripts [Get Transcript, List Transcripts, Search Transcripts], AI Summary [Get Transcript Summary], Uploads [Add Fred to Live Meeting, Upload Audio]), 1 polling trigger (On New Transcript). Auth: API key (single `apiKey` config, `shared: false`). 1 DICTIONARY (getUsersDictionary) + 1 SYSTEM (handleTriggerPollingForEvent) excluded. GraphQL backend. Companions: Notion "Create Page", Asana "Create Task", Slack "Send Message To Channel", Dropbox "On New File"/"Get Temporary Link".
- `ramp-service`: 21 actions (categories: Transactions, Cards, Users, Organization, Vendors, Bills, Reimbursements), 3 polling triggers (On New Transaction/Bill/Reimbursement). Auth: OAuth2 client_credentials (clientId/clientSecret config, not the 3-method OAuth pattern — no SYSTEM OAuth methods). 5 DICTIONARY methods + 1 SYSTEM (handleTriggerPollingForEvent) excluded. Good companions: Slack, Google Sheets, Parseur, Gmail.
- `supabase`: 4 actions (Select/Insert/Update/Delete Record, all @category CRUD), 3 triggers (On Record Created [REALTIME+POLLING], On Record Updated [REALTIME+POLLING], On Record Deleted [REALTIME only]). Auth: API key (Project URL `supabaseUrl` + API Key `supabaseKey`, no `shared` field set in config — service predates required-shared convention). 3 DICTIONARY (Tables/Columns/Operators) + 1 SAMPLE_RESULT_LOADER (getRecordSchema) + manual-webhook SYSTEM handlers all excluded. PostgREST backend. Companions: Gmail "Send Message", Google Sheets "Add Row", Slack "Send Message To Channel".
- `recruitee`: 100 actions (categories: General, Candidates, Jobs, Pipeline, Organization, Notes & Tasks, Activity, Custom Fields, Interviews, Communication, Requisitions, Advanced), 4 polling triggers (On New Application, On New Candidate, On Candidate Moved to Stage, On Status Change). Auth: API key (Personal API Token + Company ID, both `shared: false`). Many DICTIONARY methods + 1 SYSTEM (handleTriggerPollingForEvent) excluded. Companions: Gmail "Send Message", Slack "Send Message To Channel", Google Sheets "Add Row".

## Large-Service Compaction (>50 actions)
- recruitee has 100 actions; one bullet per action exceeds 2000 chars. Use one bullet per `@category` with action names comma-separated, CRUD shorthand (`List/Get/Create/Update/Delete Template`), and `manage X` when a category is full-CRUD and space is very tight. Every op stays discoverable by category; satisfies "action names only" + "logical grouping" rules. recruitee final ~1993 chars.
- freshbooks (~90 actions) likewise exceeds the 2000-char cap — apply the same per-category compaction.

## Companion Op-Name Gotchas (verify in sibling README before citing)
- Slack: it's "Send Message To Channel" (NOT "Send Message")
- Google Sheets: it's "Add Row" (NOT "Append Row")
- Gmail: "Send Message" is correct
- Parseur: triggers are "On Document Processed (Polling)" / "On Document Processed (Realtime)" (suffix required)
- google-calendar: has NO triggers (actions only: Create/Delete/Get/List/Update Event). Do not cite calendar-based triggers.
- Dropbox (dropbox-service): triggers "On New File"/"On File Modified"/"On New Folder"; useful action "Get Temporary Link" for producing a fetchable URL.
