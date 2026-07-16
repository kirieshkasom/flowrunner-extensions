# LDAP FlowRunner Extension

FlowRunner integration for **LDAP** directory servers (OpenLDAP, Active Directory, 389 Directory Server, ApacheDS, and any RFC 4511-compliant server). It speaks LDAP directly over TCP using the pure-JavaScript [`ldapts`](https://www.npmjs.com/package/ldapts) client — no native modules to compile. Every operation follows the classic LDAP lifecycle **bind → operation → unbind**, and uses a **connect-per-call** model: each action opens a fresh client, binds with the service credentials, runs its operation, and always unbinds when the call finishes — no clients are pooled or cached between invocations.

## Ideal Use Cases

- Validate user logins against a corporate directory (**Authenticate User**).
- Look up people, groups, or devices by username, email, or any attribute (**Search**, **Get Entry**).
- Provision and de-provision accounts — create, rename/move, and delete entries.
- Update directory attributes (email, group membership, phone numbers) from a workflow.
- Check group membership or attribute values server-side without transferring data (**Compare**).

## List of Actions

### Directory

- **Search** — search from a Base DN with a Scope (Base / One Level / Subtree) and an RFC 4515 filter (e.g. `(&(objectClass=person)(uid=jdoe))`); returns matching entries with their DN and attributes. The flagship read operation.
- **Get Entry** — fetch a single entry by its exact DN (base-scoped `(objectClass=*)` lookup); returns the entry or `null`.
- **Compare** — test whether an entry's attribute contains a specific value (LDAP Compare); returns a boolean.

### Entries

- **Add Entry** — create an entry at a DN from a JSON object of attribute/value pairs (include `objectClass`).
- **Modify Entry** — apply `add` / `replace` / `delete` changes to an entry's attributes.
- **Rename Entry** — change an entry's DN (LDAP ModifyDN) to rename it in place or move it.
- **Delete Entry** — delete an entry (non-recursive; leaf entries only).

### Authentication

- **Authenticate User** — validate a user's credentials by binding **as that user** on a separate connection; returns `{authenticated: true}` on success or `{authenticated: false}` on invalid credentials.

## List of Triggers

This service does not define any triggers.

## Connection Model

Every operation opens a short-lived `ldapts` `Client`, binds with the configured **Bind DN** / **Bind Password**, runs its operation, and always unbinds when the call finishes (success or failure). No clients or connections are pooled or cached between invocations. **Authenticate User** is the one exception to *whose* credentials are used: it opens its own separate client and binds as the end user being validated — never with the service credentials.

## Configuration

| Setting | Required | Description |
| --- | --- | --- |
| Server URL | Yes | LDAP server URL, e.g. `ldap://dc.example.com:389` (plain) or `ldaps://dc.example.com:636` (TLS). |
| Bind DN | Yes | The DN the service authenticates as, e.g. `cn=admin,dc=example,dc=com`. Active Directory also accepts a userPrincipalName (`svc@example.com`). |
| Bind Password | Yes | Password for the Bind DN account. |
| Base DN | No | Default search base (e.g. `dc=example,dc=com`) used when an operation doesn't specify one. |
| Verify TLS Certificate | No | For `ldaps://` only. On by default. Turn off to allow self-signed / untrusted certificates (less secure — trusted internal servers only). |

## Filter & Scope Reference

- **Filter** — standard [RFC 4515](https://www.rfc-editor.org/rfc/rfc4515) syntax: `(uid=jdoe)`, `(mail=*@example.com)`, `(&(objectClass=person)(department=Sales))`, `(|(sn=Doe)(sn=Smith))`, `(!(userAccountControl:1.2.840.113556.1.4.803:=2))`. Defaults to `(objectClass=*)`.
- **Scope** — **Base** (the base entry only), **One Level** (its immediate children), **Subtree** (the base and all descendants; the default).

## Attribute Values

- Single-valued attributes are returned as **strings**; multi-valued attributes as **arrays of strings**.
- Binary attributes (e.g. `objectGUID`, `objectSid`, `jpegPhoto`, `thumbnailPhoto`) are returned as **Buffers**.
- Every returned entry includes its `dn`.

## Active Directory Notes

- **Password writes require LDAPS.** AD only accepts password changes over an encrypted (`ldaps://`) connection.
- **`unicodePwd` needs special encoding.** Setting/resetting an AD password writes the `unicodePwd` attribute as a quoted, UTF-16LE-encoded value. This service does not perform that encoding, so AD password changes are **out of scope** for Modify Entry.
- **Paged search for large result sets.** AD caps a single search at ~1000 entries (MaxPageSize). Enable **Paged** on Search to retrieve more.
- Authenticate User accepts either a full DN or a userPrincipalName (`user@domain`) for AD binds.

## Error Handling

LDAP result codes are surfaced with the error name and message, e.g. Invalid Credentials (**49**), No Such Object (**32**), Already Exists (**68**), Not Allowed On Non-Leaf. Network-level failures (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `ENETUNREACH`) include a hint to check the Server URL host/port (389 for `ldap://`, 636 for `ldaps://`), server reachability from FlowRunner, and firewall/allowlist rules.

## Agent Ideas

- Use **Search** to find a user by username and obtain their DN, then **Authenticate User** with that DN and the entered password to build a directory-backed login check.
- On a new-hire event, use **Add Entry** to provision an account, then **Slack** "Send Message To Channel" to notify IT that the account is ready.
- Use **Search** with a group filter to list members, then **Compare** to verify a specific user's membership before granting access in a downstream step.

---

> **Note:** This is a driver-based service (pure-JS `ldapts` over raw TCP). It has not yet had a live smoke test in FlowRunner — flag it for a functional check against a real directory server before relying on it in production.
