---
name: backup-audit
description: Audit backup coverage and restore readiness across databases — RPO/RTO, backup chain integrity, missing FULL/DIFF/LOG, backup destination/DR gaps. Uses the 'mssql-dba-mcp' MCP server. Use when the user says "are we backed up", "check backups", "can we restore", "what's our RPO", "DR readiness", "backup audit". Read-only. For a full server health check use instance-risk-audit.
---

# Backup & DR audit

Answer one question: if this server died now, how much would we lose and how fast could we
recover. Read-only throughout.

## Phase 0 — context

- `mssql_server_version` — server name (for the rename trap below) + server "now".
- `mssql_all_db_info` — recovery models. Only FULL/BULK_LOGGED DBs need log-backup checks;
  SIMPLE DBs can't take log backups (don't flag them for it).

## Phase 1 — coverage per DB

- `mssql_recent_backups` — latest FULL / DIFF / LOG per DB vs server now.
- For any DB flagged "no/old backup": `mssql_db_backup_history` to confirm (don't trust one
  phrasing).
- Compute RPO per DB = age of last recoverable point (last LOG for FULL recovery, last
  FULL/DIFF for SIMPLE).

## Phase 2 — known traps (carried from instance-risk-audit)

- **Server-rename false "never":** backupset rows join on `server_name`. Cross-check
  `SELECT DISTINCT server_name FROM msdb.dbo.backupset` vs `SERVERPROPERTY('ServerName')` via
  `mssql_run_select` before declaring "never backed up".
- **Local-only FULL = DR gap:** a FULL on local disk while diffs/logs go offsite means a lost
  box orphans the offsite chain. Check the backup destination (`physical_device_name`), not just
  recency.
- **Chain integrity:** a LOG/DIFF with no reachable base FULL is unrestorable. Flag broken chains.

## Phase 3 — restore readiness (advisory)

- Is the FULL + chain sufficient to hit the stated RTO?
- Note the last successful restore test if discoverable; flag if never tested.

## Output

One-line verdict:

- 🔴 **Critical** — a DB with no usable recent backup, a broken chain, or a local-only FULL
- 🟠 **Warning** — RPO worse than target
- 🟢 **Healthy** — coverage meets target

Then per-DB table:

```
| DB | Recovery model | Last FULL | Last LOG | RPO | Destination | Risk |
```

Aggregate best-practice deviations (e.g. "12 DBs FULL recovery, no log backups") into one line
each. Track which tool produced each finding so you can answer follow-ups, but don't put tool
names in the report.
