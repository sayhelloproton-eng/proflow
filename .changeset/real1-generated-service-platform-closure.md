---
"@tomflow/proflow-agent-controller-dev": patch
"@tomflow/proflow-agent-gateway": patch
"@tomflow/proflow-agent-product": patch
"@tomflow/proflow-agent-runtime": patch
"@tomflow/proflow-agent-test-ops": patch
"@tomflow/proflow-chatgpt-carrier": patch
"@tomflow/proflow-chrome-runtime": patch
"@tomflow/proflow-deployment-conformance": patch
"@tomflow/proflow-dev-tunnel": patch
"@tomflow/proflow-execution-browser-extension": patch
"@tomflow/proflow-execution-contracts": patch
"@tomflow/proflow-execution-local": patch
"@tomflow/proflow-execution-runtime": patch
"@tomflow/proflow-model-contracts": patch
"@tomflow/proflow-model-provider-api": patch
"@tomflow/proflow-model-runtime": patch
"@tomflow/proflow-module-contract": patch
"@tomflow/proflow-module-skill": patch
"@tomflow/proflow-module-template": patch
"@tomflow/proflow-platform-cli": patch
"@tomflow/proflow-platform-host": patch
"@tomflow/proflow-task-migration-runner": patch
"@tomflow/proflow-task-orchestration": patch
"@tomflow/proflow-task-store-sqlite": patch
---

Close the Real-1 global Platform control-plane contract across every published ProFlow package. Platform CLI now owns one durable global Workspace binding with canonical identity, cross-process operation locking, cwd/`--workspace` install targeting, cross-directory instance commands, whole-instance uninstall/rebind, and deterministic npm/yarn/pnpm Workspace package-manager selection. Every package-owned install entry, including newly generated Module Template packages, delegates to the Shell-global `platform` command and fails closed when that global CLI is unavailable; Deployment Conformance and the formal test plans mechanically enforce the same rule across all 24 packages.
