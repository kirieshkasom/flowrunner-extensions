# Intercom FlowRunner Extension

Automate your Intercom support and CRM workspace: manage contacts and companies, run and reply to conversations and tickets, send proactive messages, tag and segment people, submit behavioral events, and author Help Center content - all from a no-code flow.

## Ideal Use Cases
- Sync contacts and companies from your own system (create, find, update, merge, archive).
- Triage support: create, search, reply to (with optional image attachments), assign, snooze, close, and convert conversations to tickets.
- Run tickets end to end - create, update, reply, search, and delete.
- Proactively reach customers with in-app or email messages.
- Tag and segment contacts, companies, and conversations; record opt-in/opt-out subscriptions.
- Track behavior by submitting custom events and listing a contact's event history.
- Publish and maintain Help Center articles and collections.
- React to new conversations, contacts, or tickets - or to conversations being closed or replied to - with polling triggers.

## List of Actions
- Contacts: Create, Get, Get by External ID, Update, Delete, Archive, Unarchive, List, Search, Merge
- Companies: Create or Update, Get, Find, Update, Delete, List, Attach Contact, Detach Contact, List Company Contacts
- Conversations: Create, Get, List, Search, Reply, Assign, Snooze, Open, Close, Attach Contact, Convert to Ticket
- Messaging: Create Message
- Tickets: Create, Get, Update, Delete, Search, Reply
- Admins: List, Get, Set Admin Away
- Teams: List, Get
- Tags: Create or Update, List, Get, Delete, Tag/Untag Contact, Tag/Untag Company, Tag/Untag Conversation
- Segments: List, Get
- Notes: Create, List, Get
- Events: Submit, List
- Data Attributes: List, Create, Update
- Help Center: Create/Get/Update/Delete/List/Search Article, Create/Get/Update/Delete/List Collection
- Subscriptions: List Subscription Types, Attach, Detach
- Visitors: Get, Update, Convert

## List of Triggers
- New Conversation
- New Contact
- New Ticket
- Conversation Closed
- Conversation Replied

## Agent Ideas
- When an **Intercom** "New Conversation" trigger fires, use **Slack** "Send Message To Channel" to alert the support team with the conversation details for fast triage.
- When a **Shopify** "On New Order" trigger fires, use **Intercom** "Create or Update Company" and "Submit Event" to record the purchase against the customer's Intercom profile.
- When an **Intercom** "New Contact" trigger fires, use **Google Sheets** "Add Row" to log each new signup into a tracking spreadsheet.
