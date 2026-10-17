# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`shadow-dba` is a zero-dependency Node CLI (a scaffolder) published to npm. Running it copies an engine's templates into a new workspace folder so users get a ready-to-use Claude SQL DBA setup (system prompt, MCP config, agents, skills) in one command. The CLI itself does almost nothing; **the product is the contents of `templates/`.**

## Commands

```bash
node bin/cli.js --help                          # run the CLI directly
node bin/cli.js workspace init --name foo       # scaffold into ./foo (alias: --name foo)
node bin/cli.js workspace update --path foo --dry-run   # merge newer templates (alias: update)
node bin/cli.js app                             # placeholder: the server app ships its own installer
npm test                        # node:test suite in test/ (zero dependencies)
npm link && shadow-dba --help   # install globally, then invoke by name
```

No build or lint setup exists. Requires Node >= 20. `update` needs `git` on PATH for 3-way merges (falls back to `.new` copies without it).

## Architecture

Two layers that must not be confused:

1. **The CLI** — grammar is `shadow-dba <product> <verb>`. `src/cli.js` `route()` maps argv to a command: `workspace init|update`, `app` (prints "coming soon"), plus aliases (bare / `--name x` = `workspace init`, `update` = `workspace update`). `bin/cli.js` dispatches: `update` to `src/update.js`, init to `src/scaffold.js` (arg parse + file copy): parse `--name`/`--engine`/`--help`, refuse if the target folder exists, then copy templates. `parseArgs`, `scaffold`, and `writeWorkspace` are exported for testing. `src/manifest.js` holds the template copy mapping (`shippedFiles()`) and the `.shadow-dba/` snapshot helpers. `src/update.js` + `src/merge.js` implement `shadow-dba workspace update` (see below). `src/interactive.js` is the cinematic TTY installer (splash → engine picker, skipped with `--engine` → name prompt → animated provision); it reuses `writeWorkspace`. `src/open.js` is the post-scaffold launcher: it detects the user's editor (`TERM_PROGRAM` + a PATH probe for `code`/`cursor`/`windsurf`/`subl`/`zed`), opens the new workspace in it and `DOCS.html` in the default browser. It's TTY-only, skips CI/pipes, can be disabled with `--no-open`, and fails soft. Setup instructions live in the browser-rendered Quick Start (the `#start` section of `DOCS.html`), not the terminal: `openWorkspace` returns `{ editor, docsOpened }`, and both `scaffold()` and the interactive flow print only confirmations of what opened — plus a one-line `DOCS.html` pointer when the browser didn't open.

2. **The templates** — `templates/<engine>/` is the workspace that gets generated. Editing the user-facing DBA product means editing files here, **not** the CLI.

### Engines

Templates are scoped per database engine under `templates/<engine>/`:

- `templates/mssql/` — the SQL Server workspace. The only engine that currently ships content (`available: true` in `ENGINES`); `--engine` accepts only available engines.
- `templates/postgres/` — empty placeholder for the upcoming Postgres workspace (`available: false`; shown dimmed/upcoming in the interactive picker, not selectable). When its templates are added, flip `postgres.available` to `true` in `src/scaffold.js`.

`writeWorkspace(target, engine = 'mssql', { templatesDir })` copies from `templates/<engine>/` and throws if the engine has no available templates.

### Template copy mapping (critical)

`shippedFiles()` in `src/manifest.js` is the single source of truth for what ships and where; `writeWorkspace()` and `update` both use it. Names are rewritten during copy — the on-disk template names differ from what ships (for a given `<engine>`):

- `templates/<engine>/claude/` → `<target>/.claude/` (leading dot restored at copy time)
- `templates/<engine>/mcp.json` → `<target>/.mcp.json` (dot restored; copied as-is). The MCP starts with `npx -y @shadow-dba/mssql-dba-mcp@0.1` and reads `./.env` from cwd itself (no shell, so it works on Windows); no absolute path is baked in.
- `templates/<engine>/CLAUDE.md` → `<target>/CLAUDE.md` (copied as-is)
- `templates/<engine>/.env.example`→ `<target>/.env.example` **and** `<target>/.env` (the same template is copied twice — `.env` is pre-created so the user just fills it in, no `cp` step; `.env.example` stays as a pristine reference)

`.gitignore`, `.env` and `scripts/` are created by `writeWorkspace()`, not listed in `shippedFiles()` — they belong to the user after scaffolding and `update` never touches them (npm also strips files literally named `.gitignore`).

So to add a skill/agent/setting to the generated mssql workspace, add it under `templates/mssql/claude/...`, not `.claude/...` — everything under `claude/` is walked automatically. If you add a new top-level template file or rename one, update `TOP_FILES` in `src/manifest.js` — top-level files are listed by name.

### Updating existing workspaces (`shadow-dba workspace update`)

Users run `npx shadow-dba@latest workspace update`; the new templates come from the installed npm package, so shipping an update = edit templates, bump `version`, `npm publish`.

- `writeWorkspace()` writes `<target>/.shadow-dba/state.json` (`{ kind: "workspace", engine, version }`; files from before 0.1.0 have `provider` instead of `engine` and are still read; a non-workspace `kind` is refused) and `.shadow-dba/base/` (exact copy of the shipped files) — the "base" for a 3-way merge.
- `planUpdate()` compares base / user file / new template per file: template-only changes are applied, user-only changes kept, both-changed files merged with `git merge-file` (conflict markers on overlap), new files added, dropped files removed only if unedited. Files with no base (workspaces made before `update` existed) get a `<file>.new` copy instead.
- `applyUpdate()` backs up every user file it changes to `.shadow-dba/backup/<timestamp>/` (self-ignored), applies the plan, then refreshes `base/` and `state.json`. Exit code 2 means conflicts or `.new` files need the user.

### Don't confuse repo-config with shipped templates

- Root `CLAUDE.md` (this file) configures Claude when working **on this repo**.
- `templates/mssql/CLAUDE.md` and `templates/mssql/claude/` are the DBA system prompt and config **shipped to users**. Different audience, different purpose.

## The shipped DBA workspace (templates/mssql/)

- `templates/mssql/CLAUDE.md` — system prompt casting Claude as a senior MSSQL DBA. Encodes house rules: index naming MUST be `IDX_{table}_{columns}`; mutating/destructive actions require explicit user approval; ground every conclusion in real MCP data, never invent values.
- `templates/mssql/mcp.json` — configures the `mssql-dba` MCP server (`npx @shadow-dba/mssql-dba-mcp`) with DB connection env vars the user fills in after scaffolding. Its tools are `mcp__mssql-dba__*`; settings, agents and skills must use this exact name.
- `templates/mssql/claude/skills/*/SKILL.md` — task playbooks. Each `description` front-matter field carries the trigger phrases that route a user request to that skill (e.g. performance-audit vs. instance-risk-audit). Most skills are read-only and emit scripts for the DBA to apply.
- `templates/mssql/claude/agents/exec-plan-analyst.md` — subagent for execution-plan analysis. Dispatched by the `exec-plan-analysis` skill so huge plan XML never enters the main context window. It has no live DB access, so it tags index suggestions `[NEEDS LIVE VALIDATION]` for the dispatcher to cross-check.

## Rules to update CLAUDE.md

After making changes, on every iteration, if you think that updating CLAUDE.md is necessary then ask a user if the changes made reflect his vision and ask if you should update the file. There is no need to document non-final changes if the user has some fixes in mind.
