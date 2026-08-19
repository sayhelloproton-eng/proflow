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
| library/in-process | config/status truth（适用时） | discovery / docs aggregation |
| service | validate/status/start/stop | dependency ordering + dispatch |
| browser-extension | config/materialization/status/validate | aggregation + dispatch |
| agent-package | carrier/config/status knowledge | aggregation + dispatch |
| external-resource | config/status/validate/lifecycle（真实支持时） | aggregation + dispatch |

Platform 不把领域私有 `health/config/verify/doctor` 逻辑复制进自身。

## 2. Runtime topology

`provides/requires` 只表示 Runtime Module contract 与顺序关系：

- `platform docs` 聚合并展示；
- `platform start` 用于依赖顺序；
- `platform stop` 用于逆依赖顺序。

它们不参与 npm package 安装 closure；不存在 `installRequires`。

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

Chrome Runtime、ChatGPT Carrier、Dev Tunnel、Model Provider 等由对应 Module/Adapter 自描述。需要人工动作时由 Module 自己返回可执行信息；Platform 不建立独立 Human Action workflow engine。

## 6. Composition boundary

新增符合 Module Contract 的 package 后，应自动进入 discovery/docs/status/lifecycle dispatch，不允许为了某个领域再向 Platform CLI 添加 module-specific if/else。
