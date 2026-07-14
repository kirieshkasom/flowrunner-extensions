# DeepL FlowRunner Extension

FlowRunner integration for the [DeepL API](https://developers.deepl.com/) — high-quality neural machine translation, AI-assisted writing improvement (DeepL Write), full document translation with formatting preserved, and multilingual glossary management.

## Ideal Use Cases

- Translate incoming messages, form submissions or support tickets into a customer's language before replying
- Localize documents (docx, pptx, xlsx, pdf, srt, html and more) while preserving their formatting
- Polish drafted copy with DeepL Write to fix grammar and rephrase into a chosen style or tone
- Enforce consistent brand and domain terminology across translations using custom glossaries
- Monitor DeepL character usage against the plan limit within an automation

## List of Actions

### Translation
- Translate Text

### Writing
- Improve Text

### Documents
- Upload Document
- Get Document Status
- Download Translated Document

### Glossaries
- Create Glossary
- List Glossaries
- Get Glossary
- Get Glossary Entries
- Edit Glossary
- Delete Glossary

### Languages
- List Source Languages
- List Target Languages

### Account
- Get Usage

## List of Triggers

This service does not define any triggers.

## Authentication

API key authentication. Provide your DeepL API key (from https://www.deepl.com/your-account/keys). Free-plan keys end with `:fx`; the correct API base URL is picked automatically — `api-free.deepl.com` for Free keys and `api.deepl.com` for Pro keys.

## Configuration

| Config Item | Required | Description |
|-------------|----------|-------------|
| API Key | Yes | Your DeepL API key. Free-plan keys end with `:fx`, and the free/pro base URL is selected automatically. |

## Notes

- Document translation is asynchronous: **Upload Document** returns a `document_id` and `document_key` (keep BOTH), poll **Get Document Status** until the status is `done`, then use **Download Translated Document** to save the result to FlowRunner file storage.
- **Translate Text** is limited to 128 KiB per request; each translated document is billed at a minimum of 50,000 characters.
- **Improve Text** (DeepL Write) accepts a writing style OR a tone, but not both in the same request, and supports a limited set of languages.

## Agent Ideas

- When a **Dropbox** "On New File" trigger fires, use **DeepL** "Upload Document" and "Download Translated Document" to produce a localized copy, then share it via **Gmail** "Send Message"
- Use **DeepL** "Translate Text" to localize incoming content, then call **Notion** "Create Page" to store each translation as a page in a localization database
- Use **DeepL** "Translate Text" to translate a batch of strings, then log the source and translated text with **Google Sheets** "Add Row" for review
