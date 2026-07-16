# Cloudflare FlowRunner Extension

Manage Cloudflare zones, DNS records, cache, security rulesets, and Workers KV storage using the [Cloudflare API v4](https://developers.cloudflare.com/api/). Automate DNS changes, purge cache after deploys, audit WAF rulesets, and read or write edge key-value data.

## Ideal Use Cases

- Automatically create, update, or delete DNS records when infrastructure changes.
- Purge Cloudflare cache (everything, or specific files/tags/hosts/prefixes) after a deployment.
- List and inspect a zone's rulesets to audit managed WAF and custom firewall rules.
- Read and write Workers KV values to drive edge configuration or feature flags.
- Look up zones and DNS records dynamically for use in other flow steps.

## List of Actions

- List Zones
- Get Zone
- Purge Cache
- List DNS Records
- Create DNS Record
- Get DNS Record
- Update DNS Record
- Patch DNS Record
- Delete DNS Record
- List Rulesets
- Get Ruleset
- List KV Namespaces
- List KV Keys
- Get KV Value
- Put KV Value
- Delete KV Value

## List of Triggers

None.

## Configuration

### API Token (required)

Create a scoped API token in the Cloudflare dashboard:

1. Go to **My Profile → API Tokens → Create Token**.
2. Grant only the permissions your flows need, for example:
   - **Zone → DNS → Edit** for DNS record operations.
   - **Zone → Zone → Read** for listing/reading zones and rulesets.
   - **Zone → Cache Purge → Purge** for cache purging.
   - **Account → Workers KV Storage → Edit** for Workers KV operations.
3. Copy the generated token. It is sent as an `Authorization: Bearer <token>` header.

Scoped API tokens are strongly preferred over the legacy Global API Key.

### Account ID (optional)

Only required for the **Workers KV** operations (List KV Namespaces, List KV Keys, Get/Put/Delete KV Value). Find your Account ID on the Cloudflare dashboard account overview page (right sidebar) or in the dashboard URL after `dash.cloudflare.com/`. If a KV operation runs without an Account ID configured, the service returns a clear error asking you to add it.

## Notes and Limitations

- **Zone-level analytics** are not included. Cloudflare exposes traffic/analytics data through its GraphQL Analytics API, which uses a different endpoint and query model and is out of scope for this extension.
- **Creating firewall/WAF rules** is not supported. Rulesets can be listed and read (List Rulesets, Get Ruleset), but authoring rules involves complex phase/expression payloads and is intentionally omitted.
- **Custom Hostnames and SSL/TLS certificate management** are not included.
- **Cache purge targets** for tags, hosts, and prefixes require a Cloudflare Enterprise plan. Purge by URL and Purge Everything are available on all plans.
- **Workers KV** writes may take up to 60 seconds to propagate globally.

## Agent Ideas

- When a **GitHub** "On Push" trigger fires against your production branch, call **Netlify** "Trigger Build" to deploy, then use **Cloudflare** "Purge Cache" to clear the edge cache so visitors immediately see the new build.
- After a **GitHub** "Create Release" action, use **Cloudflare** "Put KV Value" to update an edge feature flag or version key, then **Slack** "Send Message To Channel" to announce the release to the team.
- When a **GitHub** "On Pull Request Opened" trigger fires for a preview environment, use **Cloudflare** "Create DNS Record" to point a preview subdomain at the deploy and **Slack** "Send Message To Channel" to share the preview URL with reviewers.
