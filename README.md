# shadow-dba

**A senior SQL Server DBA inside Claude Code, in one command. Read-only by design.**

```bash
npx shadow-dba workspace init
```

This creates a workspace folder, opens it in your editor, and opens the quick start in your browser.
Fill in `.env` with a read-only login, run `claude` in the folder, and ask things like
"run a health check on this server" or "why is SQL slow?".

## What you get

```
mssql-shadow-dba/
├── CLAUDE.md       system prompt: a senior SQL Server DBA with house rules
├── .mcp.json       starts the read-only MCP server (@shadow-dba/mssql-dba-mcp)
├── .claude/
│   ├── skills/     instance-risk-audit, performance-audit, exec-plan-analysis,
│   │               index-tuning, backup-audit, schema-review
│   └── agents/     exec-plan-analyst (reads huge plan XML in its own context)
├── .env            your connection settings (git-ignored)
├── DOCS.html       quick start and field guide
└── scripts/        your own DBA routines
```

Every skill only reads. When a fix is needed, you get a script and you run it yourself.

## Safety

Read-only in three layers:

1. **A read-only login.** The MCP refuses to start with a sysadmin or db_owner login.
   Create the login with the [setup script](https://github.com/shadow-dba/mssql-dba-mcp#permissions).
2. **Tools that only read**: DMVs, catalog views, backup history, waits.
3. **A strict check** on the SELECT queries the agent writes itself.

The login is the real guarantee. You can check all of it: the skills are plain files in your folder,
and both projects are open source.

## Commands

| Command | What it does |
|---|---|
| `npx shadow-dba workspace init` | Create a workspace. Options: `--name <folder>`, `--engine mssql`, `--no-open` |
| `npx shadow-dba@latest workspace update` | Merge newer skills into an existing workspace; your own edits are kept |
| `npx shadow-dba app` | The shadow-dba server app (coming soon) |

Short forms: `npx shadow-dba` = `workspace init`, `npx shadow-dba update` = `workspace update`.
Requires Node.js 20 or newer. SQL Server only for now; Postgres is planned.

## Related

- [mssql-dba-mcp](https://github.com/shadow-dba/mssql-dba-mcp): the read-only SQL Server MCP server this workspace uses.

## License

[MIT](LICENSE)
