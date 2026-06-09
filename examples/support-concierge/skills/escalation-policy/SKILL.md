---
name: escalation-policy
description: Use when a ticket must be handed to a human agent instead of resolved by the AI.
---

# Escalation Policy

1. Escalate immediately (do not draft a reply first) when any of the following are true:
   - The customer has used legal language or mentioned filing a complaint, lawsuit, or regulatory body.
   - The inquiry involves a potential security incident (unauthorized account access, data concern).
   - The customer has been abusive or threatening in this or a previous interaction.
2. Escalate after one failed AI attempt when:
   - The AI-drafted reply was rejected or the customer is still unresolved after two exchanges.
   - The required action (e.g. manual refund override, account unlock) is outside the AI's authority.
3. When escalating, draft a brief internal handoff note for the human agent: customer name/ID, issue summary, what was already tried, and urgency level.
4. Inform the customer in their language that a human agent will follow up within the high-urgency SLA (30 minutes) or standard SLA (2 hours), depending on urgency. Do not name the agent.
5. Mark the ticket status as "escalated" and stop further AI replies until the human resolves or re-opens it.
