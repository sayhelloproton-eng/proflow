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
platform modules
platform docs
platform install
platform uninstall
platform start
platform stop
```

Platform CLI 是薄 orchestration layer：discovery、aggregation、dispatch、Runtime dependency ordering 与 package-manager transaction orchestration。

它不拥有 Module config/status/health/lifecycle truth，不维护 Plan/Apply/Verify/Doctor/Manifest/Repair/Upgrade 用户工作流。

## Workspace semantics

Install 使用 `--workspace` 或 cwd；其它命令以 cwd 为 Platform Instance。`.proflow` 是 Workspace/user data，uninstall 不删除。

## Dependency semantics

npm dependency 由 package manager 负责；`provides/requires` 只用于 Runtime topology、docs 与 start/stop ordering。

## Technical docs

- [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md)
- [TODO.md](TODO.md)
