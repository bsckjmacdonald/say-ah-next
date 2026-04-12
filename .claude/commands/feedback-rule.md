---
description: Add or adjust a feedback category/rule in the Say Ah scoring logic
---

Help the user add or adjust a feedback rule.

Before writing anything:

1. Read `lib/types.ts` (the `FeedbackCategory` union and `FeedbackParams` interface)
2. Read `lib/feedback.ts` and `lib/realtimeFeedback.ts` to understand how categories are picked and how feedback strings are selected
3. Read `lib/constants.ts` for any thresholds

Then ask the user:
- Is this a new category, a new message variant for an existing category, or a threshold tweak?
- What's the trigger condition in plain English?
- What should the spoken text / display text / tip be?

Only after you have clear answers, implement the change:
- New category → add to the `FeedbackCategory` union in `lib/types.ts`, handle it in the category picker, and add message variants
- New variant → add it to the variant pool, respecting the existing deck-deal cycling structure
- Threshold tweak → update `lib/constants.ts` and note any callers that assumed the old value

Do NOT add comments explaining the change itself — the git history does that. Only add a comment if the rule has a non-obvious clinical or UX reason (e.g. "threshold from LSVT protocol X").

Finish by running `npm run lint` and suggesting the user run a full session locally to hear/see the new feedback in context.
