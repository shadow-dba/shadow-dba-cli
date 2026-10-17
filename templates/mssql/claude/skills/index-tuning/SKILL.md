---
name: index-tuning
description: 'Analyze and optimize indexes on a database or table — missing, unused, duplicate/overlapping, fragmented, bad fill factor. Use when the user says "tune the indexes", "what indexes are missing", "find unused/duplicate indexes", "fix fragmentation", "index review for table X". Consolidates DMV recommendations into one ordered CREATE/DROP/REBUILD script. Read-only: emits scripts for the DBA to apply.'
---

# Index tuning

Produce a _consolidated_ index action plan, not a raw dump of DMV rows. Read-only — the
emitted CREATE/DROP/REBUILD statements are for the DBA to apply after review.

## Phase 0 — scope

Which DB (and optionally which tables).

## Phase 1 — gather (3 tools)

- `mssql_db_missing_indexes` — ranked missing-index recommendations. Impact ≈
  `avg_total_user_cost × (avg_user_impact / 100) × (user_seeks + user_scans)`.
- `mssql_table_index_health` / `mssql_db_index_health` — existing indexes: usage counts, fragmentation,
  fill factor, size; flag never-used / write-only-overhead indexes.
- `mssql_table_info` — row counts + read/write ratio (drives fill factor & whether it's worth it).

## Phase 2 — CONSOLIDATE (the value-add — never skip)

- **Dedupe missing indexes:** merge same-table requests with overlapping key prefixes into one
  index (widest key + union of includes). Don't emit 5 near-identical indexes.
- **Cross-check before adding:** if an existing index already covers a recommendation (key
  prefix + includes), recommend widening it (`DROP_EXISTING`) instead of a new one.
- **Net the writes:** flag tables where you'd add an index AND drop unused ones — show the net
  index-count change so the DBA sees write-amplification impact.
- **Skip noise:** tables under ~1000 rows, negligible impact, or near-zero reads.
- **Fill factor from workload:** read-heavy ~95-100, balanced ~85, write-heavy ~70.

## Phase 3 — output one ordered script

Tiered, highest ROI first. Group:

1. `DROP` unused / duplicate
2. `CREATE` consolidated missing
3. `REBUILD` (>30% frag) / `REORGANIZE` (>10% frag)

Each statement preceded by a comment: table, why, expected impact %, est. queries helped.

```
| Priority | Table | Action | Why (impact %, queries, frag%) | Statement |
```

Warn explicitly: every index slows writes; review on a non-prod copy; use `ONLINE = ON` only on
supported editions (check `mssql_server_version` edition). Read-only — the DBA applies after review.
