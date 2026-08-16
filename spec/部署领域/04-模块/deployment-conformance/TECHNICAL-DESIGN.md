---
docId: DEPLOYMENT-DEPLOYMENT-CONFORMANCE-TECH-DESIGN
title: '`deployment-conformance` 详细技术方案'
docType: module-design
authority: normative
lifecycle: active
domain: deployment-governance
moduleRef: deployment-conformance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-DEPLOYMENT-CONFORMANCE-TECH-DESIGN
---

# `deployment-conformance` 详细技术方案

## 1. 定位

Conformance 回答：

> “这个 Module 是否具备统一发现、安装、管理、诊断、升级/卸载和 AI 自描述所需的真实形式？”

它不替代领域业务测试，也不替代真实外部环境 E2E。

## 2. Gate C1：Static Contract

检查：

- `ModuleDescriptor` runtime schema；
- moduleRef/packageName/moduleVersion；
- Module Kind；
- `installClass: core | optional`；
- `identity.domain / identity.summary`；
- templateVersion/platformCompatibility；
- Provides/Requires version 格式与冲突；
- Requirements 零副作用描述；
- Config Slot schema；
- Lifecycle 与 Kind 自洽；
- Verification Contract；
- Effects + cleanup retention；
- package-owned Documentation entries；
- External Resource version 语义。

额外不变量：

- documentation id 不重复；
- documentation path 必须是 package-relative path，不允许 URL/绝对路径；
- 任一 effect 声明 `retention=remove` 时，Module 必须声明 package-owned `uninstall` lifecycle；
- library 继续禁止 process lifecycle/process effect；
- service 必须有 process effect，并声明真实 status/start/stop/restart/verify；
- Conformance 不因为统一接口强迫无副作用 library 伪造 uninstall。

## 3. Gate C2：Package

检查：

- package exports；
- TypeScript 类型；
- runtime schema 可用；
- 标准 CLI/adapter entry；
- stable result/error；
- secret 不泄漏；
- template compatibility；
- npm package version 与 Descriptor 一致；
- `package.json.proflow.module === true`；
- `package.json.proflow.installClass` 与 Descriptor 完全一致；
- `package.json.proflow.descriptor` 存在且指向 package-owned descriptor build artifact；
- package name 必须满足正式 `@tomflow/proflow-*` 规则；
- Descriptor documentation entries 指向 package 内真实文件；
- package 发布内容必须包含 Descriptor/README/Conformance 所需入口。
- 每个正式 Module 必须提供稳定的 package-owned `npx <package> install` 入口；若 package 已有同名业务 CLI，则复用该 CLI 的 `install` 分支，不覆盖原业务命令；否则使用 Template 生成的 `self-install.mjs`；
- `self-install.mjs` 必须随 npm package 发布，并只委托 Platform CLI 的 `install <self-package>`，不得复制第二套 Registry/Package Manager 安装逻辑；
- `platform-cli` 自身使用既有 `platform` executable 作为安装入口，不生成递归 self-install delegator。

`package.json.proflow` 只作为 Registry/Workspace Discovery 的轻量索引，完整能力事实仍以 Descriptor 为准；两者冲突必须 FAIL，不能由 CLI 猜哪一份是真的。

## 4. Gate C3：Behavior

对声明的 primitive 做合同级行为验证：

- `describe` 可读；
- `preflight` 无副作用；
- `status` 不伪造 READY；
- `verify` 返回真实 PASS/FAIL；
- `doctor` 默认无修复副作用；
- 声明 start/stop/restart/migrate 时验证基本行为和错误语义；
- 声明 uninstall 时验证 package-owned cleanup operation 使用 structured result，且不得越过 Descriptor 声明的 effect ownership/retention；
- ACTION_REQUIRED 可恢复语义。

C3 不负责 npm package manager remove；该动作由 Platform CLI 统一执行。

## 5. 不验证什么

不判断：

- Model REASON 是否真的足够聪明；
- Browser CREATE/WAKE 的全部业务 E2E；
- Task 状态机是否业务正确；
- Agent askPeer/replyPeer 是否完整；
- npm Registry 当前是否真的有某个发布版本；
- 用户真实 Workspace 是否已经安装成功。

这些分别由对应领域 Gate、Package Release Gate 或 Real Deployment 验证。

## 6. 执行位置

同一套 Conformance 用于：

```text
本地开发
CI
Package Release Gate
Upgrade Plan 前置检查
Template Migration 后复验
```

## 7. External Resource

Conformance 可以用 fake resource 验证 Adapter contract；真实资源可用性属于 deployment `verify`，不能让 CI 强依赖用户外部账号。

External resource/browser/agent carrier 的真实远端/用户状态默认不得被 Template 或 Conformance 假定可 destructive cleanup。

## 8. AI-readable Module Self-description

Conformance 必须确保 Platform CLI 可以机械聚合当前安装 Module 的自描述：

- identity/domain/summary；
- Provides/Requires；
- lifecycle；
- documentation entries；
- effects/retention。

Conformance 只检查索引完整性和文件存在性，不替代领域文档内容审计。

## 9. Custom GPT / Actions Conformance Profile

当 Module/Agent Package 声明 `custom-gpt` Carrier 时，继续执行现有 Custom GPT / File Bridge 静态与行为门。该 profile 与本轮 Module package discovery/cleanup 自描述增强并列，不互相替代。

## 10. Carrier Reuse First conformance alignment

继续验证 Product GPT mainline、Controller/Test Execution request-intent、Agent Package native capability requirement 等既有 frozen alignment；真实 ChatGPT Web 行为仍由 Carrier E2E 证明。

## 11. 当前测试纪律

本轮先更新规范与实现，不修改正式测试用例/测试计划/evidence。人工 Real-1 验证通过后再补自动化回归，避免把尚未验证的实现提前固化为测试真源。
## Service process conformance

Formal `service` packages must publish a package-owned business CLI, export the same entry through `./cli`, and expose `createServiceProcessBinding` from `deployment/adapter.ts`. A service package whose executable is only a generic self-install shim is non-conformant because Platform CLI needs a stable package-owned long-running process entry for detached supervision.


### Static Manifest Conformance

C1/C2 MUST additionally prove:

- `package.json.proflow.manifest === "./proflow.module.json"`；
- `proflow.module.json` 存在且满足完整 Module Contract；
- npm `files` allowlist 会发布该 manifest；
- static manifest 与 runtime `deployment/descriptor` canonical value 完全一致。

任何 manifest/Descriptor 漂移都属于 Conformance FAIL；Registry upgrade 不得信任一个无法与 runtime truth 对齐的发布包。
