---
name: instance-risk-audit
description: Reliability, security, and configuration audit of the SQL Server instance — backups, CHECKDB/corruption, patching/version, security posture, alerting, capacity, config hardening. Use when the user asks to "check the SQL Server", "is the server healthy", "run a health check", "security audit", "are we patched", "audit the configuration". NOT for performance questions ("why is SQL slow", "analyze performance", blocking, top queries) — those belong to performance-audit. Orchestrates the read-only DBA tools in priority order and reports prioritized findings.
---

# SQL Server health check (reliability, security, configuration)

A playbook for auditing a SQL Server instance with the `mssql-dba-mcp`. The order is
deliberate: establish context, triage urgent breakage, audit security/alerting, then standing
reliability/config risks, then targeted deep-dives only where earlier phases pointed.

**Performance is out of scope.** If the user asks why the server is slow, wants wait/query
analysis, or asks for a performance review, invoke `performance-audit` — do not duplicate it here.
The only performance-adjacent checks kept in this skill are outage-level (active blocking
chains, full disks) because they mean something is broken *now*.

All tools are read-only. Connect to one instance (env-configured). Run phases in order;
stop early only if the user asked a narrow question that one phase already answers.

## How to use this skill

1. Run the phases top to bottom, calling the named tools.
2. After each phase, keep only the **findings** (anomalies), not raw dumps.
3. Every finding must be grounded in a tool result from this run: the observed value and the
   threshold it violated. A finding without a number is an impression, not a finding. (Track
   which tool produced each finding so you can answer follow-ups, but don't put it in the report.)
4. At the end, emit the **report** (see Output): health score + emergencies + ordered actions
   first, then a compact aggregated table of 🟡 standing risks. Don't show passing checks unless asked.
5. If a tool errors on permissions (e.g. `mssql_checkdb_status` needs sysadmin/db_owner),
   note it as "could not check" — never treat an unreadable check as healthy.

## Phase 0 — Context (always run first, cheap)

You cannot judge later findings without this. These set the baselines that every threshold
below is measured against.

| Tool                     | Why it's needed first                                                            |
| ------------------------ | -------------------------------------------------------------------------------- |
| `mssql_server_version`     | Build/edition/version. Drives "is this patched / supported", and edition limits. |
| `mssql_server_timezone`    | Server clock & offset. Required to read backup/job/CHECKDB ages correctly.       |
| `mssql_all_db_info` | The database inventory + per-DB state, recovery model, compat level, options.    |

Record: how many user DBs, which recovery models, server "now". Carry these into later phases
(e.g. only FULL/BULK_LOGGED DBs need log-backup checks; "9 days old" is judged against server now).

**Patch gap** — the server can only report its own build; the latest available build is not
knowable from any server-side tool, and model memory goes stale. If the build is not current-looking
(RTM, or an old CU), web-search "SQL Server <version> latest cumulative update build" and report the
gap concretely: "build 16.0.1000.6 = RTM; latest is CU<N> (build <X>, released <month year>)".
If the lookup is unavailable, report "unpatched since <build's release>; could not verify latest CU"
— never name a CU number from memory.

## Phase 1 — Triage (is something broken right now?)

Fast checks for outage-level problems. Run these first after context.

| Tool                               | What to flag                                                 |
| ---------------------------------- | ------------------------------------------------------------ |
| `mssql_offline_db`            | Any DB not ONLINE — investigate before anything else.        |
| `mssql_storage_capacity`             | Drives under threshold — imminent out-of-space.              |
| `mssql_blocking` | Active blocking chains — users are stuck now.                |
| `mssql_agent_failed_jobs`              | Agent jobs failed in last 7 days (esp. backup/CHECKDB jobs). |

If a database is offline or a drive is full, surface it immediately and ask whether to keep going.

## Phase 1.5 — Security & alerting audit

Core to the industry-standard checklist. **Aggregate** the results — never emit one row per database.

| Tool                      | What to flag |
| ------------------------- | ------------ |
| `mssql_privileged_logins`   | Every sysadmin / securityadmin member marked **REVIEW**. If the user named their service / DBA accounts, pass them in `expectedAccounts`. If the tool warns the list is incomplete (no VIEW ANY DEFINITION), say so — don't report "no extra admins". |
| `mssql_db_owners`     | User DBs not owned by `sa`, and especially **orphaned** owners (owner login no longer exists). |
| `mssql_agent_alerts` | Missing alerts for corruption errors 823/824/825 and severities 19–25; no enabled operator (alerts have nowhere to go). The tool already escalates missing corruption alerts to 🔴 when `suspect_pages` has rows — keep that severity. |

The failsafe operator and a few Agent settings live in the registry and no tool checks them.
Never report them as healthy; say "not checked" if the user asks about Agent setup.

## Phase 2 — Reliability & configuration (standing risks)

Standing risks even when the server "feels fine".

| Tool                                             | What to flag                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mssql_recent_backups`                        | Any **online** DB with no recent FULL, or FULL/BULK_LOGGED DB with no recent LOG backup (log will grow / RPO at risk). Ignore offline DBs — they are already surfaced in Phase 1. For a flagged DB, drill in with `mssql_db_backup_history`. |
| `mssql_checkdb_status`                        | **Online** DBs never CHECKDB'd or > 7 days; any `suspect_pages` row = corruption, escalate. Skip offline DBs — they cannot be checked and are already flagged in Phase 1.                                                                |
| `mssql_server_config` (`onlyFlagged: true`) | Risk flags: uncapped max memory, cost threshold = 5, MAXDOP 0, priority boost, xp_cmdshell, etc.                                                                     |
| `mssql_tempdb_health`                              | Too few/uneven data files, %-growth, version-store bloat, contention.                                                                                                |
| `mssql_db_config_health`                    | Flagged DBs: auto_close / auto_shrink ON, page_verify ≠ CHECKSUM, auto statistics off, legacy recovery interval (target recovery time = 0), Query Store off, old compatibility level. |
| `mssql_agent_jobs`                         | Are backup + CHECKDB + index maintenance jobs actually scheduled (not just "exist")? |
| `mssql_vlf_counts`                                 | Log VLF count > ~1000 — slows startup, restores, and the recovery you'd need during an outage. Surface the worst offenders. |
| `mssql_autogrowth_issues`                     | Percent growth, tiny fixed growth (≤ 1 MB) on large files, or autogrowth off — stalls during growth events, or a hard failure when the file fills. |

## Phase 3 — Deep-dive & delegation (only if earlier phases pointed here)

Targeted follow-ups scoped to what the audit implicated:

- Backup gap on a DB → `mssql_db_backup_history` for the full chain; for an RPO/RTO-focused audit,
  invoke `backup-audit`.
- Join/comparison failures or mixed collations → `mssql_db_collation`, `mssql_db_collation_mismatches`.
- Corruption or error-log signals → `mssql_error_log`.
- Anything no tool above covers → `mssql_run_select` (read-only SELECT only).

Delegate instead of deep-diving here:

- Performance symptoms surfaced during the audit (waits, hot queries, blocking beyond the
  Phase 1 outage check) → `performance-audit`.
- Index problems (missing/unused/duplicate/fragmented) → `index-tuning`.

## Reporting rules (accuracy guardrails)

The value of this report over a raw script is judgment — which means a wrong fact is worse than a
missing one. Before writing any finding:

- **Edition-aware capacity.** If the edition is Web or Express, flag its CPU/memory cap as a finding
  — these editions are capped far below Standard and that ceiling is often the real bottleneck.
- **Backups: verify, don't trust one phrasing.** "No backup" / "never" from any one tool is a claim,
  not a fact. Confirm against `mssql_db_backup_history` before stating an RPO. Two known traps:
  - sp_Blitz-style checks join `backupset` on `server_name = SERVERPROPERTY('ServerName')`, so a
    server rename makes a real full backup read as "never." Cross-check
    `SELECT DISTINCT server_name FROM msdb.dbo.backupset` against `SERVERPROPERTY('ServerName')`.
  - A full that exists only on **local disk** while diffs/logs go offsite is an RPO/DR gap (lose the
    box → the offsite diffs are orphaned). Check backup **destination**, not just recency.
- **No fact without a tool result this session.** A number you did not read from a tool call this run
  is an impression, not a finding. When two tools disagree, report the discrepancy — don't pick one.

## Output — the report

The report is written for a busy human, not another script. Lead with a single health score and
what forces action tonight; push standing best-practice deviations into a compact aggregated tier
so nothing is dropped but nothing buries the emergencies. Plain language throughout: never name a
feature or setting (remote DAC, page verify, VLF, Query Store…) without a clause saying why the
reader should care — the reader should never have to google a finding to understand it.

**1. Health score** — the first line of the report: a 0–100 score plus a one-line verdict.

Start at 100 and deduct: **30 per 🔴** (data loss / corruption / outage risk), **10 per 🟠**
(elevated risk, no immediate outage), **2 per 🟡 finding-group** (a deviation counted once even
if it affects 20 DBs). Floor at 0. Map to a label: 85–100 🟢 Healthy · 60–84 🟡 Needs attention ·
30–59 🟠 At risk · 0–29 🔴 Critical.

Example: `> **Health score: 42/100 — 🟠 At risk.** Corruption on one database and no log backups for 3 days; the rest is tune-up work.`

The score is a communication device, not a precision instrument — its job is to make "how bad is
it?" answerable in one glance and comparable between runs.

**2. Server context line** — name, version/build, **edition (quoted from `mssql_server_version`)**,
edition CPU/memory cap if Web/Express, user-DB count, recovery-model summary.

**3. Urgent findings (🔴 / 🟠 only)** — one row each, highest first. The **Why it matters** column
is the plain-language stake — what breaks or is lost if this stays unfixed:

```
| Priority | Finding | Why it matters | Suggested action |
|----------|---------|----------------|------------------|
| 🔴 Critical | Corruption flagged on `StackOverflow` (suspect_pages, file 1, page 12345) | Data on that page is already damaged; it can spread and silently corrupt backups | DBCC CHECKDB now; restore from a clean backup |
| 🔴 Critical | No alert configured for corruption errors (823/824/825) | The server can't notify anyone about the corruption that's already happening | Create corruption alerts + an operator now |
| 🟠 Warning | DB `StackOverflow` (FULL recovery) has no LOG backup for 3 days | A crash today loses up to 3 days of data | Fix the log-backup job |
```

**4. Immediate actions, in order** — a numbered list the DBA executes top to bottom. This is the
report's highest-value section; keep it.

**5. Standing risks (aggregated)** — every 🟡 best-practice / config deviation, collapsed with
counts so 20 per-DB rows become one line. Same rule: each finding carries its one-clause "why":

```
| Finding | Why it matters | Scope | Suggested action |
|---------|----------------|-------|------------------|
| Very fragmented transaction logs (VLF count > 1000) | Slows crash recovery and restores — exactly when you're in a hurry | 3 DBs (worst: 'StackOverflow' 12,345) | Shrink + regrow log in larger steps |
| Files grow in tiny 1 MB steps | Large files pause constantly to grow, stalling queries | worst: 'StackOverflow' 100 GB | Set fixed-MB growth sized to the file |
| Query Store disabled | No history to diagnose a query that suddenly got slow | 12/12 DBs | Enable it |
| Remote DAC disabled | Blocks the emergency back-door connection used to fix a hung server remotely | instance | Enable remote admin connections |
| Extra sysadmin logins | Each one can read, change, or drop anything on the instance | 5 sysadmin, 2 securityadmin | Review; remove unneeded |
```

Severity guide: 🔴 data-loss / corruption / outage · 🟠 elevated risk, no immediate outage ·
🟡 best-practice deviation. Don't cite tool names in the report — keep them for follow-ups.
Show passing checks only when asked.

## Notes

- Read-only throughout — this skill never changes server state; recommendations are for the DBA to apply.
