# @tomflow/proflow-execution-local — Module Docs

Module ref: `execution-local`  
Domain: `execution`  
Kind: `library`

In-process real local executor for typed ProFlow Execution capabilities.

## Standard management surface

`install / uninstall / status / setup / docs / start / stop`

## Provides

- `execution-local` `1.0.0`

## Requires

- None.

## Public setup inputs

- None. Deterministic/private values and cross-Module shared facts are not public configuration.

## Ownership boundary

Module business APIs and any module-specific extra commands remain package-owned. Platform does not proxy or interpret them. Current human/external preparation is documented in `SETUP.md`.
