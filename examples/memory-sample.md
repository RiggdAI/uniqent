# Example memory — a departing engineer's brain

Paste or upload this in Studio's **Memory → Smart import** to see it parse into kinds and wire up
into the **Memory brain** graph. `[[Entities]]` and `#tags` become shared nodes that connect facts.

- Decision: we standardized on [[Postgres]] over [[MongoDB]] for all services #database #architecture
- Decision: API auth uses short-lived [[JWT]] tokens minted by [[Auth-Service]] #security
- The team prefers [[TypeScript]] with strict mode and [[pnpm]] workspaces #conventions
- Preference: small, focused PRs reviewed within a day #process
- [[Acme-Corp]] is our largest customer; [[Jane-Doe]] is their technical contact #stakeholders
- [[Auth-Service]] owns sessions and talks to [[Postgres]] via [[Prisma]] #architecture
- Milestone: shipped the [[Billing]] rewrite on [[Stripe]] in Q1 #milestone
- Billing reconciliation runs nightly against [[Stripe]] webhooks #billing #ops
- The [[Deploy-Pipeline]] uses [[GitHub-Actions]] → [[Docker]] → [[Fly-io]] #infra
- Preference: incident reviews are blameless and written up in [[Notion]] #process #culture
- Key context: [[Jane-Doe]] at [[Acme-Corp]] drives the roadmap for the [[Billing]] integration
