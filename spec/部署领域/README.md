---
docId: DEPLOYMENT-DOMAIN-README
title: 部署领域
docType: domain-index
authority: normative
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 部署领域

> Module Governance、七标准管理能力、External Resource setup/status 与版本治理。本目录同时表达 DDD 领域边界和真实工程实现路径。

## 推荐阅读顺序

1. `01-领域/01-领域宪章与Bounded-Context-Map.md`
2. `01-领域` 其余领域模型/不变量文档
3. `02-契约`
4. `03-流程与数据`
5. `04-模块`
6. `05-质量与部署`
7. `06-状态与实施`

## Modules

- [module-contract](04-模块/module-contract/README.md)
- [module-template](04-模块/module-template/README.md)
- [deployment-conformance](04-模块/deployment-conformance/README.md)
- [platform-cli](04-模块/platform-cli/README.md)
- [module-skill](04-模块/module-skill/README.md)

## 文档职责

- `01-领域`：Why、Ownership、Ubiquitous Language、Bounded Context、当前设计不变量。
- `02-契约`：Public Contract、Provides/Requires、跨域 ACL。
- `03-流程与数据`：状态、流程、持久化、并发、幂等、失败恢复。
- `04-模块`：Module → npm package/service/process/deployment unit 技术设计。
- `05-质量与部署`：安全、测试、E2E、实施/停止门、部署 requirements。
- `06-状态与实施`：明确待确认项、PENDING_SPIKE、Known Limitation 与 Domain TODO。

## 实施原则

其他领域只能依赖本领域 Public Contract / logical capability；禁止 direct DB read、internal repository/adapter、deep import 或状态镜像。Module TODO 不得重新定义领域模型。

Setup 的产品目标固定为：**用最少用户操作、最少往返、最快达到全部 required Module `setupStatus=READY` 并进入 `platform start`**。`platform setup` 默认全量聚合；具体配置流程由各 Module 自己闭环。机器能完成的步骤必须自动完成，用户只处理真实外部选择/动作；每个 setup Step 都必须有 package-owned executable/verify 路径。

## 历史 Freeze 证据

`08-测试用例与验证/DEPLOYMENT-FINAL-FREEZE-20260901.json` 保留为 2026-09-01 Deployment 真实产品验收的历史 freeze 证据；它不再声明当前 package release line。当前版本事实以各 package manifest、Workspace lockfile、Module `status` 与实际 materialized/runtime reality 为准，后续 Real-3/patch release 不倒写历史 freeze 证据。

`DEPLOYMENT-CLI-0.1.36-FREEZE-EVIDENCE.json` 继续保留为 2026-08-21 的历史 release freeze，同样不得覆盖或冒充当前版本真源。

## Carrier / Journey 对齐

Deployment 负责三个固定 Custom GPT Role 对应 Module 的标准 setup/status/docs 接缝，以及 Action auth/schema、File Bridge/Code Interpreter/Web Search capability requirement 与 Chrome/Carrier external-resource readiness。当前 v1 已发布 Action schema 的每个 operation 必须显式 `x-openai-isConsequential: false`；Deployment 负责验证已发布 material 与声明一致，但**不得把 `Always Allow` 当作 setup 配置项、Role READY 条件或权限真源**。

若 ChatGPT 仍出现 Action Permission surface，它属于 Browser Carrier 的机械 gate/recovery reality，由 Carrier 基于当前 Role/Worker/target/operation/session 事实分类和处理；它不是 Deployment 配置，也不是 Execution Approval。Deployment 不拥有 Task Worker c-id、Task/System Observer 或 Worker Turn；System Observer 只能读取 Module 当前真实 status 与公开 deployment summary。Role READY 是 behavior/capability/auth/reality based，exact model id 不是真源。
