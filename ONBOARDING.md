# Welcome to Say Ah

Glad to have you on the project. This doc should get you from a fresh clone to your first PR.

## What this is

**Say Ah** is a web app for LSVT-style voice exercises. Users do timed "ahhh" reps while the app measures their voice with the mic, gives live feedback, and logs results across a session. It's a Next.js (App Router) app, client-heavy because of the Web Audio + Speech APIs.

## Stack

- **Next.js 16.2** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4**
- **Web Audio API** for mic analysis, **SpeechSynthesis** for TTS prompts
- Deployed on **Vercel**

Heads-up: this is Next.js 16, which has real breaking changes vs. what most tutorials/LLMs assume. When in doubt, check `node_modules/next/dist/docs/` or the official docs — don't guess. `AGENTS.md` calls this out too.

## Getting set up

```bash
git clone <repo-url>
cd say-ah-next
npm install
npm run dev
```

Open http://localhost:3000. The app needs mic permission to do anything useful, so accept the prompt. Chrome or a recent Edge/Firefox works best; Safari's SpeechSynthesis behavior is quirky.

Scripts:
- `npm run dev` — dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm start` — serve the built app

No env vars are required to run locally today.

## Repo layout

```
app/            Next.js App Router entry (layout.tsx, page.tsx, globals.css)
components/     UI components
  screens/      One component per screen in the session flow
hooks/          useSession, useVoiceInput, useAudioAnalyser
lib/            Pure logic — audio analysis, feedback scoring, storage, TTS, types
public/         Static assets
```

Mental model: `app/page.tsx` is a small state machine that flips between screens (`welcome → mic-permission → pre-rep → exercise → rep-result → session-complete`, plus `history`). Session state lives in `useSession`; audio lives in `useAudioAnalyser`; everything scoring- or feedback-related is in `lib/`.

Path alias: `@/` maps to the repo root (see `tsconfig.json`), so imports look like `@/lib/constants`.

## Conventions

- **Client components** where we touch the mic, TTS, or local storage — most of the app. Only add `"use client"` where needed.
- **TypeScript everywhere.** Shared types live in `lib/types.ts`.
- **No comments unless the "why" is non-obvious.** Names should carry the load.
- **Tailwind for styling.** No CSS modules, no styled-components.
- Keep pure logic in `lib/` and stateful/browser stuff in `hooks/` or components.

## Deployment

Pushes to `main` deploy to Vercel production. PR branches get preview URLs automatically. Check the PR's Vercel comment for the preview link — that's the fastest way to sanity-check a change on a real device/mic.

## Workflow

1. Branch off `main`: `git checkout -b your-name/short-description`
2. Small, focused PRs please — easier to review, easier to roll back
3. Run `npm run lint` and `npm run build` locally before pushing
4. Test the actual mic flow in the browser; type checks won't catch audio regressions
5. Open a PR against `main`, share the Vercel preview in the description

## Good first things to poke at

- Read `app/page.tsx` end-to-end — once you understand the screen state machine, the rest of the app falls out of it
- Skim `hooks/useSession.ts` and `hooks/useAudioAnalyser.ts`
- Look at `lib/feedback.ts` and `lib/realtimeFeedback.ts` to see how rep scoring works
- Run a full session locally to see the UX before changing anything

## Questions

Ping me (Bob) on whatever we use for chat. For anything context-heavy, drop a comment on the PR or open a GitHub issue so it's captured.

Welcome aboard.
