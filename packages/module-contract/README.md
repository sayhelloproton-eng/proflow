# @tomflow/proflow-module-contract

Runtime schemas shared by ProFlow Module packages, Module Template, deployment conformance and Platform CLI.

## Standard management contract

Every governed Module adapter exposes exactly seven standard capabilities:

```text
install / uninstall / status / setup / docs / start / stop
```

Additional Module-specific commands may exist, but they are not part of the Platform standard proxy surface.

## Status observation

```text
setupStatus: READY | ACTION_REQUIRED | FAILED
runtimeStatus: RUNNING | STOPPED | FAILED | NOT_APPLICABLE
```

The Module owns these facts. Platform validates and aggregates the shape only; it does not derive readiness or invent an unknown runtime state.

## Operation result

Module operation results use `SUCCEEDED`, `ACTION_REQUIRED` or `FAILED`. `ACTION_REQUIRED` is reserved for real human or external participation and includes an executable action description. Machine-owned failures return `FAILED` with a typed error.

`BLOCKED` is a Platform orchestration/aggregation outcome, not a Module operation result status.

## Configuration boundary

Public `ConfigSlot` entries describe only values that genuinely require user or external-world input. Deterministic Workspace paths, fixed loopback values, Module-owned artifact paths, secret material and facts provided by another Module must not be turned into user configuration.

## Dependency and documentation boundary

`provides/requires` describe runtime topology, Contract discovery and ordering; package managers own package dependency resolution and mutation. Cross-Module data travels through Producer-owned public Contracts/shared facts rather than Platform-owned configuration.

`DOCS.md` and `SETUP.md` are the standard Module-owned knowledge files. The adapter `docs` and `setup` capabilities expose the current knowledge and executable setup guidance.
