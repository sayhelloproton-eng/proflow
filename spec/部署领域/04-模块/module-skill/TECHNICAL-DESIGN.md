---
docId: DEPLOYMENT-GOVERNANCE-TECH-MODULE-SKILL
title: '`module-skill` Technical Design Index'
docType: module-design-index
authority: normative
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
moduleRef: module-skill
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-GOVERNANCE-TECH-MODULE-SKILL
---

# `module-skill` Technical Design Index

## Responsibility

AI 开发辅助 Module/Skill，用 Contract/Template/Conformance 创建与升级 Module；不是 Runtime 或部署控制面，也不是 Module 规范或业务知识的第二真源。

## Standard create flow

```text
读取目标 Domain / Module frozen facts
→ 确认 moduleRef / packageName / kind / installClass / domain / summary
→ 调 module-template 稳定 CLI 创建 profile 骨架
→ 填写 Owner 真实 Provides/Requires/API/config/lifecycle/effects/docs
→ 运行 deployment-conformance
→ FAIL 则停止，不通过修改规范/测试来绕过
```

Skill 必须优先调用 Template 的稳定命令，而不是让 AI 手工复制 package 文件或自己写一套 scaffold。

## Allowed creation command

第一版由 `@tomflow/proflow-module-template` 自身 npm `bin` 提供 create command；Skill 只负责指导参数来自哪里、何时 STOP。

Skill 不拥有 Template implementation，不在 SKILL 中复制生成文件正文。

## Existing detailed sources

- [00-五包架构与Module治理模型.md](../00-五包架构与Module治理模型.md)
- [module-template/TECHNICAL-DESIGN.md](../module-template/TECHNICAL-DESIGN.md)
- [01-INSTALL与AI-native部署.md](../../05-#U8d28#U91cf#U4e0e#U90e8#U7f72/01-INSTALL#U4e0eAI-native#U90e8#U7f72.md)

## Boundary Rule

- 不推断 `installClass/domain/summary/Provides/Requires/permission` 等 Owner facts；缺失时 STOP。
- 不 deep import 其他领域实现。
- 不通过修改 Frozen Spec 或测试来让生成物通过。
- Template 负责形式；Contract 负责规则；Conformance 负责验收；Skill 负责 AI 流程编排。
- Module 完成安装后，AI 不应依赖 Platform CLI 内置包知识；先用 `platform modules` 获取当前管理集合，再用 `platform docs` / `platform docs <module>` / `platform docs <module> <documentId>` 读取 package-owned 自描述与文档。
- `platform docs` 聚合 package 自己的 Descriptor、npm `bin/exports` 与 documentation；Skill 不复制各 Module 的 commands/API/职责清单。

## Current validation policy

当前先人工验证“Skill 指导 → Template CLI → 新包骨架 → Platform 可发现”的真实路径；自动化测试用例与 evidence 在人工通过后再更新。
