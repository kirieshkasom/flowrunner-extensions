# Mindee FlowRunner Extension

Document parsing and OCR powered by [Mindee](https://www.mindee.com/). Extract structured data from invoices, receipts, financial documents, IDs, passports, resumes, US driver licenses, and any custom-built model. Authenticates with a Mindee API Key sent as an `Authorization: Token <key>` header.

## Ideal Use Cases

- Automate invoice and receipt data entry into accounting or ERP systems
- Onboard candidates by parsing resumes/CVs into structured profiles
- Verify identity from passports, national ID cards, or US driver licenses
- Run documents through your own custom-trained or generated Mindee models

## List of Actions

### Financial

- Parse Financial Document
- Parse Invoice
- Parse Receipt

### Identity

- Parse ID Document
- Parse Passport
- Parse US Driver License

### HR

- Parse Resume

### Custom Models

- Parse Custom Document
- Parse Document (Generic)

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses an API key. Create one in the Mindee platform under **API Keys** and paste it into the service configuration.

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| API Key     | Yes      | Sent on every request as the `Authorization: Token <key>` header. |

Base URL: `https://api.mindee.net/v1`.

## Document input

Every operation takes a **Document URL**. The service downloads the bytes at that URL and uploads them to Mindee as a multipart `document` file field, so the URL can be:

- a publicly reachable file URL (PDF, JPG, PNG, WEBP, TIFF, HEIC), or
- a FlowRunner file URL produced elsewhere in your flow.

## Product / version model

Mindee organizes models by account, product, and version: `POST /v1/products/{account}/{product}/v{version}/predict`. Off-the-shelf products live under the `mindee` account (e.g. `mindee/invoices/v4`); custom models live under your own account name.

- **Parse Custom Document** targets a model you built on the Mindee platform — supply your account name, the endpoint (model) name, and the version (the `v` prefix is added automatically).
- **Parse Document (Generic)** is the escape hatch for any product — supply the full path after `/v1/products/`, including version (e.g. `mindee/us_mail/v3`).

## Convenience vs. raw output

The dedicated product actions (Parse Invoice, Parse Receipt, Parse Financial Document, Parse ID Document, Parse Passport, Parse Resume, Parse US Driver License) return:

```json
{ "fields": { /* flattened, easy-to-use values */ }, "raw": { /* full Mindee response */ } }
```

Use `fields` for a clean, ready-to-map subset, and `raw` when you need the complete `document.inference.prediction` with per-field confidence scores, bounding boxes, and pages.

The **Parse Custom Document** and **Parse Document (Generic)** actions return the raw Mindee response directly (no flattening), so you can read any field your model defines.

| Operation | Product | Output |
| --------- | ------- | ------ |
| Parse Invoice | `mindee/invoices` | Flattened invoice fields + raw |
| Parse Receipt | `mindee/expense_receipts` | Flattened receipt fields + raw |
| Parse Financial Document | `mindee/financial_document` | Invoice **or** receipt (auto-detected) + raw |
| Parse ID Document | `mindee/international_id` | Identity fields + raw |
| Parse Passport | `mindee/passport` | Passport identity fields + raw |
| Parse Resume | `mindee/resume` | Candidate details, skills, experience + raw |
| Parse US Driver License | `mindee/us_driver_license` | License fields + raw |
| Parse Custom Document | `{account}/{endpoint}/v{version}` | Raw prediction for a custom/generated model |
| Parse Document (Generic) | any product path | Raw prediction (escape hatch) |

## Synchronous vs. asynchronous parsing

These operations use Mindee's **synchronous** `/predict` endpoint, which most products support and which returns the result in a single call. Some products (and large multi-page documents) also support asynchronous parsing via `/predict_async` plus polling `/documents/queue/{id}`. That async flow is not implemented here; the synchronous predict path covers the standard use cases.

## Errors

On failure Mindee returns `{ "api_request": { "status", "status_code", "error": { "message" } } }`. The service surfaces `api_request.error.message` (and the HTTP status) in the thrown error.

## Agent Ideas

- When a **Google Drive** "On New File" trigger fires for an uploaded bill, call **Mindee** "Parse Invoice" and then use **QuickBooks Online** "Create Invoice" to record it automatically.
- Use **Mindee** "Parse Receipt" on an expense image, then **Google Sheets** "Add Row" to append the merchant, date, total, and tax to an expense-tracking spreadsheet.
- When a candidate's CV lands via **Google Drive** "On New File", run **Mindee** "Parse Resume" and use **HubSpot** "Create Contact" to add the candidate with their extracted name, email, and phone.
