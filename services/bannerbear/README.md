# Bannerbear FlowRunner Extension

Generate images, videos, collections, animated GIFs, and website screenshots from
[Bannerbear](https://www.bannerbear.com/) templates via the Bannerbear API v2. Authenticate with your
Project API Key (sent as `Authorization: Bearer`). Renders are asynchronous by default: create
operations return a pending object with a `uid`, then poll the matching Get operation (or supply a
`webhook_url`) until `status` is `"completed"` and the asset URL is populated.

## Ideal Use Cases

- Auto-generate branded marketing images from a template when new content, products, or leads arrive.
- Produce personalized videos or animated GIFs at scale from per-frame modifications.
- Batch-render a set of images in one call from a template set (collection) with shared modifications.
- Capture screenshots of public web pages for previews, monitoring, or reports.
- Verify API-key validity and check remaining render quota before running a batch.

## List of Actions

### Images
- Create Image
- Get Image
- List Images

### Templates
- List Templates
- Get Template

### Videos
- Create Video
- Get Video

### Collections
- Create Collection
- Get Collection

### Screenshots
- Create Screenshot

### Animated GIFs
- Create Animated GIF

### Account
- Get Account

## List of Triggers

This service does not define any triggers.

## Authentication

Uses a **Project API Key** sent as a Bearer token (`Authorization: Bearer <YOUR_PROJECT_API_KEY>`).
Find it in **Bannerbear → your Project → Settings → API Key**; each project has its own key and
requests operate within that project. Base URL: `https://api.bannerbear.com/v2`.

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| API Key     | Yes      | Your Bannerbear Project API Key. |

## Notes

**Template + modifications model.** Every render is driven by a template (or template set / video
template) plus a list of **modifications**, each targeting a named layer. Supported keys include
`name`, `text`, `image_url`, `color`, `background`, `font_family`, `text_align_h`, `text_align_v`,
`effect`, and `hide`. Use **Get Template** to reveal a template's editable layer names
(`available_modifications`), or pick a template from the Get Templates Dictionary when selecting the
Template parameter.

**Async create → poll flow.** Create operations return `{ "uid": "...", "status": "pending" }`
immediately. To obtain the finished asset: (1) poll **Get Image / Get Video / Get Collection** with
the returned `uid`; (2) on **Create Image**, set **Wait For Completion** to `true` to poll inline
(bounded to ~30 seconds) and return the completed object; or (3) supply a `webhook_url`. Creation
endpoints are rate limited — poll on a respectful interval (a couple of seconds between checks).

## Agent Ideas

- Use **Airtable** "Get Records" to pull new product rows, then call **Bannerbear** "Create Image"
  (with Wait For Completion) to render a branded graphic per product from a template.
- After **Bannerbear** "Create Image" completes, use **Slack** "Send Message To Channel" to post the
  finished `image_url` to a marketing channel for review.
- When a **Shopify** "On New Product" trigger fires, call **Bannerbear** "Create Image" to generate a
  promotional banner, then **Google Drive** "Upload File" to archive the rendered asset.
