# SNS FlowRunner Extension

| **Kind** | **Name** | **Description** |
|----------------|----------------|---------------------|
| ACTION | Publish Message | Sends a message to a topic or directly to a phone number via SMS. Provide either a topic ARN or a phone number — at least one is required alongside the message. |
| ACTION | Create Topic | Creates a new SNS topic with the given name. Returns the topic ARN which can be used for publishing and subscribing. |
| ACTION | Delete Topic | Permanently deletes the specified topic and all its subscriptions. |
| ACTION | Subscribe | Subscribes an endpoint (email address, phone number, URL, SQS queue, or Lambda) to a topic. Returns the subscription ARN which may be &quot;pending confirmation&quot; for email endpoints. |
| ACTION | Unsubscribe | Removes a subscription from a topic using the subscription ARN. |
