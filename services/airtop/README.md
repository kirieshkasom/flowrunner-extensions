# Airtop FlowRunner Extension

Cloud browser automation for AI agents. Airtop runs real, stateful cloud browsers you can drive
programmatically: open pages, scrape or AI-query their content in natural language, and interact
with elements described in plain English — no CSS selectors required. Authenticate with an API key
(sent as a Bearer token) created at [portal.airtop.ai](https://portal.airtop.ai) and added to the
service's **API Key** configuration item.

## Ideal Use Cases

- Scraping data from sites that require login, JavaScript rendering, or navigation across pages
- Extracting specific answers or structured JSON from a page with natural-language queries
- Automating multi-step web flows (log in, click, type, submit) without brittle selectors
- Reusing persistent authentication across runs via saved browser profiles
- Handing a live, interactive browser view to a human to complete a manual login or captcha
- Capturing screenshots as visual evidence of page state during an automation

## List of Actions

- **Sessions** — Create Session, Get Session, List Sessions, Terminate Session, Save Profile On Termination
- **Windows** — Create Window, Get Window Info, Load URL, Close Window
- **Content** — Scrape Content, Page Query, Paginated Extract, Summarize Content
- **Interactions** — Click Element, Type Text, Hover Element, Scroll Page
- **Screenshot** — Take Screenshot

## List of Triggers

This service does not define any triggers.

## Session lifecycle

Airtop is stateful. Nearly every operation runs against a **session** (an isolated cloud browser)
and one of its **windows** (a browser tab). The standard flow is:

1. **Create Session** — starts a cloud browser. Optionally load a saved profile for persistent
   authentication, enable a proxy, or set an idle timeout.
2. **Create Window** — opens a tab at a URL inside the session and returns a `windowId`.
3. **Run operations** on that window — scrape, page-query, paginated-extract, summarize, click,
   type, hover, scroll, or screenshot.
4. **Terminate Session** — ends the browser and releases resources. Sessions bill until they end
   or hit their idle timeout, so always terminate sessions you are done with.

Sessions persist between operations, so you can chain many calls (navigate, log in, extract)
against the same session before terminating it.

## Natural-language page queries

The high-value operations understand the page with AI instead of brittle selectors:

- **Page Query** — ask a natural-language question ("What is the price?", "Is the user logged
  in?") and get an AI answer. Provide an optional JSON Schema to receive structured JSON.
- **Paginated Extract** — extract a list that spans multiple pages, automatically following
  pagination / load-more / infinite scroll.
- **Summarize Content** and **Scrape Content** — condense or dump the full page as text/markdown.
- **Click / Type / Hover / Scroll** — target elements by natural-language description
  (e.g. "the blue Sign In button").

## Live view

**Get Window Info** returns a `liveViewUrl` — a shareable link that streams a real-time,
optionally interactive view of the browser tab. Use it to watch an automation or let a human take
over to complete a manual login or captcha.

## Persistent authentication (profiles)

Use **Save Profile On Termination** to store a session's cookies and logged-in state under a
profile name. Pass that name to **Create Session**'s *Profile Name* in a later run to restore the
authenticated browser and skip logging in again.

## Screenshots

**Take Screenshot** captures the current page and saves the image to FlowRunner file storage,
returning a downloadable URL.

## Agent Ideas

- Chain **Airtop** "Create Session" → "Create Window" → "Page Query" to extract a structured field from a login-gated page, then store it with **Airtable** "Create Record".
- Use **Airtop** "Scrape Content" to pull an article's text, feed it to **OpenAI** "Create Response" for summarization, and post the digest to **Slack** "Send Message To Channel".
- Run **Airtop** "Paginated Extract" over a multi-page search-results listing, then append each row to a spreadsheet with **Google Sheets** "Add Rows".
