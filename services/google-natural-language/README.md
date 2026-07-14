# Google Cloud Natural Language FlowRunner Extension

Extracts meaning and structure from unstructured text using Google's [Cloud Natural Language API](https://cloud.google.com/natural-language/docs/reference/rest): analyze entities, gauge sentiment, parse syntax, classify content, and moderate for safety on plain text or HTML. Authenticates with a Google Cloud API key appended as the `key` query parameter; enable the Cloud Natural Language API in your Google Cloud project.

## Ideal Use Cases

- Score the sentiment of customer reviews, support tickets, or survey responses to flag unhappy users
- Extract people, organizations, and locations from documents or news articles for enrichment and tagging
- Auto-categorize incoming content into topics for routing or filing
- Moderate user-generated text for toxic, violent, sexual, or profane content before publishing
- Parse grammar, parts of speech, and dependency relations for linguistic feature extraction

## List of Actions

- Analyze Entities
- Analyze Entity Sentiment
- Analyze Sentiment
- Analyze Syntax
- Annotate Text
- Classify Text
- Moderate Text

## List of Triggers

This service does not define any triggers.

## Configuration

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| API Key | Yes | A Google Cloud API key with the Cloud Natural Language API enabled ([console.cloud.google.com](https://console.cloud.google.com/)). Restrict the key to the Cloud Natural Language API where possible. |

## Notes

- **Document input**: Every operation accepts `content` plus an optional `documentType` (Plain Text or HTML, default Plain Text) and `language` (BCP-47 code such as `en`, `es`, `ja`; auto-detected if omitted). Friendly labels map to the API values `PLAIN_TEXT` / `HTML` internally.
- **Encoding**: Analyze Entities, Analyze Sentiment, Analyze Entity Sentiment, and Analyze Syntax accept an `encodingType` (UTF8, UTF16, UTF32, NONE; default UTF8) controlling the character offsets returned in the response.
- **API versions**: Analyze Entities, Analyze Sentiment, Classify Text, Moderate Text, and Annotate Text use the **v2** endpoint (returning `languageCode` / `languageSupported`); Analyze Entity Sentiment and Analyze Syntax use the **v1** endpoint (returning `language`). This is selected automatically per operation.
- **Classification minimum**: Classify Text (and the classification section of Annotate Text) requires at least **20 tokens** (roughly 20 words); shorter text returns no categories.
- **Annotate Text toggles**: Combine entity extraction, document sentiment, classification, and moderation in one request; the response includes only the enabled sections.
- Sentiment `score` ranges from `-1.0` (negative) to `+1.0` (positive); `magnitude` reflects overall emotional strength and is unbounded.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires, run the body through **Google Cloud Natural Language** "Analyze Sentiment" and, if the score is negative, use **Slack** "Send Message To Channel" to alert the support team.
- Read survey responses with **Google Sheets** "Get Rows", run each through **Google Cloud Natural Language** "Classify Text" and "Analyze Entities", then write the categories and detected entities back with **Google Sheets** "Add Row".
- Pull ticket text from **Zendesk**, run **Google Cloud Natural Language** "Moderate Text" to catch abusive language and "Analyze Entity Sentiment" to gauge feeling toward specific products, then prioritize the queue accordingly.
