# @tomflow/proflow-module-skill

- Module: `module-skill`
- Runtime kind: `library`
- Product taxonomy: `agent-skill`
- Install class: `core`
- Owner: `deployment-governance`

AI 开发辅助 Skill：读取目标 Domain/Module 的正式事实，调用 `@tomflow/proflow-module-template` 的稳定 create CLI 生成标准骨架，再用 Deployment Conformance 验收。Skill 不自创新规范、不复制模板实现、不成为第二业务 Runtime。

主要 Artifact 是 [`SKILL.md`](./SKILL.md)。

规范真源：

- `spec/部署领域/04-模块/module-skill/README.md`
- `spec/部署领域/04-模块/module-skill/TECHNICAL-DESIGN.md`
- `spec/部署领域/04-模块/module-template/TECHNICAL-DESIGN.md`

`agent-skill` 仅是产品/文档 taxonomy；runtime `ModuleDescriptor.kind` 继续使用现有 `library`，不新增第二种 runtime ModuleKind。
