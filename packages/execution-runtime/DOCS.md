# @tomflow/proflow-execution-runtime — Module Docs

Module ref: `execution-runtime`  
Domain: `execution`  
Kind: `service`

Durable, policy-controlled Execution Core orchestration over SQLite and controlled executor ports.

## Standard management surface

`install / uninstall / status / setup / docs / start / stop`

## Provides

- `execution` `1.0.0`

## Requires

- `execution-local` `>=1.0.0 <2.0.0`

## Public setup inputs

- None. Deterministic/private values and cross-Module shared facts are not public configuration.

## Ownership boundary

Module business APIs and any module-specific extra commands remain package-owned. Platform does not proxy or interpret them. Current human/external preparation is documented in `SETUP.md`.
