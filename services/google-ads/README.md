# Google Ads FlowRunner Extension

FlowRunner integration for the [Google Ads API](https://developers.google.com/google-ads/api/docs/start) (REST, **v24**). Query campaign performance with GAQL, list accessible accounts and campaigns, retrieve aggregated campaign metrics, and enable or pause campaigns. Authenticates with OAuth 2.0 plus a Google Ads developer token.

## Ideal Use Cases

- Pull daily or weekly campaign performance (clicks, impressions, cost, conversions) into a spreadsheet, database, or report.
- Run arbitrary Google Ads Query Language (GAQL) reports to read any resource, metric, or segment the API exposes.
- Automatically pause campaigns that exceed a spend or performance threshold, or resume them on a schedule.
- Enumerate the accounts and campaigns available to a connected user or manager (MCC) account for downstream automation.

## List of Actions

### Reporting

- Search (GAQL)

### Accounts

- List Accessible Customers

### Campaigns

- Get Campaign Metrics
- List Campaigns
- Update Campaign Status

## List of Triggers

This service does not define any triggers.

## Authentication

The service uses OAuth 2.0 **plus** a Google Ads developer token.

| Config item | Shared | Description |
|---|---|---|
| Client Id | yes | OAuth 2.0 Client ID from the Google Cloud Console |
| Client Secret | yes | OAuth 2.0 Client Secret from the Google Cloud Console |
| Developer Token | no | Google Ads API developer token (see below) |
| Login Customer ID | no | Optional manager (MCC) account ID, digits only (see below) |

OAuth scopes requested: `https://www.googleapis.com/auth/adwords`, `userinfo.email`, `userinfo.profile`.

### Getting a developer token

1. Sign in to a Google Ads **manager account** (developer tokens are only issued to manager accounts — create one for free at ads.google.com/home/tools/manager-accounts if needed).
2. Go to **Tools & Settings → Setup → API Center** and accept the terms; a token is generated immediately with **Test** access level.
3. A **test-level token works only against Google Ads test accounts**. To call production accounts, apply for **Basic access** from the API Center (Google reviews the application; approval typically takes a few business days). Standard access can be requested later for higher quota.
4. Also enable the **Google Ads API** in the Google Cloud project that owns your OAuth client.

### Login Customer ID (MCC)

If the accounts you operate on are **client accounts managed under an MCC (manager) account**, set the Login Customer ID config item to the manager account's 10-digit ID **without dashes** (e.g. `1234567890`). It is sent as the `login-customer-id` header on every request and tells Google Ads which manager the authenticated user is acting through. Leave it empty when working directly with an account the connected user owns.

## Notes

- **Search (GAQL)** is the universal read operation. Pages are fixed at 10,000 rows by the API; paginate with `nextPageToken` or cap with a `LIMIT` clause. Monetary metrics are returned in micros (divide by 1,000,000).
- **List Campaigns** and **Get Campaign Metrics** convert monetary values from micros to currency units in the account's currency automatically.
- **Update Campaign Status** performs a partial mutate (`updateMask=status`), leaving all other campaign settings unchanged.
- Dictionaries power the pickers: an account picker (client accounts under the configured MCC, or directly accessible accounts with name lookup) and a campaign picker dependent on the selected account.

### Out of scope

**Campaign and budget creation** is intentionally not implemented: creating a servable campaign requires multiple coordinated sub-resources (campaign budget, bidding strategy, ad groups, ads, targeting criteria) that don't map well to a single flow action. Create campaigns in the Google Ads UI, then manage and report on them here. Anything readable is still available through **Search (GAQL)**.

## Agent Ideas

- Run **Google Ads** "List Campaigns" (or "Search (GAQL)") to pull yesterday's campaign performance, then use **Google Sheets** "Add Rows" to append each campaign's clicks, cost, and conversions into a daily reporting spreadsheet.
- Call **Google Ads** "Get Campaign Metrics" for a key campaign, and when spend or CPC crosses a threshold use **Slack** "Send Message To Channel" to alert the marketing team.
- Detect an underperforming campaign via **Google Ads** "Search (GAQL)", automatically call **Google Ads** "Update Campaign Status" to pause it, then use **Gmail** "Send Message" to notify the account owner with the reason.
