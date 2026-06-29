# Amazon SNS FlowRunner Extension

Zero-dependency integration with Amazon Simple Notification Service (SNS) using native AWS Signature V4 signing (Node crypto) over the AWS Query/XML protocol. Publish messages to topics or send SMS directly to phone numbers, manage topics, and manage subscriptions for pub/sub fan-out delivery. Supports two authentication methods: direct API Key credentials or IAM Role via STS AssumeRole for cross-account access.

## Ideal Use Cases

- Fanning out workflow events to many subscribers at once by publishing to an SNS topic
- Sending transactional or alert SMS messages directly to a phone number
- Creating and tearing down topics on demand as part of automated provisioning flows
- Subscribing endpoints (email, SMS, HTTP/HTTPS, SQS, Lambda) to a topic and removing them later
- Notifying email subscribers with a custom subject line on important events

## List of Actions

- Create Topic
- Delete Topic
- Publish Message
- Subscribe
- Unsubscribe

## List of Triggers

This service does not define any triggers.

## Configuration

- **Authentication Method** — `API Key` (access key directly) or `IAM Role` (STS AssumeRole with a Role ARN for cross-account access).
- **Region** — AWS region code, e.g. `us-east-1`.
- **Access Key** / **Secret Key** — AWS credentials, required for both methods.
- **IAM Role ARN** — role to assume, required for IAM Role authentication.
- **External ID** — optional external ID for cross-account role assumption.

## Notes

- **Publish targets** — Publish Message requires either a Topic ARN or a Phone Number; provide a phone number for direct SMS, or a topic ARN to fan out to its subscribers.
- **Subject line** — the optional Subject on Publish Message is used only for email subscriptions.
- **Topic selection** — Delete Topic and Subscribe expose a searchable topic dropdown backed by a live list of your topics in the configured region.
- **Subscription confirmation** — Subscribe returns a subscription ARN that may read "pending confirmation" for email endpoints until the recipient confirms.
- **Subscribe protocols** — supported protocols include `email`, `sms`, `https`, `http`, `sqs`, `lambda`, `application`, and `firehose`.

## Agent Ideas

- When a **Slack** "On Channel Message" trigger fires, use **Amazon SNS** "Publish Message" to fan the message out to all subscribers of an alerts topic.
- Use **Google Sheets** "Get Rows" to read a list of new contacts, then call **Amazon SNS** "Subscribe" to add each one's email address to a notifications topic.
- Use **Amazon SNS** "Publish Message" with a phone number to send an SMS alert, then use **DynamoDB** "Put Item" to log the notification and its message ID for auditing.
- Use **Amazon SNS** "Subscribe" to wire a topic to an SQS endpoint, then use **Amazon SQS** "Receive Messages" downstream to process the fanned-out events from the queue.
- After **Amazon SNS** "Create Topic", call **AWS Lambda** "Invoke Function" to register the topic ARN with downstream processing, or use **Amazon SES** "Send Email" to notify an operator that a new notification channel is live.
