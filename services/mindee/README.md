# Mindee FlowRunner Extension

Document parsing and OCR powered by [Mindee](https://www.mindee.com/) using the **Mindee V2 API** (app.mindee.com). Extract structured data from any Mindee model — prebuilt models for invoices, receipts, financial documents, IDs, passports, resumes, and US driver licenses, or your own custom-built models — by referencing the model's ID. Authenticates with a Mindee API Key sent as the raw `Authorization: <key>` header.

## Ideal Use Cases

- Automate invoice and receipt data entry into accounting or ERP systems
- Onboard candidates by parsing resumes/CVs into structured profiles
- Verify identity from passports, national ID cards, or US driver licenses
- Run documents through your own custom-trained or generated Mindee models

## List of Actions

### Extraction

- Extract Document — enqueue a document, wait for the result, and return flattened fields
- Enqueue Inference — enqueue a document and return the job (for webhook/high-volume flows)

### Jobs

- Get Job Status — poll an inference job by id
- Get Inference Result — fetch a completed inference and return flattened fields

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses an API key. Create one in the Mindee platform ([app.mindee.com](https://app.mindee.com)) under **API Keys** and paste it into the service configuration.

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| API Key     | Yes      | Sent on every request as the raw `Authorization: <key>` header (no `Bearer`/`Token` prefix). |

Base URL: `https://api-v2.mindee.net/v2`.

## Models

Mindee V2 selects models by a **Model ID** (a UUID). Create a model in the Mindee platform from the catalog — this covers both prebuilt models (Invoice, Receipt, Financial Document, International ID, Passport, Resume, US Driver License, and more) and custom models you build yourself — and copy its Model ID from the model's page. Pass that ID to **Extract Document** or **Enqueue Inference**.

## Document input

Every action takes a **Document URL**. The service downloads the bytes at that URL and uploads them to Mindee as a multipart `file` field, so the URL can be:

- a publicly reachable file URL (PDF, JPG, PNG, WEBP, TIFF, HEIC), or
- a FlowRunner file URL produced elsewhere in your flow.

## Asynchronous processing

The Mindee V2 API is **asynchronous only**. Every parse follows the same flow:

1. **Enqueue** the file at `POST /v2/products/extraction/enqueue` with the `model_id` and `file`. This returns a **job** (`{ job: { id, status, polling_url, result_url } }`).
2. **Poll** the job at `GET /v2/jobs/{job_id}` until `status` is `Processed` or `Failed`.
3. **Fetch** the result at `GET /v2/products/extraction/results/{inference_id}`, which returns `{ inference: { result: { fields } } }`.

**Extract Document** performs all three steps in one call and returns the flattened result (allow up to ~1 minute for large or multi-page documents). For high-volume or webhook-driven flows, use **Enqueue Inference** to get the job immediately, then **Get Job Status** and **Get Inference Result** (or a configured Mindee webhook) to retrieve the outcome later.

## Output shape

**Extract Document** and **Get Inference Result** return:

```json
{ "fields": { /* flattened values (simple, nested objects, and lists) */ }, "raw": { "inference": { /* full V2 inference */ } } }
```

Each V2 result field is one of a simple value (`{ value }`), a list (`{ items: [...] }`), or a nested object (`{ fields: {...} }`). The service flattens these into plain values, nested objects, and arrays under `fields`, and returns the complete inference under `raw` so you can read confidence levels, polygons, and OCR text when enabled.

## Errors

On failure the V2 API returns an RFC 9457 problem document: `{ "status", "title", "detail", "code", "errors": [{ "pointer", "detail" }] }`. The service surfaces `detail` (plus any per-field `errors[].detail`) and the HTTP status in the thrown error.

## Migration note (V1 → V2)

This extension targets Mindee's current **V2** API. The legacy **V1** surface (`https://api.mindee.net/v1/products/{account}/{endpoint}/vN/predict` with an `Authorization: Token <key>` header, selecting off-the-shelf products by account/endpoint/version path) is the older platform.mindee.com product and is not used here. V2 replaces the synchronous per-product `/predict` paths with a single asynchronous enqueue/poll/result flow driven by a `model_id`.

## Agent Ideas

- When a **Google Drive** "On New File" trigger fires for an uploaded bill, call **Mindee** "Extract Document" with your Invoice model and then use **QuickBooks Online** "Create Invoice" to record it automatically.
- Use **Mindee** "Extract Document" with your Receipt model on an expense image, then **Google Sheets** "Add Row" to append the merchant, date, total, and tax to an expense-tracking spreadsheet.
- When a candidate's CV lands via **Google Drive** "On New File", run **Mindee** "Extract Document" with your Resume model and use **HubSpot** "Create Contact" to add the candidate with their extracted name, email, and phone.
