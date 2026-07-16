# SecurityScorecard FlowRunner Extension

Assess and monitor the cybersecurity posture of any company by its primary domain using the SecurityScorecard API. Retrieve overall grades (A–F) and scores (0–100), per-factor scores, detailed issue findings, and historical trends; benchmark against industry peers; organize companies into portfolios; and generate reports. Authenticates with a SecurityScorecard API token sent as `Authorization: Token {token}`.

## Ideal Use Cases

- Continuously monitor a vendor's or partner's security grade and alert your team when it drops.
- Enrich a new-vendor onboarding flow with an automated third-party risk assessment.
- Benchmark a company's factor scores (patching cadence, network security, DNS health) against its industry.
- Build and maintain portfolios of monitored companies for ongoing supply-chain risk reporting.
- Generate detailed or summary security reports and prioritized remediation plans on a schedule.

## List of Actions

### Companies

- Get Company Score
- Get Company Factor Scores
- Get Company Historical Scores
- Get Company Historical Factor Scores
- Get Company Issues by Type
- Get Company Information

### Portfolios

- List Portfolios
- Create Portfolio
- Get Portfolio Companies
- Add Company to Portfolio
- Remove Company from Portfolio

### Industries

- Get Industry Score
- Get Industry Factor Scores

### Reports

- Generate Report
- Get Score Plan

## List of Triggers

This service does not define any triggers.

## Authentication & Configuration

This service uses an API token. In the SecurityScorecard app, go to **My Settings → API**, generate a token, and paste it into the **API Key** config item. The token is sent as `Authorization: Token {token}` against base URL `https://api.securityscorecard.io`.

| Config Item | Type | Required | Description |
| --- | --- | --- | --- |
| API Key | String | Yes | SecurityScorecard API token. |

## Notes

- Companies are identified by their **primary domain** (the scorecard identifier), e.g. `google.com`; all company operations take a domain.
- A company has an overall grade (A–F) and score (0–100) plus scores across ten risk factors (network security, DNS health, patching cadence, application security, endpoint security, IP reputation, hacker chatter, information leak, social engineering, cubit score).
- Use **Get Company Factor Scores** to discover which issue types apply, then **Get Company Issues by Type** for detailed findings.
- Portfolio-scoped operations are backed by a searchable Portfolios picker (dictionary) whose option value is the portfolio ID; **List Portfolios** returns the same data as an action.
- **Generate Report** queues reports asynchronously and returns a report ID/status for later download.

## Agent Ideas

- Run **SecurityScorecard** "Get Company Score", and if the grade falls below a threshold, use **Slack** "Send Message To Channel" to alert the security team with the domain and current grade.
- On a schedule, call **SecurityScorecard** "Get Portfolio Companies" and use **Google Sheets** "Add Row" to log each company's current grade and score into a vendor-risk tracking sheet.
- When **SecurityScorecard** "Get Company Issues by Type" surfaces critical findings for a monitored vendor, use **PagerDuty** "Create Incident" to page the on-call responder with the affected assets and severity.
