# GoHighLevel FlowRunner Extension

All-in-one GoHighLevel CRM integration for managing contacts, opportunities, conversations, calendar, businesses, tasks, notes, tags, workflows, forms, invoices, and products. Automate lead management, deal tracking, multi-channel messaging, invoicing, and scheduling through OAuth2 authentication.

## Ideal Use Cases

- Automating lead capture, contact management, and tagging across channels
- Tracking sales opportunities through pipeline stages with status updates
- Sending multi-channel messages (SMS, Email, WhatsApp) to contacts
- Scheduling and managing calendar appointments for sales and support
- Managing invoices, products, and billing workflows
- Building automated follow-up sequences with tasks and notes

## List of Actions

### Contacts
- Create Contact
- Delete Contact
- Get Contact By ID
- Search Contacts
- Update Contact

### Opportunities
- Create Opportunity
- Delete Opportunity
- Get Opportunity By ID
- Search Opportunities
- Update Opportunity
- Update Opportunity Status

### Conversations
- Delete Conversation
- Get Conversation By ID
- Get Messages
- Send Message

### Calendar
- Create Appointment
- Get Appointment By ID
- List Calendars
- Update Appointment

### Businesses
- Create Business
- Delete Business
- Get Business By ID
- List Businesses
- Update Business

### Tasks
- Create Task
- Delete Task
- Get Task By ID
- List Tasks
- Update Task

### Notes
- Create Note
- Delete Note
- Get Note By ID
- List Notes
- Update Note

### Tags
- Add Tags To Contact
- Create Tag
- List Tags
- Remove Tags From Contact

### Workflows
- Trigger Workflow

### Forms
- Get Form Submissions
- List Forms

### Invoices
- Create Invoice
- Get Invoice By ID
- List Invoices
- Send Invoice
- Update Invoice

### Products
- Create Product
- Create Product Price
- Delete Product
- Get Product By ID
- List Products
- Update Product

## Agent Ideas

- Use **GoHighLevel** "Search Contacts" to find new leads, then call **Gmail** "Send Message" to deliver a personalized welcome email with onboarding instructions
- When a **Google Sheets** "On New Row" trigger fires with a new lead entry, use **GoHighLevel** "Create Contact" to add the lead and "Create Opportunity" to open a deal in the pipeline
- After **GoHighLevel** "Update Opportunity Status" marks a deal as won, use **Slack** "Send Message To Channel" to notify the team with the deal details
