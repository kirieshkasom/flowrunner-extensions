# AWS Comprehend FlowRunner Extension

Zero-dependency integration with Amazon Comprehend using native AWS Signature V4 signing (Node crypto). Runs synchronous natural-language processing on text — sentiment, entities, key phrases, dominant language, PII, syntax, and targeted (entity-level) sentiment — plus batch variants for processing multiple documents in one call. Supports two authentication methods: direct API Key credentials or IAM Role via STS AssumeRole for cross-account access.

## Ideal Use Cases

- Scoring the sentiment of customer feedback, reviews, or support tickets as they flow through automations
- Extracting named entities (people, organizations, places, dates, quantities) from documents for enrichment or routing
- Pulling key phrases from long text to summarize or tag content
- Detecting the language of incoming text before further processing or translation
- Redacting or flagging personally identifiable information (PII) in user-submitted content
- Part-of-speech tagging for linguistic analysis
- Understanding sentiment toward specific entities mentioned in a document (targeted sentiment)
- Processing up to 25 documents at once with the batch operations

## List of Actions

- Batch Detect Entities
- Batch Detect Sentiment
- Detect Dominant Language
- Detect Entities
- Detect Key Phrases
- Detect PII Entities
- Detect Sentiment
- Detect Syntax
- Detect Targeted Sentiment

## Configuration

- **Authentication Method** — `API Key` (access key directly) or `IAM Role` (STS AssumeRole with a Role ARN for cross-account access).
- **Region** — AWS region code, e.g. `us-east-1`. Comprehend is called at `comprehend.{region}.amazonaws.com`.
- **Access Key** / **Secret Key** — AWS credentials, required for both methods.
- **IAM Role ARN** — role to assume, required for IAM Role authentication.
- **External ID** — optional external ID for cross-account role assumption.

## Notes

- **Synchronous, single-document ops** — all single-document actions analyze one text at a time and return results immediately. For large-scale asynchronous analysis jobs, use the AWS console or SDK.
- **5,000-byte text limit** — each document must not exceed 5,000 UTF-8 bytes. Exceeding it raises a `TextSizeLimitExceededException`; the service surfaces this as a clear error.
- **Batch limit of 25** — Batch Detect Sentiment and Batch Detect Entities accept up to 25 documents per call. Each result carries an `Index` matching its position in the input list; any documents that failed appear in a separate `errorList`.
- **Language codes** — languages are chosen from a friendly dropdown (English, Spanish, French, German, Italian, Portuguese, Arabic, Hindi, Japanese, Korean, Chinese Simplified, Chinese Traditional) and mapped in code to Comprehend codes (`en`, `es`, `fr`, `de`, `it`, `pt`, `ar`, `hi`, `ja`, `ko`, `zh`, `zh-TW`).
- **Language support varies by operation** — Detect Dominant Language takes no language input. Detect PII Entities and Detect Targeted Sentiment currently support English only. Detect Syntax supports English, Spanish, French, German, Italian, and Portuguese. Using an unsupported language raises `UnsupportedLanguageException`, surfaced as a clear error.

## Agent Ideas

- Use **AWS Comprehend** "Detect Sentiment" on incoming support emails, then branch on the result to escalate negative messages via **Amazon SNS** "Publish Message".
- Use **AWS Comprehend** "Detect PII Entities" to flag documents containing sensitive data before storing them with **DynamoDB** "Put Item".
- Use **AWS Comprehend** "Detect Entities" to extract organizations and people from an article, then enrich a record in **Google Sheets** "Add Rows".
