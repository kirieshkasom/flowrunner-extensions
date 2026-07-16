# Drift FlowRunner Extension

FlowRunner integration for [Drift](https://www.drift.com), the conversational marketing and live-chat platform. Manage contacts, drive conversations, send chat and internal messages, look up agents, and maintain account-based-marketing accounts directly from your flows. Authenticates with a Bearer access token against the Drift Platform API at `https://driftapi.com`.

## Ideal Use Cases

- Automatically create or update a Drift contact when a new lead arrives from another system.
- Reply to a live chat thread, post an internal agent note, or start a brand-new conversation with a visitor.
- Route or triage conversations by changing their status to Open, Closed, or Pending.
- Sync account-based-marketing accounts (target companies) and look up the agents assigned to them.

## List of Actions

### Accounts

- Create or Update Account
- Get Account
- List Accounts

### Contacts

- Create Contact
- Delete Contact
- Get Contact
- Get Contact by Email
- List Contacts
- Update Contact

### Conversations

- Create Conversation
- Get Conversation
- Get Conversation Messages
- List Conversations
- Send Message
- Update Conversation Status

### Users

- Get User
- List Users

## List of Triggers

This service does not define any triggers.

## Authentication

Drift uses a **Bearer access token**. Every request is sent with `Authorization: Bearer <accessToken>`. Provide the token as the **Access Token** configuration item, obtained from either:

- **Drift → Settings → App Settings → your developer app → OAuth access token**, or
- a **personal access token** created in the Drift Developer portal (dev.drift.com).

> **Status note:** Drift was acquired by Salesloft. The Drift Platform API remains active and continues to be served from the `driftapi.com` host with the same Bearer-token authentication; this integration targets that API, unchanged.

## Conversation & Message Model

Drift is organized around **conversations** between a site visitor (a **contact**) and your **users** (agents / bots):

- A **conversation** has a status of `open`, `closed`, or `pending`.
- Each conversation contains **messages**. A message is either a **Chat** message (visible to the visitor) or a **Private / Private Note** (an internal, agent-only note).
- **Contacts** are the people you converse with, identified by email and a Drift-assigned numeric ID.
- **Users** are your agents; **accounts** are target companies used for account-based marketing.

To reply in an existing thread, use **Send Message** with the conversation ID. To begin a brand-new thread with a contact, use **Create Conversation**.

## Agent Ideas

- When a new lead lands in **HubSpot** via "Create Contact", call Drift "Create Contact" to sync the visitor into Drift and then "Create Conversation" to open a personalized outreach thread.
- Use Drift "Get Conversation Messages" to pull a chat transcript, then post a summary to a channel with **Slack** "Send Message To Channel" so the sales team is alerted to hot conversations.
- After Drift "Update Conversation Status" closes a chat, fire **Segment** "Track Event" to record the resolution in your analytics pipeline for downstream reporting.
