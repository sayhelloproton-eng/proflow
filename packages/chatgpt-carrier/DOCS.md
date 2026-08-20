# @tomflow/proflow-chatgpt-carrier — Module Docs

Module ref: `chatgpt-carrier`  
Domain: `deployment-governance`  
Kind: `external-resource`

Governs and verifies the real-world ChatGPT Custom GPT carrier without faking readiness.

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
