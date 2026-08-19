# @tomflow/proflow-module-contract

Runtime schemas shared by ProFlow Module packages, Template, Conformance and Platform CLI.

## Current contract

The active governance contract contains Module identity/version/kind, lightweight package discovery metadata, Runtime `provides/requires`, config slots, documentation, lifecycle declarations/results and Module-owned status observation.

Package-install classification is not part of the contract: `installClass` and `installRequires` are removed.

## Status observation

```text
configStatus = READY | INCOMPLETE | INVALID
missingConfig? = required keys, only when INCOMPLETE
runtimeStatus = RUNNING | STOPPED | FAILED | UNKNOWN
```

The Module produces these facts; Platform validates/aggregates the shape only.

## Dependency boundary

`provides/requires` describe Runtime Module topology. npm/pnpm/yarn own package dependency resolution and mutation.

## Lifecycle boundary

Modules expose only real capabilities. Libraries do not fabricate service lifecycle; running Modules own their own validation/status/start/stop behavior.
