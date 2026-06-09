---
name: dietary-check
description: Audit a menu for allergen labelling, vegan and halal coverage, and common dietary requirements.
---

# Dietary Check

When asked to check a menu for dietary compliance:

1. **Scan every dish for the Big Four allergens:** nuts (all tree nuts + peanuts), gluten (wheat,
   barley, rye, oats), dairy, and shellfish. Flag any unlabelled allergen as a blocker.
2. **Check vegan coverage.** A vegan dish must contain no meat, fish, dairy, eggs, or honey.
   Flag every service period that lacks at least one vegan option.
3. **Check halal coverage.** Flag any service period that lacks at least one clearly halal option
   (no pork, no alcohol in cooking, halal-certified protein).
4. **Surface hidden risks.** Look for cross-contamination notes (shared fryers, prep surfaces)
   and flag them separately from declared allergens.
5. **Report findings** as a table: dish | allergens present | vegan? | halal? | issues.
   Use ✓ / ✗ for boolean columns so the operator can scan at a glance.
6. **Propose fixes.** For each flagged issue suggest the minimal change that resolves it — a
   substitution, an added label, or a preparation note.
