---
name: agent-ideas
description: Verify companion service @operationName exactly when writing the Agent Ideas section
metadata:
  type: feedback
---

Rule: In the `## Agent Ideas` section, every referenced operation must be a real
`@operationName` from the named service. Grep the companion service's README/index.js
before writing the bullet — do not assume the name.

**Why:** Easy to write plausible-but-wrong names. Real examples caught:
- Slack's send op is **"Send Message To Channel"**, not "Send Message".
- Gmail's is **"Send Message"** (correct).
- Airtable's is **"Create Record"** (also "Create Records" exists).
- Stripe uses **Invoices** (Create Invoice, Send Invoice, Pay Invoice), it has NO
  "Create Transaction" — that op belongs to Paddle.

**How to apply:** Before finalizing Agent Ideas, `grep -iE "<op name>" services/<companion>/README.md`
for each op referenced. Fix mismatches.
