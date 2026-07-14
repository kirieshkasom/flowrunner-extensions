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
- [~] Kafka — **excluded**: persistent consumer connections do not fit the request/response runtime (needs a platform decision)
- [~] RabbitMQ — **excluded**: same persistent-connection constraint as Kafka

### Team chat, meetings & messaging
- [x] Discord (`services/discord`)
- [x] Microsoft Teams (`services/microsoft-teams`)
- [x] Zoom (`services/zoom`)
- [x] Google Chat (`services/google-chat`)
- [x] LinkedIn (`services/linkedin`)
- [x] Facebook Graph API (Pages/posts) (`services/facebook`)
- [x] Reddit (`services/reddit`)

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
- [x] GitLab (`services/gitlab`)
- [x] Bitbucket (`services/bitbucket`)
- [x] Cloudflare (`services/cloudflare`)
- [x] Netlify (`services/netlify`)
- [x] Sentry (`services/sentry`)
- [x] PostHog (`services/posthog`)
- [x] Jenkins (`services/jenkins`)

### Productivity, PM & scheduling
- [x] Linear (`services/linear`)
- [x] Todoist (`services/todoist`)
- [x] Coda (`services/coda`)
- [x] Cal.com (`services/cal-com`)
- [x] SurveyMonkey (`services/surveymonkey`)
- [x] Eventbrite (`services/eventbrite`)
- [x] Clockify (`services/clockify`)
- [x] Toggl Track (`services/toggl`)
- [x] Harvest (`services/harvest`)

### Payments & commerce
- [x] PayPal (`services/paypal`)
- [x] Chargebee (`services/chargebee`)
- [x] Paddle (`services/paddle`)
- [x] Wise (`services/wise`)
- [x] Magento 2 (`services/magento`)

### CMS & content
- [x] Contentful (`services/contentful`)
- [x] Strapi (`services/strapi`)
- [x] Ghost (`services/ghost`)
- [x] Zendesk (see helpdesk — `services/zendesk`)
- [x] Figma (`services/figma`)

---

## Tier 2 — Medium priority

Solid demand; round out category coverage.

### CRM & sales
- [x] Copper (`services/copper`)
- [x] Keap (Infusionsoft) (`services/keap`)
- [x] Freshworks CRM (`services/freshworks-crm`)
- [x] Agile CRM (`services/agile-crm`)
- [x] Salesmate (`services/salesmate`)
- [x] Affinity (`services/affinity`)
- [x] Mautic (`services/mautic`)
- [x] Drift (`services/drift`)

### Sales intelligence / enrichment
- [x] Clearbit (`services/clearbit`)
- [x] Hunter.io (`services/hunter`)
- [x] Dropcontact (`services/dropcontact`)
- [x] UpLead (`services/uplead`)
- [x] Phantombuster (`services/phantombuster`)

### Marketing
- [x] GetResponse (`services/getresponse`)
- [x] Iterable (`services/iterable`)
- [x] Lemlist (`services/lemlist`)
- [x] Autopilot (Ortto) (`services/ortto`)
- [x] Tapfiliate (`services/tapfiliate`)
- [x] ProfitWell (`services/profitwell`)
- [x] Brandfetch (`services/brandfetch`)
- [x] Bitly (`services/bitly`)

### Messaging / SMS / push
- [x] Vonage (`services/vonage`)
- [x] MessageBird (Bird) (`services/messagebird`)
- [x] Plivo (`services/plivo`)
- [x] seven (sms77) (`services/seven`)
- [x] MSG91 (`services/msg91`)
- [x] Pushover (`services/pushover`)
- [x] Pushbullet (`services/pushbullet`)
- [x] Mattermost (`services/mattermost`)
- [x] Rocket.Chat (`services/rocketchat`)
- [x] Cisco Webex (`services/webex`)
- [x] GoTo Webinar (`services/gotowebinar`)
- [x] Line (`services/line`)

### Helpdesk / ITSM
- [x] Freshservice (`services/freshservice`)
- [x] Zammad (`services/zammad`)
- [x] HaloPSA (`services/halopsa`)
- [x] SyncroMSP (`services/syncromsp`)

### Databases / low-code data
- [ ] Oracle Database
- [ ] Databricks
- [ ] Azure Cosmos DB
- [ ] Azure Storage (Blob/Table)
- [ ] TimescaleDB
- [ ] MQTT
- [ ] AMQP
- [x] Baserow (`services/baserow`)
- [x] NocoDB (`services/nocodb`)
- [x] SeaTable (`services/seatable`)
- [x] Grist (`services/grist`)
- [x] Quick Base (`services/quickbase`)
- [x] Stackby (`services/stackby`)
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
- [x] AWS Bedrock (`services/aws-bedrock`)
- [x] AWS Cognito (`services/aws-cognito`)
- [x] AWS Rekognition (`services/aws-rekognition`)
- [x] AWS Textract (`services/aws-textract`)
- [x] AWS Transcribe (`services/aws-transcribe`)
- [x] AWS Comprehend (`services/aws-comprehend`)
- [x] AWS IAM (`services/aws-iam`)
- [x] AWS ELB (`services/aws-elb`)
- [x] AWS Certificate Manager (`services/aws-acm`)

### ERP / accounting / e-commerce
- [ ] Odoo
- [ ] ERPNext
- [ ] Invoice Ninja
- [ ] Gumroad
- [ ] Unleashed Software
- [ ] DHL (shipping)

### Forms & events
- [x] Formstack (`services/formstack`)
- [x] Form.io (`services/formio`)
- [x] Wufoo (`services/wufoo`)
- [x] Acuity Scheduling (`services/acuity`)
- [x] Demio (`services/demio`)
- [x] Onfleet (`services/onfleet`)
- [x] Workable (`services/workable`)

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
- [x] Mindee (OCR) (`services/mindee`)
- [x] Jina AI (`services/jina`)
- [x] Airtop (browser automation) (`services/airtop`)
- [x] Milvus (`services/milvus`)
- [x] Chroma (`services/chroma`)
- [x] PGVector (`services/pgvector`)
- [x] MongoDB Atlas Vector Search (`services/mongodb` Vector Search category)
- [x] Azure AI Search (`services/azure-ai-search`)
- [x] Zep (`services/zep`)

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
