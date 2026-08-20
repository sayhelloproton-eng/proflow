---
docId: PROFLOW-README
title: ProFlow 技术文档总入口
docType: index
authority: normative
lifecycle: active
canonicalFor:
- proflow.documentation.navigation
domain: platform
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# ProFlow 实施规范总入口

> 本目录是 ProFlow **唯一当前实施规范真源**。文档按 DDD 知识边界组织，同时明确 Module / Package / Service / Process / Deployment Unit 的真实工程落点，供人类、Codex/Agent、测试与部署共同使用。

## 1. 阅读层级

```text
Platform
→ Domain
→ Subdomain / Bounded Context
→ Module
→ Contract / Flow / Persistence / Runtime
→ Testing / TODO / Evidence
```

## 2. 五领域

| Domain | Owner 核心 | 主 Bounded Context | 入口 |
|---|---|---|---|
| 任务与编排 | Task/Plan/Node/TaskRoleBinding/TaskDocument | `task-orchestration` | [任务与编排领域](任务与编排领域/README.md) |
| 智能体运行与协作 | Agent Package/Role/Worker/Collaboration/Gateway | `agent-runtime-collaboration` | [智能体运行与协作领域](智能体运行与协作领域/README.md) |
| 执行 | Intent→Effect→Result/Evidence；Local/Browser Effect | `execution` | [执行领域](执行领域/README.md) |
| 模型与推理 | ReasoningSpec/FAST/REASON/AUTO/Provider/Health | `model-reasoning` | [模型与推理领域](模型与推理领域/README.md) |
| 部署 | Module Governance / 七标准管理能力 / External Resource setup / package-version governance | `deployment-governance` | [部署领域](部署领域/README.md) |

公共边界与工程约定见 [平台架构与公共约定](平台架构与公共约定/README.md)。

## 3. DDD 与工程单元

```text
Bounded Context != npm package
Bounded Context != service
Bounded Context != folder
Package != Module != Service != Process != Deployment Unit
```

Task 当前明确包含多个 Subdomain，并以一个 Task Orchestration Bounded Context 承载 v1 模型；其他领域当前各保持一个主 Bounded Context + 多个工程 Module/内部组件。只有真实出现独立模型、语言和边界时才新增 Bounded Context。

## 4. 人类阅读路径

1. 本页。
2. 目标 Domain README / Domain Charter。
3. Ubiquitous Language / Bounded Context Map。
4. Public Contract / Key Flow / Data Ownership。
5. 目标 Module README / TECHNICAL-DESIGN / Runtime。
6. `05-质量与部署`。
7. `06-状态与实施` 与 Module TODO。

## 5. AI / Codex Progressive Disclosure

1. `DOCUMENT-INDEX.json` 定位目标文档。
2. 读取目标 Domain Charter / Model / Context。
3. 读取目标 Public Contract 与 dependency rules。
4. 读取目标 Module README / TECHNICAL-DESIGN / Runtime。
5. 读取 Module TODO 与 Testing/Recovery。
6. 只加载与当前任务直接相关的文档，不全量塞入上下文。

## 6. Runtime Topology

```text
Custom GPT
   │ GPT Actions
   ▼
agent-gateway  ───────────────┐
                              ▼
                        platform-host
                       ┌──────┴──────┐
                       │             │
                  Task Runtime   Agent Runtime
                       │             │
                       └──────┬──────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
             execution-runtime     model-runtime
                    │
                    ▼
        execution-browser-extension
```

`platform-cli` 只负责 Module discovery/ordering/forwarding/aggregation 与 package-manager orchestration；标准命令固定为 `install/uninstall/status/setup/docs/start/stop`，它不是业务 Runtime，也不读取 Module 私有配置。ChatGPT Carrier、Chrome Runtime、Dev Tunnel、Model Provider 等作为 External Resource Module 自治治理。

## 7. Source of Truth

- Domain ownership/model：`01-领域`。
- Public API / dependencies：`02-契约`。
- 流程、状态、持久化、恢复：`03-流程与数据`。
- Module/Package/Service/Runtime：`04-模块` 与平台 `05-平台模块`。
- 质量、部署要求、E2E：`05-质量与部署`。
- 待确认、Known Limitation、Spike、Domain TODO：`06-状态与实施`。
- `DOCUMENT-INDEX.json / MODULE-REGISTRY.json / EXTERNAL-RESOURCE-REGISTRY.json` 是机器导航/治理索引，不覆盖 Markdown 正文语义。

## 8. Implementation Ready Gate

任何 Module 进入 `READY_TO_IMPLEMENT` 前必须能回答：

```text
Domain / Bounded Context 是什么？
Owns / Does Not Own 是什么？
Provides / Requires 是什么？
Package / Service / Process / Deployment Unit 是什么？
Public Contract 在哪里？
Config / Persistence / Runtime 怎么工作？
Failure / Recovery 怎么处理？
怎么测试和验证？
当前 TODO 是什么？
```


## 当前实施基线

进入实现前必须先读取 [`IMPLEMENTATION-BASELINE.md`](IMPLEMENTATION-BASELINE.md)。

## 9. v1 Task Journey / Carrier / Observer 集成基线

跨五领域理解第一版智能体主链时，必须先读取：

- [`PLATFORM-DOC-01-04`](平台架构与公共约定/01-架构/04-Task-Journey-Carrier与Observer-v1集成基线.md)：J0→J6 与 X1→X7 跨域基线；
- [`TASK-DOC-03-05`](任务与编排领域/03-流程与数据/05-Task-Observer推进与异常诊断边界.md)：Task Observer；
- [`AGENT-DOC-03-07`](智能体运行与协作领域/03-流程与数据/07-Worker-Turn与GPT原生能力使用边界.md)：Worker Turn / GPT Native；
- [`MODEL-DOC-03-08`](模型与推理领域/03-流程与数据/08-Task-Diagnostic与System-Assessment推理规范.md)：Task Diagnostic / System Observer REASON。

这些文档不新增第六领域；它们用于消除 Task/Agent/Execution/Model/Deployment 与 Extension/Gateway/platform-host 之间的重复编排语义。
