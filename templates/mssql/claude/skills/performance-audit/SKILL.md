---
name: performance-audit
description: Performance analysis of the SQL Server instance — owns ALL performance questions, both live firefights and broader reviews. Use when the user says "why is SQL slow", "the server is slow", "analyze the performance", "performance review", "highlight performance issues", "what's blocking", "something is hammering the DB", "top queries", "live bottleneck". Two modes - live triage (5s wait sample -> running queries -> constrained resource) and instance review (cumulative waits, top resource queries, memory/IO/tempdb). For reliability, security, configuration, backup, or patching audits use instance-risk-audit instead.
---

# Performance analysis

Single goal: name the bottleneck(s) and the queries/resources behind them. Read-only.
Performance only — if the user wants backups, CHECKDB, security, patching, or configuration
audited, invoke `instance-risk-audit` instead.

## Mode selection

- **Firefight** — the user says slow *right now*, users are stuck, something is hammering the DB.
  Value is speed: live 5-second sample, answer in minutes.
- **Review** — "analyze the performance", "highlight performance issues", no acute incident.
  Value is completeness: cumulative evidence since restart.

If ambiguous, check for an active incident first (`mssql_blocking`,
`mssql_running_requests`): something visibly on fire → Firefight; otherwise → Review.

## Phase 0 — minimal context (both modes)

- `mssql_server_version` — uptime (cumulative DMVs reset on restart; a review right after a
  restart is meaningless — say so) + edition (Web/Express CPU/memory caps are often the real
  bottleneck).

## Wait decode (both modes)

Ignore benign idle waits (`SLEEP_*`, `*_QUEUE`, `XE*`, `BROKER_*`, CLR idle,
`WAIT_XTP_HOST_WAIT`) — they top the list on healthy servers.

- `CXPACKET`/`CXCONSUMER` → parallelism (MAXDOP / cost threshold)
- `PAGEIOLATCH_*` → reading from disk
- `LCK_M_*` → blocking
- `WRITELOG` → log/storage latency
- `RESOURCE_SEMAPHORE` / `RESOURCE_SEMAPHORE_QUERY_COMPILE` → **poison wait**, memory-grant
  pressure; escalate
- `SOS_SCHEDULER_YIELD` → CPU pressure
- `PAGELATCH_*` on 2:x pages → tempdb contention

## Mode A — Firefight (slow right now)

1. `mssql_wait_stats` with **`sampleSeconds: 5`** — the live top non-idle wait names the
   bottleneck. Re-sample once if the first sample looks transient.
2. `mssql_running_requests` — what is actually executing (CPU, reads, elapsed, blocker, SQL text).
   Use `includeSleeping: true` if you suspect an abandoned open transaction holding locks.
3. Corroborate the top wait with **exactly one** resource tool:
   - memory wait → `mssql_memory_pressure` (+ `mssql_buffer_hit_ratio`); name the wait + forced grants
   - IO wait → `mssql_disk_io_latency` (flag files over ~20 ms read / ~20 ms write)
   - lock wait → `mssql_blocking` (head blocker, blocked count)
   - tempdb → `mssql_tempdb_health`
4. Only if a query stands out: `mssql_top_queries` (sort by the implicated resource) →
   `mssql_execution_plan` on the returned plan handle.

## Mode B — Instance review (analyze performance)

1. `mssql_wait_stats` with **`sampleSeconds: 0`** — the since-restart wait profile. The top
   non-idle waits (by % of total) name the chronic bottlenecks. Always report them alongside
   uptime.
2. `mssql_top_queries` — run for `cpu`, then `logical_reads`, then `duration`. The
   queries appearing across multiple sorts are the real offenders.
3. Corroborate all four resources (each is one cheap call):
   - `mssql_memory_pressure` + `mssql_buffer_hit_ratio` — PLE vs RAM size (~300s per 4 GB rule of
     thumb), forced grants, sustained hit ratio well under ~99% on OLTP
   - `mssql_disk_io_latency` — files over ~20 ms read / ~20 ms write
   - `mssql_tempdb_health` — file count/balance, contention
   - `mssql_blocking` — standing blocking patterns
4. Deep-dive where the evidence points: `mssql_execution_plan` on standout plan handles;
   `mssql_db_missing_indexes` on implicated databases. For a full index audit
   (unused/duplicate/fragmentation), invoke `index-tuning` instead of redoing it here.

## Rules

- The top non-idle wait **must appear in output**, even when it is the only line. "No
  performance issues" is a finding only after the top wait is named.
- A memory finding must **name the wait** (e.g. `RESOURCE_SEMAPHORE`) and the forced-grant count.
- In Review mode, every cumulative percentage must be reported with the uptime it accumulated
  over.
- No number that wasn't read from a tool call this session.

## Output

One-line verdict first:

- 🔴 **Firefight** — active bottleneck blocking users now
- 🟠 **Degraded** — measurable pressure, not blocking
- 🟢 **No bottleneck** — top non-idle wait is benign

**Firefight:** then one table —

```
| Bottleneck | Top wait (tool) | Query/resource behind it | Suggested action |
```

— then the top 1-3 offending queries with the single highest-value next step. Keep it short;
this mode's value is speed.

**Review:** then the top chronic bottlenecks (max 3), each with wait %, uptime, the queries
behind it, and the corroborating resource number; then a numbered, ordered recommendation list
(highest-impact first). Skip healthy resources — report them in one line, not four.
