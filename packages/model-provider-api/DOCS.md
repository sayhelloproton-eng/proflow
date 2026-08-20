# @tomflow/proflow-model-provider-api — Module Docs

Module ref: `model-provider-api`  
Domain: `deployment-governance`  
Kind: `external-resource`

Governs and probes the configured OpenAI-compatible model provider API as an external resource.

## Standard management surface

`install / uninstall / status / setup / docs / start / stop`

## Provides

- `model.provider.api` `1.0.0`

## Requires

- None.

## Public setup inputs

- `providerBaseUrl` — OpenAI-compatible provider API base URL
- `providerCredential` — Optional credential reference; absent for unauthenticated providers

## Ownership boundary

Module business APIs and any module-specific extra commands remain package-owned. Platform does not proxy or interpret them. Current human/external preparation is documented in `SETUP.md`.
