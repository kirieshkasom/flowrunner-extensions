# Amazon SQS FlowRunner Extension

Integration with Amazon Simple Queue Service (SQS). Send, receive, and delete messages, batch-send up to 10 messages at once, and inspect queue attributes — for both standard and FIFO queues. Supports two authentication methods: direct API Key credentials or IAM Role via STS AssumeRole for cross-account access.

## Ideal Use Cases

- Decoupling workflow steps by pushing messages onto a queue for asynchronous processing
- Sending a single message or up to 10 messages in one batch from an automated flow
- Polling a queue for work items using long polling to reduce empty responses and costs
- Acknowledging and removing processed messages so they are not redelivered
- Ordering and deduplicating events through FIFO queues with message group and deduplication IDs
- Monitoring queue depth and configuration by reading queue attributes such as message count and visibility timeout

## List of Actions

- Delete Message
- Get Queue Attributes
- Receive Messages
- Send Message
- Send Message Batch

## List of Triggers

This service does not define any triggers.

## Configuration

- **Authentication Method** — `API Key` (access key directly) or `IAM Role` (STS AssumeRole with a Role ARN for cross-account access).
- **Region** — AWS region code, e.g. `us-east-1`.
- **Access Key** / **Secret Key** — AWS credentials, required for both methods.
- **IAM Role ARN** — role to assume, required for IAM Role authentication.
- **External ID** — optional external ID for cross-account role assumption.

## Notes

- **Queue selection** — operations expose a searchable queue dropdown (List Queues Dictionary) backed by a live list of your queues in the configured region; the label shows the queue name and the value is the full queue URL.
- **FIFO queues** — Send Message accepts a Message Group ID (required for FIFO ordering) and a Message Deduplication ID (to prevent duplicates within a 5-minute window).
- **Long polling** — set Wait Time Seconds above 0 on Receive Messages to wait for messages before returning, reducing empty responses and request costs.
- **Visibility timeout** — received messages stay hidden from other consumers until the visibility timeout expires; delete them with their receipt handle once processed.
- **Batching** — Send Message Batch sends up to 10 entries per request, each with a unique `id` and `messageBody`, and returns separate lists of successful and failed messages.
- **Queue attributes** — Get Queue Attributes returns all attributes by default, or a specified subset such as `ApproximateNumberOfMessages` and `VisibilityTimeout`.

## Agent Ideas

- After **Amazon SQS** "Receive Messages" returns a work item, process it and then call **Amazon SQS** "Delete Message" with the receipt handle so it is not redelivered, logging the outcome with **AWS DynamoDB** "Put Item".
- When a **Slack** "On Channel Message" trigger fires, use **Amazon SQS** "Send Message" to enqueue the message for asynchronous downstream processing without blocking the flow.
- Use **Amazon SQS** "Receive Messages" to pull queued notification jobs, then call **Amazon SNS** "Publish Message" to fan each one out to a topic's subscribers.
