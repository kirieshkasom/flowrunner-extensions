# AI Vision FlowRunner Extension

A multi-provider AI vision service that analyzes images using 10 supported providers including OpenAI, Anthropic, Google Gemini, Mistral, Cohere, Together AI, Fireworks AI, xAI, Hugging Face, and Moonshot AI. Supports both free-form text analysis and structured JSON output with schema enforcement. Accepts HTTP/HTTPS image URLs and base64 data URIs.

## Ideal Use Cases

- Extracting structured data from images such as invoices, receipts, or business cards
- Classifying and tagging visual content for automated content moderation
- Building AI agents that interpret screenshots, charts, or diagrams
- Automating quality inspection workflows with image-based analysis
- Comparing vision model outputs across providers for accuracy benchmarking
- Processing document images into structured records for database storage

## List of Actions

- Analyze Image
- Analyze Image with Structured Output

## List of Triggers

This extension has no triggers.

## Agent Ideas

- When a **Google Sheets** "On New Row" trigger fires with an image URL, use **AI Vision** "Analyze Image with Structured Output" to extract fields into JSON, then write the results back with **Google Sheets** "Update Row"
- Use **Dropbox** "On New File" to detect a newly uploaded receipt, call **AI Vision** "Analyze Image with Structured Output" to pull totals and line items, then store them with **Airtable** "Create Record"
- When a **Slack** "On New Message" trigger includes a screenshot, use **AI Vision** "Analyze Image" to describe the image and **Slack** "Send Message In Channel" to post the summary back to the thread
