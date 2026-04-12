---
description: Pre-merge manual QA checklist for the Say Ah session flow
---

Walk me through a pre-merge sanity check. Do NOT run or modify code — this is a checklist for the human.

Print the following checklist as a numbered list and ask the user to confirm each item before marking the PR ready:

1. `npm run lint` passes locally
2. `npm run build` passes locally
3. Dev server starts cleanly (`npm run dev`) with no console errors on load
4. Mic permission flow works: denying + re-granting both recover gracefully
5. Full session runs end-to-end: welcome → mic → pre-rep → exercise → rep-result → session-complete, for all reps in `TOTAL_REPS`
6. Live audio meter moves during a rep; strip chart renders
7. TTS prompts play (Chrome). Confirm no uncaught errors in Safari even if voices are limited
8. Rep rating (thumbs) captures and persists
9. Feedback modal submits without error (or is obviously gated in dev)
10. History screen shows the session after completion
11. Vercel preview URL from the PR has been opened on a real phone with a real mic

If any item fails, stop and help diagnose it. Otherwise, suggest the user request review.
