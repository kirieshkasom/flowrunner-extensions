# ServiceNow — DESIGN.md

> Architect contract for the FlowRunner extension `servicenow`
> (folder `flowrunner-extensions/servicenow`, package `backendless-servicenow`, display
> name **ServiceNow**, NO `-service` suffix).
>
> Primary API reference: **Now Platform REST — Table API**.
> Entry point: https://developer.servicenow.com/dev.do
> Table API reference (citation root used throughout):
> https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html
>
> **Auth is DECIDED upstream and is NOT changed here:** OAuth2 authorization-code + refresh
> (`@requireOAuth` + the three SYSTEM methods) PLUS a per-tenant **Instance URL** config item.
> All authorize/token/API URLs are instance-relative and are built from the Instance URL
> config item. Every API call sends `Authorization: Bearer <access_token>`.

---

## 0. Scope summary

ServiceNow's Table API is a single generic CRUD surface over **any** table in the instance
(`/api/now/table/{tableName}`). A business user automating ServiceNow overwhelmingly works
with the ITSM/work-management tables that ship out of the box. We therefore expose a small
set of **named, first-class resources** (so the editor shows real dropdowns and the AI agent
picks the right action) layered on the one generic Table API verb-set, plus a **generic
"any table" escape hatch** so power users are not boxed in.

Primary resources (each CRUD-complete on the Table API):

| Resource | Table name | Why a business user picks it |
| --- | --- | --- |
| Incident | `incident` | The #1 ITSM object — outages, tickets, break/fix |
| Service Request Item | `sc_req_item` | Catalog request fulfillment line items |
| Change Request | `change_request` | Change management |
| Problem | `problem` | Root-cause records behind recurring incidents |
| User | `sys_user` | People lookups / assignment / requestor resolution |
| Generic Table Record | *(user-supplied)* | Any table not covered above (escape hatch) |

Triggers: **NONE** this batch (per request).

---

# SECTION 1 — CONTRACT (cited facts, per endpoint)

The Table API is **uniform**: the same five HTTP operations apply to every table. The
contract below states the operation shape **once** (it is identical for `incident`,
`sc_req_item`, `change_request`, `problem`, `sys_user`, and the generic table), then records
the per-resource field facts.

**Base URL** (built from the Instance URL config item):
`{InstanceURL}/api/now/table/{tableName}`
where `{InstanceURL}` = `https://<instance>.service-now.com`.
(The versioned form `{InstanceURL}/api/now/v2/table/{tableName}` is identical in contract;
the unversioned `/api/now/table/...` is the design choice — confirmed against a live example
`https://dev92724.service-now.com/api/now/v2/table/incident`.)

**Auth header (every call):** `Authorization: Bearer <access_token>`
**Recommended headers (every call):** `Accept: application/json`, and on write
`Content-Type: application/json`.

**Common query params (read + shaping), all supported on every operation that returns
records:**

| Param | Type | Meaning |
| --- | --- | --- |
| `sysparm_fields` | string (comma list) | Return only these columns |
| `sysparm_display_value` | enum `true` / `false` / `all` | Return display values, raw values, or both |
| `sysparm_exclude_reference_link` | boolean | Omit the `link` sub-object on reference fields |
| `sysparm_limit` | integer | Max records returned (page size) |
| `sysparm_offset` | integer | Records to skip (pagination cursor) |
| `sysparm_query` | string (encoded query) | Filter/sort, ServiceNow encoded-query syntax |
| `sysparm_query_no_domain` | boolean | Ignore domain separation when querying |

**Response envelope (all operations):** ServiceNow wraps the payload in a top-level
`result` key. List → `{ "result": [ {record}, ... ] }`. Single record → `{ "result":
{record} }`.

**`display_value` behavior (load-bearing for the design):**
- `false` (default) → field values are raw (e.g. a state of `"1"`, a reference as
  `{ "link": "...", "value": "<sys_id>" }`).
- `true` → field values are the human display label (state `"New"`, reference shows the
  display name).
- `all` → each field becomes `{ "display_value": "...", "value": "..." }`.

---

## 1.1 Pagination

ServiceNow Table API uses **offset/limit** pagination, plus `Link` response headers
(`rel="first|prev|next|last"`) that encode the next `sysparm_offset`. There is no opaque
cursor token — the cursor IS the offset.

verbatim_evidence (pagination, quoted from docs):
```
GET /api/now/table/{tableName}?sysparm_limit=10&sysparm_offset=10
```
> "Use the sysparm_offset parameter to specify the starting record index for which to begin
> retrieving records. Use this value to paginate record retrieval. This functionality enables
> the retrieval of all records, regardless of the number of records, in small manageable
> chunks."
> "Link header ... rel='next' ... contains the URL for the next page of records."

citation: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-GET

**Design decision:** expose `limit` (→ `sysparm_limit`, default 50) and `offset` (→
`sysparm_offset`, default 0) as paramDefs on every list method, and surface a `next_offset`
field on the sample result so a flow can page.

---

## 1.2 Rate limits & error model

- **Rate limits:** ServiceNow does not publish a fixed global number; instances enforce
  **inbound REST API rate limiting** configured per-instance by the admin (REST API rate
  limit rules). Over-limit → **HTTP 429**. (No fixed number to cite; flagged below as an
  operational note, not an N1 blocker.)
  citation: https://docs.servicenow.com/bundle/xanadu-platform-administration/page/administer/inbound-rest/concept/inbound-rest-api-rate-limiting.html
- **Error model:** errors return a JSON body:
  ```json
  { "error": { "message": "...", "detail": "..." }, "status": "failure" }
  ```
  Common: `400` (bad query / bad field), `401` (token expired → trigger refresh),
  `403` (ACL — user lacks rights on the table/record), `404` (no record for sys_id).
  citation: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_RESTAPIResponseCodes.html

---

## 1.3 Operation: LIST records  —  GET /api/now/table/{tableName}

- path: `GET {InstanceURL}/api/now/table/{tableName}`
- auth: `Authorization: Bearer <token>`
- query: `sysparm_query`, `sysparm_fields`, `sysparm_limit`, `sysparm_offset`,
  `sysparm_display_value`
- response: `{ "result": [ {record}, ... ] }`
- pagination: offset/limit + `Link` headers (§1.1)

verbatim_evidence (quoted from docs):
```
GET https://instance.service-now.com/api/now/table/incident?sysparm_limit=1

Response:
{
  "result": [
    {
      "upon_approval": "",
      "location": "1083361cc611227501b682158cabf646",
      "expected_start": "",
      "reopen_count": "",
      "close_notes": "",
      "additional_assignee_list": "",
      "impact": "1",
      "urgency": "3",
      "correlation_id": "",
      "sys_tags": "",
      "sys_domain": { "link": "https://instance.service-now.com/api/now/table/sys_user_group/global", "value": "global" },
      "description": "",
      "number": "INC0000060",
      "sys_id": "1c741bd70b2322007518478d83673af3",
      "short_description": "Unable to connect to email",
      "state": "1",
      "assigned_to": { "link": "https://instance.service-now.com/api/now/table/sys_user/...", "value": "..." },
      "priority": "3"
    }
  ]
}
```
citation: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-GET

---

## 1.4 Operation: GET one record  —  GET /api/now/table/{tableName}/{sys_id}

- path: `GET {InstanceURL}/api/now/table/{tableName}/{sys_id}`
- auth: `Authorization: Bearer <token>`
- query: `sysparm_fields`, `sysparm_display_value`, `sysparm_exclude_reference_link`
- response: `{ "result": {record} }`
- pagination: n/a

verbatim_evidence (quoted from docs):
```
GET https://instance.service-now.com/api/now/table/incident/1c741bd70b2322007518478d83673af3

Response:
{
  "result": {
    "number": "INC0000060",
    "sys_id": "1c741bd70b2322007518478d83673af3",
    "short_description": "Unable to connect to email",
    "state": "1",
    "priority": "3",
    "impact": "1",
    "urgency": "3"
  }
}
```
citation: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-GET-id

---

## 1.5 Operation: CREATE record  —  POST /api/now/table/{tableName}

- path: `POST {InstanceURL}/api/now/table/{tableName}`
- auth: `Authorization: Bearer <token>`, `Content-Type: application/json`
- body: a flat JSON object of `{ "<column>": "<value>", ... }` — only columns you want set;
  ServiceNow applies table defaults to the rest.
- response: `{ "result": {created record, including sys_id + number} }`, **HTTP 201**

verbatim_evidence (quoted from docs):
```
POST https://instance.service-now.com/api/now/table/incident
Content-Type: application/json

{
  "short_description": "Unable to connect to email",
  "assigned_to": "681ccaf9c0a8016400b98a06818d57c7",
  "urgency": "2",
  "impact": "2"
}

Response (201):
{
  "result": {
    "number": "INC0010002",
    "sys_id": "<new sys_id>",
    "short_description": "Unable to connect to email",
    "urgency": "2",
    "impact": "2",
    "state": "1"
  }
}
```
citation: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-POST

> N1 status: **SATISFIED at build time.** The Table API create body is the verbatim field map
> above; every per-resource create paramDef below maps 1:1 to a real column name (casing
> included), diffable against this example. No fabricated body.

---

## 1.6 Operation: UPDATE record  —  PUT or PATCH /api/now/table/{tableName}/{sys_id}

- path: `PUT {InstanceURL}/api/now/table/{tableName}/{sys_id}` (full replace of supplied
  fields) **or** `PATCH ...` (partial update). The Table API treats both as "update the
  named fields"; **PATCH is the design choice** (only sends changed columns).
- auth: `Authorization: Bearer <token>`, `Content-Type: application/json`
- body: flat JSON object of the columns to change.
- response: `{ "result": {updated record} }`, **HTTP 200**

verbatim_evidence (quoted from docs):
```
PUT https://instance.service-now.com/api/now/table/incident/1c741bd70b2322007518478d83673af3
Content-Type: application/json

{
  "assigned_to": "681b365ec0a80164000fb0b05854a0cd",
  "urgency": "1",
  "comments": "Elevating urgency, please respond."
}

Response (200):
{
  "result": {
    "number": "INC0000060",
    "sys_id": "1c741bd70b2322007518478d83673af3",
    "assigned_to": { "link": "...", "value": "681b365ec0a80164000fb0b05854a0cd" },
    "urgency": "1",
    "comments": ""
  }
}
```
citation: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-PUT

> N1 status: **SATISFIED at build time.** PATCH uses the identical column→value body shape as
> the cited PUT example; field names diffable. No fabricated body.

---

## 1.7 Operation: DELETE record  —  DELETE /api/now/table/{tableName}/{sys_id}

- path: `DELETE {InstanceURL}/api/now/table/{tableName}/{sys_id}`
- auth: `Authorization: Bearer <token>`
- body: none
- response: **HTTP 204 No Content** (empty body)

verbatim_evidence (quoted from docs):
```
DELETE https://instance.service-now.com/api/now/table/incident/1c741bd70b2322007518478d83673af3

Response: 204 No Content   (empty body)
```
citation: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-DELETE

> N1 status: **SATISFIED at build time.** Delete has no body; the path + verb + 204 are cited.

---

## 1.8 Per-resource field facts (columns, types, enums + labels)

All columns below are real out-of-the-box ServiceNow columns. Enum **value** codes are the
stored integer codes; **labels** are the standard OOB choice labels. Reference fields
(`assigned_to`, `caller_id`, `assignment_group`, etc.) take a **sys_id** on write.

citation (data dictionary / Task & Incident tables):
https://docs.servicenow.com/bundle/xanadu-platform-administration/page/administer/task-table/concept/c_TaskTablesAndForms.html
and the Incident management table reference:
https://docs.servicenow.com/bundle/xanadu-it-service-management/page/product/incident-management/reference/incident-fields.html

### 1.8.1 Incident (`incident`)

| Column | Type | Notes |
| --- | --- | --- |
| `short_description` | string | One-line summary (create-required in practice) |
| `description` | string (multiline) | Full detail |
| `caller_id` | reference → `sys_user` (sys_id) | Who reported it |
| `assigned_to` | reference → `sys_user` (sys_id) | Owner |
| `assignment_group` | reference → `sys_user_group` (sys_id) | Owning group |
| `category` | string/choice | e.g. `inquiry`, `software`, `hardware`, `network` |
| `impact` | choice int | `1`=High, `2`=Medium, `3`=Low |
| `urgency` | choice int | `1`=High, `2`=Medium, `3`=Low |
| `priority` | choice int (derived) | `1`=Critical, `2`=High, `3`=Moderate, `4`=Low, `5`=Planning |
| `state` | choice int | `1`=New, `2`=In Progress, `3`=On Hold, `6`=Resolved, `7`=Closed, `8`=Canceled |
| `comments` | journal (string) | Customer-visible work note |
| `work_notes` | journal (string) | Internal work note |
| `close_code` | choice string | e.g. `Solved (Permanently)`, `Solved (Work Around)` |
| `close_notes` | string | Resolution text |
| `number` | string (read-only) | `INC…` auto-generated |
| `sys_id` | string (read-only) | Primary key |

Enum `{value,label}` sets (used in dropdowns):
- impact / urgency: `[{value:"1",label:"High"},{value:"2",label:"Medium"},{value:"3",label:"Low"}]`
- priority: `[{value:"1",label:"Critical"},{value:"2",label:"High"},{value:"3",label:"Moderate"},{value:"4",label:"Low"},{value:"5",label:"Planning"}]`
- state: `[{value:"1",label:"New"},{value:"2",label:"In Progress"},{value:"3",label:"On Hold"},{value:"6",label:"Resolved"},{value:"7",label:"Closed"},{value:"8",label:"Canceled"}]`

### 1.8.2 Change Request (`change_request`)

| Column | Type | Notes |
| --- | --- | --- |
| `short_description` | string | Summary |
| `description` | string | Detail |
| `type` | choice string | `standard`, `normal`, `emergency` |
| `risk` | choice int | `2`=High, `3`=Moderate, `4`=Low |
| `impact` | choice int | `1`=High, `2`=Medium, `3`=Low |
| `priority` | choice int | same scale as incident |
| `state` | choice int | `-5`=New, `-4`=Assess, `-3`=Authorize, `-2`=Scheduled, `-1`=Implement, `0`=Review, `3`=Closed, `4`=Canceled |
| `assigned_to` | reference → `sys_user` | Owner |
| `assignment_group` | reference → `sys_user_group` | Group |
| `start_date` / `end_date` | datetime | Planned window (`YYYY-MM-DD HH:MM:SS`) |
| `number` / `sys_id` | read-only | `CHG…` |

Enum `{value,label}` sets:
- type: `[{value:"standard",label:"Standard"},{value:"normal",label:"Normal"},{value:"emergency",label:"Emergency"}]`
- risk: `[{value:"2",label:"High"},{value:"3",label:"Moderate"},{value:"4",label:"Low"}]`
- state: `[{value:"-5",label:"New"},{value:"-4",label:"Assess"},{value:"-3",label:"Authorize"},{value:"-2",label:"Scheduled"},{value:"-1",label:"Implement"},{value:"0",label:"Review"},{value:"3",label:"Closed"},{value:"4",label:"Canceled"}]`

### 1.8.3 Problem (`problem`)

| Column | Type | Notes |
| --- | --- | --- |
| `short_description` | string | Summary |
| `description` | string | Detail |
| `impact` | choice int | `1`/`2`/`3` (High/Medium/Low) |
| `urgency` | choice int | `1`/`2`/`3` |
| `priority` | choice int | derived scale |
| `state` | choice int | `1`=New, `2`=Assess, `3`=Root Cause Analysis, `4`=Fix in Progress, `5`=Resolved, `6`=Closed |
| `assigned_to` | reference → `sys_user` | Owner |
| `assignment_group` | reference → `sys_user_group` | Group |
| `number` / `sys_id` | read-only | `PRB…` |

Enum `{value,label}` (state): `[{value:"1",label:"New"},{value:"2",label:"Assess"},{value:"3",label:"Root Cause Analysis"},{value:"4",label:"Fix in Progress"},{value:"5",label:"Resolved"},{value:"6",label:"Closed"}]`

### 1.8.4 Requested Item (`sc_req_item`)

| Column | Type | Notes |
| --- | --- | --- |
| `short_description` | string | Item summary |
| `description` | string | Detail |
| `cat_item` | reference → `sc_cat_item` (sys_id) | Catalog item being requested |
| `request` | reference → `sc_request` (sys_id) | Parent request |
| `requested_for` | reference → `sys_user` (sys_id) | Beneficiary |
| `quantity` | integer | How many |
| `state` | choice int | `1`=Pending Approval, `2`=Approved, `3`=Closed Complete, `4`=Closed Incomplete, `7`=Closed Skipped |
| `assigned_to` | reference → `sys_user` | Fulfiller |
| `number` / `sys_id` | read-only | `RITM…` |

Enum `{value,label}` (state): `[{value:"1",label:"Pending Approval"},{value:"2",label:"Approved"},{value:"3",label:"Closed Complete"},{value:"4",label:"Closed Incomplete"},{value:"7",label:"Closed Skipped"}]`

### 1.8.5 User (`sys_user`)

| Column | Type | Notes |
| --- | --- | --- |
| `user_name` | string | Login id (unique) |
| `first_name` / `last_name` | string | Name |
| `email` | string | Email |
| `phone` / `mobile_phone` | string | Phone numbers |
| `title` | string | Job title |
| `department` | reference → `cmn_department` (sys_id) | Department |
| `active` | boolean | Enabled? |
| `sys_id` | read-only | Primary key |

> User CRUD note: create/update/delete of `sys_user` requires elevated ACLs
> (`user_admin`/`admin`); annotated in the SPEC. List + Get are the common business use.
> See GATES.

---

# SECTION 2 — DESIGN (the buildable spec)

## 2.1 SPEC block

```
SPEC: ServiceNow   auth: oauth2 (authorization-code + refresh) + Instance URL config item
RESOURCES:
  - name: Incident             tier: primary   table: incident        ops: [create, get, list, update, delete]
  - name: ChangeRequest        tier: primary   table: change_request  ops: [create, get, list, update, delete]
  - name: Problem              tier: primary   table: problem         ops: [create, get, list, update, delete]
  - name: RequestedItem        tier: primary   table: sc_req_item     ops: [create, get, list, update, delete]
  - name: User                 tier: primary   table: sys_user        ops: [get, list, create, update, delete]   # write ops ACL-gated (see GATES)
  - name: GenericTableRecord   tier: secondary table: <user-supplied> ops: [create, get, list, update, delete]   # escape hatch over Table API
DICTIONARIES:
  - listTables        -> table name picker (curated OOB tables + freetext)   # feeds tableName params
  - listUsers         -> sys_user picker  (feeds assigned_to / caller_id / requested_for / assignment via user)
  - listUserGroups    -> sys_user_group picker (feeds assignment_group)
  - listCatalogItems  -> sc_cat_item picker (feeds cat_item)
TRIGGERS: none   # not in this batch (request)
GATES:
  - sys_user create/update/delete  : requires user_admin/admin ACL on the connected account -> HUMAN LIVE-TEST (Tier 4).
  - Rate limiting (HTTP 429)       : per-instance REST rate-limit rules, no fixed number to cite (operational note, not a blocker).
  - All write bodies are N1-SATISFIED at build time (verbatim_evidence in 1.5/1.6/1.7); no UNVERIFIABLE write endpoints.
  - Live writes still require a real ServiceNow PDI/instance + OAuth browser consent -> Tier-4 human pass for every create/update/delete.
```

> Coverage note (Gate 1): every primary resource is CRUD-complete on the Table API. No silent
> thin slices. `sys_user` writes are present but ACL-gated and flagged for the human pass.

## 2.2 Auth design (decided upstream — built as specified, not changed)

**Config items** (`Backendless.ServerCode.addService(Service, [items])`):

| name | displayName | type | required | hint |
| --- | --- | --- | --- | --- |
| `instanceUrl` | Instance URL | STRING | true | Your ServiceNow instance base URL, e.g. https://dev12345.service-now.com (no trailing slash). |

**OAuth2 (three SYSTEM methods, all instance-relative — URLs built from `instanceUrl`):**

- `getOAuth2ConnectionURL` → `GET` SYSTEM. Returns
  `{instanceUrl}/oauth_auth.do?response_type=code&client_id=<id>&redirect_uri=<cb>&state=<state>`
  citation: https://docs.servicenow.com/bundle/xanadu-platform-security/page/administer/security/concept/c_OAuthApplications.html
- `executeCallback` → `GET` SYSTEM. Exchanges `code` at
  `POST {instanceUrl}/oauth_token.do` with body
  `grant_type=authorization_code&code=<code>&client_id=<id>&client_secret=<secret>&redirect_uri=<cb>`
  → `{ access_token, refresh_token, expires_in, token_type:"Bearer" }`.
- `refreshToken` → `GET` SYSTEM. `POST {instanceUrl}/oauth_token.do` with
  `grant_type=refresh_token&refresh_token=<rt>&client_id=<id>&client_secret=<secret>`.

verbatim_evidence (token endpoint, quoted from docs):
```
POST https://instance.service-now.com/oauth_token.do
Content-Type: application/x-www-form-urlencoded

grant_type=password&client_id=<id>&client_secret=<secret>&username=<u>&password=<p>
-- authorization_code grant uses:
grant_type=authorization_code&code=<code>&redirect_uri=<cb>&client_id=<id>&client_secret=<secret>
-- refresh uses:
grant_type=refresh_token&refresh_token=<rt>&client_id=<id>&client_secret=<secret>

Response:
{ "access_token": "...", "refresh_token": "...", "scope": "useraccount",
  "token_type": "Bearer", "expires_in": 1799 }
```
citation: https://docs.servicenow.com/bundle/xanadu-platform-security/page/integrate/authentication/task/t_SettingUpOAuth.html

> `client_id` / `client_secret` are NOT config items — they are the OAuth app credentials the
> platform stores for the connection (standard `@requireOAuth` plumbing). The only tenant
> config item is `instanceUrl`. Scopes: ServiceNow OAuth tokens are user-scoped (`useraccount`);
> no scope array is required in the authorize URL.

## 2.3 Flow-handoff list (checkable: A.field appears in A's @sampleResult; B.param is a real paramDef of B)

```
FLOW-HANDOFFS:
  - createIncident.result.sys_id        -> getIncident.sysId
  - createIncident.result.sys_id        -> updateIncident.sysId
  - createIncident.result.sys_id        -> deleteIncident.sysId
  - listIncidents.result[].sys_id       -> updateIncident.sysId
  - listUsers.items[].value             -> createIncident.assignedTo        (sys_user sys_id)
  - listUsers.items[].value             -> createIncident.callerId
  - listUserGroups.items[].value        -> createIncident.assignmentGroup
  - createChangeRequest.result.sys_id   -> updateChangeRequest.sysId
  - listChangeRequests.result[].sys_id  -> getChangeRequest.sysId
  - createProblem.result.sys_id         -> updateProblem.sysId
  - createRequestedItem.result.sys_id   -> updateRequestedItem.sysId
  - listCatalogItems.items[].value      -> createRequestedItem.catItem
  - listUsers.items[].value             -> createRequestedItem.requestedFor
  - listTables.items[].value            -> listTableRecords.tableName
  - listTables.items[].value            -> createTableRecord.tableName
  - createTableRecord.result.sys_id     -> getTableRecord.sysId
```

## 2.4 Method roster (what the Engineer builds)

Named-resource methods (5 primary resources × 5 CRUD verbs) + generic escape hatch (5) +
4 dictionaries + 3 OAuth SYSTEM. Destructive methods (`delete*`, and `update*`) carry
`destructive: true` + a `mock`.

```
Incident:        createIncident, getIncident, listIncidents, updateIncident, deleteIncident
ChangeRequest:   createChangeRequest, getChangeRequest, listChangeRequests, updateChangeRequest, deleteChangeRequest
Problem:         createProblem, getProblem, listProblems, updateProblem, deleteProblem
RequestedItem:   createRequestedItem, getRequestedItem, listRequestedItems, updateRequestedItem, deleteRequestedItem
User:            createUser*, getUser, listUsers, updateUser*, deleteUser*    (* ACL-gated, GATES)
Generic:         createTableRecord, getTableRecord, listTableRecords, updateTableRecord, deleteTableRecord
Dictionaries:    listTables, listUsers(dict), listUserGroups, listCatalogItems
SYSTEM:          getOAuth2ConnectionURL, executeCallback, refreshToken
```

> Note: `listUsers` serves double duty — it is both a first-class List User **action**
> (returns full records) and the **dictionary** backing user-reference params. The dictionary
> form is a separate `@registerAs DICTIONARY` method (`pickUser`) returning `{items:[{label,
> value,note}]}`; the action returns full records. They are different methods to keep shapes
> clean. (Roster lists `listUsers` action; the four DICTIONARIES are the picker methods
> `listTables`/`pickUser`/`listUserGroups`/`listCatalogItems`.)

## 2.5 Interface spec per method

Conventions: every method routes through one `#apiRequest(method, absoluteUrl, body?)`
factory that injects `Authorization: Bearer` and builds the base URL from `instanceUrl`.
All routes are `POST` (FlowRunner action rule) except the three OAuth SYSTEM methods.
`Array.<T>` dotted form everywhere. Reference-field params (sys_id) carry a `dictionary`.
Enum params are `DROPDOWN` with the `{value,label}` sets from §1.8.

### Shared shaping params (present on every list/get/create/update where useful)

| param | type | label | uiComponent | required | notes |
| --- | --- | --- | --- | --- | --- |
| `displayValues` | String | Value Format | DROPDOWN `[{value:"false",label:"Raw values"},{value:"true",label:"Display labels"},{value:"all",label:"Both"}]` | false | → `sysparm_display_value`, default `"true"` |
| `fields` | Array.<String> | Return Fields | MULTI_LINE_TEXT / freetext | false | → `sysparm_fields` (comma-joined); accepts array or comma string |

### Incident — createIncident
`@route POST /createIncident` · `@description Create a ServiceNow incident (outage/ticket).
Use when a flow needs to open a new incident; returns the new INC number and sys_id.`

| param | type | label | uiComponent | dropdown / dictionary | required |
| --- | --- | --- | --- | --- | --- |
| `shortDescription` → `short_description` | String | Short Description | SINGLE_LINE_TEXT | — | **true** |
| `description` → `description` | String | Description | MULTI_LINE_TEXT | — | false |
| `callerId` → `caller_id` | String | Caller | SINGLE_LINE_TEXT | dictionary: `pickUser` | false |
| `assignedTo` → `assigned_to` | String | Assigned To | SINGLE_LINE_TEXT | dictionary: `pickUser` | false |
| `assignmentGroup` → `assignment_group` | String | Assignment Group | SINGLE_LINE_TEXT | dictionary: `listUserGroups` | false |
| `category` → `category` | String | Category | DROPDOWN `[{value:"inquiry",label:"Inquiry / Help"},{value:"software",label:"Software"},{value:"hardware",label:"Hardware"},{value:"network",label:"Network"},{value:"database",label:"Database"}]` | — | false |
| `impact` → `impact` | String | Impact | DROPDOWN (impact set §1.8.1) | — | false |
| `urgency` → `urgency` | String | Urgency | DROPDOWN (urgency set §1.8.1) | — | false |
| `state` → `state` | String | State | DROPDOWN (state set §1.8.1) | — | false |
| `comments` → `comments` | String | Additional Comments (customer-visible) | MULTI_LINE_TEXT | — | false |
| `workNotes` → `work_notes` | String | Work Notes (internal) | MULTI_LINE_TEXT | — | false |

`@sampleResult`: `{ "result": { "number":"INC0010002", "sys_id":"<id>",
"short_description":"Unable to connect to email", "state":"1", "impact":"2", "urgency":"2",
"priority":"3" } }`
Body built: flat `{short_description, description, caller_id, assigned_to, assignment_group,
category, impact, urgency, state, comments, work_notes}` — omit nulls. Diffable against §1.5.

### Incident — getIncident
`@route POST /getIncident` · `@description Fetch one incident by its sys_id.`

| param | type | label | uiComponent | dictionary | required |
| --- | --- | --- | --- | --- | --- |
| `sysId` → path | String | Incident sys_id | SINGLE_LINE_TEXT | dictionary: `pickIncident`? → **use freetext + note** (no per-record dict; user comes from list) | **true** |
| `displayValues` | (shared) | | | | false |
| `fields` | (shared) | | | | false |

> Dictionary note: a per-record dictionary for "pick an incident" would page the whole
> incident table — not built. The sys_id comes from `listIncidents`/`createIncident` via the
> flow-handoff. `sysId` is required freetext with a description telling the user to feed it
> from List/Create Incident.

`@sampleResult`: `{ "result": { "number":"INC0000060", "sys_id":"...",
"short_description":"Unable to connect to email", "state":"1", "priority":"3" } }`

### Incident — listIncidents
`@route POST /listIncidents` · `@description List/search incidents. Filter with a ServiceNow
encoded query (e.g. active=true^priority=1) and page with limit/offset.`

| param | type | label | uiComponent | dropdown | required | default |
| --- | --- | --- | --- | --- | --- | --- |
| `query` → `sysparm_query` | String | Filter (encoded query) | SINGLE_LINE_TEXT | — | false | — |
| `limit` → `sysparm_limit` | Number | Page Size | NUMERIC_STEPPER | — | false | 50 |
| `offset` → `sysparm_offset` | Number | Offset | NUMERIC_STEPPER | — | false | 0 |
| `displayValues` | (shared) | | | | false | "true" |
| `fields` | (shared) | | | | false | — |

`@sampleResult`: `{ "result":[{ "number":"INC0000060","sys_id":"...","short_description":"...",
"state":"1","priority":"3" }], "next_offset": 50 }`

### Incident — updateIncident  (destructive: true)
`@route POST /updateIncident` · `@description Update fields on an incident by sys_id (PATCH —
only the fields you set are changed). Common: change state, reassign, add comments.`

Params: `sysId` (**true**, freetext, note "from List/Create Incident") + the SAME optional
field params as `createIncident` (all optional here). Body = PATCH of supplied columns only.
Diffable against §1.6. `mock`: returns the updated record echo.
`@sampleResult`: `{ "result": { "number":"INC0000060","sys_id":"...","state":"2",
"assigned_to":{"value":"..."} } }`

### Incident — deleteIncident  (destructive: true)
`@route POST /deleteIncident` · `@description Delete an incident by sys_id. Permanent.`

| param | type | label | uiComponent | required |
| --- | --- | --- | --- | --- |
| `sysId` → path | String | Incident sys_id | SINGLE_LINE_TEXT (note: from List/Create) | **true** |

Response 204 → method returns `{ deleted: true, sys_id }`. `mock`: `{deleted:true}`.

### ChangeRequest — create/get/list/update/delete
Identical method shapes to Incident, table `change_request`. Field params for create/update:
`shortDescription`→`short_description` (**true** on create), `description`, `type` (DROPDOWN
type set §1.8.2), `risk` (DROPDOWN risk set), `impact` (DROPDOWN impact set), `assignedTo`
(dict `pickUser`), `assignmentGroup` (dict `listUserGroups`), `state` (DROPDOWN state set
§1.8.2), `startDate`→`start_date` (DATE_TIME_PICKER), `endDate`→`end_date`
(DATE_TIME_PICKER). list/get/delete same param shape as Incident (sysId, query/limit/offset).
`@sampleResult` (get): `{ "result": { "number":"CHG0030001","sys_id":"...","type":"normal",
"state":"-5","risk":"3" } }`. Create body diffable against §1.5/§1.8.2.

### Problem — create/get/list/update/delete
Table `problem`. Create/update fields: `shortDescription` (**true**), `description`,
`impact` (DROPDOWN), `urgency` (DROPDOWN), `state` (DROPDOWN state set §1.8.3), `assignedTo`
(dict `pickUser`), `assignmentGroup` (dict `listUserGroups`). list/get/delete same shape.
`@sampleResult` (get): `{ "result": { "number":"PRB0040001","sys_id":"...","state":"1" } }`.

### RequestedItem — create/get/list/update/delete
Table `sc_req_item`. Create/update fields: `shortDescription` (**true**), `description`,
`catItem`→`cat_item` (dict `listCatalogItems`), `requestedFor`→`requested_for` (dict
`pickUser`), `quantity` (Number, NUMERIC_STEPPER, default 1), `state` (DROPDOWN state set
§1.8.4), `assignedTo` (dict `pickUser`). list/get/delete same shape.
`@sampleResult` (get): `{ "result": { "number":"RITM0050001","sys_id":"...","quantity":"1",
"state":"1" } }`.

### User — get/list (+ create/update/delete, ACL-gated)
Table `sys_user`.
- `getUser` params: `sysId` (**true**, freetext note "from List Users").
- `listUsers` params: `query` (`sysparm_query`, e.g. `active=true^emailLIKEacme.com`),
  `limit` (default 50), `offset`, `displayValues`, `fields`.
  `@sampleResult`: `{ "result":[{ "sys_id":"...","user_name":"abel.tuter",
  "first_name":"Abel","last_name":"Tuter","email":"abel.tuter@example.com","active":"true" }],
  "next_offset":50 }`
- `createUser`/`updateUser`/`deleteUser`: built, but each `@description` carries the
  parenthetical "(requires user admin rights on the connected account)". Create fields:
  `userName`→`user_name` (**true**), `firstName`→`first_name`, `lastName`→`last_name`,
  `email`, `phone`, `mobilePhone`→`mobile_phone`, `title`, `active` (TOGGLE, Boolean).
  Diffable against §1.5 generic create body. Flagged on GATES for Tier-4.

### Generic — createTableRecord / getTableRecord / listTableRecords / updateTableRecord / deleteTableRecord
The escape hatch over the Table API for any table not named above.

| param | type | label | uiComponent | dictionary / dropdown | required |
| --- | --- | --- | --- | --- | --- |
| `tableName` | String | Table | SINGLE_LINE_TEXT | dictionary: `listTables` | **true** |
| `fieldsData` | Object | Field Values | (Object) | **schemaLoader: `tableRecordSchema`** (see 2.6) — falls back to `freeform:true` | true (create) |
| `sysId` | String | Record sys_id | SINGLE_LINE_TEXT (note "from List Records") | — | true (get/update/delete) |
| `query`/`limit`/`offset`/`displayValues`/`fields` | shared list params | | | | false |

`createTableRecord` / `updateTableRecord` body = `fieldsData` flat object → matches §1.5/§1.6
body shape exactly (column→value map). `@sampleResult` (create): `{ "result": { "sys_id":"...",
"number":"..." } }`.

> **Object rule resolution (2.6):** `fieldsData` is a `type:"Object"` user-facing param and
> MUST NOT ship bare. Two designed options below; the Engineer builds Option A
> (`schemaLoader`). Only if `listTables` cannot resolve a table's columns at design-build
> time does it fall back to Option B (`freeform:true`) with the justification recorded.

## 2.6 schemaLoader design for the generic `fieldsData` Object param

**Option A (preferred) — dynamic schemaLoader `tableRecordSchema`:**
`@registerAs PARAM_SCHEMA_DEFINITION`, `dependsOn: ["tableName"]`. It calls the **Table
Schema / Meta** endpoint to read the chosen table's columns and returns a paramDef array
(one camelCase paramDef per writable column: `{name,label,type,uiComponent,required}`),
so the editor renders real fields instead of a JSON blob.

Schema source endpoint:
```
GET {InstanceURL}/api/now/ui/meta/{tableName}
-- or the dictionary table:
GET {InstanceURL}/api/now/table/sys_dictionary?sysparm_query=name={tableName}^active=true&sysparm_fields=element,column_label,internal_type,mandatory
```
citation: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html
(sys_dictionary is itself a Table API table — same GET contract as §1.3; element=column name,
column_label=label, internal_type=type, mandatory=required.)

verbatim_evidence (sys_dictionary read, quoted shape):
```
GET /api/now/table/sys_dictionary?sysparm_query=name=incident^active=true&sysparm_fields=element,column_label,internal_type,mandatory&sysparm_limit=5
{ "result":[ {"element":"short_description","column_label":"Short description","internal_type":"string","mandatory":"true"} ] }
```
citation: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-GET

**Option B (fallback) — `freeform: true` with justification:**
If schema resolution is unavailable for a chosen table, `fieldsData` ships as
`"freeform": true` justified: *"An arbitrary ServiceNow table's column set is not known
ahead of time; this is a genuine user-defined column→value map keyed by column names the
user chooses, not a catch-all additionalFields bag."* This justification is reviewer-judged
(review-checklist §13). The named resources (Incident/Change/Problem/RITM/User) NEVER use a
bare Object — their fields are first-class params, so the only Object in the whole extension
is this one generic escape hatch.

## 2.7 Dictionary method specs (all `@registerAs DICTIONARY`, input `{search,cursor,criteria}` → `{items:[{label,value,note}],cursor}`)

| dictionary | backing call | item.value | item.label | item.note |
| --- | --- | --- | --- | --- |
| `listTables` | curated static list of common OOB tables (incident, change_request, problem, sc_req_item, sc_task, task, sys_user, sys_user_group, cmdb_ci, kb_knowledge) merged with `GET /api/now/table/sys_db_object?sysparm_query=nameLIKE{search}&sysparm_fields=name,label&sysparm_limit=50` | `name` | `label` | `name` |
| `pickUser` | `GET /api/now/table/sys_user?sysparm_query=nameLIKE{search}^ORemailLIKE{search}^active=true&sysparm_fields=sys_id,name,email&sysparm_limit=50` | `sys_id` | `name` | `email` |
| `listUserGroups` | `GET /api/now/table/sys_user_group?sysparm_query=nameLIKE{search}^active=true&sysparm_fields=sys_id,name&sysparm_limit=50` | `sys_id` | `name` | — |
| `listCatalogItems` | `GET /api/now/table/sc_cat_item?sysparm_query=nameLIKE{search}^active=true&sysparm_fields=sys_id,name,short_description&sysparm_limit=50` | `sys_id` | `name` | `short_description` |

All four are plain Table API GETs (§1.3 contract) on system tables — same auth, same
envelope. `nameLIKE` is ServiceNow encoded-query "contains".
citation: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-GET
Encoded-query operators (`LIKE`, `^`, `^OR`, `=`):
https://docs.servicenow.com/bundle/xanadu-platform-user-interface/page/use/common-ui-elements/concept/c_OperatorsAvailableFiltersQueries.html

## 2.8 Error mapping (friendly, remediating)

| API condition | Friendly message |
| --- | --- |
| 401 / token expired | (auto) refresh token then retry; if still 401 → "Your ServiceNow connection expired — reconnect the account." |
| 403 ACL | "Your ServiceNow user lacks rights on table '{table}'. Ask an admin to grant access (or use a different account)." |
| 404 on sys_id | "No record found for that sys_id in '{table}'. Use the List action to pick a valid record." |
| 400 bad query | "Invalid filter. ServiceNow encoded-query example: active=true^priority=1." |
| 400 bad field | "Unknown field '{field}' on '{table}'. Use Return Fields with real column names." |
| 429 | "ServiceNow rate limit hit — retry shortly (your instance enforces REST rate limits)." |
| missing instanceUrl | "Set the Instance URL in the service config (e.g. https://dev12345.service-now.com)." |

---

## 2.9 Internal-consistency checklist (Architect self-verify)

- Every interface-spec paramDef traces to a CONTRACT entry (§1.3–§1.8). ✔
- Every flow-handoff field appears in the source method's `@sampleResult` and the target
  param is a real paramDef. ✔
- Every write endpoint (create/update/delete across all resources + generic) has
  `verbatim_evidence` (§1.5/§1.6/§1.7) — **no UNVERIFIABLE write endpoints.** ✔
- The only `type:"Object"` user-facing param (`fieldsData`) has a designed `schemaLoader`
  (Option A) with a justified `freeform` fallback (Option B). ✔
- Every primary resource is CRUD-complete; the one ACL-gated set (`sys_user` writes) is
  flagged on GATES. ✔
- Naming drops `-service`: folder `servicenow`, package `backendless-servicenow`, display
  name "ServiceNow". ✔
- Auth honored as decided: `@requireOAuth` + 3 SYSTEM methods + single `instanceUrl` config
  item; all URLs instance-relative. ✔

Ready for the Engineer.
