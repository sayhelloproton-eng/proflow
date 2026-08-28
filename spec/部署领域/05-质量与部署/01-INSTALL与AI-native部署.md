---
docId: DEPLOYMENT-DOC-05-01
title: INSTALL 与 AI-native Deployment
docType: operational-design
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# INSTALL 与 AI-native 部署

## 1. AI-native Golden Path

```text
platform install
→ platform status
→ platform docs（AI 理解 Module）
→ platform setup（一次全量列出全部未 READY Module 的可执行引导）
→ platform status
→ platform start
→ platform status
→ platform stop
```

不存在 `platform modules`、INSTALL.md、Plan/Apply、独立 configure/preflight/verify/doctor/manifest 用户流程。

## 2. Install

Install 分两层，不能混为一谈：

```text
package install
→ Registry discovery + package-manager sync

Module install
→ validate dependency graph
→ frozen deployment install order
→ Module.install
```

package-manager sync 是一次完整 package-set mutation，本身没有用户部署顺序语义。完成 package set 后，Platform 必须使用下列冻结 `Module.install` 顺序，Registry/npm 返回顺序不得影响结果：

```text
01 chrome-runtime
02 execution-browser-extension
03 agent-controller-dev
04 agent-product
05 agent-test-ops
06 agent-gateway
07 dev-tunnel
08 agent-runtime
09 platform-host
10 execution-runtime
11 execution-local
12 model-provider-api
13 model-runtime
14 task-orchestration
15 task-store-sqlite
16 task-migration-runner
17 execution-contracts
18 model-contracts
19 module-contract
20 module-skill
21 module-template
22 deployment-conformance
23 platform-cli
```

`chrome-runtime` 是第一个真实部署动作：已有 Chrome 则复用，macOS 缺失则 owner 自动安装并验证。Browser Extension 第二，三个 Agent Package 随后物化，再进入 Gateway / Tunnel 等后续依赖。该顺序只治理 `Module.install`；`setup/start` 仍服从真实 dependency graph。未知未来 Module 排在冻结序列之后并按稳定 `moduleRef` 排序。

`Module.install` 自己 materialize 所有可确定的 Module-owned state/config/artifact。Platform 不替 Module 创建私有配置，也不把 deterministic 值暴露给用户。

重复 `platform install` 必须可重入；无独立 `platform upgrade`。

## 3. Install success

只证明 package set 已同步且每个 `Module.install` 成功完成；不等于 setup READY，也不等于 runtime RUNNING。

## 4. Status / Docs / Setup

`status` 聚合 Module-owned `setupStatus/runtimeStatus`；`docs` 聚合 `Module.docs`；`setup` 转发 `Module.setup`。

AI 通过 `DOCS.md` 理解能力，通过 `SETUP.md + Module.setup` 一次获得完整未 READY 清单。各 Module 的 setup 以最少用户操作、最少往返、最快 READY 为目标：能自动就自动；必须人工时给出明确 Human Action；每个状态推进 Step 都有 package-owned executable/verify 与成功条件。Platform 不再读取 configSlots 后自行解释“缺什么配置”。

Browser Extension / Custom GPT 的当前 Golden Path 进一步收敛为：用户只执行首次“加载已解压的扩展程序”；随后 Extension hello/heartbeat、Extension ID/session reality、三个 Agent 的 GPT editor materialization、Knowledge 上传、`gpt-5-6`、Capabilities、Action Schema、真实 g-id、Role register 与动态 Auth 回填均由 owning Module + Deployment Provisioning 自动完成。TTY Module.setup 可以 bounded wait 用户完成这一个人工动作并在同一次调用中继续；非 TTY 或超时则返回 ACTION_REQUIRED，重跑 setup 重新观察现实。

## 5. Config ownership

Module 能唯一确定的配置由 `Module.install` 自闭环；跨 Module 值走 Producer-owned Contract/shared fact；只有真实用户选择或外部现实才进入 `Module.setup`。

## 6. Start

`platform start` 只使用 `Module.status` 作为 readiness gate：需要启动的 Module 必须 `setupStatus=READY`，然后按 Runtime dependency order 调用 `Module.start`。没有独立 preflight/validate。

## 7. Uninstall

`platform uninstall` 先按逆依赖顺序调用 `Module.uninstall`，再移除 Workspace package dependencies。Module 决定自己的 owned artifact 保留/清理规则；Platform 不自动删除整个 `.proflow`。

## 8. Workspace identity

不依赖 global current Workspace。Workspace identity 只作为 Platform-local metadata，不成为 Module lifecycle/config truth。
