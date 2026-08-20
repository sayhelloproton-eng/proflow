# @tomflow/proflow-agent-gateway — Module Docs

Module ref: `agent-gateway`  
Domain: `agent-runtime-collaboration`  
Kind: `service`

The sole Custom GPT Actions HTTP ingress and OpenAI transport anti-corruption layer.

## Standard management surface

`install / uninstall / status / setup / docs / start / stop`

## Provides

- `custom-gpt-actions-gateway` `1.0.0`

## Requires

- `agent-runtime` `>=1.0.0 <2.0.0`
- `task-orchestration` `>=1.0.0 <2.0.0`
- `execution` `>=1.0.0 <2.0.0`

## Public setup inputs

- None. Deterministic/private values and cross-Module shared facts are not public configuration.

## Ownership boundary

Module business APIs and any module-specific extra commands remain package-owned. Platform does not proxy or interpret them. Current human/external preparation is documented in `SETUP.md`.
