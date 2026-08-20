---
docId: DEPLOYMENT-GOVERNANCE-MODULE-PLATFORM-CLI
title: '`platform-cli` Module'
docType: module-index
authority: normative
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
moduleRef: platform-cli
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
- DEPLOYMENT-DOC-02-01
---

# `platform-cli` Module

## Identity

```text
moduleRef: platform-cli
package: @tomflow/proflow-platform-cli
kind: cli
```

## Frozen product surface

```bash
platform install
platform uninstall
platform status
platform setup
platform docs
platform start
platform stop
```

Platform CLI 是薄 orchestration layer：discovery、dependency ordering、forwarding/dispatch、aggregation 与 package-manager transaction orchestration。

它不拥有 Module config/status/setup/docs/start/stop 的业务 truth，不维护 Plan/Apply/Preflight/Verify/Doctor/Manifest/Repair/Upgrade 用户工作流。

## Standard forwarding

```text
platform install   → package sync + Module.install
platform uninstall → Module.uninstall + package remove
platform status    → Module.status
platform setup     → full scan + aggregate Module.setup
platform docs      → Module.docs
platform start     → status gate + Module.start
platform stop      → Module.stop
```

## Setup semantics

`platform setup` 默认遍历全部 discovered Module：READY 跳过，非 READY 调用各自 `Module.setup`，遇到 `ACTION_REQUIRED` 或 `FAILED` 继续扫描，最后一次性返回完整结果。Platform 不生成具体引导内容；它只聚合各包自己的 action/error/data。

定向 `platform setup --module <moduleRef> --input <opaque-json>` 仅用于把某个 Module 真正需要的最小人工输入送回 owning Module。Platform 不解析 input，也不要求用户提供系统可自行确定的 path/token/endpoint/shared fact。

## Workspace semantics

`--workspace` 显式覆盖 cwd；不传时使用当前 Workspace。`.proflow` 是 Workspace/user data，具体 Module-owned artifact 的清理由 `Module.uninstall` 决定。

## Dependency semantics

npm dependency 由 package manager 负责；`provides/requires` 只用于 Module topology、Contract 发现与 start/stop ordering。Platform 不用跨 Module 私有 config 拼装 dependency value。

## Boundary

Module-specific extra commands 可以存在并由 Module 自己维护。Platform 不代理、不理解、不代管。

## Technical docs

- [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md)
- [TODO.md](TODO.md)
