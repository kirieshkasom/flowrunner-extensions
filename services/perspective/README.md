# Perspective FlowRunner Extension

Score text for toxicity and related attributes using Google's Perspective Comment Analyzer API, and submit suggested scores as feedback to improve the models. Authentication uses a Google Cloud API key with the Comment Analyzer API enabled.

## Ideal Use Cases

- Automatically flag or hide toxic, insulting, or threatening user-generated comments before they are published.
- Prioritize community-moderation queues by ranking submissions by their toxicity or identity-attack scores.
- Gate chat, ticket, or forum replies that exceed a toxicity threshold and route them for human review.
- Send corrective feedback to Perspective when a comment is mis-scored, improving future model accuracy.

## List of Actions

### Analysis

- Analyze Comment

### Feedback

- Suggest Comment Score

## List of Triggers

This service does not define any triggers.

## Authentication

Perspective uses a **Google Cloud API key** passed as the `?key=` query parameter.

1. Request access to the Perspective API at [developers.perspectiveapi.com](https://developers.perspectiveapi.com) — the Comment Analyzer API is access-gated and must be requested/approved.
2. In the granted Google Cloud project, enable the **Comment Analyzer API**.
3. Create an **API key** credential (APIs & Services -> Credentials).
4. Paste the key into the service's **API Key** config item (required).

## Notes

- **Attributes**: `Toxicity`, `Severe Toxicity`, `Identity Attack`, `Insult`, `Profanity`, and `Threat` are production attributes with broader language support; `Sexually Explicit` and `Flirtation` are experimental and English-only. Analyze Comment defaults to `Toxicity` when no attribute is selected. Each attribute's `summaryScore.value` is a probability from 0 to 1 that the attribute applies (not a severity magnitude); enabling **Span Annotations** adds per-sentence `spanScores`.
- **doNotStore**: Defaults to `true`, so Google does not retain the submitted text for research. Set it to `false` only if you have permission to share the comment.
- **Errors**: `COMMENT_TOO_LONG` — the text exceeds the API length limit; `LANGUAGE_NOT_SUPPORTED_BY_ATTRIBUTE` — a requested attribute does not support the given language (common with the experimental, English-only attributes).

## Agent Ideas

- When a **Slack** "On Channel Message" trigger fires, call **Perspective** "Analyze Comment" and, if the toxicity score is high, use **Slack** "Update Message In Channel" or "Send Direct Message" to warn the poster.
- When a **Zendesk** "On Ticket Event" trigger fires, run **Perspective** "Analyze Comment" on the ticket text and use **Zendesk** "Add Comment To Ticket" to add an internal note when abusive language is detected.
- Before a **Discourse** "Create Post / Reply" call publishes user content, screen it with **Perspective** "Analyze Comment" and route high-scoring posts to a moderation queue instead of posting.
