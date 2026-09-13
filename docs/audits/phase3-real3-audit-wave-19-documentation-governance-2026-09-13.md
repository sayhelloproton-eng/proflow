# Phase 3 Real-3 Audit｜Wave 19 Documentation Governance

Date: 2026-09-13
Status: DONE

## Scope

Wave 19 owns documentation authority, CURRENT/handoff truth, status/TODO/provenance boundaries, duplicate local-automation rules, and machine-index/generated-artifact drift. Runtime/source behavior was not redesigned in this Wave.

## Evidence

- Current Local Engineering Skill is the sole Chat local-engineering protocol owner; Acceptance Skill owns shared browser/CLI/runtime acceptance mechanics.
- `03-自动化知识库` was checked for generic compatibility stubs and active backlinks.
- `CURRENT.md`, `IMPLEMENTATION-BASELINE.md`, `IMPLEMENTATION-EVIDENCE-INDEX.json`, machine indexes and the surface-governance generated artifacts were compared against current working-tree reality.
- `SPEC-MANIFEST.json` was a 2026-08-25 migration hash snapshot with 103/227 entries drifted; `SPEC-CONFORMANCE.json` still reported 178 Document Index entries and 37 Test Plan entries while current indexes contain 183 and 39.
- Canonical baseline completeness proof found zero current Markdown entries missing from `DOCUMENT-INDEX.json` or `TEST-PLAN-INDEX.json` under their current scope rules.

## Findings

1. Five generic automation compatibility files duplicated shared-Skill ownership and kept active project Runbooks coupled to obsolete project-local mechanics.
2. `Package-Update-Loop.md` retained one active backlink to the deleted Browser automation stub.
3. `IMPLEMENTATION-EVIDENCE-INDEX.json` exposed capture-time `ACTION_REQUIRED` fields without making their historical scope explicit, conflicting with CURRENT terminal Real-3 facts.
4. The tracked migration manifest/conformance pair had become a stale second truth and contradicted the documentation-governance rule that migration verification assets are not the long-term normative baseline.
5. Wave 18 surface-governance failure was non-causal to Product request-field schema: canonical generation on the current dirty tree changed only `BATCH6-PUBLIC-SURFACE-RECONCILIATION.json`; the UI reconciliation artifact stayed byte-identical.

## Changes Applied

- Deleted five generic local-automation compatibility stubs and redirected active ProFlow Runbooks/Flows to shared Engineering/Acceptance Skills.
- Repaired the remaining active Package Update backlink.
- Reframed implementation evidence statuses as `evidenceStatusAtCapture` / `criticalProofsAtCapture`; CURRENT/live Owner facts remain current-state authority.
- Removed stale tracked `SPEC-MANIFEST.json` and `SPEC-CONFORMANCE.json`; `IMPLEMENTATION-BASELINE.md` and key-truth navigation now describe machine indexes as derived navigation/evidence rather than a second business truth.
- Refreshed `BATCH6-PUBLIC-SURFACE-RECONCILIATION.json` from the repository's canonical generator output produced on a temporary mirror of the current dirty working tree; no direct `--write` mutation was performed in the real repository.
- Updated `CURRENT.md` to Wave 19 DONE / Wave 20 next.

## Verification

- shared-protocol no-stubs / active-backlink proof: PASS.
- current-truth scoped `git diff --check`: PASS.
- stale migration artifacts absent and no current consumer points to them: PASS.
- evidence capture-time semantics proof: PASS.
- canonical machine-index completeness: `DOCUMENT-INDEX=183`, `TEST-PLAN-INDEX=39`, missing current entries = 0.
- `surface-governance --check`: PASS after generated-artifact refresh.
- final Wave 19 scoped `git diff --check`: required before closure and owned by this frozen decision.

## Residual

- Historical/provenance directories, one-off artifacts, dead files, empty directories, stale fixtures and other physical repository hygiene are intentionally carried into Wave 20; they do not regain current authority.
- No package publish, install, version application, deployment, runtime restart, Git stage or commit is part of Wave 19.
