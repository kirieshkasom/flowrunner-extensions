# Front FlowRunner Extension

Integrates the Front shared inbox platform into FlowRunner workflows. Manage conversations across email, SMS, and chat channels, post internal team comments, maintain the contact and account directory, and react to new conversations, inbound messages, or comments.

## Ideal Use Cases

- Triaging new conversations by routing them to the right inbox, assignee, or tag based on content
- Sending templated outbound emails or SMS replies through Front channels as part of a workflow
- Posting internal comments to alert teammates when external systems report relevant events
- Syncing Front contacts and accounts with a CRM so customer context stays consistent
- Notifying chat channels or creating downstream tasks when new inbound customer messages arrive

## List of Actions

### Conversations

- Archive Conversation
- Get Conversation
- List Conversation Messages — each message includes an `attachments` array (id, filename, content_type, size, url); pass an attachment's `id` or `url` to **Get Attachment** to retrieve the file
- List Conversations
- Reply to Conversation
- Search Conversations
- Send Message
- Update Conversation

### Comments

- Add Comment
- List Comments

### Contacts

- Create Contact
- Get Contact
- List Contacts
- Update Contact

### Accounts

- Create Account
- Get Account
- List Accounts
- Update Account

### Attachments

- Get Attachment

## List of Triggers

- On New Comment
- On New Conversation
- On New Inbound Message — fires for each new inbound message; the payload includes an `attachments` array (id, filename, content_type, size, url, is_inline). Pass an attachment's `id` or `url` to **Get Attachment** to download the file into FlowRunner Files.

## Agent Ideas

- When a **Front** "On New Inbound Message" trigger fires, use **Gemini AI** "Generate Content" to draft a suggested reply, then call **Front** "Add Comment" to post the draft as an internal note for a teammate to send.
- When a **HubSpot** "Create Contact" event creates a new lead, use **Front** "Create Contact" to mirror the contact and **Front** "Send Message" to deliver a welcome email through the support channel.
- When a **Front** "On New Conversation" trigger fires with a VIP tag, use **Slack** "Send Message To Channel" to alert the on-call channel with the conversation subject and recipient.
