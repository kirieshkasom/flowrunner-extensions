# APITemplate.io FlowRunner Extension

Generate PDFs and images from reusable templates using the [APITemplate.io](https://apitemplate.io/) REST API. Merge your data into saved PDF/image templates or render a PDF straight from raw HTML, then get a hosted download URL back. Also lists and deletes generated objects and checks account credits. Authenticates with an API key (`X-API-KEY` header) and supports the Default, Europe (DE), and Australia (AU) regional hosts.

## Ideal Use Cases

- Produce invoices, receipts, contracts, or certificates from a saved template by merging record data into it
- Render a PDF on the fly from raw HTML and CSS when no template exists
- Generate social/marketing images (JPEG and PNG) from an image template with per-layer overrides
- Manage generated files: list, retrieve download URLs, and delete old objects
- Confirm the API key and region are configured correctly by checking remaining credits

## List of Actions

- **PDF Generation** — Create PDF, Create PDF from HTML
- **Image Generation** — Create Image
- **Templates** — List Templates
- **Objects** — List Generated Objects, Delete Object
- **Account** — Get Account Information

## List of Triggers

This service does not define any triggers.

## Configuration

| Config Item | Required | Description |
| ----------- | -------- | ----------- |
| **API Key** | Yes | Your APITemplate.io API key, sent as the `X-API-KEY` header. Found in the dashboard under **API Integration → API Key**. |
| **Region** | No | The regional host matching your account. Defaults to `Default`. |

### Regional hosts

APITemplate.io serves accounts from region-specific hosts. Select the one matching where your account data is stored:

| Region | Base URL |
| ------ | -------- |
| Default | `https://rest.apitemplate.io/v2` |
| Europe (DE) | `https://rest-de.apitemplate.io/v2` |
| Australia (AU) | `https://rest-au.apitemplate.io/v2` |

## Notes

- **Create PDF** and **Create Image** take a `template_id` plus a data/overrides object whose keys match the template's placeholders/layers. The Template ID parameter is backed by a dictionary, so you can search and select a template by name (or get IDs from **List Templates**).
- **Create PDF from HTML** needs no template — supply the HTML body, optional CSS, and rendering settings (page size, margins, orientation).
- **Create Image** overrides can target named layers, e.g. `{"overrides":[{"name":"text_1","text":"Hello"}]}`, or use a flat property object matching the template's placeholders. It returns both JPEG and PNG download URLs.
- **Delete Object** is permanent and identified by the `transaction_ref` returned when the object was created (or from **List Generated Objects**).

## Agent Ideas

- Use **Airtable** "Get Records" to pull invoice rows, then call **APITemplate.io** "Create PDF" to render each invoice from a saved template.
- After **APITemplate.io** "Create PDF" returns a download URL, use **Gmail** "Send Message" to email the generated document to the customer.
- Generate marketing assets with **APITemplate.io** "Create Image", then use **Google Drive** "Upload File" to archive the JPEG/PNG outputs into a shared folder.
