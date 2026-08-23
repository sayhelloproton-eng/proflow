---
docId: DEPLOYMENT-DOC-03-01
title: 七命令编排流与失败边界
docType: runtime-flow
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 七命令编排流与失败边界

> 旧 Plan / Apply / Resume 产品流程已退休。本文给出当前薄 Platform CLI 的运行流。

## 1. 总原则

```text
用户意图 = 七个 Platform 命令
Module 真实行为 = Module 标准能力
Platform = discovery / ordering / forwarding / aggregation
```

Platform 不再生成 `planRef/stepRef/applyRef/resumeRef`，也不维护部署事务状态机或 Module 私有 config bus。

## 2. Install

```text
Resolve Workspace
→ Registry / package-manager 同步 package set
→ 重新发现 Module
→ dependency order
→ Module.install
```

失败即失败；不进入 Plan/Apply recovery。Module.install 自闭环 deterministic materialization。

## 3. Status / Docs / Setup

`status` 只聚合 Module.status；`docs` 只聚合 Module.docs；`setup` 按 dependency order 全量观察 Module。READY 跳过；非 READY Module 在其全部 required provider `setupStatus=READY` 时才转发 `Module.setup`。若任一 required provider 尚未 READY，Platform 只基于 generic dependency graph 把该 Module 记录为 `BLOCKED` 并跳过其 setup 调用，同时继续扫描其它独立 Module；provider 在同一次 setup 调用中完成后，后续依赖 Module 可以继续执行。所有 `ACTION_REQUIRED/BLOCKED/FAILED` 最终一次性聚合；Platform 不在第一个 blocker 停止，也不理解具体业务原因。

该 dependency-readiness observation 只存在于当前命令内存中，用于 generic ordering/gating，不是 Module config bus 或持久化 resume state。

## 4. Start

```text
Discover
→ Build dependency order
→ Module.status
→ require setupStatus=READY
→ Module.start in dependency order (fail-fast)
```

没有独立 validate/preflight。Start 中途失败时后续 Module 不再启动；已成功启动者保持真实现状，Platform 不自动 rollback/retry/repair。

## 5. Stop

逆依赖顺序调用 `Module.stop`，fail-fast；不隐式执行其它命令。

## 6. Uninstall

```text
Discover
→ reverse dependency order
→ Module.uninstall
→ package-manager remove
```

Platform 不猜 Module cleanup；不自动删除整个 `.proflow`。

## 7. Human / Web 操作

登录、浏览器加载、Custom GPT、Tunnel、Provider 等动作归 owning Module.setup。每个 Module 的 `SETUP.md` 必须给出最短 Step 路线；每个状态推进 Step 必须有 package-owned executable 或 verify command。`ACTION_REQUIRED` 只用于真实人工/外部动作，并与其它 Module 的引导一起聚合；再次执行 setup 时重新观察现实，不依赖 Platform resume state。

Browser Extension 首次部署的正常 TTY happy path 固定为：

```text
Module.setup 准备 unpacked extension / local credential / bridge config
→ 打开 chrome://extensions
→ 提示用户执行唯一人工动作：加载已解压的扩展程序
→ Module.setup 在 bounded window 内等待真实 Extension hello + heartbeat
→ heartbeat 到达后自动验证 extension/session reality
→ setupStatus=READY
→ dependency order 后续 Agent Package setup 才可进入 Custom GPT 自动 Provisioning
```

Extension ID、Service Worker online、heartbeat、Custom GPT editor 字段填写、Knowledge 上传、model/capabilities、Action Schema、g-id 读取等 machine-owned Web reality 不得要求用户复制/声明。非 TTY 或用户未在 bounded window 内完成加载时，Module.setup 返回明确 `ACTION_REQUIRED` 与 rerun command；Platform 本身不保存 resume state。

不存在 `platform configure/repair/doctor/apply` 作为替代入口。
