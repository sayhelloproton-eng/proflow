# 部署领域｜测试用例与验证

## Current truth

Executable test inventory must follow the frozen six-command Platform CLI and current Module Governance contract.

R4 rules:

- tests encoding deleted Plan/Apply/Upgrade/Verify/Doctor/Manifest behavior are deleted or rewritten;
- tests do not force production code to preserve removed product concepts;
- generated inventories are regenerated through existing governance tooling after test migration, not hand-edited as product truth;
- business-domain tests change only when a mechanical descriptor/adapter contract assertion requires it.

Primary current tests cover Contract/Template/Skill/Conformance, six Platform commands and the simulated human Golden Path.

Historical generated inventory `当前全量测试用例目录-20260815.md` remains historical until R4 regeneration and must not be interpreted as current frozen acceptance truth.
