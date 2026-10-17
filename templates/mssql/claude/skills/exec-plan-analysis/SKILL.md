---
name: exec-plan-analysis
description: Analyze SQL Server execution plans to identify performance bottlenecks and optimization opportunities. Use when a developer asks to "analyze this execution plan".
---

The user wants an execution plan analysis. Your job here is **only to dispatch and validate** — do not perform the plan analysis yourself. The full analysis methodology lives in the `exec-plan-analyst` subagent definition; do not duplicate it here.

## Step 1 — Dispatch

1. **Do NOT read, open, grep, or process any execution plan files** attached to this conversation. The plan XML is too large to fit in this context window and would defeat the purpose of using a subagent.
2. From the conversation, collect only routing metadata (no file content):
   - **File path(s)** of any attached plan files (`.xml`, `.json`, `.sqlplan`).
   - **Plan handle(s)** if provided as text, with any accompanying query stats.
   - **Query text** if the user provided it alongside the plan.
3. Invoke the `exec-plan-analyst` subagent with:
   - The file path(s) or plan handle(s).
   - The query text (if any).
   - An instruction that it must read and analyze the plan itself using its own `Read`/`Grep` tools.
4. **Multiple plans → multiple subagents in parallel.** If the user attached or referenced more than one plan/query, invoke one `exec-plan-analyst` subagent **per plan** in a single response so they run concurrently.

## Step 2 — Validate every index recommendation against live data

The subagent has no MCP access and will mark every index suggestion with `[NEEDS LIVE VALIDATION]`. You must validate each one before presenting it. For every table mentioned in the subagent's recommendations, fetch in parallel:

- `mssql_table_index_health` — full existing index definitions, usage status, read/write ratio, fragmentation, drop candidates.
- `mssql_table_missing_indexes` — DMV-level missing-index recommendations to cross-reference.

Use the live data to:

1. **Detect duplicates / consolidation opportunities.** If a suggested index already exists (or its columns are already covered by an existing index's keys or `INCLUDE`s), either drop the suggestion or recommend modifying the existing index instead of adding a new one.
2. **Detect column-position mistakes.** If the existing index has the right columns but in the wrong position (e.g., `CreationDate` is an `INCLUDE` where it should be the 2nd key), recommend a `DROP` + `CREATE` (or column-order rebuild) rather than adding a redundant index.
3. **Identify drop candidates** (write-only indexes: zero `user_seeks/scans/lookups` with non-zero `user_updates`) on the same table. If you're adding an index, prefer to drop unused ones to offset write amplification.
4. **Retune `FILLFACTOR`** based on the live read/write ratio:
   - Read-heavy (≥10:1) → 90–95
   - Balanced (1:1 to 5:1) → 85
   - Write-heavy (1:5 or worse) → 70–80
5. **Prefer `ONLINE = ON`** unless the table contains LOB columns or the edition does not support it.
6. **Column order rule:** equality predicates → range/sort → `INCLUDE` for projection-only columns.

Discard or revise any recommendation that the live data contradicts. Never present a recommendation that hasn't been cross-checked against live index definitions.

## Step 3 — Present to the user

Use the subagent's output structure (Summary / Database & Tables / Performance Bottlenecks / Optimization Recommendations / Validation Plan). For each recommendation that was modified or dropped after live validation, **clearly mark the change and explain why** (e.g., "Revised from new index to column-order rebuild because `CreationDate` is already an INCLUDE on `IDX_Posts_OwnerUserId`"). Include a net-impact summary if you added one index and dropped several (e.g., "Net NCI count on `dbo.Posts`: 8 → 5").

## Constraints

- Do not analyze the plan yourself; that's the subagent's role.
- Do not present unvalidated `[NEEDS LIVE VALIDATION]` recommendations to the user.
- Do not run `UPDATE STATISTICS`, `CREATE INDEX`, or any DDL — produce recommendations only.
