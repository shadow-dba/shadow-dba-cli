# Security policy

shadow-dba promises that the agent cannot change your database. If you find a way around that,
or any other security problem, please tell us privately first.

## How to report

Use GitHub private vulnerability reporting:
[Report a vulnerability](https://github.com/shadow-dba/shadow-dba-cli/security/advisories/new).
For problems in the MCP server (for example a query that gets past the read-only check), report it in
[mssql-dba-mcp](https://github.com/shadow-dba/mssql-dba-mcp/security/advisories/new).

Please include the version, what you did, and what happened. We aim to reply within a few working days and
will credit you in the release notes unless you ask us not to.

## What counts

- A way for the agent to write, alter, or drop anything through this workspace.
- The workspace leaking credentials from `.env` (for example into git or into a file the agent shares).
- The CLI writing outside the folder you chose.

## Supported versions

Only the latest 0.x release gets fixes.
