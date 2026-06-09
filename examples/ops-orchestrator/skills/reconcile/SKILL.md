---
name: reconcile
description: Reconcile today's fulfilments against the ledger and report any mismatches.
---

# Reconcile

1. **Load** — read the fulfilment log for the target date and the corresponding ledger entries.
2. **Match** — pair each fulfilment to its ledger entry by order ID; flag any unmatched rows on either side.
3. **Compare** — for matched pairs, check that invoiced amount equals ledger amount; record each delta.
4. **Threshold check** — any delta above the configured threshold (default $50) is marked for escalation to Finance.
5. **Report** — write a reconciliation summary listing: matched count, unmatched orders, unmatched ledger entries, deltas, and items requiring escalation. Never modify ledger or invoice data.
