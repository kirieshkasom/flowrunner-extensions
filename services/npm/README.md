# npm Registry FlowRunner Extension

Read-only access to the public npm registry: fetch package metadata and versions, resolve dist-tags, search packages, and pull download statistics. Public package reads require no authentication; an npm access token is only needed to read private packages.

## Ideal Use Cases

- Monitoring package versions and dist-tags for dependency automation
- Tracking download trends for packages you publish or depend on
- Searching the registry to discover packages by keyword, scope, or author
- Health-checking the registry connection

## List of Actions

### Packages

- Get Package
- Get Package Version
- Get Package Dist-Tags

### Search

- Search Packages

### Downloads

- Get Download Count
- Get Download Range

### Registry

- Get Registry Info

## List of Triggers

This service does not define any triggers.

## Authentication

- **No token required for public data.** Package metadata, versions, dist-tags, search, download counts, and registry info are all public reads.
- **Optional Auth Token** for private packages only. Create a token at [npmjs.com → Access Tokens](https://www.npmjs.com/settings/~/tokens). When set, it is sent as `Authorization: Bearer <token>`.

## Notes

- **Scoped package names** (e.g. `@angular/core`) are accepted as-is; the service URL-encodes the `/` to `%2F` for you.
- **Search** hits `GET /-/v1/search` and supports pagination (`size` up to 250, `from`) and optional quality/popularity/maintenance ranking weights, plus qualifiers like `author:`, `scope:`, and `keywords:` in the search text.
- **Downloads** use a friendly period preset (Last Day / Last Week / Last Month / Last Year) or a custom `YYYY-MM-DD:YYYY-MM-DD` range. Omit the package name for registry-wide totals.
- **Hosts**: package metadata, versions, dist-tags, and search use `https://registry.npmjs.org`; download counts use `https://api.npmjs.org`.

## Agent Ideas

- Use **npm Registry** "Get Package Dist-Tags" to check the current `latest` version of a dependency, then when it changes call **GitHub** "Create Issue" to open a "Bump dependency" ticket in the affected repo.
- Run **npm Registry** "Get Download Range" for a package you maintain and use **Google Sheets** "Add Row" to log the daily download counts into a spreadsheet for trend charting.
- Use **npm Registry** "Search Packages" to discover packages matching a keyword or scope, then post the top results to a channel with **Slack** "Send Message To Channel" for team review.
