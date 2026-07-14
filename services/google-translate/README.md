# Google Translate FlowRunner Extension

Translate text between 130+ languages, detect the language of any text, and list supported languages using the [Google Cloud Translation API (Basic, v2)](https://cloud.google.com/translate/docs/basic/translating-text). Authenticates with a simple Google Cloud API key.

## Ideal Use Cases

- Translate incoming customer messages, form submissions, or support tickets into your team's language before routing them.
- Localize outbound emails, notifications, or product content into each recipient's language.
- Detect the language of user-generated text and branch a flow based on the result.
- Translate batches of strings (up to 128 per call) mapped from a previous step, such as spreadsheet rows or CRM records.

## List of Actions

- Translate Text
- Detect Language
- List Languages

## List of Triggers

This service has no triggers.

## Configuration

| Setting | Required | Description |
| ------- | -------- | ----------- |
| API Key | Yes | Google Cloud API key with the Cloud Translation API enabled. Create it in the GCP Console under **APIs & Services > Credentials > Create credentials > API key**. For security, restrict the key to the Cloud Translation API. |

## Notes

- **Translate Text** accepts a single string or an array of up to 128 strings mapped from a previous step; each input produces one entry in the returned `translations` array.
- Leave **Source Language** empty to let Google auto-detect it; the detected ISO-639-1 code is returned as `detectedSourceLanguage` on each translation.
- The **Format** option controls how the input is interpreted: **Text** for plain text (default) or **HTML** to translate markup while preserving tags.
- The v2 API returns HTML-escaped characters (e.g. `&#39;` for an apostrophe) even in Text format; this extension automatically decodes them, so `translatedText` contains plain characters. In HTML format the markup is returned as-is from Google.
- The **Target Language** and **Source Language** fields are backed by searchable language pickers populated live from the API; you may also type an ISO-639-1 code (e.g. `es`, `fr`, `zh-CN`) directly.
- Google Cloud bills Basic translation per character; see [Cloud Translation pricing](https://cloud.google.com/translate/pricing).

## Agent Ideas

- Use **Google Translate** "Detect Language" on an inbound message, then "Translate Text" to English and reply via **Gmail** "Send Message" in the sender's original language.
- After **Google Sheets** "Get Rows", use **Google Translate** "Translate Text" with the mapped array of cell values to localize an entire product catalog in one call.
- Combine **Slack** message triggers with **Google Translate** "Translate Text" to mirror a support channel into a second language in real time.
