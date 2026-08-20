---
docId: DEPLOYMENT-DOC-04-00
title: 五包架构与 Module 治理模型
docType: module-map
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 五包架构与 Module 治理模型

## 1. 五包职责

### `module-contract`
定义 Module identity/kind/version、轻量 package discovery metadata、provides/requires、标准七能力、统一 operation result 与 `setupStatus/runtimeStatus` 状态合同。

### `module-template`
生成符合冻结模型的标准 Module 工程形式：descriptor、adapter、七标准能力、`DOCS.md`、`SETUP.md` 与 package-owned setup executable/verify seam。`SETUP.md` 必须表达最短闭环步骤，而不是纯 prose。Template 不生成 `CONFIGURATION.md`，也不生成 Platform-owned preflight/verify/doctor 心智。

### `deployment-conformance`
机械验证 package metadata、descriptor/manifest equality、七标准 adapter commands、DOCS/SETUP 与治理边界；不验证业务正确性，不要求 `createProductionBinding` 或 Platform config bus。

### `platform-cli`
一级命令固定：

```text
install uninstall status setup docs start stop
```

职责只包含 Registry/Workspace discovery、ordering、forwarding、aggregation 与 package-manager transaction orchestration。

### `module-skill`
AI 开发辅助，只消费 Contract/Template/Conformance 与七命令产品真源；负责检查 Module setup 是否从“当前 reality → 自动步骤 → 最小人工动作 → package-owned verify → READY”闭环，不得重新发明 Platform-owned validation/config bus/Plan/Apply/Verify/Doctor。

## 2. Module 分类

`ModuleKind` 可继续区分 library/service/cli/browser-extension/agent-package/external-resource 等工程 profile，但所有 governed Module 都提供相同七标准能力。

## 3. 三个层级

```text
Module = 统一治理身份
Module Package = npm 承载物
Runtime Unit = 真实具备运行生命周期的实现
```

Library 不伪造独立 process；其标准 `start/stop` 可以 no-op，`runtimeStatus=NOT_APPLICABLE`。

## 4. 三层事实来源

```text
npm Registry
= 可同步的 ProFlow package/version set

Workspace package.json + package resolution
= 当前真实 package installation state

Package-owned descriptor + adapter + DOCS/SETUP
= Module topology / management / knowledge truth
```

Platform 不维护第二份业务或配置真源。

## 5. provides / requires

用于 Module topology、Contract discovery 与 start/stop ordering；不替代 npm dependency graph，也不把 shared fact 变成 Platform config copy。

## 6. 治理链

```text
Create / Adopt
→ Template
→ Descriptor / Adapter / DOCS / SETUP
→ Conformance
→ Release
→ platform install
→ platform status
→ platform setup
→ platform start / stop
→ platform uninstall
```

新增合规 Module 不需要修改 Platform CLI module-specific 业务代码；Module-specific extra command 也不进入 Platform 代理面。

## 7. Setup 闭环治理

```text
platform setup
→ 全量发现与依赖排序
→ READY Module 跳过
→ 其余 Module.setup 全部执行
→ Module 自己自动完成可自动步骤
→ 一次聚合全部 ACTION_REQUIRED / FAILED
→ 用户只提供真正不可自动获得的最小输入
→ package-owned verify
→ Module.status.setupStatus = READY
→ platform start
```

Platform 只拥有“发现、排序、转发、聚合”。具体步骤、脚本、材料、验证与恢复全部属于 owning Module。治理优先级固定为：**能自动就自动；必须人工才问；能一次问完不分多次；能脚本验证不靠口头确认。**
## Setup 加速不变量

`platform setup` 每次都必须扫描全部 discovered Module：`READY` 跳过，非 READY 继续调用 owning `Module.setup`；遇到 `ACTION_REQUIRED` 或 `FAILED` 也不得提前停止，最后一次性聚合完整清单。具体配置知识与步骤只属于各 Module。每个需要推进 setup 状态的 Module 必须以最短路径闭环：能自动就自动，真正人工动作才返回 `ACTION_REQUIRED`；对应 `SETUP.md` Step 必须提供 package-owned executable/verify 与 Success Condition，目标是最少用户操作、最少往返、最快达到 `setupStatus=READY` 并可启动。
