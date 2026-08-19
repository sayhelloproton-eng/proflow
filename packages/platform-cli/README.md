# @tomflow/proflow-platform-cli

Deterministic Workspace-level CLI for ProFlow Platform installation, discovery, knowledge aggregation and lifecycle dispatch.

## Frozen CLI

```bash
platform modules
platform docs
platform install
platform uninstall
platform start
platform stop
```

Removed top-level commands: `search`, `plan`, `apply`, `upgrade`, `preflight`, `restart`, `status`, `verify`, `doctor`, `manifest`.

## Ownership

```text
Module / package owns logic and truth.
Platform CLI owns discovery, dispatch, aggregation and ordering.
Package manager owns npm dependency operations.
```

## Workspace

`platform install [--workspace <path>]` resolves the explicit workspace or `process.cwd()`. The other five commands operate on `process.cwd()` and do not depend on a global current-workspace binding.

`.proflow` is Workspace/user data and may survive uninstall/reinstall. `platform uninstall` removes ProFlow package dependencies only and never deletes `.proflow`.

## Install

Install dynamically discovers the complete managed ProFlow package/version set from the private npm scope, synchronizes it in one package-manager transaction where possible, re-observes installed packages, validates descriptors, then initializes/reuses minimal Workspace-local metadata.

There is no Core package class, `installRequires`, install closure, Plan/Apply or independent Upgrade flow.

## Modules

`platform modules` aggregates Module-owned status observations only:

```text
moduleRef
version
configStatus: READY | INCOMPLETE | INVALID
missingConfig?  # only when INCOMPLETE
runtimeStatus: RUNNING | STOPPED | FAILED | UNKNOWN
```

Platform does not infer private health/config/runtime facts.

## Docs

`platform docs` aggregates each installed Module's `provides`, `requires`, `configSlots` and static documentation. It accepts no module/document positional argument.

## Start / Stop

Start builds Runtime dependency order from `provides/requires`, dispatches all applicable Module validate/preflight first (fail-fast), then starts in dependency order (fail-fast). It does not rollback already-started Modules.

Stop dispatches Module stop in reverse dependency order and fails fast.

## Boundary

The CLI must remain thin: new compliant Modules should become discoverable/observable/startable without adding module-specific business logic here.
