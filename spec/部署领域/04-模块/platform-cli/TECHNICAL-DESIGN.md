---
docId: DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
title: '`platform-cli` 详细技术方案'
docType: module-design
authority: normative
lifecycle: active
domain: deployment-governance
moduleRef: platform-cli
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
- DEPLOYMENT-DOC-02-01
---

# `platform-cli` 详细技术方案

## 1. Surface

唯一一级命令：`install/uninstall/status/setup/docs/start/stop`。所有 removed Platform command 必须不可 routable，也不可通过别名/隐藏 positional route 复活。

## 2. Core rule

```text
Platform knows who to call and in what order.
Module knows how it works.
```

Platform 允许 discovery、dependency ordering、generic forwarding、aggregation、package-manager orchestration；禁止读取/解释 Module private config，禁止 moduleRef-specific branch，禁止构建 `configByModuleRef` 中间配置总线。

## 3. Install

```text
resolve workspace
→ validate Workspace-local metadata
→ Registry discover complete ProFlow package/version set
→ package-manager sync
→ re-observe installed packages
→ discover/validate descriptors
→ dependency order
→ Module.install
```

Package sync 只把代码包放入 Workspace；真正 capability materialization 由 Module.install 完成。Install 不做 setup 人工动作。

## 4. Uninstall

```text
discover/order
→ reverse order Module.uninstall
→ package-manager remove
```

Platform 不猜 Module-owned state/artifact cleanup。

## 5. Status

调用每个 installed Module 的 `status`，校验统一结果并聚合：

```text
moduleRef/version = discovery metadata
setupStatus = READY | ACTION_REQUIRED | FAILED
runtimeStatus = RUNNING | STOPPED | FAILED | NOT_APPLICABLE
```

没有 `configStatus`、`missingConfig`、整体 Platform readiness 或 verification state。

## 6. Setup

`platform setup` 默认执行**全量扫描与聚合**：

```text
Discover all Modules
→ dependency order
→ observe Module.status
→ READY: skip
→ non-READY: invoke Module.setup
→ continue after ACTION_REQUIRED / FAILED
→ aggregate every result once
```

全量 setup 不得 fail-fast。其目的不是替 Module 决策，而是让 AI/用户一次看到当前所有 Module 的可执行引导和机器 blocker，减少反复运行命令才能知道下一件事的往返成本。

Platform 原样保留并校验 Module 返回的结构化 setup steps，但不理解 Microsoft、Chrome、Custom GPT、Tunnel、Model 等业务事实。`platform setup --module <moduleRef>` 只定向重新观察某个 Module；人工或 AI 输入由 Module-owning setup CLI 通过明确参数收集，Platform 不接受原始 JSON input。

Module 的 setup 实现必须优先自动执行所有 machine-owned 步骤，只把真正的用户/外部选择留给 `ACTION_REQUIRED`。Platform 不允许因“方便引导”重新变成 config bus。

## 7. Docs

`platform docs` 调用 `Module.docs` 并聚合。Platform 不读取 Module 私有 config，也不根据 configSlots 拼配置指南。

标准知识文档为 `DOCS.md` 与 `SETUP.md`；Module-specific 其它业务文档可以存在，但不形成新的 Platform 标准管理面。

## 8. Start

```text
Discover
→ build provides/requires order
→ Module.status
→ require setupStatus=READY for applicable runtime Modules
→ Module.start in order (fail-fast)
```

没有 Platform preflight/validate 第二阶段。start 中途失败不自动 rollback。

## 9. Stop

逆依赖顺序调用 `Module.stop`，fail-fast。Platform 不做 verify/repair。

## 10. Package manager primitive

Platform 继续拥有 npm/pnpm/yarn selection、safe argv、package synchronization/removal 与 installed-version observation；这些只能服务 package graph，不能变成 Module config owner。

## 11. Module command binding

Platform 直接加载/调用 package-owned 标准 command adapter。允许 generic schema validation，不允许 `createProductionBinding(configByModuleRef)` 或任何 Module-specific composition。

运行型 Module 的内部 process entrypoint 可以存在，但只由 Module.start/stop 的实现拥有；不得成为 Platform 第二套 lifecycle。

## 12. Workspace metadata

只保留 canonical Workspace identity 与 Platform 自己需要的最小 metadata。Module 私有 state/config 不进入 Platform persistence。

## 13. Delete gate

每个旧 binding/config/docs/lifecycle middleman 删除前必须满足：CodeGraph caller count = 0 且精确文本 import/reference count = 0。若删除 `configByModuleRef` 后出现跨 Module 必需事实却没有 Producer-owned Contract，立即 `STOP = SHARED_FACT_CONTRACT_MISSING`，不得重建 config bus。

## Setup 加速合同

`platform setup` 每次都必须一次遍历全部 discovered Module；`READY` 跳过，`ACTION_REQUIRED/FAILED` 继续扫描并最终全量聚合。Platform 只转发/聚合，不解释步骤。各 Module 的 `SETUP.md` 必须以最短闭环 Step 描述；每个状态推进 Step 有 package-owned executable/verify 与 Success Condition。自动化优先，只有真实人工或外部动作才能要求用户输入，目标是最少操作、最少往返、最快 READY → start。
