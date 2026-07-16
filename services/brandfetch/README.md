# Brandfetch FlowRunner Extension

Look up brand assets and company data through the [Brandfetch Brand API v2](https://developers.brandfetch.com). Retrieve logos, color palettes, fonts, links, and firmographics for any company by domain or brand ID, and search for brands by name. Authenticates with a Brandfetch Brand API key sent as an `Authorization: Bearer` header (get one at [developers.brandfetch.com](https://developers.brandfetch.com)).

## Ideal Use Cases

- Enrich a CRM company or lead record with logos, brand colors, and firmographics starting from just its email domain.
- Auto-brand generated documents, decks, or emails by pulling a company's primary logo and accent color.
- Resolve a company name a user typed into a canonical domain and brand ID before storing it.
- Build a brand directory or media kit by fetching structured brand records at scale.

## List of Actions

### Brand

- Get Brand
- Search Brands

## List of Triggers

This service does not define any triggers.

## Notes

### Brand lookup by domain

**Get Brand** accepts a company **domain** (e.g. `nike.com`), a **Brandfetch brand ID** (e.g. `id_0dwKPKT`), or a stock ticker, ISIN, or crypto symbol. It returns the complete Brandfetch record: name, domain, descriptions, all logos (`logo`/`symbol`/`icon`/`other`) with each format's download URL, the color palette (`accent`/`dark`/`light`/`brand` with hex values), fonts, social/website links, images, industries, and company firmographics. Returns 404 if the brand is not found. Use **Search Brands** first when you only have a name or partial domain — then pass a result's domain or brand ID into **Get Brand**.

### Convenience fields

Alongside the raw API record, **Get Brand** surfaces two flattened fields so flows can grab the main assets without traversing the arrays:

- `primaryLogoUrl` — the best available logo URL (prefers a full `logo`, then `symbol`, `icon`, `other`; prefers a raster format, falling back to SVG).
- `primaryColor` — the brand's `accent` color hex, falling back to the first available color.

### Logo Link CDN (no API key required)

Brandfetch also exposes a public **Logo Link** CDN for embedding brand logos directly in `<img>` tags with no API call and no authentication:

```
https://cdn.brandfetch.io/{domain}
```

For example, `https://cdn.brandfetch.io/nike.com` returns Nike's logo image. It is handy for quickly rendering a logo, but returns no structured data — use **Get Brand** for full brand metadata, multiple logo formats, colors, and company info.

## Agent Ideas

- Use **Brandfetch** "Search Brands" to resolve a company name to its domain, then **Brandfetch** "Get Brand" to fetch its logo and firmographics, and **HubSpot** "Create Company" to store the enriched record.
- After **HubSpot** "Create Contact" fires with a work email, call **Brandfetch** "Get Brand" on the email's domain to attach the employer's logo and accent color to the contact.
- Use **Brandfetch** "Get Brand" to pull a client's `primaryLogoUrl` and `primaryColor`, then **Google Sheets** "Add Row" to log the brand assets into a client onboarding sheet.
