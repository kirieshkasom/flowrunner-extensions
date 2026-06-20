# Supabase FlowRunner Extension

Integration with Supabase that exposes your Postgres database over the PostgREST API for reading and writing records. Provides full CRUD operations on any table with simple and advanced filtering, plus realtime and polling triggers that react to row-level changes.

## Ideal Use Cases

- Reading, inserting, updating, and deleting rows in Supabase tables from automated workflows
- Building AI agents that query and mutate application data with column-level selection and filtering
- Syncing records between Supabase and external services in real time
- Triggering downstream automation when rows are created, updated, or deleted
- Capturing webhook or form data as new database records
- Maintaining reporting and audit tables driven by database events

## List of Actions

- Delete Record
- Insert Record
- Select Records
- Update Record

## List of Triggers

- On Record Created
- On Record Deleted
- On Record Updated

## Agent Ideas

- When a **Supabase** "On Record Created" trigger fires for a new signup row, use **Gmail** "Send Message" to send the user a welcome email with their account details
- Use **Supabase** "Select Records" to pull a filtered set of rows, then call **Google Sheets** "Add Row" to mirror each record into a reporting spreadsheet
- When a **Supabase** "On Record Updated" trigger fires on an order status change, use **Slack** "Send Message To Channel" to notify the fulfillment team of the update
