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

Ensures and observes the real Google Chrome runtime required before Browser Extension setup. On macOS, missing Chrome is installed automatically from the official Stable DMG; an already installed Chrome is reused. Extension load/authorization remains owned by execution-browser-extension and its evidence is never faked.


## 2026-08-14 Carrier boundary

Chrome runtime is an external browser prerequisite, not a Task/Worker identity owner. Task-scoped `workerRef/c-id` and `conversationLocator` are observed by execution-browser-extension at runtime; tab/window ids remain transient. No frame registry/iframe team topology is part of v1 readiness.
