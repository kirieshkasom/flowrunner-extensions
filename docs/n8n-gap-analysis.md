# FlowRunner vs n8n — Integration Gap Analysis

> Generated 2026-07-13 from the n8n open-source repo (`packages/nodes-base/nodes` and
> `packages/@n8n/nodes-langchain`) compared against `services/` in this repo.

## Summary

| Metric | Count |
| --- | --- |
| FlowRunner services today | 95 |
| n8n built-in app integrations (excl. core/utility nodes) | ~330 |
| Overlap (FlowRunner already has an n8n equivalent) | ~56 |
| **n8n integrations FlowRunner is missing** | **~230** |
| FlowRunner exclusives n8n does NOT have natively | ~38 |

FlowRunner already covers most of the top-demand SaaS tier (Slack, HubSpot, Salesforce,
Stripe, Shopify, Notion, Jira, Google Sheets/Drive/Calendar/Gmail, OpenAI, etc.). The
biggest structural gaps are: **databases**, **helpdesk**, **team chat (Discord/Teams/Zoom)**,
**dev-tools/observability**, **transactional email**, **the rest of the Google & Microsoft
suites**, and **AI providers beyond OpenAI/Gemini**.

---

## Tier 1 — High-priority gaps (build first)

Highest usage in n8n / broadest customer demand.

### Databases & data infrastructure
- [x] PostgreSQL (`services/postgresql` — driver-based spike, pending in-FlowRunner validation)
- [x] MySQL / MariaDB (`services/mysql`)
- [x] MongoDB (`services/mongodb`)
- [x] Microsoft SQL Server (`services/sql-server`)
- [x] Redis (`services/redis`)
- [x] Google BigQuery (`services/bigquery`)
- [x] Snowflake (`services/snowflake`)
- [ ] Kafka
- [ ] RabbitMQ

### Team chat, meetings & messaging
- [x] Discord (`services/discord`)
- [x] Microsoft Teams (`services/microsoft-teams`)
- [x] Zoom (`services/zoom`)
- [x] Google Chat (`services/google-chat`)
- [ ] LinkedIn
- [ ] Facebook Graph API (Pages/posts)
- [ ] Reddit

### Helpdesk & support
- [x] Zendesk (`services/zendesk`)
- [x] Freshdesk (`services/freshdesk`)
- [x] Help Scout (`services/help-scout`)

### Transactional & marketing email
- [x] SendGrid (`services/sendgrid`)
- [x] Mailgun (`services/mailgun`)
- [x] Postmark (`services/postmark`)
- [x] Mailjet (`services/mailjet`)
- [x] ActiveCampaign (`services/activecampaign`)
- [x] MailerLite (`services/mailerlite`)
- [x] Kit (ConvertKit) (`services/kit`)
- [x] Customer.io (`services/customerio`)

### Google suite (missing pieces)
- [x] Google Docs (`services/google-docs`)
- [x] Google Slides (`services/google-slides`)
- [x] Google Analytics (GA4) (`services/google-analytics`)
- [x] Google Ads (`services/google-ads`)
- [x] Google Contacts (`services/google-contacts`)
- [x] Google Tasks (`services/google-tasks`)
- [x] Google Translate (`services/google-translate`)
- [x] Google Cloud Storage (`services/google-cloud-storage`)
- [x] Google Firebase Firestore (`services/google-firestore` — Realtime DB not covered)

### Microsoft suite (missing pieces)
- [x] Microsoft Excel 365 (`services/microsoft-excel`)
- [x] Microsoft OneDrive (`services/microsoft-onedrive`)
- [x] Microsoft To Do (`services/microsoft-todo`)
- [x] Microsoft Dynamics 365 CRM (`services/dynamics-365`)

### AI / LLM providers & infra
- [x] Anthropic Claude (`services/anthropic-ai`)
- [x] Azure OpenAI (`services/azure-openai`)
- [x] Google Vertex AI (`services/google-vertex-ai`)
- [x] Mistral AI (`services/mistral-ai`)
- [x] Groq (`services/groq`)
- [x] Ollama (self-hosted models) (`services/ollama`)
- [x] OpenRouter (`services/openrouter`)
- [x] xAI Grok (`services/xai-grok`)
- [x] DeepSeek (`services/deepseek`)
- [x] Cohere (`services/cohere`)
- [x] Hugging Face Inference (`services/huggingface`)
- [x] Perplexity (`services/perplexity`)
- [x] Pinecone (vector store) (`services/pinecone`)
- [x] Qdrant (vector store) (`services/qdrant`)
- [x] Weaviate (vector store) (`services/weaviate`)
- [x] DeepL (translation) (`services/deepl`)

### Dev tools & observability
- [ ] GitLab
- [ ] Bitbucket
- [ ] Cloudflare
- [ ] Netlify
- [ ] Sentry
- [ ] PostHog
- [ ] Jenkins

### Productivity, PM & scheduling
- [ ] Linear
- [ ] Todoist
- [ ] Coda
- [ ] Cal.com
- [ ] SurveyMonkey
- [ ] Eventbrite
- [ ] Clockify
- [ ] Toggl Track
- [ ] Harvest

### Payments & commerce
- [ ] PayPal
- [ ] Chargebee
- [ ] Paddle
- [ ] Wise
- [ ] Magento 2

### CMS & content
- [ ] Contentful
- [ ] Strapi
- [ ] Ghost
- [ ] Zendesk (see helpdesk)
- [ ] Figma

---

## Tier 2 — Medium priority

Solid demand; round out category coverage.

### CRM & sales
- [ ] Copper
- [ ] Keap (Infusionsoft)
- [ ] Freshworks CRM
- [ ] Agile CRM
- [ ] Salesmate
- [ ] Affinity
- [ ] Mautic
- [ ] Drift

### Sales intelligence / enrichment
- [ ] Clearbit
- [ ] Hunter.io
- [ ] Dropcontact
- [ ] UpLead
- [ ] Phantombuster

### Marketing
- [ ] GetResponse
- [ ] Iterable
- [ ] Lemlist
- [ ] Autopilot (Ortto)
- [ ] Tapfiliate
- [ ] ProfitWell
- [ ] Brandfetch
- [ ] Bitly

### Messaging / SMS / push
- [ ] Vonage
- [ ] MessageBird (Bird)
- [ ] Plivo
- [ ] seven (sms77)
- [ ] MSG91
- [ ] Pushover
- [ ] Pushbullet
- [ ] Mattermost
- [ ] Rocket.Chat
- [ ] Cisco Webex
- [ ] GoTo Webinar
- [ ] Line

### Helpdesk / ITSM
- [ ] Freshservice
- [ ] Zammad
- [ ] HaloPSA
- [ ] SyncroMSP

### Databases / low-code data
- [ ] Oracle Database
- [ ] Databricks
- [ ] Azure Cosmos DB
- [ ] Azure Storage (Blob/Table)
- [ ] TimescaleDB
- [ ] MQTT
- [ ] AMQP
- [ ] Baserow
- [ ] NocoDB
- [ ] SeaTable
- [ ] Grist
- [ ] Quick Base
- [ ] Stackby
- [ ] Elasticsearch

### Dev / IT / security
- [ ] CircleCI
- [ ] Travis CI
- [ ] Grafana
- [ ] Metabase
- [ ] Splunk
- [ ] UptimeRobot
- [ ] Okta
- [ ] Microsoft Entra ID
- [ ] Bitwarden
- [ ] LDAP
- [ ] npm registry
- [ ] Git (raw operations)
- [ ] Nextcloud
- [ ] Home Assistant

### AWS (missing pieces)
- [ ] AWS Bedrock
- [ ] AWS Cognito
- [ ] AWS Rekognition
- [ ] AWS Textract
- [ ] AWS Transcribe
- [ ] AWS Comprehend
- [ ] AWS IAM
- [ ] AWS ELB
- [ ] AWS Certificate Manager

### ERP / accounting / e-commerce
- [ ] Odoo
- [ ] ERPNext
- [ ] Invoice Ninja
- [ ] Gumroad
- [ ] Unleashed Software
- [ ] DHL (shipping)

### Forms & events
- [ ] Formstack
- [ ] Form.io
- [ ] Wufoo
- [ ] Acuity Scheduling
- [ ] Demio
- [ ] Onfleet
- [ ] Workable

### Content / social / media
- [ ] Storyblok
- [ ] Medium
- [ ] Discourse
- [ ] Disqus
- [ ] Spotify
- [ ] Bannerbear
- [ ] APITemplate.io
- [ ] QuickChart
- [ ] Google Business Profile

### AI utilities & vector stores (rest)
- [ ] Mindee (OCR)
- [ ] Jina AI
- [ ] Airtop (browser automation)
- [ ] Milvus
- [ ] Chroma
- [ ] PGVector
- [ ] MongoDB Atlas Vector Search
- [ ] Azure AI Search
- [ ] Zep

---

## Tier 3 — Long tail / niche

Include for parity claims; low individual demand.

- [ ] Action Network
- [ ] Adalo
- [ ] Beeminder
- [ ] Bubble
- [ ] Cockpit CMS
- [ ] CoinGecko
- [ ] Cortex (security)
- [ ] CrateDB
- [ ] Currents
- [ ] E-goi
- [ ] Elastic Security
- [ ] Emelia
- [ ] FileMaker
- [ ] Flow (getflow.com)
- [ ] Google Books
- [ ] Google Cloud Natural Language
- [ ] Google Perspective
- [ ] Google Workspace Admin
- [ ] Gotify
- [ ] Hacker News
- [ ] Humantic AI
- [ ] KoBoToolbox
- [ ] LingvaNex
- [ ] LoneScale
- [ ] Mailcheck
- [ ] Marketstack
- [ ] Matrix
- [ ] MISP
- [ ] Mocean
- [ ] Monica CRM
- [ ] NASA
- [ ] Netscaler (Citrix ADC)
- [ ] One Simple API
- [ ] OpenThesaurus
- [ ] OpenWeatherMap
- [ ] Orbit (service shut down in 2024 — skip)
- [ ] Oura
- [ ] Peekalink
- [ ] Philips Hue
- [ ] Pushcut
- [ ] QuestDB
- [ ] Raindrop
- [ ] Rundeck
- [ ] SecurityScorecard
- [ ] Sendy
- [ ] SIGNL4
- [ ] Strava
- [ ] Taiga
- [ ] TheHive / TheHive 5
- [ ] Twake
- [ ] Twist
- [ ] uProc
- [ ] urlscan.io
- [ ] Venafi TLS Protect
- [ ] Vero
- [ ] Wekan
- [ ] Yourls
- [ ] Zulip
- [ ] Microsoft Graph Security

---

## Platform capabilities (n8n core nodes, not services)

These are n8n *utility* nodes users rely on heavily. In FlowRunner they belong to the
platform/flow-engine roadmap rather than the extensions repo, but they matter for
perceived parity:

- Generic **HTTP Request** + **GraphQL** actions
- **Webhook** trigger / respond-to-webhook
- **SMTP send** / **IMAP read** (generic email, no vendor)
- **FTP/SFTP**, **SSH**
- **RSS feed** read/trigger
- **XML ⇄ JSON**, **HTML extract**, **Markdown convert**
- **PDF read**, **iCalendar**, **spreadsheet file parse**, **compression (zip/gzip)**
- **Crypto** (hash/HMAC/sign), **JWT**, **TOTP**
- **Image editing** (resize/crop/composite)
- Flow logic: If/Switch/Merge/Filter/Loop/Wait/Schedule/Code — assumed covered by FlowRunner core

---

## FlowRunner exclusives (n8n has NO native equivalent)

Worth highlighting in marketing — we're ahead here: Acumatica, Apollo, Bill.com,
BigCommerce, ClickSend, Close CRM, DataForSEO, Deel, DocuSign, EasyPost, Easyship,
ElevenLabs, Fireflies, FreshBooks, Front, GoCardless, Google Forms, Gravity Forms,
Instantly, MailerSend, NetSuite, Parseur, PDF.co, Personio, Ramp, Recruitee, Revolut
Business, ShipBob, Shippo, ShipStation, Squarespace, TurboDocx, Wiza, Zoho Books, Zoho
Inventory, Zoho Recruit.

(n8n's Zoho node covers CRM only; FlowRunner has four Zoho products.)

---

## Counting notes

- n8n's "~1200 integrations" marketing number includes credential-only entries, community
  nodes, and generic HTTP templates. This analysis uses only **built-in first-party nodes**
  from the n8n monorepo — the honest parity target.
- Umbrella folders expanded: Google (21 sub-nodes), Microsoft (12), AWS (15 incl. flat-file
  Lambda/SNS), Cisco (Webex), Elastic (2).
- Excluded from the gap list: n8n-internal nodes (n8n API, training/debug nodes) and
  deprecated services (Orbit).
