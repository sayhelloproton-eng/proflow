# chrome-runtime

Domain Owner: deployment-governance
Module Kind: external-resource
Service: none
Process: none
Business Fact Owner: none

## Owner

Deployment Governance

## Consumers

- execution-browser-extension

## Does NOT own

- Execution Browser Extension build / install / load / authorize
- Execution semantics

## Purpose

Observes the real Chrome runtime (version, platform detection) and the MV3
extension load prerequisite. Extension load/authorization evidence is never
faked.
