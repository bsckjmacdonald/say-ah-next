---
description: Refresh the working copy from main and verify the build still works
---

Get the branch back in sync with `main` and confirm everything still builds.

Steps (run sequentially, stop on first failure and report):

1. `git status` — if there are uncommitted changes, STOP and ask the user what to do. Do not stash or discard without explicit permission.
2. `git fetch origin`
3. Report how many commits behind `origin/main` the current branch is
4. If the user is on a feature branch: ask whether to rebase or merge `main` in. If on `main`: `git pull --ff-only`.
5. `npm install` only if `package-lock.json` changed
6. `npm run lint`
7. `npm run build`

Report the outcome of each step concisely. Do not auto-fix lint/build failures — surface them to the user first.
