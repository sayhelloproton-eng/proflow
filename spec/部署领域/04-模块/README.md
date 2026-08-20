---
docId: DEPLOYMENT-GOVERNANCE-MODULE-REGISTRY
title: 部署领域｜Module Registry
docType: module-registry
authority: normative
lifecycle: active
domain: deployment-governance
canonicalFor:
- deployment-governance.module-registry
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 部署领域｜Module Registry

> Module 是治理身份，不自动等于 Service 或 Process；Package 自己拥有状态、配置与生命周期真相，Platform 只聚合/分发。

| moduleRef | package | kind | technical docs |
|---|---|---|---|
| `module-contract` | `@tomflow/proflow-module-contract` | library | [module-contract](./module-contract/README.md) |
| `module-template` | `@tomflow/proflow-module-template` | library | [module-template](./module-template/README.md) |
| `deployment-conformance` | `@tomflow/proflow-deployment-conformance` | library/cli | [deployment-conformance](./deployment-conformance/README.md) |
| `platform-cli` | `@tomflow/proflow-platform-cli` | cli-app | [platform-cli](./platform-cli/README.md) |
| `module-skill` | `@tomflow/proflow-module-skill` | agent-skill | [module-skill](./module-skill/README.md) |

## 规则

- Runtime cross-module dependency 只通过 `provides/requires`；npm dependency 由 package manager 负责。
- 所有 governed Module 都提供 `install/uninstall/status/setup/docs/start/stop`；Library 的 runtime 生命周期可用 `NOT_APPLICABLE` 表达，不伪造独立 process。
- Platform CLI 不实现 Module 私有验证/health/config truth，只发现、排序、转发和聚合。
- `Module.install` 自动闭环 deterministic materialization；Producer-owned shared fact 不要求用户搬运。
- `Module.setup` 只保留真实用户/外部动作，并以最少交互尽快到 READY。每个 `SETUP.md` Step 都必须有 package-owned executable/verify；纯人工步骤至少具备 prepare/verify 命令。
- 不存在 Core/installRequires 安装模型，也不存在 package-owned 单包 install 产品入口。
## Setup 加速不变量

`platform setup` 每次都必须扫描全部 discovered Module：`READY` 跳过，非 READY 继续调用 owning `Module.setup`；遇到 `ACTION_REQUIRED` 或 `FAILED` 也不得提前停止，最后一次性聚合完整清单。具体配置知识与步骤只属于各 Module。每个需要推进 setup 状态的 Module 必须以最短路径闭环：能自动就自动，真正人工动作才返回 `ACTION_REQUIRED`；对应 `SETUP.md` Step 必须提供 package-owned executable/verify 与 Success Condition，目标是最少用户操作、最少往返、最快达到 `setupStatus=READY` 并可启动。
