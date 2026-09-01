# 部署领域｜测试用例与验证

## Current truth

Executable test inventory must follow the frozen seven-command Platform CLI and current Module Governance contract.

R4 rules:

- tests encoding deleted Plan/Apply/Upgrade/Verify/Doctor/Manifest behavior are deleted or rewritten;
- tests do not force production code to preserve removed product concepts;
- generated inventories are regenerated through existing governance tooling after test migration, not hand-edited as product truth;
- business-domain tests change only when a mechanical descriptor/adapter contract assertion requires it.

Primary current tests cover Contract/Template/Skill/Conformance, seven Platform commands and the simulated human Golden Path.

The current machine-generated inventory is indexed from `spec/IMPLEMENTATION-EVIDENCE-INDEX.json`. `当前全量测试用例目录-20260815.md` remains a dated historical snapshot and must not override current executable evidence.

## Current Deployment Final Freeze

- [`DEPLOYMENT-FINAL-FREEZE-20260901.json`](DEPLOYMENT-FINAL-FREEZE-20260901.json) is the current Final Freeze evidence: real Registry latest versions, true Fresh Product Workspace, final public lifecycle/recovery and user verdict.
- [`DEPLOYMENT-CLI-0.1.36-FREEZE-EVIDENCE.json`](DEPLOYMENT-CLI-0.1.36-FREEZE-EVIDENCE.json) is a historical 2026-08-21 release freeze and must not override the current Deployment Final Freeze.
