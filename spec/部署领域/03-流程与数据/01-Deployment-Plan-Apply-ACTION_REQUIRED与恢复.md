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

`status` 只聚合 Module.status；`docs` 只聚合 Module.docs；`setup` 只转发 Module.setup。三者都不替 Module 做业务判断。

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

登录、浏览器加载、Custom GPT、Tunnel、Provider 等动作归 owning Module.setup。`ACTION_REQUIRED` 原样透传；再次执行 setup 时重新观察现实，不依赖 Platform resume state。

不存在 `platform configure/repair/doctor/apply` 作为替代入口。
