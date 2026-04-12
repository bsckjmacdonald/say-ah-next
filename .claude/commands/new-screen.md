---
description: Scaffold a new screen component and wire it into the state machine
---

Create a new screen for the Say Ah session flow.

Screen name from arguments: $ARGUMENTS (PascalCase, e.g. `CalibrationScreen`). If empty, ask the user for the name and the screen id (kebab-case, e.g. `calibration`) before doing anything.

Steps:

1. Add the new screen id to the `ScreenId` union in `lib/types.ts`. Place it in the order it appears in the flow — confirm position with the user if unclear.
2. Create `components/screens/<Name>.tsx` following the structure of existing screens (look at `PreRepScreen.tsx` as a reference — client component, typed props, Tailwind classes consistent with the rest).
3. Import and render the new screen in `app/page.tsx` under the screen switch, and add any needed handlers (`handle<Name>Begin`, etc.) following the existing `useCallback` pattern.
4. Do NOT add tests, stories, or docs unless the user asks.
5. After scaffolding, run `npm run lint` and `npm run build` and report any errors.

Conventions to respect:
- `"use client"` at the top — every screen is client-side
- Props typed inline; no separate `*.types.ts` file
- No comments unless the "why" is non-obvious
- Use the `@/` path alias for imports

End with a one-line summary of what changed and suggest the user test the new screen in the browser.
