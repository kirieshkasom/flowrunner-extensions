# Bubble FlowRunner Extension

Connect FlowRunner to a [Bubble](https://bubble.io) app's **Data API** and **Workflow API** using a bearer API token. Read, search, create, modify, replace, delete, and bulk-import database records ("things"), and trigger backend (API) workflows against your app's Live or Development branch.

## Ideal Use Cases

- Sync records between a Bubble app's database and external systems (CRMs, spreadsheets, sheets).
- Query a data type with search constraints to fetch filtered, sorted, paginated result sets.
- Create or bulk-import records into Bubble from incoming data or file uploads.
- Keep records current by partially modifying or fully replacing things.
- Fire off Bubble backend workflows from an automation, passing in parameters.

## List of Actions

### Data

- Get Thing
- List / Search Things
- Create Thing
- Modify Thing
- Replace Thing
- Delete Thing
- Bulk Create Things

### Workflow

- Trigger Workflow

## List of Triggers

This service does not define any triggers.

## Authentication

Bubble uses a bearer API token.

1. Open your Bubble app and go to **Settings -> API**.
2. Check **"This app exposes a Data API"** (and select the data types you want to expose).
3. Under **API Tokens**, generate a token.

Every request is sent with the header `Authorization: Bearer <API Token>`.

### Configuration

| Item | Required | Description |
| --- | --- | --- |
| **App URL** | Yes | Your app URL, e.g. `https://myapp.bubbleapps.io` or a custom domain. Omit any trailing slash and any `/version-test` path. |
| **API Token** | Yes | The token generated in Settings -> API. |
| **Environment** | No | `Live` (default) or `Development`. |

### Live vs. Development

Bubble apps have two branches. The service builds the base URL from your **App URL** and the selected **Environment**:

- **Live** -> `{App URL}/api/1.1`
- **Development** -> `{App URL}/version-test/api/1.1`

Choose **Development** to test against your app's version-test branch before deploying to Live.

## Data API

The Data API operates on **things** (database records). The **Data Type** parameter is the lowercase, singular name of the type as defined in your app's database (for example `user`, `order`, `blog_post`). Because Bubble type and field names are app-specific, they are free-text parameters — enter the exact names from your app.

Each thing includes Bubble's built-in fields: `_id`, `Created Date`, `Modified Date`, and `Created By`.

- **Get Thing** — retrieve one thing by its `_id`.
- **List / Search Things** — retrieve a filtered, sorted, paginated list of things.
- **Create Thing** — create one thing from a fields object; returns the new `id`.
- **Modify Thing** — partially update a thing (only the fields you supply change).
- **Replace Thing** — fully replace a thing (fields you omit are cleared).
- **Delete Thing** — permanently delete a thing by `_id`.
- **Bulk Create Things** — create many things in one call from an array of objects.

### Search constraints

**List / Search Things** accepts a **Constraints** parameter: a JSON array of constraint objects. Each object has three keys:

```json
[
  { "key": "status", "constraint_type": "equals", "value": "active" },
  { "key": "age",    "constraint_type": "greater than", "value": 18 }
]
```

Supported `constraint_type` values:

| constraint_type | Meaning |
| --- | --- |
| `equals` / `not equal` | Strict equality / inequality on a field. |
| `is_empty` / `is_not_empty` | Whether a field is empty (for non-list fields). |
| `text contains` / `not text contains` | Whether a text field contains the given string (respects word stems). |
| `greater than` / `less than` | Numeric or date comparison against the value. |
| `in` / `not in` | Whether the field value is in the provided list. |
| `contains` / `not contains` | Whether a list field contains the given entry. |
| `empty` / `not empty` | Whether a list field is empty (list fields only). |
| `geographic_search` | Match things within a radius of a central address (geographic address fields). |

Additional list parameters:

- **Sort Field** — a field name to sort by (e.g. `Created Date`).
- **Descending** — sort descending when enabled (requires Sort Field).
- **Limit** — max results per call (1–100; server default is 100).
- **Cursor** — zero-based offset of the first result, for pagination.

List responses are returned wrapped under `response`:

```json
{
  "response": {
    "results": [ /* things */ ],
    "cursor": 0,
    "count": 1,
    "remaining": 0
  }
}
```

Page through large result sets by adding `count` to your previous `cursor` until `remaining` is 0.

### Bulk Create

**Bulk Create Things** takes an array of objects and submits them to Bubble as newline-delimited JSON (`Content-Type: text/plain`). The response is a per-line result list, one entry per input object, each reporting success (with the new `id`) or an error.

## Workflow API

**Trigger Workflow** runs a Bubble backend **API workflow** by endpoint name and passes a parameters object as a JSON body:

- The workflow must be defined under **Backend Workflows** and exposed as a public API workflow.
- Its authentication settings must permit the API token.
- The response is whatever the workflow's response step returns.

The Development environment targets `/version-test/api/1.1/wf/...` so you can test workflows on the version-test branch.

## Errors

Bubble returns errors as `{ statusCode, body: { status, message } }`. The service surfaces the message and status, for example: `Bubble API error (404): Missing data type`.

## Agent Ideas

- Use **Airtable** "Get Records" to pull rows from a base, then call **Bubble** "Bulk Create Things" to import them into a Bubble data type in one pass.
- After **Bubble** "List / Search Things" returns filtered records, use **Google Sheets** "Add Row" to log each result into a reporting spreadsheet.
- When new data arrives, call **Bubble** "Create Thing" and then **Slack** "Send Message To Channel" to notify a team channel that the record was created.
