---
"@tomflow/proflow-agent-controller-dev": patch
"@tomflow/proflow-agent-gateway": patch
"@tomflow/proflow-agent-product": patch
"@tomflow/proflow-agent-test-ops": patch
"@tomflow/proflow-deployment-conformance": patch
"@tomflow/proflow-execution-browser-extension": patch
"@tomflow/proflow-execution-contracts": patch
"@tomflow/proflow-execution-local": patch
"@tomflow/proflow-model-contracts": patch
"@tomflow/proflow-model-runtime": patch
"@tomflow/proflow-module-template": patch
"@tomflow/proflow-platform-host": patch
---

Close Real-1 deployment graph and Fresh Workspace bootstrap gaps: remove Contract-library runtime-provider aliases, correct Execution/Model dependency direction, materialize logical/moduleRef providers through `installRequires`, enforce repository graph validation, and keep self-install executables stable without package-manager worktree mutation.
