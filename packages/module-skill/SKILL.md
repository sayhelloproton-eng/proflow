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

Owner-controlled content includes `provides`, `requires`, `requirements`, genuine public/user setup config slots, effects, DOCS/SETUP content and module-specific business commands. The seven standard management capabilities are fixed by the platform contract and are not optional owner choices.

Do not create or preserve `installClass` or `installRequires`.

## Create Flow

1. Materialize the correct Module profile from the template.
2. Populate only frozen owner facts and the Module-owned seven-command management seam.
3. Deterministic/private values belong to `Module.install`; cross-Module facts come from producer contracts/shared facts; only genuine user choice or external reality belongs to `Module.setup`.
4. Publish exactly `DOCS.md` and `SETUP.md` as the standard knowledge surface, then run conformance and fix only governance-surface failures.

## Modify Flow

1. Read current owner truth before editing generated or governed files.
2. Preserve valid package-owned behavior; change only facts explicitly changed by the owner.
3. Re-run conformance after modification. Never repair a governance failure by inventing Domain behavior.

## Forbidden

Do not invent capability, dependency, permission, owner, domain, service/process, config semantics, setup steps or external-resource behavior.

Do not generate package-owned `platform install <self>` wrappers. Platform installation is Workspace/instance-level only.

Do not teach or expose removed top-level Platform commands: `modules`, `search`, `plan`, `apply`, `upgrade`, `preflight`, `restart`, `verify`, `doctor`, `manifest`. `platform status` is a valid frozen command and only aggregates `Module.status`.

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

The user-facing Platform CLI is exactly: `install`, `uninstall`, `status`, `setup`, `docs`, `start`, `stop`.

Every governed Module exposes the same seven standard management capabilities. Platform only discovers Modules, orders dependencies, forwards these capabilities and aggregates results. It must not read/interpret Module-private config or recreate `preflight`/`verify`/`doctor` as a second truth source.

Use `platform status` to aggregate Module-owned status, `platform setup` to forward current human/external setup actions, and `platform docs` to aggregate Module-owned knowledge. `platform start` gates only on current `Module.status.setupStatus`, then calls `Module.start` in dependency order. Package installation/version synchronization remains `platform install`; npm dependency mutation belongs to the package manager, while capability materialization belongs to `Module.install`.
