---
docId: TP-MODULE-PLATFORM-CLI
title: platform-cli｜开发前 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
boundedContext: deployment-governance
moduleRef: platform-cli
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
- DEPLOYMENT-DOC-05-02
- DEPLOYMENT-DOC-05-03
- DEPLOYMENT-DOC-03-04
implementationWave: Wave 6
---

# platform-cli 测试计划

## Frozen surface

Exactly six top-level commands:

```text
modules docs install uninstall start stop
```

Removed commands must be unroutable; frozen commands accept no positional module/package target. `install` may accept only `--workspace`.

## Targeted tests

### modules

Aggregate Module-owned `moduleRef/version/configStatus/missingConfig?/runtimeStatus`; Platform does not derive private health/config/runtime truth.

### docs

Aggregate all installed Module `provides/requires/configSlots/documents` in one call; no positional filtering command.

### install / uninstall

Install performs full private-scope ProFlow package/version synchronization and descriptor re-observation without Plan/Apply/Core/installRequires. Uninstall removes ProFlow dependencies only and preserves `.proflow`.

### lifecycle

Start dispatches all applicable validate/preflight before any start, fail-fast; then starts dependency-order, fail-fast, no rollback. Stop dispatches reverse-order and fail-fast.

### composition

Service packages use package-owned production bindings; Platform service-process wrapper caller count = 0. Workspace target does not depend on global binding lifecycle state.

## Simulated human integration

```text
Fresh Workspace
→ install
→ modules
→ docs
→ configure via Module docs
→ start
→ modules
→ stop
→ uninstall
```

Final assertion: `.proflow` remains and no hidden old-engine command/path is required.
