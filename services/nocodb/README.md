# NocoDB FlowRunner Extension

Connect FlowRunner to [NocoDB](https://nocodb.com), the open-source no-code database platform. This service reads and writes table records, manages linked (relational) records, and inspects base, table, field, and view metadata through the NocoDB **API v2**. It authenticates with an API token sent as the `xc-token` header and works with both NocoDB Cloud and self-hosted instances.

## Ideal Use Cases

- Sync records between NocoDB and other apps by listing, creating, updating, or deleting rows in a table.
- Look up a single record by primary key, or filter and page through large tables using NocoDB `where` filter syntax.
- Maintain relationships by listing, linking, and unlinking related records across tables.
- Provision structure programmatically by creating tables with typed columns.
- Inspect base, table, field, and view metadata to drive dynamic automations.

## List of Actions

### Records

- Count Records
- Create Records
- Delete Records
- Get Record
- List Records
- Update Records

### Linked Records

- Link Records
- List Linked Records
- Unlink Records

### Bases & Tables

- Create Table
- Get Base
- Get Table
- List Bases
- List Tables

### Views

- List Views

## List of Triggers

This service does not define any triggers.

## Configuration

| Config item | Required | Description |
| --- | --- | --- |
| **Instance URL** | Yes | The base URL of your NocoDB instance. Any trailing slash is removed automatically. |
| **API Token** | Yes | A NocoDB API token, sent on every request as the `xc-token` header. |

### Cloud vs. self-hosted Instance URL

- **NocoDB Cloud:** `https://app.nocodb.com`
- **Self-hosted:** the origin of your deployment, e.g. `https://nocodb.example.com`

Do not include a path — the service appends `/api/v2` itself.

### Creating an API token

1. In NocoDB, open the **account menu** (your avatar, top-right).
2. Go to **Account Settings → Tokens**.
3. Click **Create new token**, give it a name, and copy the generated value.
4. Paste it into the **API Token** config item.

The token is sent as the `xc-token` request header and scopes access to whatever the issuing user can see.

## Identifiers

NocoDB API v2 addresses data by **table ID** (e.g. `m_xyz789`), not by table name. Use the built-in dictionaries (the base/table/field/view dropdowns on each operation) to look up the IDs. Field parameters generally use field **titles**; link and view parameters use their **IDs**.

## The `where` filter syntax

List Records and Count Records accept a NocoDB `where` expression. Each condition is `(field,operator,value)`, and conditions are combined with `~and` or `~or`:

```
(Status,eq,Active)~and(Age,gt,21)
(Country,eq,US)~or(Country,eq,CA)
```

Common operators:

| Operator | Meaning |
| --- | --- |
| `eq` / `neq` | equals / not equals |
| `gt` / `ge` | greater than / greater or equal |
| `lt` / `le` | less than / less or equal |
| `like` / `nlike` | contains / does not contain |
| `in` | value in a comma-separated set |
| `isnull` / `notnull` | is null / is not null |
| `isblank` / `notblank` | is blank / is not blank |

## Agent Ideas

- Use **Airtable** "Get Records" to pull rows from an Airtable base, then call **NocoDB** "Create Records" to migrate or mirror them into a NocoDB table.
- On a schedule, call **NocoDB** "List Records" with a `where` filter for new or changed rows, then use **Slack** "Send Message To Channel" to notify the team of matching records.
- Use **Google Sheets** "Get Rows" to read spreadsheet data, then call **NocoDB** "Create Records" (or "Update Records" by primary key) to keep a NocoDB table in sync with the sheet.
