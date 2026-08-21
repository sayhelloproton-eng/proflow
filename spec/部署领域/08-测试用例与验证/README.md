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

## Current deployment release freeze

- [`DEPLOYMENT-CLI-0.1.36-FREEZE-EVIDENCE.json`](DEPLOYMENT-CLI-0.1.36-FREEZE-EVIDENCE.json) records the published package versions, gates, Fresh Workspace acceptance and explicit non-claims for the frozen Deployment CLI release.
