# Wekan FlowRunner Extension

Integrate [Wekan](https://wekan.github.io/) — the open-source kanban board — with FlowRunner. Manage boards, lists (columns), cards, swimlanes and checklists on your own Wekan server. This service does not use OAuth; it authenticates with your username/email and password, which are exchanged for a bearer token and user id via the login endpoint.

## Ideal Use Cases

- Automatically create Wekan cards from incoming tickets, form submissions or chat messages
- Sync tasks between Wekan and other project tools by creating, editing, moving or deleting cards
- Provision new boards, lists and swimlanes as part of onboarding or project-kickoff workflows
- Report on board activity by counting cards or listing cards grouped by list or swimlane
- Build and maintain card checklists as work is broken down into subtasks

## List of Actions

### Boards

- Get User Boards
- Get Board
- Create Board
- Delete Board
- Get Board's Cards Count

### Lists

- Get Lists
- Get List
- Create List
- Delete List

### Cards

- Get Cards in List
- Get Card
- Create Card
- Edit Card
- Delete Card
- Get Cards by Swimlane

### Swimlanes

- Get Swimlanes
- Create Swimlane

### Checklists

- Get Card Checklists
- Create Checklist

## List of Triggers

This service does not define any triggers.

## Authentication

Wekan does not use OAuth. This service authenticates with your **username/email and password**:

1. On the first call of each execution it performs `POST {Server URL}/users/login` with a form-encoded body of `username` and `password`.
2. Wekan returns a bearer **token** and your **user id** (`id`). Both are cached in memory for the rest of the execution and sent as `Authorization: Bearer {token}` on every subsequent request.
3. If a request returns `401` (token expired or revoked), the service logs in again once and retries the request transparently.

All REST endpoints are served under `{Server URL}/api`.

### Configuration

| Item       | Required | Description                                                                                |
| ---------- | -------- | ------------------------------------------------------------------------------------------ |
| Server URL | Yes      | Your Wekan server URL, e.g. `https://wekan.example.com` (any trailing slash is stripped).   |
| Username   | Yes      | Your Wekan username or email address.                                                       |
| Password   | Yes      | Your Wekan password. Exchanged for a bearer token via `POST {url}/users/login`.             |

## Data Model

Wekan organizes work as **Board → List (column) → Card**, with **Swimlanes** as horizontal rows that cut across all lists. A card therefore belongs to both a **list** (its column) and a **swimlane** (its row). Every board is created with a **Default** swimlane and can have more.

**Create Card** requires two ids beyond the title:

- **Author User ID** — the user recorded as the card's creator. This defaults to the authenticated user (the id returned at login), so you can leave it blank.
- **Swimlane ID** — the swimlane the card is placed in. Every board has a Default swimlane; use **Get Swimlanes** to retrieve its id, then pass it here. (Board id + list id come from **Get User Boards** / **Get Lists**, or the built-in board/list dropdowns.)

## Notes

- Board and list parameters are backed by dictionary pickers, so you can select a board and then its list by name instead of pasting ids.
- Wekan surfaces errors either as a plain string or as `{ error, reason }`; the service normalizes both and includes the HTTP status in the thrown error message.
- Board `permission` is `Public` or `Private`; board `color` is one of Wekan's built-in themes (Belize, Nephritis, Pomegranate, and so on). Friendly labels are mapped to Wekan's raw values automatically.

## Agent Ideas

- When a **ClickUp** "On Task Created" trigger fires, call **Wekan** "Create Card" to mirror the task onto a Wekan board's default swimlane so both teams share one kanban view
- Use **GitHub** "Create Issue" for a bug report, then call **Wekan** "Create Card" and "Create Checklist" to track the fix and its subtasks on an engineering board
- After **Wekan** "Get Board's Cards Count" reports a backlog spike, use **Slack** "Send Message To Channel" to alert the team with the current card total for that board
