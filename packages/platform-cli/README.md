# @tomflow/proflow-platform-cli

Thin Workspace-level orchestration CLI for ProFlow package discovery, dependency ordering, command forwarding, result aggregation and package-manager operations.

## Standard CLI

The top-level management surface is exactly seven commands:

```bash
platform install
platform uninstall
platform status
platform setup
platform docs
platform start
platform stop
```

Removed Platform routes such as `modules`, `preflight`, `verify`, `doctor`, `restart`, `plan`, `apply`, `upgrade` and `manifest` are not routable. Module-specific commands remain owned by their Module and are not proxied by Platform.

All seven commands accept `--workspace <path>`; without it, the CLI uses `process.cwd()`.

## Ownership

```text
Module owns its behavior, private configuration and operational truth.
Platform owns discovery, dependency ordering, invocation, aggregation and package-manager orchestration.
Package manager owns npm dependency mutation.
```

Platform does not interpret Module-private configuration or recreate a cross-Module configuration bus.

## Install / Uninstall

`platform install` validates or creates the minimal Workspace metadata, discovers the complete governed package set from the Registry, synchronizes that set, validates the installed descriptors, then invokes `Module.install` in dependency order. It does not perform human setup work.

`platform uninstall` invokes `Module.uninstall` in reverse dependency order before package removal. `.proflow` is Workspace/user data and is preserved unless an owning Module explicitly removes its own artifacts.

## Status

`platform status` validates and aggregates only Module-owned observations:

```text
setupStatus: READY | ACTION_REQUIRED | FAILED
runtimeStatus: RUNNING | STOPPED | FAILED | NOT_APPLICABLE
```

There is no Platform-derived configuration status, missing-input list, overall readiness or verification state.

## Setup

`platform setup` scans all discovered Modules in dependency order. It skips `READY` Modules, invokes `Module.setup` for every non-ready Module, continues after `ACTION_REQUIRED` or `FAILED`, and returns one complete aggregate.

Targeted `platform setup --module <moduleRef> --input '<json>'` forwards opaque input to the owning Module. Platform neither interprets that input nor creates Module-specific instructions.

## Docs

`platform docs` invokes and aggregates `Module.docs`. `DOCS.md` and `SETUP.md` remain Module-owned knowledge.

## Start / Stop

`platform start` first completes the dependency-ordered `Module.status` setup gate. If any applicable Module has `setupStatus != READY`, no `Module.start` call is made. Once every Module is ready, starts run in dependency order and fail fast. A start failure does not trigger automatic rollback.

`platform stop` invokes `Module.stop` in reverse dependency order and fails fast.

## Boundary

The CLI remains a thin, generic orchestration layer. Adding a conforming Module must not require Module-specific Platform business logic.
