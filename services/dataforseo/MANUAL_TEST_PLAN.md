# DataForSEO SERP — Manual Test Plan

Use this checklist to verify the three SERP methods after the resultFormat/depth changes. Run from a FlowRunner sandbox app with valid DataForSEO credentials. Each call is a single live SERP request; expect each to cost the equivalent of one 10-result SERP billing unit unless noted.

## Setup

- DataForSEO sandbox or production credentials configured on the service.
- A workflow with each of the three SERP actions wired to a log output node so the full response is visible.

## 1. Google Organic — defaults (regular, depth=10)

- **Call:** `serpGoogleOrganic({ keyword: "flowrunner" })` (all other params default).
- **Expected URL hit:** `POST /v3/serp/google/organic/live/regular` (verify in service debug logs).
- **Expected response:** `items_count` ≤ 10. `items[]` contains entries with `type` in `{organic, paid, featured_snippet}`. No `knowledge_graph`, no `ai_overview`, no `people_also_ask`.
- **Pass criteria:** non-empty `items`, `language_code === "en"`, `location_code === 2840`.

## 2. Google Organic — resultFormat='advanced'

- **Call:** `serpGoogleOrganic({ keyword: "weather new york", resultFormat: "advanced" })`.
- **Expected URL hit:** `POST /v3/serp/google/organic/live/advanced`.
- **Expected response:** items may include richer types — `knowledge_graph`, `local_pack`, `people_also_ask`, `ai_overview`, etc. — depending on the keyword. At least one non-organic, non-paid, non-featured_snippet item present for a query like "weather new york".
- **Pass criteria:** richer item types observable; same `items_count` ≤ 10 (since `depth` still defaults to 10).

## 3. Google Organic — depth override

- **Call:** `serpGoogleOrganic({ keyword: "flowrunner", depth: 20 })`.
- **Expected response:** `items_count` up to 20 organic-typed items (plus optional featured snippet).
- **Pass criteria:** more items than test 1; billing log shows ~2× the cost of test 1.

## 4. Bing Organic — defaults (regular, depth=10)

- **Call:** `serpBingOrganic({ keyword: "flowrunner" })`.
- **Expected URL hit:** `POST /v3/serp/bing/organic/live/regular`.
- **Expected response:** `items_count` ≤ 10, items typed `organic`/`paid`/`featured_snippet` only.
- **Pass criteria:** non-empty `items`, `se_domain` contains `bing.com`.

## 5. Google Maps — defaults (depth=100, advanced)

- **Call:** `serpGoogleMaps({ keyword: "pizza near me" })`.
- **Expected URL hit:** `POST /v3/serp/google/maps/live/advanced` (unchanged from before).
- **Expected response:** `items_count` up to 100. Each item has `rating`, `address`, `phone` (when present).
- **Pass criteria:** non-empty `items` array; default depth behavior unchanged from pre-change baseline.

## Regression notes

- Existing workflows that depended on Advanced-only fields on Google or Bing Organic (`knowledge_graph`, `ai_overview`, etc.) must explicitly pass `resultFormat: "advanced"` or they will see those fields disappear. Document this in the PR.
- Existing workflows that relied on `depth=100` default (now 10) on the Organic methods will see 90% fewer results. They must explicitly pass `depth: 100` to preserve prior behavior.
