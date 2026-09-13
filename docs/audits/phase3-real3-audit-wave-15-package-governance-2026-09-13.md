# Phase 3 / Real-3 Audit — Wave 15 Package / Dependency Governance

Date: 2026-09-13

## Scope

Wave 15 closes package release ownership for semantic source changes already accepted by Waves 08–13. It does not redesign those changes and does not publish, install, restart, or otherwise adopt new package builds into the running platform.

## Source state versus installed runtime baseline

Wave 14 proved the currently installed runtime baseline healthy: Extension 0.1.62, Host 0.1.29, Gateway 0.1.18, Execution Runtime 0.1.19, Tunnel 0.1.36, and Dev/Test 0.1.21, with platform status 3/3 and PLATFORM_READY=YES.

That installed-runtime PASS is intentionally distinct from adoption of the current audit source. Waves 10–13 introduced newer semantic source changes that are not yet represented by a formal pending release intent. Runtime adoption remains a later release/install closure concern.

## First divergence

Before this Wave, `pnpm change status` reported `No pending changes.` Existing `.changeset/*.md` entries had already been consumed by the release ledger. They remain historical provenance only and cannot own the current audit source changes.

Therefore the release planner would otherwise omit real runtime semantic changes from this audit.

## Runtime semantic release owners

The following packages require patch release intent:

- `@tomflow/proflow-task-orchestration` — Task-scoped Worker identity invariants and reopen generation semantics.
- `@tomflow/proflow-platform-host` — ambiguous Task/Worker Permission identity fail-closed behavior and application-boundary observability semantics.
- `@tomflow/proflow-agent-gateway` — safe typed downstream error preservation and Gateway observability boundary semantics.
- `@tomflow/proflow-execution-browser-extension` — Permission/page-reality correlation, recurring recovery/testability, Permission action dispatch testability, and Browser observability semantics.

## Packages intentionally not bumped

`agent-controller-dev`, `agent-test-ops`, and `platform-cli` changed only through tests or governance proof in the audited scope. They do not receive standalone package bumps from Wave 15.

## Governance decision

Wave 15 adds release ownership only. It does not run `pnpm version`, publish, `npm publish`, install packages, run platform setup, or restart the platform.

The current Wave 14 installed baseline therefore remains valid and unchanged. Adoption of the current audit source is deferred to the formal release/install closure.

## Verification contract

The same frozen Engineering Decision must prove all of the following after applying these changesets:

1. `pnpm change status` exposes patch intent for all four runtime semantic owner packages.
2. `pnpm package:release --plan` includes all four packages in the formal release graph.
3. `git diff --check` passes.

Wave 15 is DONE only when that release-ownership verification passes. No publish or install side effect is part of this Wave.
