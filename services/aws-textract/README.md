# AWS Textract FlowRunner Extension

Extract text and structured data from documents with [Amazon Textract](https://aws.amazon.com/textract/). Supports optical character recognition (OCR), form and table extraction, natural-language queries, invoice/receipt analysis, and identity-document parsing — synchronously for single-page documents and asynchronously for large multi-page PDFs stored in Amazon S3. All requests are signed with AWS Signature Version 4 (hand-rolled, zero external dependencies) using the AWS JSON 1.1 protocol.

## Ideal Use Cases

- Running OCR on scanned images or PDFs to recover plain, machine-readable text
- Extracting form key-value pairs and tables from structured documents into workflow data
- Asking natural-language questions of a document and getting back direct answers
- Parsing invoices and receipts into header fields and line items for accounting automation
- Reading identity documents (driver's licenses, passports) into normalized identity fields
- Processing large multi-page PDFs stored in S3 through asynchronous jobs

## List of Actions

### Text Detection

- Detect Document Text

### Document Analysis

- Analyze Document
- Analyze Expense
- Analyze ID

### Asynchronous

- Start Document Text Detection
- Get Document Text Detection
- Start Document Analysis
- Get Document Analysis

## List of Triggers

This service does not define any triggers.

## Configuration

This integration reuses the shared AWS authentication model. Configure these items:

- **Authentication Method** — `API Key` (use your access key directly) or `IAM Role` (assume a role via STS AssumeRole for cross-account access).
- **Region** — AWS region code, e.g. `us-east-1`. Textract endpoints resolve to `textract.{region}.amazonaws.com`.
- **Access Key** / **Secret Key** — your AWS credentials (required for both methods).
- **IAM Role ARN** / **External ID** — used only with the `IAM Role` method.

The credentials need `textract:*` permissions for the operations you call, and `s3:GetObject` on any bucket you reference.

## Notes

### Document input: Bytes vs. S3

Every synchronous operation accepts the document in one of two ways:

- **File URL (inline bytes)** — provide a `File URL`; the file is downloaded and sent inline as base64 `Bytes`. Best for a **single-page** image (JPEG, PNG, TIFF) or single-page PDF up to roughly **5 MB**.
- **Amazon S3 object** — provide an `S3 Bucket` and `S3 Object Name`. The bucket must be in the **same region** as this integration. Required for the asynchronous operations. When both a File URL and S3 fields are supplied, S3 takes precedence.

Supported formats: **PNG, JPEG, PDF, TIFF**.

### Synchronous vs. asynchronous

- **Synchronous** operations (Detect Document Text, Analyze Document, Analyze Expense, Analyze ID) return results immediately but only process **single-page** images/PDFs within the size limits above.
- **Asynchronous** operations handle **large, multi-page PDFs (up to 500 MB / 3000 pages)** stored in S3. The flow is:
  1. Call **Start Document Text Detection** or **Start Document Analysis** → returns a `JobId`.
  2. Poll **Get Document Text Detection** or **Get Document Analysis** with that `JobId` until `JobStatus` is `SUCCEEDED` (other states: `IN_PROGRESS`, `PARTIAL_SUCCESS`, `FAILED`). The Get operations automatically paginate through all result pages for you. Async results are retained for 7 days.

### Feature types (Analyze Document / Start Document Analysis)

Select one or more **Feature Types**:

- `FORMS` — key-value pairs, returned as a convenience `forms` map.
- `TABLES` — tabular data, returned as simplified `tables` (rows of cells).
- `QUERIES` — natural-language questions (supply `queries` as `[{ "Text": "...", "Alias": "..." }]`); answers returned as a `queries` map keyed by alias/question.
- `SIGNATURES` — locate signatures.
- `LAYOUT` — reading order and layout elements.

### Convenience extraction

Raw Textract responses are flat lists of `Block` objects linked by relationships. This integration keeps the raw `blocks` available but also derives friendlier shapes: `text` (LINE blocks concatenated), `forms`, `queries`, `tables`, `summaryFields` / `lineItems` (invoice/receipt), and `fields` (identity documents, with value and confidence).

## Agent Ideas

- When a **Dropbox** "On New File" trigger fires with a scanned invoice, use **AWS Textract** "Analyze Expense" to extract vendor, total, and line items, then use **Google Sheets** "Add Row" to log the expense into an accounting spreadsheet.
- Use **S3 Storage** "Upload Object from URL" to stage a large multi-page PDF, call **AWS Textract** "Start Document Analysis" and poll "Get Document Analysis" until `SUCCEEDED`, then use **Slack** "Send Message To Channel" to post the extracted form fields to the team.
- When a **Gmail** "On New Attachment" trigger delivers an ID document, use **AWS Textract** "Analyze ID" to parse the identity fields, then use **Google Sheets** "Add Row" to record the applicant's normalized details for verification.
