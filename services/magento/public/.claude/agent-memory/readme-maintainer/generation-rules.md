---
name: generation-rules
description: The required README structure and content standards from docs/ai/readme-generation-rules.md
metadata:
  type: reference
---

Rules file: `docs/ai/readme-generation-rules.md` (read it every time before generating).

Required sections in order:
1. Title: `{Service Name} FlowRunner Extension`
2. Description (do NOT use the phrase "Service Description")
3. `## Ideal Use Cases` (exact heading, bullet points)
4. `## List of Actions` (names only, no descriptions; sorted alphabetically or by logical grouping)
5. `## List of Triggers` (names only)

Exclude SYSTEM and DICTIONARY methods from actions per the rules. In practice existing
service READMEs (e.g. paddle) still add extra sections — Configuration, Notes, and the
mandated `## Agent Ideas` — and list dictionaries in a compact footnote. The agent system
prompt requires `## Agent Ideas` at the bottom, and says to preserve manually-added sections
that don't conflict. So the 2000-char limit in the rules doc is not strictly enforced when
the service already has a richer, house-style README; preserve those sections on update.

Actions grouped by @category (Products, Prices, Customers, Subscriptions, Transactions,
Discounts, Adjustments, Dictionaries) is a valid "logical grouping".
