# SQS FlowRunner Extension

| **Kind** | **Name** | **Description** |
|----------------|----------------|---------------------|
| ACTION | Send Message | Sends a single message to a queue. For FIFO queues, provide Message Group ID to ensure ordering and Message Deduplication ID to prevent duplicates. Use Delay Seconds to postpone message delivery. |
| ACTION | Send Message Batch | Sends up to 10 messages in a single request. Each entry must include a unique ID and a message body. Returns lists of successfully sent and failed messages. |
| ACTION | Receive Messages | Polls a queue and returns up to the requested number of messages. Use Wait Time Seconds for long polling to reduce empty responses and lower costs. Messages remain hidden from other consumers until the Visibility Timeout expires. |
| ACTION | Delete Message | Permanently removes a message from a queue using its receipt handle obtained from Receive Messages. After deletion the message cannot be received again. |
| ACTION | Get Queue Attributes | Retrieves attributes of a queue such as message count, visibility timeout, ARN, and delay settings. Defaults to returning all attributes. |
