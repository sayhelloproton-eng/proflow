# @tomflow/proflow-platform-host — Module Docs

Module ref: `platform-host`  
Domain: `platform-architecture`  
Kind: `service`

Provides the ProFlow local application composition root that binds Task, Agent, Execution and Model owner transports.

## Standard management surface

`install / uninstall / status / setup / docs / start / stop`

## Provides

- `platform-host` `1.0.0`

## Requires

- `task-orchestration` `>=1.0.0 <2.0.0`
- `agent-runtime` `>=1.0.0 <2.0.0`
- `execution` `>=1.0.0 <2.0.0`
- `model-inference` `>=1.0.0 <2.0.0`

## Public setup inputs

- None. Deterministic/private values and cross-Module shared facts are not public configuration.

## Ownership boundary

Module business APIs and any module-specific extra commands remain package-owned. Platform does not proxy or interpret them. Current human/external preparation is documented in `SETUP.md`.
