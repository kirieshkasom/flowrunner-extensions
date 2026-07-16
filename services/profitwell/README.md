# ProfitWell FlowRunner Extension

Reads SaaS subscription financial metrics from [ProfitWell Metrics](https://www.profitwell.com/) (now **ProfitWell Metrics by Paddle**) and pushes subscription lifecycle events into manual/API-based ProfitWell accounts. Authenticates with a private ProfitWell (Paddle) API token, set as the **API Token** config item.

## Ideal Use Cases

- Pull month-over-month or day-by-day MRR, active customers, ARPU, and churn into dashboards, reports, or alerts.
- Break down a single metric (e.g. Recurring Revenue, Churned Customers) over time, optionally by plan.
- Feed subscription creations, upgrades/downgrades, plan migrations, and churn events into a manual/API-based ProfitWell account so they are counted in your metrics.

## List of Actions

### Metrics (token-based, read-only)

- Get Monthly Metrics
- Get Daily Metrics
- Get Metric Detail

Any account with an API token can read metrics; this requires a **metrics-enabled** token. Available metrics include recurring revenue (MRR), active customers, average revenue per user, new recurring revenue, upgrades, downgrades, reactivations, new customers, churned customers, churned revenue, net new revenue, and plan change revenue.

### Subscriptions (manual / API-based accounts)

- Create Subscription
- Update Subscription
- Migrate Subscription
- Churn Subscription
- Get Subscriptions

These operations require an **API-based (manual)** ProfitWell account that feeds ProfitWell directly through the API (rather than a billing-system integration); they are not applicable to accounts wired to a billing integration. Changes made via the subscription API can take up to ~90 minutes to be reflected in your metrics.

## List of Triggers

This service does not define any triggers.

## Authentication

Set a single config item, **API Token** — your private ProfitWell (Paddle) API token, found in the ProfitWell app under **Account Settings → API keys**. The token is sent as the **raw** `Authorization` header value — **not** `Bearer <token>`, just the token itself. A `200` response indicates the token authenticated successfully; a `401` indicates an invalid or missing token.

## Notes

- **Paddle / Retain status:** ProfitWell is now part of Paddle (acquired 2022). The standalone **ProfitWell Metrics v2 API is still active** at `https://api.profitwell.com/v2` and remains the documented way to read metrics and push subscription data — this is separate from Paddle's Billing API and from Paddle **Retain** (the churn-recovery product, formerly ProfitWell Retain). When Retain is enabled on your account, delinquent churns can trigger recovery workflows automatically off the same subscription/churn data.
- **Field conventions:** Value is in the smallest currency unit (cents, e.g. `4900` for `$49.00`); Plan Currency is a lowercase ISO 4217 code (`usd`, `eur`, `gbp`); Plan Interval is `Monthly`/`Yearly` in the UI (sent as `month`/`year`); Effective Date accepts a `YYYY-MM-DD` date or Unix timestamp; Churn Type is `Voluntary` (customer cancelled) or `Delinquent` (failed payment).
- API errors surface the response body message together with the HTTP status where available, e.g. `ProfitWell API error [401]: ...`.
- Zero runtime dependencies. No dictionaries — ProfitWell does not expose a reliable lookup surface for plans/customers.

## Agent Ideas

- When a **Chargebee** "Create Subscription" completes, call **ProfitWell** "Create Subscription" to mirror the new subscription into a manual ProfitWell account so it is counted in your metrics.
- On a monthly schedule, use **ProfitWell** "Get Monthly Metrics" to fetch MRR and churn, then **Slack** "Send Message To Channel" to post the revenue summary to a #metrics channel.
- Use **ProfitWell** "Get Metric Detail" to pull churned-customer counts per plan, then **Google Sheets** "Add Rows" to append the breakdown into a churn-tracking spreadsheet.
