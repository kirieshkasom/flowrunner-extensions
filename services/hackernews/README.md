# Hacker News FlowRunner Extension

Read-only access to [Hacker News](https://news.ycombinator.com/) through its two public, unauthenticated APIs: the **Official Firebase API** (`https://hacker-news.firebaseio.com/v0`) for canonical items, user profiles, live story-id lists, and change feeds, and the **Algolia HN Search API** (`https://hn.algolia.com/api/v1`) for full-text search plus hydrated items and users. No credentials required — this service defines no configuration items; add it and start calling operations.

## Ideal Use Cases

- Monitor the front page, newest, best, Ask HN, Show HN, or job feeds and act on new stories on a schedule.
- Full-text search Hacker News by keyword, author, or content type and route matches into a spreadsheet or chat.
- Fetch a story with its entire nested comment thread in one call for summarization or sentiment analysis.
- Track edits and score changes with the change feed, or pull a user's karma and submission history.

## List of Actions

### Items & Users

- Get Item
- Get User
- Get Max Item ID

### Story Lists

- Get Top Stories
- Get New Stories
- Get Best Stories
- Get Ask Stories
- Get Show Stories
- Get Job Stories
- Get Updates
- Get Top Stories (Hydrated)

### Search

- Search
- Search by Date
- Get Item (Algolia)
- Get User (Algolia)

## List of Triggers

This service does not define any triggers.

## How Hacker News data is modeled

Everything on Hacker News is an **item** with a numeric id: a story, comment, job, poll, or poll option (`pollopt`). The fields returned depend on the item's `type` (stories carry `title`/`url`/`score`/`descendants`; comments carry `text`/`parent`; polls carry `parts`). A story's `kids` array lists its direct child comment ids in display order.

The Firebase **story-list** endpoints (top/new/best/ask/show/job) return a bare JSON **array of ids**, not full stories. Resolve each id with **Get Item**, or use **Get Top Stories (Hydrated)** to fetch the first N items in a single action.

## Search parameters

- **Tags** — pick a content type (Story, Comment, Ask HN, Show HN, Poll, Front Page). You can also type a raw Algolia tag such as `author_pg` or `story_8863`, and comma-separate tags to AND them (e.g. `story,author_pg`).
- **Numeric Filters** — Algolia expression over `created_at_i` (Unix seconds), `points`, or `num_comments`, e.g. `points>100,num_comments>=10`.
- **Page** / **Hits Per Page** — zero-based paging (defaults: page 0, 20 per page).

## Errors

Firebase returns a literal `null` body for unknown item ids or usernames; the service surfaces this as a clean `404 not found` message. Other transport failures surface the upstream status and message.

## Agent Ideas

- On a schedule, call **Get Top Stories (Hydrated)** to pull the current front page, then use **Slack** "Send Message To Channel" to post the highest-scoring headlines with their links to a team channel.
- Use **Search by Date** with a `created_at_i` numeric filter to collect every new story mentioning a keyword, then log each hit with **Google Sheets** "Add Row" into a monitoring spreadsheet.
- When a discussion is trending, call **Get Item (Algolia)** to fetch the full nested comment tree in one call and use **Discord** "Send Message" to post a thread summary into a community channel.
