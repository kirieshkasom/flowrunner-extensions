# Sage Intacct FlowRunner Extension

Connect FlowRunner to [Sage Intacct](https://www.sage.com/en-us/sage-business-cloud/intacct/), the cloud financial management and ERP accounting platform, via OAuth2. This extension wraps the Sage Intacct REST API to provide generic CRUD over 400+ object types plus dedicated operations across Accounts Payable, Accounts Receivable, Cash Management, Contracts and Revenue Management, and Purchasing. Object types, records, bank accounts, customers, and credit card accounts are surfaced through searchable dictionaries, and record forms are generated dynamically from Sage Intacct's schema.

## Ideal Use Cases

- Create, read, update, delete, and list records of any Sage Intacct object type from a single set of generic operations.
- Automate Accounts Receivable workflows: submit, reverse, reclassify, and generate PDFs for invoices, adjustments, advances, payments, and customer refunds.
- Manage Accounts Payable approvals by approving or declining vendors.
- Reconcile and correct Cash Management activity: reverse fees, deposits, receipts, and transfers, reopen reconciliations, and triage bank transactions.
- Drive Contracts and Revenue Management lifecycles: post, renew, expire, hold, resume, and uncancel contracts and revenue schedule lines.
- Route Purchasing documents through approval by submitting, approving, or declining them.
- Manage employee Expenses end to end: create and list expense reports, lines, summaries, adjustments, and electronic receipts, then submit, approve, or decline them by updating the report's `state` field.
- Attach scanned or digital receipts (PDFs and other files) by uploading Base64-encoded file content into an attachment container, then link it to an expense report, adjustment, or electronic receipt.

## List of Actions

### Records

- Create Record
- Get Record
- Update Record
- Delete Record
- List Records

### Accounts Payable

- Approve a vendor
- Decline a vendor

### Accounts Receivable

- Submit an adjustment
- Reclassify an adjustment
- Reverse an adjustment
- Submit an advance
- Reverse an advance
- Submit a customer refund
- Reverse a customer refund
- Submit an invoice
- Reclassify an invoice
- Reverse an invoice
- Generate a PDF of an invoice
- Submit an AR payment
- Reverse a payment

### Cash Management

- Reverse a bank fee
- Reopen a bank reconciliation
- Assign customer to a bank transaction
- Ignore a bank transaction
- Stop ignoring a bank transaction
- Reverse a credit card fee
- Reopen a credit card reconciliation
- Reverse a credit card transaction
- Reverse a deposit
- Reverse a funds transfer
- Reverse an other receipt

### Contracts and Revenue Management

- Post a contract
- Renew a contract
- Expire a contract
- Uncancel a contract
- Hold contract schedules
- Resume contract schedules
- Clear all MEA allocations
- Clear last active MEA allocation
- Post a revenue schedule line
- Unpost a revenue schedule line

### Purchasing

- Submit a purchasing document
- Approve a purchasing document
- Decline a purchasing document

## Dynamic Records and Dictionaries

The generic Records operations (Create, Get, Update, Delete, List) work against any of Sage Intacct's 400+ object types spanning modules such as Accounts Payable, Accounts Receivable, Cash Management, Company Configuration, Consolidations, Construction, Contracts and Revenue Management, Expenses, Fixed Assets Management, General Ledger, Inventory Control, Order Entry, Project and Resource Management, Purchasing, Reports, Tax, and Time. Select the object type first, and the record form fields are generated dynamically from the Sage Intacct schema. Selections are backed by searchable dictionaries for object types, records, bank accounts, customers, and credit card accounts.

The **Expenses** module surfaces employee-expense object types through these same generic operations, including Expense Report (`expenses/employee-expense`), Expense Report Line, Expense Summary, Expense Type, Expense Payment Type, Expense Adjustment and Adjustment Line, Unit Rate, Electronic Receipt and Receipt Line, and Expense To Approve and its lines. Sage Intacct exposes no dedicated submit/approve/decline endpoint for expense reports, so move a report through its lifecycle with Update Record by setting the `state` field (for example `draft`, `submitted`, `partiallyApproved`, `partiallyDeclined`, `approved`, `declined`, `posted`, `paid`, `reversed`, or `voided`).

To attach supporting documents, use Create Record or Update Record on the `company-config/attachment` object type: its **Files** field accepts an array of objects, each with a `name` (file name with extension) and `data` (Base64-encoded file content), for example `[{"name":"receipt.pdf","data":"<base64>"}]`. This uploads actual file content — such as a scanned receipt — rather than an empty attachment container, and the resulting attachment can be referenced by an expense report, expense adjustment, electronic receipt, or any other object with an Attachment field.

## Authentication

This service uses OAuth2 (`@requireOAuth`). Register an application in the [Sage Developer Portal](https://developer.sage.com/) to obtain your credentials, then configure:

- **Client ID** — OAuth 2.0 Client ID from the Sage Developer Portal.
- **Client Secret** — OAuth 2.0 Client Secret from the Sage Developer Portal.

Both are shared config items. Once configured, connect an account through the standard FlowRunner OAuth flow.

## Agent Ideas

- After **Sage Intacct** "Generate a PDF of an invoice", use **Gmail** "Send Message" to email the invoice PDF to the customer.
- Use **Google Sheets** "Get Rows" to read a batch of new vendor bills, then call **Sage Intacct** "Create Record" for each to sync them into the ledger.
- When an approval is needed, use **Sage Intacct** "List Records" to find pending purchasing documents and **Slack** "Send Message To Channel" to alert the finance team before calling "Approve a purchasing document".
