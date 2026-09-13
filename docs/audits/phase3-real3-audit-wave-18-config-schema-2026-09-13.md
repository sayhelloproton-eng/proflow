# Phase 3 Real-3 Audit｜Wave 18 Config & Schema

Date: 2026-09-13
Status: DONE. Product Action schema drift is corrected and verified; an independently stale public-surface machine artifact is classified as Wave 19 documentation-governance residual, not as a Wave 18 schema regression.

## Scope

Wave 18 aligns shipped Custom GPT OpenAPI, runtime owner schemas, TypeScript/runtime parsers, operation surfaces, and configuration contracts. Waves 01-17 were not rescanned.

## Evidence

The three shipped Role OpenAPI documents were compared with Platform Host role operation admission and the Task Orchestration public contracts. `scripts/surface-governance.mjs` remains the repository operationId surface gate. Agent Runtime validates basic OpenAPI shape and bearer authentication, while provisioning hydrates and publishes the Role package action schema as authored.

## Findings

- Product, Controller/Dev, and Test/Ops operationId sets are governed against the Platform Host authorization inventory; no stale operationId divergence was found in this Wave.
- Gateway removes untrusted role identity and normalizes file references, but it does not invent missing Task command fields. Platform Host forwards canonical Task inputs to the Task Orchestration owner contract.
- Task Orchestration requires `putTaskDocument.nodeId` to be present and nullable. Controller/Dev and Test/Ops already publish that shape.

## First divergence and fix

Product OpenAPI declared `nodeId` nullable but optional for `PutTaskDocumentInput`. A request valid under that public schema could therefore omit `nodeId`, while Gateway and Host forward the body unchanged and the Task owner rejects the missing required field.

Product OpenAPI now requires `nodeId` while preserving `string | null`. Product should send `nodeId: null` for Task-scoped Requirement content during PENDING before a node exists. Runtime ownership and PENDING semantics remain unchanged.

## Verification

- Product static regression PASS: `PutTaskDocumentInput.required` includes `nodeId`, and the published type remains `[string, null]`.
- Product typecheck PASS.
- Changeset status PASS: `.changeset/real3-audit-product-action-schema.md` is pending and plans `@tomflow/proflow-agent-product` `0.1.18 → 0.1.19`.
- Scoped Wave 18 `git diff --check` PASS.
- Repository `surface-governance` was executed and reported stale `spec/平台架构与公共约定/08-测试用例与验证/BATCH6-PUBLIC-SURFACE-RECONCILIATION.json`. The generator compares Product OpenAPI operationIds rather than request-field required/nullability, and Wave 18 did not change Product operationIds. Current dirty generator inputs are the Product OpenAPI plus pre-existing Browser `extension/background.ts`; the generated reconciliation JSON itself is not dirty. This failure is therefore independent of the Wave 18 schema fix.

## Residual

The stale public-surface machine artifact is carried into Wave 19, whose canonical scope explicitly owns machine-index versus Markdown drift. Wave 18 does not rewrite that generated artifact merely to make a non-causal repository-wide gate green.

No package publish, install, version application, deployment, or runtime restart is part of Wave 18.
