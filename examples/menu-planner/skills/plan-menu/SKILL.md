---
name: plan-menu
description: Build a balanced, seasonal menu that meets a specified food-cost target and service period.
---

# Plan Menu

When asked to plan a menu:

1. **Clarify the brief.** Confirm: number of days, meal periods (breakfast/lunch/dinner), food-cost
   target (default 30%), and any hard dietary requirements (vegan, halal, allergen-free).
2. **Select seasonal ingredients.** Use web fetch to check what is in season for the current
   month and region. Prefer items with short supplier lead-times.
3. **Draft the menu.** For each dish include: name, main ingredients, estimated food cost %,
   portion sizes (protein / starch / vegetable), and allergen labels.
4. **Check coverage.** Verify at least one vegan and one halal option appears in every service
   period. Flag any period where this is not met.
5. **Confirm cost compliance.** Calculate the blended food-cost % across the full menu. If any
   dish exceeds the target, flag it and suggest a swap before finalising.
6. **Output a clean table** per day/meal, followed by a summary row showing overall food-cost %.
