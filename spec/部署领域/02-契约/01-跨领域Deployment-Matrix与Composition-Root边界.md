---
docId: DEPLOYMENT-DOC-02-01
title: 跨领域 Deployment Matrix 与 Composition Root 边界
docType: dependency-index
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 跨领域 Deployment Matrix 与 Composition Root 边界

> 本文只描述 Deployment 编排边界，不重新定义各领域业务合同。

## 1. 统一治理模型

| Module 类型 | Module 自己拥有 | Platform CLI 只做 |
|---|---|---|
| 所有 governed Module | `install/uninstall/status/setup/docs/start/stop` 标准管理真源 | discovery / ordering / forwarding / aggregation |
| 有独立 runtime 的 Module | 真实 process/service composition 与 runtime status | 调用标准 start/stop，不理解内部实现 |
| 无独立 runtime 的 Module | no-op start/stop + `NOT_APPLICABLE` | 原样聚合 |
| 有人工/外部依赖的 Module | 最短 setup workflow / ACTION_REQUIRED / reality observation / package-owned executable+verify | 全量转发并聚合 setup，不保存 step state |
| 有 extra capability 的 Module | verify/doctor/migrate/role/create 等自身命令 | 不代理、不解释 |

Platform 不把领域私有 `health/config/verification` 逻辑复制进自身，也不读取 Module 私有 config。

## 2. Runtime topology

`provides/requires` 只表示 Module contract 与顺序关系：

- `platform install/setup/start` 可用于依赖顺序；
- `platform stop/uninstall` 使用逆依赖顺序；
- `platform docs` 只聚合 Module.docs，不把 topology 翻译成配置值。

它们不参与 npm package dependency closure；不存在 `installRequires`，也不得被 Platform 用作 shared-fact config copy。

## 3. Application Composition Root

`@tomflow/proflow-platform-host` 仍是 Application Composition Root / Local Platform Host：负责 instantiate、dependency injection、local transport 与自身生命周期；不拥有其它领域业务状态。

Task Runtime、Agent Runtime 保持独立 npm package并由 host in-process 装配；Execution Runtime、Model Runtime、Agent Gateway 保持独立运行型 Module。任何领域 package 不得反向依赖 platform-host。

## 4. 当前关键逻辑能力绑定

| Module | Provides | Requires |
|---|---|---|
| `execution-contracts` | — | — |
| `execution-local` | `execution-local` | — |
| `execution-runtime` | `execution` | `execution-local` |
| `model-contracts` | — | — |
| `model-provider-api` | `model.provider.api` | — |
| `model-runtime` | `model-inference` | `model.provider.api` |
| `platform-host` | `platform-host` | `task-orchestration`, `agent-runtime`, `execution`, `model-inference` |

纯 Contract library 不冒充 Runtime provider。Repository architecture gate 只验证 Runtime `provides/requires` 的 unresolved/incompatible/cycle 等一致性，不再验证 install closure。

## 5. 外部资源

Chrome Runtime、ChatGPT Carrier、Dev Tunnel、Model Provider 等由对应 Module 自描述。deterministic preparation 归 `Module.install`；`platform setup` 一次遍历全部非 READY Module。Module 内部能自动完成的步骤必须自动完成；只有真实人工/外部动作返回 `ACTION_REQUIRED`，并给出 package-owned executable/verify 与成功条件；Platform 只聚合，不建立独立 Human Action workflow engine。

## 6. Composition boundary

新增符合 Module Contract 的 package 后，应自动进入 discovery，并由 Platform generic 转发七标准能力；不允许为了某个领域再向 Platform CLI 添加 module-specific if/else，也不允许 Platform 代理 Module-specific extra command。
