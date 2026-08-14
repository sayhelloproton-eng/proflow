# chatgpt-carrier

Domain Owner: deployment-governance
Module Kind: external-resource
Service: none
Process: none
Business Fact Owner: none

## Owner

Deployment Governance

## Consumers

- agent-product
- agent-controller-dev
- agent-test-ops
- execution-browser-extension

## Does NOT own

- Agent roles, role-specific Instructions / future Knowledge specialization / OpenAPI, or role registration
- Custom GPT materialization (Web-only, human-driven)

## Purpose

Governs the real-world ChatGPT Custom GPT carrier: reachability and the
per-check evidence required before any consumer may treat the carrier as
verified. Verification is honest — reachability alone never implies
schema / auth / File Bridge correctness.


## 2026-08-14 v1 readiness alignment

Carrier readiness is behavior/capability based: role-scoped Action auth, static OpenAPI, required File Bridge/Code Interpreter/Web Search and Web-only GPT setup. Exact ChatGPT model id is advisory only. Routine Actions target `x-openai-isConsequential:false` + user Always Allow; unexpected permission remains a recovery condition. Stable Conversation c-id is not supplied by Actions and is observed later by the Chrome/Browser Carrier during Task Worker creation.
