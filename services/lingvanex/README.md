# LingvaNex FlowRunner Extension

Machine translation powered by the [LingvaNex](https://lingvanex.com/) B2B Cloud API. Translate text or HTML between hundreds of languages, list supported languages, and auto-detect the source language of a piece of text. Authentication uses an API key sent as a Bearer token.

## Ideal Use Cases

- Localize user-generated content, support tickets, or product descriptions into multiple target languages
- Auto-detect the language of an incoming message before routing or replying in the sender's language
- Translate HTML email or web content while preserving markup and tags
- Power multilingual chatbots and AI Agents that translate prompts and responses on the fly
- Populate a language picker in a UI by fetching the full list of supported LingvaNex languages

## List of Actions

- Detect Language
- Get Languages
- Translate

## List of Triggers

This service does not define any triggers.

## Configuration

- **API Key** — Your LingvaNex B2B Cloud API key, sent on every request as `Authorization: Bearer <API Key>`.

## Notes

- **Language codes** use the underscore locale form: a lowercase language code, an underscore, then an uppercase country code — for example `en_GB`, `es_ES`, `fr_FR`, `de_DE`, `ru_RU`. Use these codes for the **From Language** and **To Language** fields. Run **Get Languages** to look up the exact codes available to your account, or **Detect Language** to obtain the source code for a **Translate** call.
- **Translate** accepts a single string or an array of strings (each translated independently), supports HTML mode (preserves markup/tags) or Text mode, and can optionally return transliterated (romanized) forms. Omitting the source language auto-detects it.
- All calls go to `https://api-b2b.backenster.com/b1/api/v3`. On a logical failure the API returns a non-null `err` field, which the service surfaces (with the HTTP status when present) as a thrown error.

## Agent Ideas

- Use **Gmail** "On New Email" to catch an incoming message, call LingvaNex "Detect Language" then "Translate" to convert the body into your team's language, and reply with **Gmail** "Send Message"
- When **Slack** "On Channel Message" fires in a non-native language, call LingvaNex "Detect Language" and "Translate", then post the translation back with **Slack** "Send Message To Channel"
- Fetch rows with **Google Sheets** "Get Rows", run each cell through LingvaNex "Translate" into a target locale, and write the results back with **Google Sheets** "Update Rows"
