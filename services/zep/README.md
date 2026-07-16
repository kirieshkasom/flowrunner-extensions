# Zep FlowRunner Extension

Long-term memory for AI agents and assistants. This service integrates [Zep Cloud](https://www.getzep.com) with FlowRunner so your flows can store conversation history, build a per-user knowledge graph, and pull relevant memory back into LLM prompts. Zep authenticates with a single API Key sent as an `Authorization: Api-Key <key>` header.

## Memory Model

Zep organizes memory around three concepts:

- **Users** — the top-level owner of memory. Each user has a personal knowledge graph that grows as data is added.
- **Threads** — the unit that groups conversation messages for a user. Threads are Zep's current model and replace the older "session" concept.
- **Graph** — Zep continuously extracts entities (nodes) and facts (edges) from messages and ingested data into a knowledge graph, per user or per shared graph. Search the graph to retrieve targeted facts.

The flagship operation is **Get Thread Context**: it returns a ready-to-inject context block summarizing the most relevant facts about the user, which you drop straight into your LLM prompt to give the assistant long-term memory. Choose "summary" mode for a concise narrative or "basic" mode for raw relevant facts and edges.

## Ideal Use Cases

- Give a chatbot or AI agent persistent, cross-conversation memory of each user by injecting **Get Thread Context** into every prompt.
- Record conversation turns from any channel (Slack, Telegram, support inbox) into a per-user thread with **Add Messages**.
- Ingest documents, business records, or external knowledge into a user or shared graph with **Add Graph Data**, then retrieve targeted facts with **Search Graph**.
- Maintain a shared knowledge base (company policies, product facts) in a shared graph that many users' agents can search.
- Inspect what Zep has learned about a user via **Get User Node** and **Get User Graph Episodes**.

## List of Actions

### Users
- Add User
- Get User
- List Users
- Update User
- Delete User
- Get User Node

### Threads
- Create Thread
- Get Thread
- List User Threads
- Delete Thread

### Memory
- Add Messages
- Get Thread Context
- Get Messages

### Graph
- Add Graph Data
- Search Graph
- Get User Graph Episodes

### Graphs
- Create Graph
- Get Graph

## List of Triggers

This service does not define any triggers.

## Configuration

Provide a single **API Key** config item. Zep authenticates with an `Authorization: Api-Key <key>` header. Get your key from [app.getzep.com](https://app.getzep.com) under **Project Settings > API key**. Base URL: `https://api.getzep.com/api/v2`.

## Typical Flow

1. **Add User** for each end user.
2. **Create Thread** for a conversation.
3. **Add Messages** as the conversation progresses.
4. **Get Thread Context** and inject the returned context into your LLM prompt.
5. Optionally **Add Graph Data** to ingest documents and **Search Graph** for targeted facts.

## Agent Ideas

- Record each turn of an assistant conversation with **Zep** "Add Messages", then call **Zep** "Get Thread Context" and pass the returned context into **OpenAI** "Create Chat Completion" so the reply reflects everything Zep has learned about the user.
- When a **Slack** "On Channel Message" trigger fires, log the message to a user's thread with **Zep** "Add Messages", fetch memory with **Zep** "Get Thread Context", and generate a grounded reply with **Anthropic Claude** "Ask Claude".
- When a **Telegram** "On New Message" trigger fires, use **Zep** "Search Graph" to pull the most relevant facts about the user and feed them into **Anthropic Claude** "Send Messages" before replying via **Telegram** "Send Message".
