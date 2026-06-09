---
name: triage-inquiry
description: Use when a new customer message arrives and needs to be classified before any reply is drafted.
---

# Triage Inquiry

1. Detect the customer's language from the message text.
2. Identify the primary topic: shipping, billing, returns, account, product bug, or other.
3. Assign urgency: high (order blocked, payment dispute, security concern), medium (delayed but not blocked), or low (general question).
4. Check whether the message contains legal language, threats, or abusive content — flag immediately for escalation if so.
5. Output a structured triage summary: `{ language, topic, urgency, escalate: true|false, reason? }` before any further action.
