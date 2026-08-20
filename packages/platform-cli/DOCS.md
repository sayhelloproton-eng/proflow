# @tomflow/proflow-platform-cli — Module Docs

Module ref: `platform-cli`  
Domain: `deployment-governance`  
Kind: `cli`

Thin Platform CLI for Module discovery, documentation, package synchronization and lifecycle orchestration.

## Standard management surface

`install / uninstall / status / setup / docs / start / stop`

## Provides

- None.

## Requires

- None.

## Public setup inputs

- None. Deterministic/private values and cross-Module shared facts are not public configuration.

## Ownership boundary

Module business APIs and any module-specific extra commands remain package-owned. Platform does not proxy or interpret them. Current human/external preparation is documented in `SETUP.md`.
