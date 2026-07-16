# Ortto FlowRunner Extension

Integrate [Ortto](https://ortto.com) (formerly Autopilot) with FlowRunner. Ortto is centered on **people** (contacts) and **activities**, using a merge-based upsert model and a typed **field-id** naming convention. Authenticate with an Ortto API key sent as the `X-Api-Key` header.

## Ideal Use Cases

- Sync contacts from forms, checkouts, or CRMs into Ortto, matching by email so records merge instead of duplicating.
- Record custom activity events against people to drive Ortto journeys and reporting.
- Look up a person by email, or page through people with field/filter selection, to enrich other workflows.
- Discover custom person field ids so downstream steps can address the right typed fields.

## List of Actions

### People

- Merge or Create Person
- Get People
- Get Person by Email

### Activities

- Create Custom Activity

### Fields

- Get Custom Fields

## List of Triggers

This service does not define any triggers.

## Configuration

| Config item | Required | Notes |
| ----------- | -------- | ----- |
| API Key     | Yes      | Ortto → Settings → API keys → create a custom API key. Sent as the `X-Api-Key` header. |
| Region      | No       | `Global (Default)`, `Australia`, or `Europe`. Selects the correct regional API host. |

### Regional hosts

Ortto serves the API from region-specific hosts. Select the one matching your instance region; all endpoints are under the `/v1` path (e.g. `https://api.ap3api.com/v1/person/merge`).

| Region            | Host                        |
| ----------------- | --------------------------- |
| Global (Default)  | `https://api.ap3api.com`    |
| Australia         | `https://api.au.ap3api.com` |
| Europe            | `https://api.eu.ap3api.com` |

## Notes

### Field-id convention

Ortto addresses every person/activity field by a **typed field id**. Built-in fields use the form `type::name` (e.g. `str::email`, `str::first`, `str::last`, `phn::phone`); custom fields use `type:cm:name` (e.g. `str:cm:job-title`). The prefix encodes the data type (`str` string, `bol` boolean, `int` integer, `phn` phone, `geo` geo, `dtz` date, etc.).

- `str::` string and `bol::` boolean fields take **plain values**.
- `phn::` phone, `geo::` geo and `dtz::` date fields take **object values** — e.g. `phn::phone` is `{ "phone": "61401234567", "parse_with_country_code": true }` and `geo::city` is `{ "name": "Melbourne" }`. Supply these via **Raw Fields**.

This service accepts plain `Email` / `First Name` / `Last Name` / `Phone` values and maps them to the standard ids for you; custom fields (and any object-valued fields) are addressed by their own ids via the **Raw Fields** passthrough, which is merged on top of and overrides the convenience values. Use **Get Custom Fields** to discover the ids defined in your account.

### Merge-based upsert

There is no separate create vs update. **Merge or Create Person** upserts: Ortto matches an existing person by email (`str::email`) and merges the supplied fields, or creates a new person if none matches. **Merge Strategy** controls how existing values are treated — `Overwrite existing` (default) updates all provided fields, `Append only` fills empty fields without changing existing ones, and `Ignore` never updates a matched person but still creates one when none matches. By default merges run **asynchronously** — Ortto queues the operation and returns a per-person status acknowledgement rather than the finished person.

### Custom activities

**Create Custom Activity** records an event against a person. **Person Fields** identifies (and can set data on) the person by field ids (usually `str::email`), **Merge By** lists the field ids used to match an existing person (defaults to `str::email`), and **Attributes** carries the activity's own payload keyed by that activity's field ids (e.g. `str:cm:destination`, `int::v`). The person is created if they do not yet exist; up to 50 events per activity per contact per 24h are accepted.

## Agent Ideas

- Use **Typeform** "Get Form Responses" to pull new form submissions, then call **Ortto** "Merge or Create Person" to upsert each respondent by email with their answers mapped to Raw Fields.
- After **Shopify** "Get List of Orders" returns recent purchases, call **Ortto** "Create Custom Activity" to record a purchase event against each customer to trigger post-sale journeys.
- When a **Calendly** "On Invitee Created" trigger fires, call **Ortto** "Merge or Create Person" to sync the booker's details and "Create Custom Activity" to log the booking for follow-up automation.
