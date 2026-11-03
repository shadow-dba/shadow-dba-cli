---
name: schema-review
description: Review a table or schema for design anti-patterns — missing/poor primary keys, heaps, missing/unindexed/untrusted foreign keys, type and collation mismatches on join columns, deprecated or wrong data types, identity columns nearing exhaustion, rows approaching the 8060-byte limit, GUID clustered keys on write-heavy tables. Use when a developer asks to "review this table", "is this schema ok", "check the data model", "design review", "why is this table slow to write". Read-only, advisory.
---

# Schema review (developer)

Catch design problems before they become production performance/integrity issues. Read-only,
advisory — DDL changes are the developer's to apply.

## Phase 0 — scope

Which table(s) / DB. For a whole-DB review, derive the hot set from `mssql_db_tables`:
top ~10 tables by row count, plus any smaller table with high write activity. Never assume
table names — list what is actually there.

## Phase 1 — gather

- `mssql_table_info` / `mssql_db_tables` — columns, types, nullability, PK, row count,
  read/write ratio, size.
- `mssql_db_index_health` — index footprint per table.
- `mssql_db_collation_mismatches` — columns whose collation differs from the DB default.
- `mssql_db_table_keys` — heaps, tables with no PK, tables where only the PK is unique.
- `mssql_db_foreign_keys` — every FK with its health (trusted, disabled, indexed, type /
  length / collation mismatches, fix script), plus a "likely missing foreign keys" section.
  Use `onlyIssues: true` on a large database to see only FKs with problems.
- `mssql_db_check_constraints` — untrusted / disabled check constraints, with the fix script.
- `mssql_db_identity_headroom` — how much of each identity column's range is used.
- `mssql_db_column_design_issues` — deprecated / smell types, tables with very wide rows.

Pass `databaseName` to each `mssql_db_*` tool when reviewing a database other than the connected one.

## Phase 2 — flag anti-patterns

**Keys & storage**
- **No PK on a large table** — integrity + perf risk.
- **Heap (no clustered index)** — a nonclustered PK does not prevent this (`mssql_db_table_keys`
  shows the table as a heap even when it has a PK). Forwarded records, space never reclaimed.
- **GUID single-column clustered PK on a write-heavy table** — random inserts fragment;
  suggest sequential GUID or identity surrogate.
- **Composite PK > 3 cols on a high-activity table** — bloats every NC index; suggest surrogate.
- **String single-column PK on a large table** — wide keys repeated in every NC index.

**Integrity**
- **Missing FK** — parent-child column with no constraint (`mssql_db_foreign_keys`, "likely
  missing foreign keys" section). The tool matches by column name, so treat each candidate as
  a judgment call and confirm the relationship first. Orphans accumulate silently.
- **Unindexed FK column** (`mssql_db_foreign_keys`) — every parent delete/update and every join scans the child.
- **Untrusted or disabled FK/check constraint** (`mssql_db_foreign_keys`, `mssql_db_check_constraints`) — optimizer can't use it for join
  elimination or predicate pruning; suggest re-validating `WITH CHECK CHECK`.
- **Only-PK uniqueness where a natural key exists** (`mssql_db_table_keys` + column judgment: codes, emails,
  external ids) — duplicates accumulate with no error.

**Types**
- **Type/length mismatch across FK or join columns** (`mssql_db_foreign_keys`) — implicit conversion
  kills sargability on exactly the columns that get joined most.
- **Collation mismatch** (`mssql_db_collation_mismatches` + `mssql_db_foreign_keys`) — join failures / implicit conversions / scans.
- **Deprecated & wrong types** (`mssql_db_column_design_issues`): `text`/`ntext`/`image` (removal-listed), `datetime` where
  `datetime2` fits, `float`/`real` for money, `sql_variant`.
- **Sizing smells:** `NVARCHAR(MAX)` where bounded would do, oversized `varchar`,
  everything nullable.

**Capacity**
- **Identity exhaustion** (`mssql_db_identity_headroom`) — the tool marks WARN at ≥ 50% of the
  range used and RISK at ≥ 80%.
- **Wide rows** (`mssql_db_column_design_issues`) — max in-row size near the 8060-byte limit or many LOB columns:
  page splits, off-row spill, buffer pool waste.
- **Missing supporting indexes** for the table's access pattern (scan-dominant large table).

## Phase 3 — severity & output

Severity is evidence-based, not fixed per check:
- 🔴 — integrity or correctness at risk now, or measurable damage on a large/hot table
  (no PK / heap on a large table, identity RISK (≥ 80%), type mismatch on a hot join).
- 🟠 — defeats the optimizer or degrades predictably with growth (unindexed FK, untrusted
  constraint, GUID clustered PK on write-heavy, wide rows, identity WARN (≥ 50%)).
- 🟡 — debt: works today, costs later (deprecated types, sizing smells, missing natural-key
  uniqueness on a low-risk table).
- Scale with the table: the same smell on a tiny static lookup table drops one level.

One table, 🔴 first:

```
| Table | Issue | Why it matters | Evidence (tool/query) | Suggested fix |
```

Advisory only — apply DDL on a branch / non-prod copy. Cross-link `index-tuning` for index
gaps.
