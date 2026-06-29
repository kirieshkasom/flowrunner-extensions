# DynamoDB FlowRunner Extension

Zero-dependency integration with Amazon DynamoDB using native AWS Signature V4 signing (Node crypto). Read, write, query, and scan tables with items exposed as plain JSON — values are automatically marshalled to and from DynamoDB's typed attribute-value format. Supports two authentication methods: direct API Key credentials or IAM Role via STS AssumeRole for cross-account access.

## Ideal Use Cases

- Persisting workflow data, events, or records into a DynamoDB table from automated flows
- Looking up single items or batches of items by primary key for downstream processing
- Querying tables or secondary indexes with key conditions and filters, paginating through large result sets
- Scanning a table to export, audit, or migrate its contents
- Running ad-hoc PartiQL (SQL-compatible) statements against DynamoDB
- Bulk loading or removing many items in a single step with automatic batching and retry of unprocessed items
- Discovering a table's primary key and schema before reading or writing

## List of Actions

- Batch Get Items
- Batch Write Items
- Delete Item
- Describe Table
- Execute Statement (PartiQL)
- Get Item
- Put Item
- Query
- Scan
- Update Item

## Configuration

- **Authentication Method** — `API Key` (access key directly) or `IAM Role` (STS AssumeRole with a Role ARN for cross-account access).
- **Region** — AWS region code, e.g. `us-east-1`.
- **Access Key** / **Secret Key** — AWS credentials, required for both methods.
- **IAM Role ARN** — role to assume, required for IAM Role authentication.
- **External ID** — optional external ID for cross-account role assumption.

## Notes

- **Plain JSON items** — items, keys, and expression attribute values are supplied and returned as plain JSON; the service auto-marshalls them to and from DynamoDB's typed attribute-value format.
- **Pagination cursors** — Query, Scan, and List Tables return an opaque base64 `cursor`; pass it back on the next call to fetch the following page. Execute Statement (PartiQL) uses the underlying NextToken directly as its cursor.
- **Update Item** — provide a simple `Updates` object to set attributes, or supply a raw `Update Expression` for advanced operations (ADD, REMOVE, conditional math).
- **Batching** — Batch Get Items splits into chunks of 100 and Batch Write Items into chunks of 25, automatically retrying any unprocessed keys/items.

## Agent Ideas

- Use **AWS SQS** "Receive Messages" to pull queued events, then use **AWS DynamoDB** "Batch Write Items" to persist each event into a table in a single batched, automatically retried write.
- Use **AWS DynamoDB** "Query" to fetch records matching a key condition, then use **AWS SNS** "Publish Message" to broadcast a notification or **Google Sheets** "Add Rows" to append each item to a reporting spreadsheet.
- After an **AWS Lambda** "Invoke Function" call returns a result, use **AWS DynamoDB** "Put Item" to store the function's output, then use **Gmail** "Send Message" to notify a stakeholder.
