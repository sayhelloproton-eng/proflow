# ProFlow Module Skill

Use this Skill only to create or maintain a governed ProFlow Module package from already-frozen owner facts.

## Responsibility model

```text
Module / package owns logic and truth.
Platform CLI owns discovery, dispatch, aggregation and ordering.
Package manager owns npm dependency operations.
```

## Source Order

1. Read the owning Domain's Frozen Contract and accepted product decisions.
2. Read the current package facts and Module Descriptor; never infer missing facts from neighboring packages.
3. Use `@tomflow/proflow-module-template` for governed package structure.
4. Use `@tomflow/proflow-deployment-conformance` as the mechanical governance gate.

## Required Frozen Owner Facts

Before create or modify, confirm `moduleRef`, `packageName`, `moduleVersion`, `kind`, `domain` and `summary` from owner truth.

Owner-controlled content includes `provides`, `requires`, `requirements`, config slots, lifecycle, verification, effects and documentation. commands / APIs / permissions may be represented only when explicitly frozen by the owning Domain.

Do not create or preserve `installClass` or `installRequires`.

## Create Flow

1. Materialize the correct Module profile from the template.
2. Populate only frozen owner facts and package-owned status/config/lifecycle behavior.
3. For config-bearing Modules, document source, format, sensitivity, materialization and basic completion checks.
4. Run conformance and fix only governance-surface failures.

## Modify Flow

1. Read current owner truth before editing generated or governed files.
2. Preserve valid package-owned behavior; change only facts explicitly changed by the owner.
3. Re-run conformance after modification. Never repair a governance failure by inventing Domain behavior.

## Forbidden

Do not invent capability, dependency, permission, owner, domain, lifecycle, service/process, config semantics or external-resource behavior.

Do not generate package-owned `platform install <self>` wrappers. Platform installation is Workspace/instance-level only.

Do not teach or expose removed top-level Platform commands: `search`, `plan`, `apply`, `upgrade`, `preflight`, `restart`, `status`, `verify`, `doctor`, `manifest`.

## Stop Rules

When required truth is absent or contradictory, STOP instead of guessing. Use the applicable explicit condition:

- `PENDING_DECISION`: an owner/product decision is unresolved.
- `NOT_FROZEN`: a dependency, permission, capability or other required owner fact is not frozen.
- `ACCEPTANCE_NOT_FROZEN`: acceptance criteria are not frozen enough to implement safely.
- `SPEC_GAP`: the frozen contract and required conformance cannot both be satisfied without a specification correction.
- `PENDING_SPIKE`: an empirical fact must be established before implementation.
- `STOP`: proceeding would invent facts or cross the owning Domain boundary.

A missing dependency, permission or conformance prerequisite is never permission to guess. If satisfying governance requires redesigning the owning business Domain, stop and report `DOMAIN_BLOCKER`.

## Deployment Use

The user-facing Platform CLI remains only `modules`, `docs`, `install`, `uninstall`, `start`, and `stop`.

Platform may discover packages, aggregate docs/status, dispatch Module validate/start/stop and order runtime dependencies. `platform start` may run Module preflight internally; internal Deployment primitives are not user commands.

Use `platform modules` to observe current Module facts and `platform docs` for package-owned setup guidance. Package installation/version synchronization remains whole-instance `platform install`; npm dependency mutation belongs to the package manager.
