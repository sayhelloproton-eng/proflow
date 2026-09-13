# Phase 3 Real-3 Audit｜Wave 20 Repository Hygiene

Date: 2026-09-13
Status: DONE

## Scope

Wave 20 cleans repository-only residue: one-off debug/temp scripts, stale fixtures/artifacts/bundles, mistakenly tracked runtime/generated files, invalid TODO/FIXME, dead files, empty directories and accidental duplicate config/content. It does not redesign architecture or reinterpret historical evidence as current product state.

## Evidence

- Repository HEAD at acquisition: `d7043fc377e8f605cb0828b8698a0e579ed4c763`, branch `main`.
- Existing audit WIP is intentionally dirty and was preserved; no reset/clean/stage is authorized.
- No tracked debug/tmp/log/build/dist/coverage residue was found by name. The three tracked `custom-gpt-knowledge.zip` files are Agent package product assets, not temp bundles.
- The migration fixture `packages/task-migration-runner/tests/fixtures/task-schema-20260810.sql` has a real consumer in `packages/task-migration-runner/tests/migration-critical-proofs.test.ts`; it is retained.
- Package `tsconfig.json`, conformance files and several deployment adapters are exact duplicates by design and are retained.
- A final source-marker scan found no actual source comment beginning with `TODO`, `FIXME` or `HACK`; enum/state literals and normative TODO documents are not hygiene defects.
- Empty `.proflow` artifact directories and `.throughput-fixture` are runtime/local directories, not tracked repository files; Wave 20 does not mutate unrelated runtime state merely to make the filesystem visually empty.

## Changes Applied

### 1. Migration provenance residue

Deleted the four tracked migration provenance artifacts after repository-wide search proved there was no current consumer outside the provenance material itself:

- `spec/provenance/MIGRATION-REPORT.md`
- `spec/provenance/SOURCE-DOCUMENT-CONFORMANCE.json`
- `spec/provenance/SOURCE-PROVENANCE.json`
- `spec/provenance/SOURCE-RELEASE-MANIFEST.json`

Current documentation governance already excludes migration provenance from current specification authority, so retaining those files would only preserve a second historical surface inside the live spec package.

### 2. Product OpenAPI duplicate truth

`packages/agent-product/actions/custom-gpt.openapi.yaml` is the formal package asset because:

- `package.json` publishes `actions/` and does not publish a root OpenAPI file;
- `proflowAgent.carrierProfiles.custom-gpt.actionSchema` points to `actions/custom-gpt.openapi.yaml`;
- Product static tests and the surface-governance generator use the `actions/` owner.

Deleted duplicate `packages/agent-product/custom-gpt.openapi.yaml`. The two cross-package tests that still read the root duplicate were changed to read the formal `actions/` asset. Gateway action-surface, Agent Runtime journey-alignment and Product static targeted tests all passed after the change.

### 3. Module Contract source-directory compiled residue

Deleted:

- `packages/module-contract/src/index.js`
- `packages/module-contract/src/workspace.js`

They were the only tracked `src/*.js` files with same-path `.ts` owners. `packages/module-contract/tsconfig.json` includes only `.ts`, package exports publish `dist`, current `.ts` source imports `.ts`, and repository-wide reverse reference checks found no consumer of either source-directory `.js` file.

## Harness / Recovery Evidence

The first provenance cleanup attempt used a DELETE-only frozen envelope and failed closed before apply because the shared materializer did not create an empty `changed-files/` directory before tar creation. No repository mutation occurred in that failed attempt. The normal Wave 20 audit record was then included as a CREATE in the repaired Decision and the cleanup completed through the standard whole-file runner. This is recorded as shared runner evidence; the shared Skill is not modified inside the ProFlow audit.

A later read-only hygiene scan initially miscounted Chinese tracked paths because `git ls-files` default quoting was treated as literal filenames. Re-running with `git ls-files -z` proved the apparent mass deletion was a harness artifact, not repository loss. The only unrelated existing tracked deletion identified was `docs/audits/operation-chain-observability-2026-09-12.md`; Wave 20 deliberately preserved that pre-existing WIP boundary.

## Verification

- Provenance deletion / no-current-reference proofs: PASS.
- Product duplicate OpenAPI removal and formal-owner proofs: PASS.
- Gateway Action surface targeted test: PASS.
- Agent Runtime journey-alignment targeted test: PASS.
- Product static targeted test: PASS.
- `module-contract` test and typecheck: required final closure gates.
- Final mechanical hygiene proof requires: no tracked `src/*.js` + same-path `.ts` pairs, no root-level Agent OpenAPI mirror, no restored provenance migration artifacts, fixture still referenced, and scoped `git diff --check` PASS.

## Residual

No additional repository-hygiene mutation is required by Wave 20 after the final gates pass. Runtime/local empty directories and unrelated pre-existing WIP remain outside this Wave by design. No commit, stage, reset, clean, publish, install, deploy or runtime restart is part of Wave 20.
