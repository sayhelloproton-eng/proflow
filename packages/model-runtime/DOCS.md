# @tomflow/proflow-model-runtime — Module Docs

Module ref: `model-runtime`  
Domain: `model-reasoning`  
Kind: `service`

Provides the ProFlow Model Runtime service with FAST/REASON routing, provider capability checks and inference observability.

## Standard management surface

`install / uninstall / status / setup / docs / start / stop`

## Provides

- `model-inference` `1.0.0`

## Requires

- `model.provider.api` `>=1.0.0 <2.0.0`

## Public setup inputs

- `fastModel` — Provider model identifier for FAST
- `reasonModel` — Provider model identifier for REASON

## Ownership boundary

Module business APIs and any module-specific extra commands remain package-owned. Platform does not proxy or interpret them. Current human/external preparation is documented in `SETUP.md`.
