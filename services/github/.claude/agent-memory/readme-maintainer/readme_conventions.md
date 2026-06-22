---
name: readme-conventions
description: Verified structure and conventions for FlowRunner service README.md files in SharedExtensions
metadata:
  type: project
---

Service README structure (rules in docs/ai/readme-generation-rules.md, plus observed practice):

Sections in order: Title (`{Service} FlowRunner Extension`), description paragraph (no "Service Description" phrase), `## Ideal Use Cases` (bullets), `## List of Actions` (operationName only, sorted), `## List of Triggers` (POLLING/REALTIME trigger operationNames only), `## Agent Ideas` (2-3 cross-service bullets naming exact operationNames).

**Why:** README doubles as AI Agent Tool documentation; Agent Ideas section highlights cross-service synergies.

**How to apply:**
- Exclude `@registerAs SYSTEM`, `DICTIONARY`, `SAMPLE_RESULT_LOADER`, `PARAM_SCHEMA_DEFINITION` from action/trigger lists.
- The rules doc states a 2000-char limit, but real READMEs (e.g. trello, github) with many operations exceed it — completeness wins over the limit in practice.
- Enumerate operations fast with: `grep -nE "@operationName|@registerAs|@category" src/index.js` rather than reading the whole (often 3000+ line) index.js.
- Config items: OAuth `clientId`/`clientSecret` use `shared: true`; everything else `false`.
