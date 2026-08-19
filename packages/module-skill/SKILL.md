# ProFlow Module Skill

Use this Skill only to create or maintain a governed ProFlow Module package from already-frozen owner facts.

## Responsibility model

```text
Module / package owns logic and truth.
Platform CLI owns discovery, dispatch, aggregation and ordering.
Package manager owns npm dependency operations.
```

## Required workflow

1. Read the owning Domain's frozen contract and package facts.
2. Use `@tomflow/proflow-module-template` instead of copying an old package by hand.
3. Populate real Module identity, kind, `provides/requires`, config slots, documentation and only the lifecycle/status capabilities the Module truly owns.
4. For config-bearing Modules, provide configuration guidance covering source, format, sensitivity, materialization and basic completion checks.
5. Run `@tomflow/proflow-deployment-conformance` and fix only governance-surface failures.

## Do not invent

Do not invent capability, dependency, permission, owner, domain, lifecycle, service/process, config semantics or external-resource behavior.

Do not create or preserve `installClass` or `installRequires`.

Do not generate package-owned `platform install <self>` wrappers. Platform installation is Workspace/instance-level only.

Do not teach or expose removed top-level Platform commands: `search`, `plan`, `apply`, `upgrade`, `preflight`, `restart`, `status`, `verify`, `doctor`, `manifest`.

## Platform boundary

Platform may discover packages, aggregate docs/status, dispatch Module validate/start/stop and order runtime dependencies. It must not become the second owner of Module config, health, runtime or repair logic.

If satisfying the governance contract requires redesigning the owning business Domain, stop and report `DOMAIN_BLOCKER` rather than expanding scope.
