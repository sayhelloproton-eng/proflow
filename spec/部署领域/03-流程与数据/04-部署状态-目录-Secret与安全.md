---
docId: DEPLOYMENT-DOC-03-04
title: Workspace 元数据、目录、Secret 与安全
docType: persistence-security
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# Workspace 元数据、目录、Secret 与安全

## 1. Workspace 模型

Workspace 根继续承载真实 package manifest/lockfile、用户源码和 `.proflow`：

```text
workspace/
├── package.json
├── <package-manager lockfile>
├── src/
├── docs/
└── .proflow/
```

`.proflow` 属于 Workspace / 用户数据，不等同于“当前已安装”。

## 2. `.proflow` 的保留语义

它可以包含：

```text
Workspace-local identity / binding metadata
Module config
runtime-local data / logs / cache
用户历史记录
凭据引用
```

因此 `platform uninstall` 永远不自动删除 `.proflow`。历史 `.proflow` 可以在 reinstall 时继续存在并被校验/复用。

旧 `.proflow/deployment/plans`、verification index、generated `INSTALL.md`、apply state 不再是当前 Platform CLI 必需状态。

## 3. Binding

Binding 只是 Workspace-local identity metadata，不再存在 global binding lifecycle、tombstone 或 `INSTALLING/UNINSTALLING/BROKEN` 状态机。

Install 只在成功同步 package + descriptor 后初始化/复用最小 metadata；metadata 与当前 Workspace 明显冲突时 fail-closed。

## 4. Config ownership

Module owns config semantics。Platform 只允许保存/读取通用 Workspace config 载体，不理解 Browser/Model/Gateway 私有字段。

特殊物理材料化必须由 owning Module 显式提供能力，不得把领域文件逻辑重新搬进 Platform。

## 5. Secret

- raw secret 不进入 CLI JSON、日志、docs 聚合或通用 evidence；
- Module 只读取自己声明的敏感 config slot；
- 受控文件需限制权限；
- Platform 不建立新的 Vault Service，也不复制领域 credential 语义。

## 6. 原子性

只为六命令所需的最小 Workspace-local metadata 使用安全原子写。旧 Plan/Apply persistence 与 exclusive apply lock 在零 caller 后删除。
