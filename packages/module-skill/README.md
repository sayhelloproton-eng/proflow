# @tomflow/proflow-module-skill

- Module: `module-skill`
- Kind: `library`
- Owner: `deployment-governance`

AI 开发辅助 Skill：用已冻结的 Contract / Template / Conformance 创建与维护 ProFlow Module，不自创新规范，不成为第二业务 Runtime。主要 Artifact 是 [`SKILL.md`](./SKILL.md)。

规范真源：

- `spec/部署领域/04-模块/module-skill/README.md`
- `spec/部署领域/04-模块/module-skill/TECHNICAL-DESIGN.md`
- `spec/部署领域/04-模块/module-skill/TODO.md`
- `spec/部署领域/07-测试计划/modules/module-skill.md`

## DOC_CLARIFICATION_RESIDUAL

Registry / document taxonomy 将 `module-skill` 的 `kind` 标注为 `agent-skill`，但 `module-contract` 的 `ModuleKind` 枚举不含 `agent-skill`，且本 Wave 禁止为 `agent-skill` 修改 `module-contract`。因此 runtime `ModuleDescriptor.kind` 采用 `library`（无 service/process，纯静态 Skill policy artifact）。不修改 Spec，不阻断实现。
