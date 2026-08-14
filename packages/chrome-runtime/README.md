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


## 2026-08-14 Carrier boundary

Chrome runtime is an external browser prerequisite, not a Task/Worker identity owner. Task-scoped `workerRef/c-id` and `conversationLocator` are observed by execution-browser-extension at runtime; tab/window ids remain transient. No frame registry/iframe team topology is part of v1 readiness.
