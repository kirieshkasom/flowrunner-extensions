# DataForSEO SERP Regular Format & Depth Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `resultFormat` (regular | advanced) parameter to the two Organic SERP methods, lower their default `depth` from 100 to 10, fix incorrect max-depth docs (700 → 200), and correct Maps' depth docs to reflect per-100 billing — without changing Maps' default depth or endpoint.

**Architecture:** All edits land in a single file: [services/dataforseo/src/index.js](services/dataforseo/src/index.js). One constant added (`DEFAULT_DEPTH = 10`). Two methods (`serpGoogleOrganic`, `serpBingOrganic`) gain a new param and a templated endpoint URL. One method (`serpGoogleMaps`) gets only docstring fixes. A new `MANUAL_TEST_PLAN.md` ships next to the service for sandbox verification (no unit-test framework exists in the repo; that gap is filed as a separate follow-up).

**Tech Stack:** Node.js FlowRunner extension. `Flowrunner.Request` for HTTP. JSDoc `@paramDef` annotations drive UI generation. Prettier via `npm run lint` for formatting.

**Background / Decisions locked in during brainstorm:**
- DFS docs state Regular and Advanced cost the same per call. The cost-savings come entirely from lowering `depth`, not from the format switch. The `resultFormat` parameter still ships, but its docs describe payload richness, not cost.
- Regular returns `organic`, `paid`, and `featured_snippet`. Advanced adds `knowledge_graph`, `local_pack`, `ai_overview`, `people_also_ask`, `carousel`, etc.
- Maps is per-100-result billing with default depth 100 and max 700. Lowering Maps' default would save nothing and return 90% less data; only the docstring changes.
- Maps has no Regular variant (confirmed: docs page 404, overview lists Advanced-only).
- Organic max depth is 200, not 700. Current docs say "10 to 700" — that's a bug we fix here.
- No internal callers in the codebase depend on Advanced-only fields (verified by repo-wide grep). External FlowRunner workflows are not visible from this repo; the PR description flags the breaking change so workflow owners can pin `resultFormat='advanced'` if they need the richer payload.

---

### Task 1: Add DEFAULT_DEPTH constant

**Files:**
- Modify: [services/dataforseo/src/index.js:1-6](services/dataforseo/src/index.js#L1-L6)

- [ ] **Step 1: Add the constant next to the other defaults**

Edit `services/dataforseo/src/index.js`. Find:

```javascript
const API_BASE_URL = 'https://api.dataforseo.com/v3'
const DEFAULT_LANGUAGE_CODE = 'en'
const DEFAULT_LOCATION_CODE = 2840
const LOCATIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000
```

Replace with:

```javascript
const API_BASE_URL = 'https://api.dataforseo.com/v3'
const DEFAULT_LANGUAGE_CODE = 'en'
const DEFAULT_LOCATION_CODE = 2840
const DEFAULT_DEPTH = 10
const LOCATIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000
```

- [ ] **Step 2: Sanity check**

Run: `grep -n "DEFAULT_DEPTH" services/dataforseo/src/index.js`
Expected: a single line showing the new constant on line 5.

---

### Task 2: Update serpGoogleOrganic — add resultFormat, lower depth default, fix endpoint and docs

**Files:**
- Modify: [services/dataforseo/src/index.js:114-144](services/dataforseo/src/index.js#L114-L144)

The current method hardcodes `/serp/google/organic/live/advanced`, defaults `depth` to 100, and advertises a 10–700 range that doesn't exist. After this task it accepts a `resultFormat` param (`'regular' | 'advanced'`, default `'regular'`), templates that into the URL, defaults depth to 10, and has accurate docs + sample.

- [ ] **Step 1: Replace the entire JSDoc block + method signature + body**

Replace this block:

```javascript
  /**
   * @operationName Google Organic Search
   * @category SERP
   * @appearanceColor #1A73E8 #4A9AF5
   * @description Retrieves Google organic search results for a keyword in a specific location and language. Returns ranked URLs with titles, descriptions, and position data. Useful for competitive SERP analysis, rank tracking, and content gap identification.
   * @route POST /serp-google-organic
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Keyword","name":"keyword","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The search query to look up in Google organic results."}
   * @paramDef {"type":"Number","label":"Location","name":"locationCode","default":2840,"dictionary":"getLocationsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"DataForSEO location code for geo-targeted results. Default is 2840 (United States)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","default":"en","dictionary":"getLanguagesDictionary","description":"Language code for search results. Default is en (English)."}
   * @paramDef {"type":"Number","label":"Result Depth","name":"depth","default":100,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of search results to retrieve, from 10 to 700. Default is 100."}
   * @paramDef {"type":"String","label":"Device","name":"device","default":"desktop","uiComponent":{"type":"DROPDOWN","options":{"values":["desktop","mobile"]}},"description":"Device type to emulate for the search. Desktop and mobile SERPs can differ significantly."}
   *
   * @returns {Object}
   * @sampleResult {"keyword":"flowrunner","type":"organic","se_domain":"google.com","location_code":2840,"language_code":"en","check_url":"https://www.google.com/search?q=flowrunner&num=100&hl=en&gl=US","se_results_count":12500000,"items_count":10,"items":[{"type":"organic","rank_group":1,"rank_absolute":1,"domain":"example.com","title":"FlowRunner - Workflow Automation","url":"https://example.com/flowrunner","description":"FlowRunner is a powerful workflow automation platform..."}]}
   */
  async serpGoogleOrganic(keyword, locationCode, languageCode, depth, device) {
    locationCode = locationCode || DEFAULT_LOCATION_CODE
    languageCode = languageCode || DEFAULT_LANGUAGE_CODE
    depth = depth || 100
    device = device || 'desktop'

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/serp/google/organic/live/advanced`,
      body: { keyword, location_code: locationCode, language_code: languageCode, depth, device },
      logTag: 'serpGoogleOrganic',
    })

    return result[0] || {}
  }
```

With:

```javascript
  /**
   * @operationName Google Organic Search
   * @category SERP
   * @appearanceColor #1A73E8 #4A9AF5
   * @description Retrieves Google organic search results live for a keyword in a specific location and language. The 'resultFormat' parameter selects payload richness: 'regular' returns organic, paid, and featured_snippet items (sufficient for rank tracking and URL/title/description analysis); 'advanced' additionally returns knowledge_graph, local_pack, ai_overview, people_also_ask, carousels, and other SERP features. Both formats cost the same per call; cost scales with the 'depth' parameter (billed per 10 results).
   * @route POST /serp-google-organic
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Keyword","name":"keyword","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The search query to look up in Google organic results."}
   * @paramDef {"type":"Number","label":"Location","name":"locationCode","default":2840,"dictionary":"getLocationsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"DataForSEO location code for geo-targeted results. Default is 2840 (United States)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","default":"en","dictionary":"getLanguagesDictionary","description":"Language code for search results. Default is en (English)."}
   * @paramDef {"type":"Number","label":"Result Depth","name":"depth","default":10,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of search results to retrieve, from 10 to 200. DataForSEO bills in 10-result increments; depth=20 costs twice depth=10, and so on. Default is 10."}
   * @paramDef {"type":"String","label":"Device","name":"device","default":"desktop","uiComponent":{"type":"DROPDOWN","options":{"values":["desktop","mobile"]}},"description":"Device type to emulate for the search. Desktop and mobile SERPs can differ significantly."}
   * @paramDef {"type":"String","label":"Result Format","name":"resultFormat","default":"regular","uiComponent":{"type":"DROPDOWN","options":{"values":["regular","advanced"]}},"description":"'regular' returns organic, paid, and featured_snippet items only — slimmer payload, easier to parse. 'advanced' adds rich SERP features (knowledge_graph, local_pack, ai_overview, people_also_ask, carousels). Cost is identical; choose 'advanced' only when you need those extra item types."}
   *
   * @returns {Object}
   * @sampleResult {"keyword":"flowrunner","type":"organic","se_domain":"google.com","location_code":2840,"language_code":"en","check_url":"https://www.google.com/search?q=flowrunner&num=10&hl=en&gl=US","se_results_count":12500000,"items_count":10,"items":[{"type":"featured_snippet","rank_group":1,"rank_absolute":1,"domain":"example.com","title":"What is FlowRunner?","description":"FlowRunner is a workflow automation platform...","url":"https://example.com/flowrunner"},{"type":"organic","rank_group":1,"rank_absolute":2,"domain":"example.com","title":"FlowRunner - Workflow Automation","url":"https://example.com/flowrunner","description":"FlowRunner is a powerful workflow automation platform...","breadcrumb":"https://example.com › products › flowrunner"}]}
   */
  async serpGoogleOrganic(keyword, locationCode, languageCode, depth, device, resultFormat) {
    locationCode = locationCode || DEFAULT_LOCATION_CODE
    languageCode = languageCode || DEFAULT_LANGUAGE_CODE
    depth = depth || DEFAULT_DEPTH
    device = device || 'desktop'
    resultFormat = resultFormat || 'regular'

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/serp/google/organic/live/${ resultFormat }`,
      body: { keyword, location_code: locationCode, language_code: languageCode, depth, device },
      logTag: 'serpGoogleOrganic',
    })

    return result[0] || {}
  }
```

- [ ] **Step 2: Sanity check the edit by reading lines 114–150**

Run: `sed -n '114,150p' services/dataforseo/src/index.js`
Expected: shows the new signature with `resultFormat`, the new template literal URL, and `DEFAULT_DEPTH` in use.

---

### Task 3: Update serpBingOrganic — same shape as Google Organic

**Files:**
- Modify: [services/dataforseo/src/index.js:176-204](services/dataforseo/src/index.js#L176-L204)

Bing Organic mirrors Google Organic structurally — same endpoint family, same `/regular` and `/advanced` variants, same depth semantics (default 10, max 200, billed per 10). The only difference is no `device` parameter.

- [ ] **Step 1: Replace the entire JSDoc block + method**

Replace this block:

```javascript
  /**
   * @operationName Bing Organic Search
   * @category SERP
   * @appearanceColor #1A73E8 #4A9AF5
   * @description Retrieves Bing organic search results for a keyword. Returns ranked URLs with titles, descriptions, and position data. Useful for tracking Bing-specific rankings and diversifying search visibility analysis beyond Google.
   * @route POST /serp-bing-organic
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Keyword","name":"keyword","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The search query to look up in Bing organic results."}
   * @paramDef {"type":"Number","label":"Location","name":"locationCode","default":2840,"dictionary":"getLocationsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"DataForSEO location code for geo-targeted results. Default is 2840 (United States)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","default":"en","dictionary":"getLanguagesDictionary","description":"Language code for search results. Default is en (English)."}
   * @paramDef {"type":"Number","label":"Result Depth","name":"depth","default":100,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of search results to retrieve, from 10 to 700. Default is 100."}
   *
   * @returns {Object}
   * @sampleResult {"keyword":"flowrunner","type":"organic","se_domain":"bing.com","location_code":2840,"language_code":"en","se_results_count":8400000,"items_count":10,"items":[{"type":"organic","rank_group":1,"rank_absolute":1,"domain":"example.com","title":"FlowRunner - Workflow Automation","url":"https://example.com/flowrunner","description":"FlowRunner is a powerful workflow automation platform..."}]}
   */
  async serpBingOrganic(keyword, locationCode, languageCode, depth) {
    locationCode = locationCode || DEFAULT_LOCATION_CODE
    languageCode = languageCode || DEFAULT_LANGUAGE_CODE
    depth = depth || 100

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/serp/bing/organic/live/advanced`,
      body: { keyword, location_code: locationCode, language_code: languageCode, depth },
      logTag: 'serpBingOrganic',
    })

    return result[0] || {}
  }
```

With:

```javascript
  /**
   * @operationName Bing Organic Search
   * @category SERP
   * @appearanceColor #1A73E8 #4A9AF5
   * @description Retrieves Bing organic search results live for a keyword. The 'resultFormat' parameter selects payload richness: 'regular' returns organic, paid, and featured_snippet items (sufficient for rank tracking); 'advanced' adds rich SERP features. Both formats cost the same per call; cost scales with 'depth' (billed per 10 results). Useful for tracking Bing-specific rankings and diversifying search visibility analysis beyond Google.
   * @route POST /serp-bing-organic
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Keyword","name":"keyword","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The search query to look up in Bing organic results."}
   * @paramDef {"type":"Number","label":"Location","name":"locationCode","default":2840,"dictionary":"getLocationsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"DataForSEO location code for geo-targeted results. Default is 2840 (United States)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","default":"en","dictionary":"getLanguagesDictionary","description":"Language code for search results. Default is en (English)."}
   * @paramDef {"type":"Number","label":"Result Depth","name":"depth","default":10,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of search results to retrieve, from 10 to 200. DataForSEO bills in 10-result increments; depth=20 costs twice depth=10, and so on. Default is 10."}
   * @paramDef {"type":"String","label":"Result Format","name":"resultFormat","default":"regular","uiComponent":{"type":"DROPDOWN","options":{"values":["regular","advanced"]}},"description":"'regular' returns organic, paid, and featured_snippet items only — slimmer payload, easier to parse. 'advanced' adds rich SERP features. Cost is identical; choose 'advanced' only when you need the extra item types."}
   *
   * @returns {Object}
   * @sampleResult {"keyword":"flowrunner","type":"organic","se_domain":"bing.com","location_code":2840,"language_code":"en","se_results_count":8400000,"items_count":10,"items":[{"type":"organic","rank_group":1,"rank_absolute":1,"domain":"example.com","title":"FlowRunner - Workflow Automation","url":"https://example.com/flowrunner","description":"FlowRunner is a powerful workflow automation platform...","breadcrumb":"https://example.com › products › flowrunner"}]}
   */
  async serpBingOrganic(keyword, locationCode, languageCode, depth, resultFormat) {
    locationCode = locationCode || DEFAULT_LOCATION_CODE
    languageCode = languageCode || DEFAULT_LANGUAGE_CODE
    depth = depth || DEFAULT_DEPTH
    resultFormat = resultFormat || 'regular'

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/serp/bing/organic/live/${ resultFormat }`,
      body: { keyword, location_code: locationCode, language_code: languageCode, depth },
      logTag: 'serpBingOrganic',
    })

    return result[0] || {}
  }
```

- [ ] **Step 2: Sanity check**

Run: `grep -n "resultFormat\|/serp/bing/organic/live" services/dataforseo/src/index.js`
Expected: one URL template line and at least three `resultFormat` references inside the Bing block.

---

### Task 4: Update serpGoogleMaps — docstring only (no signature or endpoint change)

**Files:**
- Modify: [services/dataforseo/src/index.js:146-174](services/dataforseo/src/index.js#L146-L174)

Maps has only an Advanced variant and is billed per 100-result SERP. The current method body is correct; we only refine the description and the depth `@paramDef` so callers understand the billing model and don't try to drop depth thinking it saves money.

- [ ] **Step 1: Update the `@description` and the `depth` `@paramDef` only**

Find:

```javascript
   * @description Retrieves Google Maps local search results for a keyword. Returns business listings with names, addresses, ratings, and review counts. Ideal for local SEO monitoring, competitor mapping, and location-based market analysis.
```

Replace with:

```javascript
   * @description Retrieves Google Maps local search results live for a keyword. Returns business listings with names, addresses, ratings, and review counts. Ideal for local SEO monitoring, competitor mapping, and location-based market analysis. DataForSEO offers only an Advanced variant for Maps (no Regular).
```

Then find:

```javascript
   * @paramDef {"type":"Number","label":"Result Depth","name":"depth","default":100,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of search results to retrieve, from 10 to 700. Default is 100."}
```

Replace with:

```javascript
   * @paramDef {"type":"Number","label":"Result Depth","name":"depth","default":100,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of search results to retrieve, from 10 to 700. Unlike Google/Bing Organic, Maps is billed per 100-result SERP — lowering depth below 100 does not reduce cost, only the number of returned results. Default is 100."}
```

- [ ] **Step 2: Confirm the method body is unchanged**

Run: `sed -n '162,174p' services/dataforseo/src/index.js`
Expected: identical method body to before (signature `(keyword, locationCode, languageCode, depth)`, URL still `/serp/google/maps/live/advanced`, `depth = depth || 100`). Only the JSDoc above changed.

---

### Task 5: Create MANUAL_TEST_PLAN.md

**Files:**
- Create: `services/dataforseo/MANUAL_TEST_PLAN.md`

Stand-in for a unit-test suite since no framework exists. The PR should also include a follow-up ticket reference for "add Jest to the FlowRunner extensions repo."

- [ ] **Step 1: Write the test plan**

Create `services/dataforseo/MANUAL_TEST_PLAN.md` with this content:

````markdown
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
````

- [ ] **Step 2: Verify file**

Run: `ls -la services/dataforseo/MANUAL_TEST_PLAN.md`
Expected: file exists, > 1KB.

---

### Task 6: Lint and final verification

**Files:**
- All edited files.

- [ ] **Step 1: Run the project lint/format script**

Run: `npm run lint`
Expected: no errors. Prettier may reformat the edited block; that's fine.

- [ ] **Step 2: Verify no other endpoint paths or methods accidentally changed**

Run: `git diff --stat services/dataforseo/`
Expected: only `src/index.js` and the new `MANUAL_TEST_PLAN.md` show in the diff. No other services touched.

Run: `git diff services/dataforseo/src/index.js | grep -E "^[+-].*url:|^[+-].*async serp"`
Expected diff lines:
- Two new template-literal URLs (`/serp/google/organic/live/${ resultFormat }`, `/serp/bing/organic/live/${ resultFormat }`)
- Two removed hardcoded `/advanced` URLs for the same methods
- Maps URL line unchanged (not in the diff at all)
- Two updated method signatures adding `resultFormat`

- [ ] **Step 3: Skim the final file**

Run: `sed -n '1,10p;114,210p' services/dataforseo/src/index.js`
Sanity check: `DEFAULT_DEPTH = 10` on line ~5; both Organic methods accept `resultFormat`; Maps method body unchanged; all three docstrings reflect the agreed wording.

---

## Self-Review Checklist (run after Task 6)

- [ ] **Spec coverage:** resultFormat added to Google + Bing Organic ✓. Maps untouched ✓. Depth default lowered for Organic only ✓. Max-depth text corrected for Organic ✓. Maps depth doc updated to reflect per-100 billing ✓. DEFAULT_DEPTH constant added ✓. Manual test plan included ✓.
- [ ] **No placeholder text** anywhere in the file.
- [ ] **Type consistency:** parameter order in method signatures matches the order of `@paramDef` declarations? Google Organic: keyword, locationCode, languageCode, depth, device, resultFormat. Bing Organic: keyword, locationCode, languageCode, depth, resultFormat. (Verify the FlowRunner runtime maps params positionally vs by name — see [docs/ai/flowrunner-service-rules.md](docs/ai/flowrunner-service-rules.md) if uncertain. JSDoc `@paramDef` order should match the JS signature.)
- [ ] **Breaking changes documented** in the PR description with the depth-100-to-10 and Advanced-to-Regular defaults called out plainly.
