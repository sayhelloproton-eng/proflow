# @tomflow/proflow-agent-runtime — Module Docs

Module ref: `agent-runtime`  
Domain: `agent-runtime-collaboration`  
Kind: `library`

Agent-owned Role Registry, credential binding and Collaboration durable runtime.

## Standard management surface

`install / uninstall / status / setup / docs / start / stop`

## Provides

- `agent-runtime` `1.0.0`

## Requires

- `task-orchestration` `>=1.0.0 <2.0.0`
- `execution` `>=1.0.0 <2.0.0`

## Public setup inputs

- None. Deterministic/private values and cross-Module shared facts are not public configuration.

## Ownership boundary

Module business APIs and any module-specific extra commands remain package-owned. Platform does not proxy or interpret them. Current human/external preparation is documented in `SETUP.md`.
