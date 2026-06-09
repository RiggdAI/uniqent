---
name: process-order
description: Process an incoming order through the full receive → validate → fulfil → invoice pipeline.
---

# Process Order

1. **Receive** — read the order file and confirm all required fields are present (order ID, line items, customer ref, timestamp).
2. **Validate** — check quantities against available inventory and verify pricing matches the current rate card; surface any discrepancies before continuing.
3. **Fulfil** — mark the order as fulfiled in the order log; do not alter the source record without operator confirmation.
4. **Invoice** — generate the invoice document, referencing the order ID, and write it to the invoices directory.
5. **Summarise** — output a one-paragraph handoff note: order ID, status, any exceptions, and the next required action.
