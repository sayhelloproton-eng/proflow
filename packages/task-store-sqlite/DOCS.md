# @tomflow/proflow-task-store-sqlite — Module Docs

Module ref: `task-store-sqlite`  
Domain: `task-orchestration`  
Kind: `library`

Provides the node:sqlite store and repository adapters for Task-owned structured facts.

## Standard management surface

`install / uninstall / status / setup / docs / start / stop`

## Provides

- None.

## Requires

- `task-orchestration` `>=1.0.0 <2.0.0`

## Public setup inputs

- None. Deterministic/private values and cross-Module shared facts are not public configuration.

## Ownership boundary

Module business APIs and any module-specific extra commands remain package-owned. Platform does not proxy or interpret them. Current human/external preparation is documented in `SETUP.md`.
