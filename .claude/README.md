# .claude/

Shared Claude Code config for this repo. Anything in here is picked up automatically by Claude Code for anyone who checks the repo out.

## commands/

Project-specific slash commands. Type `/` in Claude Code to see them.

- `/new-screen <Name>` — scaffold a new screen component and wire it into the state machine
- `/session-check` — pre-merge manual QA checklist for the session flow
- `/sync` — pull `main`, reinstall if needed, lint + build
- `/feedback-rule` — guided add/adjust of a feedback category or scoring rule

## Adding a new command

Drop a `<name>.md` file in `commands/`. Frontmatter supports `description`. The body is the prompt Claude runs. Use `$ARGUMENTS` to capture whatever the user typed after the command name.

Keep them short and task-specific. If a command gets too generic, it's just noise — prefer writing it down in `AGENTS.md` as a convention instead.
