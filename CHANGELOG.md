# Changelog

## 0.2.0

- New command names: `shadow-dba harness` creates a workspace and `shadow-dba harness update`
  merges newer templates. `workspace init`, `workspace update` and `app` are removed.
  Bare `shadow-dba` and `shadow-dba update` still work.
- The interactive installer offers to overwrite a workspace folder that already exists.
- DOCS.html follows the brand kit: brand colors, IBM Plex Sans type scale, the brand logo and
  favicon. The workflow example is named "instance risk audit", like the skill.
- New logo in the README.

## 0.1.0 (2026-10-20)

First public release.

- `shadow-dba workspace init`: creates a Claude Code DBA workspace for SQL Server
  (`--name`, `--engine mssql`, `--no-open`). Bare `shadow-dba` still works.
- `shadow-dba workspace update`: 3-way merges newer templates into a workspace and keeps your edits.
  `shadow-dba update` still works.
- `shadow-dba app`: placeholder for the server app.
- Skills: instance-risk-audit, performance-audit, exec-plan-analysis, index-tuning, backup-audit,
  schema-review. Subagent: exec-plan-analyst.
- The MCP server starts with `npx -y @shadow-dba/mssql-dba-mcp@0.1` and reads `.env` itself
  (works on Windows).
- Skills, the subagent and DOCS use the MCP 0.1 tool names (`mssql_` prefix, snake_case).
- `.env.example` defaults to a read-only `shadow-dba` login; comments sit on their own lines.
