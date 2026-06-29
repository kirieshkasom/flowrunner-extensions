# AWS Lambda FlowRunner Extension

Zero-dependency integration with AWS Lambda using native AWS Signature V4 signing (Node crypto). Invoke functions synchronously, asynchronously, or as a dry run, and retrieve function configuration details. Supports two authentication methods: direct API Key credentials or IAM Role via STS AssumeRole for cross-account access.

## Ideal Use Cases

- Triggering custom Lambda functions as a step in an automated flow and using their results downstream
- Running synchronous (RequestResponse) functions to compute, transform, or enrich data inline
- Fire-and-forget (Event) invocations for background processing without waiting for a response
- Validating invocation parameters and permissions with a DryRun before going live
- Inspecting a function's runtime, handler, memory, timeout, state, and ARN before invoking it

## List of Actions

- Get Function
- Invoke Function

## Configuration

- **Authentication Method** — `API Key` (access key directly) or `IAM Role` (STS AssumeRole with a Role ARN for cross-account access).
- **Region** — AWS region code, e.g. `us-east-1`.
- **Access Key** / **Secret Key** — AWS credentials, required for both methods.
- **IAM Role ARN** — role to assume, required for IAM Role authentication.
- **External ID** — optional external ID for cross-account role assumption.

## Notes

- **Invocation types** — `RequestResponse` (default) waits for and returns the function result; `Event` fires-and-forgets; `DryRun` validates parameters without running the function.
- **Plain JSON payloads** — the event payload is supplied as plain JSON and the response payload is returned parsed; omit the payload for functions that require no input.
- **Function errors** — Invoke Function returns `statusCode`, `functionError` (non-null when the function itself raised an error), and the parsed `payload`.

## Agent Ideas

- Use **AWS SQS** "Receive Messages" to pull queued jobs, then call **AWS Lambda** "Invoke Function" (RequestResponse) to process each message and use **AWS DynamoDB** "Put Item" to persist the returned payload.
- Use **AWS Lambda** "Invoke Function" to run custom processing on incoming data, then use **AWS SNS** "Publish Message" to broadcast the result to downstream subscribers.
- Use **AWS Lambda** "Get Function" to confirm a target function is `Active` before using "Invoke Function", and **AWS SES** "Send Email" to alert the team if the invocation returns a function error.
