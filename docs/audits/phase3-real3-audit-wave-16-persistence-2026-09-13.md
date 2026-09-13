# Phase 3 / Real-3 Audit — Wave 16 Persistence

Date: 2026-09-13

## Scope

Wave 16 audits the Task persistence boundary: SQLite schema and migrations, Task/events/execution history/role bindings/document metadata/idempotency ownership, document recovery journals, and fail/reopen/retry history preservation. It does not reopen the Real-3 acceptance flow or redesign lifecycle semantics already closed by earlier Waves.

## Evidence

- `SqliteTaskStore` is the structured Task state owner. It enables SQLite foreign keys and WAL and wraps command mutations in `BEGIN IMMEDIATE` / `COMMIT` with rollback on failure.
- `schema_migrations` is the migration authority. Each new migration and its version/name/checksum ledger row are committed in the same immediate transaction; existing rows are checked for name/checksum drift and legacy compatibility identity.
- `tasks`, `nodes`, `task_role_bindings`, `node_execution_history`, `task_documents`, `task_messages`, `task_events`, and `idempotency_records` remain the canonical structured persistence surfaces.
- `node_execution_history` preserves consumed `(node_id, run_no)` generations. Current reopen semantics preserve the old generation and advance an invalidated started downstream generation before rerun.
- Task document content is intentionally file-owned under `.proflow/tasks/.../documents`, while SQLite owns its durable metadata/hash. The recovery protocol is the bridge between those two media, not a second Task truth store.
- `putTaskDocument` writes `previous.md`, `next.md`, and `state.json` under the recovery journal before promotion; after success, version conflict, rollback, or a later owner read, recovery compares canonical content with durable SQLite metadata and either removes a settled attempt or restores the prior canonical content deterministically.
- `createTask` stages initial documents before its SQLite command, removes the stage on pre-commit failure, promotes after commit, and lets the first owner document read finish a post-commit promotion interruption.
- Runtime inspection of `/Users/agent/Desktop/proton-workspace/.proflow/recovery` found no state-bearing pending attempts, but did expose two empty Task-level `task-document` directories left after prior journals had already converged.

## Findings

1. No duplicate structured truth store was found. SQLite remains authoritative for Task metadata/state, events, idempotency and execution history; Markdown remains authoritative document content, coupled by hashes and explicit recovery.
2. Migration identity is durable and fail-closed. Schema change plus migration ledger write are transactional, and verification detects missing tables, metadata drift, checksum drift and schema drift.
3. Fail/reopen/retry history is generation-safe: previously consumed runs remain in `node_execution_history`, and reopened/invalidated started generations cannot reuse the old `(node_id, run_no)` identity.
4. Document recovery is crash-safe across the file/SQLite commit boundary, but cleanup stopped at the document-type recovery directory. Once the last type directory was removed, its empty Task-level parent remained as non-authoritative orphan residue.

## Changes Applied

- Added a canonical Task-level document-recovery root helper in `task-orchestration`.
- Recovery now prunes an empty Task-level recovery root both when a type root is already absent and after the last settled type root is removed.
- Added `RF-TASK-ORCH-06` behavior coverage proving a successful durable document write leaves no Task-level recovery directory.
- Added patch release ownership for `@tomflow/proflow-task-orchestration`.
- No SQLite schema, migration, Task lifecycle, reopen generation, idempotency, document hash, or recovery rollback semantics were changed.

## Verification

Wave 16 requires:

- the full `@tomflow/proflow-task-orchestration` package test suite;
- the full `@tomflow/proflow-task-store-sqlite` package test suite;
- the full `@tomflow/proflow-task-migration-runner` package test suite;
- typecheck for all three persistence-owner packages;
- pending release intent for `@tomflow/proflow-task-orchestration`;
- `git diff --check`.

The two legacy empty runtime Task recovery directories are safe to remove only while still empty. Their presence does not represent pending recovery state and does not alter the Wave 14 installed-runtime health result.

## Residual

Wave 16 does not publish or install the new Task Orchestration source. The installed runtime baseline remains the Wave 14 baseline until the later formal release/install adoption closure. Repository/runtime hygiene beyond state-bearing persistence correctness remains owned by the later Repository Hygiene Wave.
