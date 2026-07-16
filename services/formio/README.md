# Form.io FlowRunner Extension

Manage Form.io forms, their field definitions, and the submissions collected against them directly from your FlowRunner flows. Authenticates with a project-scoped API key sent in the `x-token` header.

## Ideal Use Cases

- Programmatically create and update forms and resources, keeping field definitions in sync across environments.
- Push external records into Form.io as submissions, or read submissions out into other systems.
- Validate a project connection and inspect a form's component keys before automating submission workflows.
- Audit a project's forms, form actions, and roles.

## Authentication

Form.io authenticates each request with an **API key** sent in the `x-token` header. Configure two values:

| Config | Description |
| --- | --- |
| **Project URL** | Your Form.io project base URL, e.g. `https://examplxyz.form.io`. Strip any trailing slash. All requests are made against this base. |
| **API Key** | A Form.io API key. Create one in the Form.io portal under **Project Settings → API Keys → Add API Key**. It is sent as the `x-token` header on every request. |

Use **Get Current User** as a connection check: a successful response confirms the project URL and API key are valid.

## Forms and the component-key model

Every form has a **path** (a unique URL segment) and a **components** array that defines its fields. Each component has a `key`, and that key is the property name used inside a submission's `data` object.

- **Get Form** returns the components array — inspect it to discover the exact `key` values a form expects.
- When you **Create** or **Update** a submission, the `data` object you send is keyed by those component keys, e.g. `{ "firstName": "Jane", "email": "jane@example.com" }`.

Operations that take a form accept **either** the form `_id` **or** the form `path`; both resolve server-side. Form.io uses `limit`/`skip` pagination, with total counts returned in the `Content-Range` response header.

## List of Actions

### Forms
- Create Form
- Delete Form
- Get Form
- List Form Actions
- List Forms
- Update Form

### Submissions
- Create Submission
- Delete Submission
- Get Submission
- List Submissions
- Update Submission

### Roles
- List Roles

### Connection
- Get Current User

## List of Triggers

This service does not define any triggers.

## Agent Ideas

- Use Form.io **List Submissions** to pull new form entries, then **Google Sheets** "Add Row" to append each submission's data into a tracking spreadsheet.
- When a submission is retrieved via Form.io **Get Submission**, use **Gmail** "Send Message" to email a formatted confirmation or notification to the submitter.
- After Form.io **Create Submission** captures a lead, post an alert to a team channel with **Slack** "Send Message To Channel" so staff can follow up immediately.
