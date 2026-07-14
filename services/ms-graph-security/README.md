# Microsoft Graph Security FlowRunner Extension

Automate security operations across Microsoft Defender and Microsoft Sentinel from FlowRunner over the [Microsoft Graph Security API](https://learn.microsoft.com/en-us/graph/api/resources/security-api-overview). Triage alerts and incidents, monitor your Microsoft Secure Score posture, and manage threat intelligence indicators. Authentication uses OAuth 2.0 with delegated permissions.

## Ideal Use Cases

- Triage security alerts and incidents automatically: set status, assign an owner, and record classification and determination.
- Correlate and resolve incidents that group related alerts into a single case.
- Track your tenant's Microsoft Secure Score over time and manage the review state of individual controls.
- Push threat intelligence indicators (URLs, domains, IPs, file hashes) into Microsoft security products for allow, block, or alert actions.

## List of Actions

### Alerts
- List Alerts
- Get Alert
- Update Alert
- List Legacy Alerts

### Incidents
- List Incidents
- Get Incident
- Update Incident

### Secure Score
- List Secure Scores
- Get Secure Score
- List Secure Score Control Profiles
- Update Secure Score Control Profile

### Threat Intelligence
- List Threat Intelligence Indicators
- Create Threat Intelligence Indicator
- Delete Threat Intelligence Indicator

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses OAuth 2.0 (Microsoft identity platform / Azure AD v2 endpoint) with delegated permissions. Operations run in the context of the signed-in user, who must hold a supported Microsoft Entra role (for example Security Reader, Security Operator, or Security Administrator) with sufficient privileges for the actions being performed.

1. **Register an app** in the [Microsoft Entra admin center](https://entra.microsoft.com) under **Identity → Applications → App registrations → New registration**, setting the FlowRunner OAuth callback URL as a **Web** redirect URI.
2. **Create a client secret** under **Certificates & secrets** and copy its **Value** immediately (shown only once).
3. **Grant delegated Microsoft Graph permissions** — `openid`, `offline_access`, `SecurityEvents.ReadWrite.All`, `SecurityIncident.ReadWrite.All`, `SecurityAlert.ReadWrite.All`, and `ThreatIndicators.ReadWrite.OwnedBy` — then select **Grant admin consent**. These are admin-restricted scopes that require tenant admin consent.
4. **Configure the service** with your **Client ID** (Application ID) and **Client Secret**, then connect an account through the FlowRunner OAuth flow.

## Data Model

- **Alerts** (`alerts_v2`) track suspicious activities detected across Microsoft Defender and Microsoft Sentinel, each carrying a status, severity, classification, determination, and an evidence collection. The legacy `alerts` collection is exposed via **List Legacy Alerts** for older integrations.
- **Incidents** correlate related alerts into a single investigable case with its own status, assignment, classification, determination, and custom tags. Incidents can optionally expand their related alerts inline.
- **Secure Score** exposes daily snapshots of the tenant's security posture (`secureScores`) plus the per-control definitions (`secureScoreControlProfiles`) whose review state you can update.
- **Threat Intelligence Indicators** (`tiIndicators`) are observables — URLs, domains, destination IPs, or file hashes — that you submit to a target Microsoft security product to drive allow, block, or alert actions.

## Notes

- Microsoft Graph returns large collections in pages. When a response includes an `@odata.nextLink`, pass it to the **Next Page Link** parameter of the same operation to retrieve the next page.
- **Update Secure Score Control Profile** always sends the required `vendorInformation` block (`provider: SecureScore`, `vendor: Microsoft`) and the `Prefer: return=representation` header so the updated profile is returned.
- **Create Threat Intelligence Indicator** requires at least one observable (Domain Name, URL, Destination IPv4, or File Hash Value). When supplying a file hash, also select its File Hash Type. Note that the `tiIndicators` API is observable-based, marked deprecated, and only available on Microsoft Graph's beta surface; for new large-scale threat-intelligence ingestion, consider Microsoft Sentinel's upload API.

## Agent Ideas

- When **Microsoft Graph Security** "List Incidents" surfaces a high-severity active incident, use **Microsoft Teams** "Send Channel Message" to alert the security operations channel.
- After triaging with **Microsoft Graph Security** "Update Alert", use **Outlook** "Send Message" to notify the assigned owner with the alert details.
- Periodically call **Microsoft Graph Security** "List Secure Scores" and record the current and maximum score to track your security posture trend over time.
