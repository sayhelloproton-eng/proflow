# @tomflow/proflow-execution-browser-extension — Module Docs

Module ref: `execution-browser-extension`  
Domain: `execution`  
Kind: `browser-extension`

Execution-owned MV3 Browser executor, evidence provider and browser application surface.

## Standard management surface

`install / uninstall / status / setup / docs / start / stop`

## Provides

- `execution-browser-executor` `1.0.0`

## Requires

- `execution` `>=1.0.0 <2.0.0`
- `task-orchestration` `>=1.0.0 <2.0.0`
- `agent-runtime` `>=1.0.0 <2.0.0`

## Public setup inputs

- None. Deterministic/private values and cross-Module shared facts are not public configuration.

## Ownership boundary

Module business APIs and any module-specific extra commands remain package-owned. Platform does not proxy or interpret them. Current human/external preparation is documented in `SETUP.md`.
