# FreshBooks FlowRunner Extension

Cloud accounting integration for invoicing, payments, expenses, and project-based time tracking. Manage clients, invoices, estimates, expenses, payments, items, taxes, bills, vendors, projects, and time entries through a single connection, and pull financial reports — all secured with OAuth2.

## Ideal Use Cases

- Automating invoice creation, delivery, and payment recording for client billing
- Onboarding new clients and keeping contact and billing details in sync from external sources
- Tracking expenses, bills, and vendor payments for bookkeeping
- Converting accepted estimates into invoices and sending them automatically
- Logging billable time against projects and managing project rates
- Generating financial reports (Profit & Loss, Tax Summary, Aging) for dashboards and review
- Triggering downstream workflows when invoices, payments, or clients are created or updated

## List of Actions

**Clients**
- Find Clients
- Get Client
- Create Client
- Update Client
- Delete Client

**Invoices**
- Find Invoices
- Get Invoice
- Create Invoice
- Update Invoice
- Send Invoice
- Delete Invoice

**Estimates**
- Find Estimates
- Get Estimate
- Create Estimate
- Update Estimate
- Send Estimate
- Convert Estimate to Invoice
- Delete Estimate

**Expenses**
- Find Expenses
- Get Expense
- Create Expense
- Update Expense
- Delete Expense

**Payments**
- Find Payments
- Get Payment
- Record Payment
- Update Payment
- Delete Payment

**Items**
- Find Items
- Get Item
- Create Item
- Update Item
- Delete Item

**Taxes**
- Find Taxes
- Create Tax
- Update Tax
- Delete Tax

**Other Income**
- Find Other Income
- Record Other Income
- Update Other Income
- Delete Other Income

**Tasks**
- Find Tasks
- Create Task
- Update Task
- Delete Task

**Credit Notes**
- Find Credit Notes
- Get Credit Note
- Create Credit Note
- Update Credit Note
- Delete Credit Note

**Recurring Invoices**
- Find Recurring Invoices
- Get Recurring Invoice
- Create Recurring Invoice
- Update Recurring Invoice
- Delete Recurring Invoice

**Vendors**
- Find Vendors
- Create Vendor
- Update Vendor
- Delete Vendor

**Bills**
- Find Bills
- Get Bill
- Create Bill
- Update Bill
- Delete Bill

**Bill Payments**
- Find Bill Payments
- Record Bill Payment
- Update Bill Payment
- Delete Bill Payment

**Projects**
- Find Projects
- Get Project
- Create Project
- Update Project
- Delete Project

**Time Tracking**
- Find Time Entries
- Get Time Entry
- Log Time
- Update Time Entry
- Delete Time Entry

**Services**
- Find Services
- Create Service
- Set Service Rate

**Reports & Account**
- Get Financial Report
- Get Account Info

## List of Triggers

- Record Created or Changed

## Agent Ideas

- When a **FreshBooks** "Record Created or Changed" trigger fires for a new payment, use **Gmail** "Send Message" to email the client a thank-you and receipt with the amount and invoice number
- Use **Stripe** "List Charges" to pull recent card payments, then call **FreshBooks** "Record Payment" against the matching invoice so accounting stays reconciled with the payment processor
- When a **FreshBooks** "Record Created or Changed" trigger fires for a new invoice, use **Google Sheets** "Add Row" to log the invoice number, client, amount, and status into a billing tracking spreadsheet
