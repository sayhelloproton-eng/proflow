# @tomflow/proflow-chrome-runtime — Module Docs

Module ref: `chrome-runtime`  
Domain: `deployment-governance`  
Kind: `external-resource`

Observes the real Chrome runtime and MV3 extension load prerequisite.

## Standard management surface

`install / uninstall / status / setup / docs / start / stop`

## Provides

- None.

## Requires

- None.

## Public setup inputs

- `chromeExecutablePath` — Absolute path to the Chrome/Chromium executable; when unset, probes macOS candidates then PATH commands

## Ownership boundary

Module business APIs and any module-specific extra commands remain package-owned. Platform does not proxy or interpret them. Current human/external preparation is documented in `SETUP.md`.
